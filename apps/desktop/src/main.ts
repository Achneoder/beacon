import { BrowserWindow, app, dialog, ipcMain, powerMonitor, session } from 'electron';
import { CONNECT_LINK_SCHEME, parseConnectLink } from '@beacon/shared';
import { ApiClient, instanceProbe } from './api.js';
import { discoverInstance, type ProbeFailure } from './discovery.js';
import { toLanguage, t, type Language, type MessageKey } from './locales.js';
import { FileOutbox, clearOutbox, outboxPath } from './outbox.js';
import {
  DEFAULT_SETTINGS,
  apiUrlFor,
  readSettings,
  settingsPath,
  writeSettings,
  type Settings,
} from './settings.js';
import { effectiveServer, linkFromArgv, provisioningPaths, readProvisioning } from './provisioning.js';
import { Tracker, withTimeout, type PauseReason } from './tracker.js';
import { StatusTray, stateLabel } from './tray.js';
import { createAppWindow, createConnectWindow } from './window.js';

/**
 * The Beacon desktop client.
 *
 * The window shows the served web app; **the main process owns the clock**. That split
 * is the whole design: the events worth tracking — the app closing, the machine going
 * to sleep, the screen locking — all happen when there may be no window left to ask,
 * and a renderer that is being torn down cannot be relied on to finish an HTTP request.
 * Everything the user reads inside the window still comes from `apps/web`, unmodified.
 *
 * See `tracker.ts` for what actually decides when the clock starts and stops, and
 * `discovery.ts` for how a typed or provisioned address is verified as Beacon before
 * this process ever trusts it — the app ships as one generic build for every customer,
 * so the backend it talks to is never known until runtime.
 */

/** How often to re-read the server while a window is open. */
const TICK_MS = 60_000;
/** How long a shutdown path may wait for the network before giving up on it. */
const SHUTDOWN_BUDGET_MS = 3_000;

let settings: Settings = { ...DEFAULT_SETTINGS };
let tracker: Tracker | null = null;
let tray: StatusTray | null = null;
let appWindow: BrowserWindow | null = null;
let connectWindow: BrowserWindow | null = null;
let ticker: NodeJS.Timeout | null = null;
let lockTimer: NodeJS.Timeout | null = null;
let quitting = false;
/** Set when the connect window is showing a failure rather than a first-run prompt. */
let connectFailure = false;
/** True once an administrator's provisioning enforces the server address. */
let locked = false;
/** Set when a provisioned address failed its startup probe — see `resolveServer`. */
let provisionFailure: { url: string; reason: ProbeFailure } | null = null;
/** A `beacon://` link's address, waiting for the connect screen to prefill it. */
let pendingLinkUrl: string | null = null;
/** A link that arrived before `start()` finished — macOS can deliver one at launch. */
let queuedLinkServer: string | null = null;
let started = false;
/** Guards `setup:submit` against a second probe firing before the first settles. */
let probing = false;

const store = {
  settings: () => settingsPath(app.getPath('userData')),
  outbox: () => outboxPath(app.getPath('userData')),
};

const log = (message: string) => console.log(`[beacon] ${message}`);

// A `beacon://` link on macOS is delivered here, even to a process that has not
// finished starting — registered at module scope, before `whenReady`, so a cold
// launch by link is queued rather than silently dropped.
app.on('open-url', (event, url) => {
  event.preventDefault();
  const server = parseConnectLink(url);
  if (!server) return;

  if (started) promptLink(server);
  else queuedLinkServer = server;
});

// A second launch must not start a second tracker: two of them would fight over one
// open entry, and the loser's clock-in would be refused every minute.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  // On Windows and Linux a `beacon://` link to an already-running app arrives as a
  // second launch's argv, which this handler already existed to see — it just used to
  // discard it.
  app.on('second-instance', (_event, argv) => {
    const server = linkFromArgv(argv);
    if (server) promptLink(server);
    else showApp();
  });
  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  settings = readSettings(store.settings());
  if (settings.language === DEFAULT_SETTINGS.language) {
    settings.language = toLanguage(app.getLocale());
  }

  registerSetupHandlers();
  app.setAsDefaultProtocolClient(CONNECT_LINK_SCHEME);

  const argvServer = linkFromArgv(process.argv);
  if (argvServer) queuedLinkServer = argvServer;

  const resolved = await resolveServer();
  if (!resolved) {
    showConnect(Boolean(provisionFailure));
    finishStartup();
    return;
  }

  const outbox = new FileOutbox(store.outbox());
  const clock = new ApiClient(resolved.apiUrl, session.defaultSession);

  tracker = new Tracker({
    clock,
    outbox,
    autoTrack: () => settings.autoTrack,
    log,
    onStatus: (status) => {
      tray?.update(status, settings, locked);
      log(`status: ${stateLabel(settings.language, status)}`);
    },
  });

  tray = new StatusTray(trayActions(), tracker.status, settings, locked);

  registerPowerHandlers();
  app.on('before-quit', onBeforeQuit);
  // The clock is the point of this app, so closing the window leaves it running in the
  // tray. Quitting is an explicit choice, from the tray or the menu bar.
  app.on('window-all-closed', () => undefined);
  app.on('activate', () => showApp());

  showApp();
  await tracker.start();
  ticker = setInterval(() => void tracker?.tick(), TICK_MS);

  finishStartup();
}

/** Runs once, whichever way `start()` finished — including the "show connect" exit. */
function finishStartup(): void {
  started = true;

  if (queuedLinkServer) {
    const server = queuedLinkServer;
    queuedLinkServer = null;
    promptLink(server);
  }
}

// ----------------------------------------------------------- resolving the server

/**
 * The address this launch should use, verified before anything is built around it.
 *
 * A server the user has already chosen (or that a previous launch already verified) is
 * trusted without re-probing — `settings.json` only ever holds an address that once
 * answered as Beacon, see `setup:submit` below. Anything new — a first-run default from
 * `provisioning.ts`, or a freshly enforced `locked` address — is probed exactly like a
 * typed one before this process ever builds an `ApiClient` around it.
 */
async function resolveServer(): Promise<{ serverUrl: string; apiUrl: string } | null> {
  const provisioning = readProvisioning(provisioningPaths(process.platform, process.env), process.env);
  const effective = effectiveServer(settings.serverUrl, provisioning);
  locked = effective.locked;

  if (!effective.serverUrl) return null;

  if (effective.serverUrl === settings.serverUrl) {
    const apiUrl = apiUrlFor(settings);
    if (apiUrl) return { serverUrl: settings.serverUrl, apiUrl };
  }

  const outcome = await discoverInstance(effective.serverUrl, instanceProbe(session.defaultSession));

  if (!outcome.ok) {
    provisionFailure = { url: outcome.url, reason: outcome.reason };
    return null;
  }

  settings = { ...settings, serverUrl: outcome.serverUrl, apiUrl: outcome.apiUrl };
  writeSettings(store.settings(), settings);

  return { serverUrl: outcome.serverUrl, apiUrl: outcome.apiUrl };
}

/** The copy key for a probe failure — `setup.invalid` has no `{url}` placeholder. */
function failureMessageKey(reason: ProbeFailure): MessageKey {
  return reason === 'invalid' ? 'setup.invalid' : (`setup.error.${reason}` as MessageKey);
}

// --------------------------------------------------------------------- windows

function showApp(): void {
  if (!settings.serverUrl) {
    showConnect(connectFailure);
    return;
  }

  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.show();
    appWindow.focus();
    return;
  }

  appWindow = createAppWindow(settings.serverUrl);
  appWindow.on('closed', () => {
    appWindow = null;
  });
  appWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // A sub-resource failing is the page's business. A main frame that never loaded
    // means the server is not there, and the user needs to be told which one we tried.
    if (!isMainFrame) return;
    // -3 is ERR_ABORTED, which a navigation the user themselves replaced also produces.
    if (code === -3) return;

    log(`cannot load ${url}: ${description} (${code})`);
    appWindow?.destroy();
    appWindow = null;
    showConnect(true);
  });
}

function showConnect(failure: boolean): void {
  connectFailure = failure;

  if (connectWindow && !connectWindow.isDestroyed()) {
    connectWindow.webContents.reload();
    connectWindow.show();
    connectWindow.focus();
    return;
  }

  connectWindow = createConnectWindow();
  connectWindow.on('closed', () => {
    connectWindow = null;
    // Closing the first-run prompt with nothing configured leaves an app that can do
    // nothing at all; there is no tray yet to reopen it from.
    if (!settings.serverUrl) app.quit();
  });
}

/**
 * A `beacon://connect?url=…` link is never trusted outright — it only pre-fills the
 * connect screen, which the user still has to submit. Anyone can navigate a page to a
 * custom scheme, so an emailed link must not be able to silently repoint the app at an
 * attacker's server. `locked` refuses it outright instead: an enforced install has
 * nothing for a link to change.
 */
function promptLink(server: string): void {
  if (locked) {
    void dialog.showMessageBox({ type: 'info', message: t(settings.language, 'link.locked') });
    return;
  }

  pendingLinkUrl = server;
  showConnect(false);
}

function registerSetupHandlers(): void {
  ipcMain.handle('setup:copy', () => {
    const language: Language = settings.language;
    const linkUrl = pendingLinkUrl;
    pendingLinkUrl = null;

    if (locked) {
      return {
        language,
        title: t(language, 'error.title'),
        intro: provisionFailure
          ? t(language, failureMessageKey(provisionFailure.reason), { url: provisionFailure.url })
          : t(language, 'setup.locked'),
        label: t(language, 'setup.label'),
        submit: t(language, 'setup.submit'),
        checking: t(language, 'setup.checking'),
        confirm: t(language, 'setup.confirm'),
        retry: provisionFailure ? t(language, 'error.retry') : null,
        url: settings.serverUrl,
        locked: true,
      };
    }

    if (provisionFailure) {
      const failure = provisionFailure;

      return {
        language,
        title: t(language, 'setup.title'),
        intro: t(language, failureMessageKey(failure.reason), { url: failure.url }),
        label: t(language, 'setup.label'),
        submit: t(language, 'setup.submit'),
        checking: t(language, 'setup.checking'),
        confirm: t(language, 'setup.confirm'),
        retry: null,
        url: linkUrl ?? failure.url,
        locked: false,
      };
    }

    return connectFailure
      ? {
          language,
          title: t(language, 'error.title'),
          intro: t(language, 'error.body', { url: settings.serverUrl ?? '' }),
          label: t(language, 'setup.label'),
          submit: t(language, 'error.change'),
          checking: t(language, 'setup.checking'),
          confirm: t(language, 'setup.confirm'),
          retry: t(language, 'error.retry'),
          url: linkUrl ?? settings.serverUrl,
          locked: false,
        }
      : {
          language,
          title: t(language, 'setup.title'),
          intro: t(language, 'setup.intro'),
          label: t(language, 'setup.label'),
          submit: t(language, 'setup.submit'),
          checking: t(language, 'setup.checking'),
          confirm: t(language, 'setup.confirm'),
          retry: null,
          url: linkUrl ?? settings.serverUrl,
          locked: false,
        };
  });

  ipcMain.handle('setup:submit', async (_event, value: unknown, confirmed: unknown) => {
    if (locked) return { ok: false, message: t(settings.language, 'setup.locked') };
    // A double-Enter, or a click while the previous probe is still in flight, must not
    // run two probes and relaunch twice.
    if (probing) return { ok: false, message: '' };

    probing = true;
    try {
      const raw = typeof value === 'string' ? value.trim() : '';
      const outcome = await discoverInstance(raw, instanceProbe(session.defaultSession));

      if (!outcome.ok) {
        return {
          ok: false,
          message: t(settings.language, failureMessageKey(outcome.reason), { url: outcome.url }),
        };
      }

      if (outcome.info.setupRequired && confirmed !== true) {
        // Not an error: the address is a real, reachable Beacon API, just one nobody
        // has installed yet. One more click is what stops a person from silently
        // registering themselves as the owner of a stranger's fresh instance.
        return { ok: false, confirm: true, message: t(settings.language, 'setup.notInstalled') };
      }

      const changed = outcome.serverUrl !== settings.serverUrl || outcome.apiUrl !== settings.apiUrl;

      settings = { ...settings, serverUrl: outcome.serverUrl, apiUrl: outcome.apiUrl };
      writeSettings(store.settings(), settings);

      if (changed) {
        // Pointing at a different installation means a different account: the cookie
        // jar holds the old server's session, and the outbox may hold a clock-out that
        // belongs to it — see `clearOutbox`. Both have to be gone before the process
        // that reads them again starts up, so this is awaited rather than fired and
        // forgotten the way it used to be.
        await session.defaultSession.clearStorageData({ storages: ['cookies'] });
        clearOutbox(store.outbox());
      }

      relaunch();

      return { ok: true, message: '' };
    } finally {
      probing = false;
    }
  });

  ipcMain.handle('setup:retry', () => relaunch());
}

/**
 * Restarting is the honest way to adopt a new server: the API client, the tracker and
 * the cookie jar were all built around the old one, and rewiring them in place would
 * be three chances to leave a stale reference behind.
 */
function relaunch(): void {
  quitting = true;
  app.relaunch();
  app.exit(0);
}

// ----------------------------------------------------------------- the lifecycle

function registerPowerHandlers(): void {
  powerMonitor.on('suspend', () => {
    if (settings.stopOnSuspend) void pause('suspend');
  });
  powerMonitor.on('resume', () => void resume());

  // Linux and macOS only, and unlike `before-quit` there is no reliable way to hold
  // the system back — Electron's own typings do not offer the event to cancel with.
  // It does not need one: `pause` writes the clock-out to disk before it tries to
  // send it, so being killed here costs a replay on the next launch, not the entry.
  powerMonitor.on('shutdown', () => {
    void withTimeout(pause('shutdown'), SHUTDOWN_BUDGET_MS).finally(() => app.exit(0));
  });

  // A lock is not by itself a reason to stop: locking the screen for the length of a
  // corridor would otherwise cut the day into pieces. Only a lock that outlasts the
  // grace counts as having left.
  powerMonitor.on('lock-screen', () => {
    if (!settings.stopOnLock) return;

    clearLockTimer();
    lockTimer = setTimeout(() => void pause('lock'), settings.lockGraceSeconds * 1_000);
  });
  powerMonitor.on('unlock-screen', () => {
    const wasPending = lockTimer !== null;
    clearLockTimer();
    // Unlocking inside the grace means nothing ever stopped, so there is nothing to
    // start again — and reconciling would be a needless round trip.
    if (!wasPending) void resume();
  });
}

function onBeforeQuit(event: Electron.Event): void {
  if (quitting) return;

  quitting = true;
  event.preventDefault();
  // The last thing this process does is finish the clock-out it just recorded. The
  // record is already on disk either way, so a budget that runs out costs precision
  // on the next launch, not the entry.
  void withTimeout(pause('quit'), SHUTDOWN_BUDGET_MS).finally(() => app.exit(0));
}

async function pause(reason: PauseReason): Promise<void> {
  clearTicker();
  await tracker?.pause(reason);
}

async function resume(): Promise<void> {
  await tracker?.resume();
  if (!ticker) ticker = setInterval(() => void tracker?.tick(), TICK_MS);
}

function clearTicker(): void {
  if (!ticker) return;

  clearInterval(ticker);
  ticker = null;
}

function clearLockTimer(): void {
  if (!lockTimer) return;

  clearTimeout(lockTimer);
  lockTimer = null;
}

// --------------------------------------------------------------------- the tray

function trayActions() {
  return {
    open: () => showApp(),
    clockIn: () => void tracker?.clockInNow(),
    clockOut: () => void tracker?.clockOutNow(),
    toggle: (key: 'autoTrack' | 'stopOnSuspend' | 'stopOnLock', value: boolean) => {
      settings = { ...settings, [key]: value };
      writeSettings(store.settings(), settings);
      if (tracker) tray?.update(tracker.status, settings, locked);
      // Turning tracking back on should start it now, not at the next tick.
      if (key === 'autoTrack' && value) void tracker?.start();
    },
    // An enforced address has nothing for the tray to offer changing — see `promptLink`
    // and `StatusTray`, which hides this menu item entirely once `locked` is true.
    changeServer: () => {
      if (!locked) showConnect(false);
    },
    quit: () => app.quit(),
  };
}
