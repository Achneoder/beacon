import { BrowserWindow, app, ipcMain, powerMonitor, session } from 'electron';
import { ApiClient } from './api.js';
import { toLanguage, t, type Language } from './locales.js';
import { FileOutbox, outboxPath } from './outbox.js';
import {
  DEFAULT_SETTINGS,
  apiUrlFor,
  isServerUrl,
  readSettings,
  settingsPath,
  writeSettings,
  type Settings,
} from './settings.js';
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
 * See `tracker.ts` for what actually decides when the clock starts and stops.
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

const store = {
  settings: () => settingsPath(app.getPath('userData')),
  outbox: () => outboxPath(app.getPath('userData')),
};

const log = (message: string) => console.log(`[beacon] ${message}`);

// A second launch must not start a second tracker: two of them would fight over one
// open entry, and the loser's clock-in would be refused every minute.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => showApp());
  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  settings = readSettings(store.settings());
  if (settings.language === DEFAULT_SETTINGS.language) {
    settings.language = toLanguage(app.getLocale());
  }

  registerSetupHandlers();

  const apiUrl = apiUrlFor(settings);
  if (!settings.serverUrl || !apiUrl) {
    showConnect(false);
    return;
  }

  const outbox = new FileOutbox(store.outbox());
  const clock = new ApiClient(apiUrl, session.defaultSession);

  tracker = new Tracker({
    clock,
    outbox,
    autoTrack: () => settings.autoTrack,
    log,
    onStatus: (status) => {
      tray?.update(status, settings);
      log(`status: ${stateLabel(settings.language, status)}`);
    },
  });

  tray = new StatusTray(trayActions(), tracker.status, settings);

  registerPowerHandlers();
  app.on('before-quit', onBeforeQuit);
  // The clock is the point of this app, so closing the window leaves it running in the
  // tray. Quitting is an explicit choice, from the tray or the menu bar.
  app.on('window-all-closed', () => undefined);
  app.on('activate', () => showApp());

  showApp();
  await tracker.start();
  ticker = setInterval(() => void tracker?.tick(), TICK_MS);
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

function registerSetupHandlers(): void {
  ipcMain.handle('setup:copy', () => {
    const language: Language = settings.language;

    return connectFailure
      ? {
          language,
          title: t(language, 'error.title'),
          intro: t(language, 'error.body', { url: settings.serverUrl ?? '' }),
          label: t(language, 'setup.label'),
          submit: t(language, 'error.change'),
          retry: t(language, 'error.retry'),
          url: settings.serverUrl,
        }
      : {
          language,
          title: t(language, 'setup.title'),
          intro: t(language, 'setup.intro'),
          label: t(language, 'setup.label'),
          submit: t(language, 'setup.submit'),
          retry: null,
          url: settings.serverUrl,
        };
  });

  ipcMain.handle('setup:submit', (_event, value: unknown) => {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!isServerUrl(url)) {
      return { ok: false, message: t(settings.language, 'setup.invalid') };
    }

    const changed = url !== settings.serverUrl;
    settings = { ...settings, serverUrl: url, apiUrl: null };
    writeSettings(store.settings(), settings);

    // Pointing at a different installation means a different account: the cookie jar
    // holds the old server's session, and leaving it behind would keep a credential
    // for a server this user has just said they are done with.
    if (changed) void session.defaultSession.clearStorageData({ storages: ['cookies'] });

    relaunch();

    return { ok: true, message: '' };
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
      if (tracker) tray?.update(tracker.status, settings);
      // Turning tracking back on should start it now, not at the next tick.
      if (key === 'autoTrack' && value) void tracker?.start();
    },
    changeServer: () => showConnect(false),
    quit: () => app.quit(),
  };
}
