import { BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** `dist/` at runtime, so `assets/` and the compiled preload resolve from one place. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

export const assetPath = (name: string): string => join(HERE, '..', 'assets', name);

/**
 * The window that shows Beacon itself: the served web app, unmodified.
 *
 * No preload and no Node integration — the page gets exactly what a browser tab gets,
 * which is the point. `apps/web` needs no desktop build, no desktop branch, and no
 * awareness that it is running here; it already re-reads the clock on window focus
 * (`apps/web/src/routes/(app)/+layout.svelte`), which is how it notices a clock-out
 * this process made while the window was in the background.
 */
export function createAppWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 480,
    minHeight: 560,
    show: false,
    icon: assetPath('icon.png'),
    title: 'Beacon',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // In-window navigation stays in the window — SSO sends the user to their identity
  // provider and back, so an origin check here would break the sign-in it is meant to
  // protect. Anything that is not the web is refused outright, and a link that asks
  // for a new window opens in the real browser instead of an unchromed popup.
  window.webContents.on('will-navigate', (event, target) => {
    if (!isWeb(target)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isWeb(target)) void shell.openExternal(target);

    return { action: 'deny' };
  });

  void window.loadURL(url);

  return window;
}

/**
 * The connect screen: the server address on first run, and the "cannot reach Beacon"
 * notice afterwards.
 *
 * A window of its own rather than a mode of the one above, because it is the only page
 * with a preload. Keeping them apart means the served web app is never handed a bridge
 * into the main process.
 */
export function createConnectWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 460,
    height: 420,
    resizable: false,
    show: false,
    icon: assetPath('icon.png'),
    title: 'Beacon',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // An ES-module preload cannot run in the sandbox, and it has to be a module
      // because this workspace compiles as one. The page it serves is a local file
      // with no network access of its own.
      sandbox: false,
      preload: join(HERE, 'setup-preload.mjs'),
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadFile(assetPath('connect.html'));

  return window;
}

function isWeb(url: string): boolean {
  try {
    const { protocol } = new URL(url);

    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
