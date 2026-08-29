import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LANGUAGES, toLanguage, type Language } from './locales.js';

/**
 * What the user has chosen, in `userData/settings.json`.
 *
 * There is no credential here on purpose. The window signs in against the served web
 * app exactly as a browser would, and the main process rides the same Electron cookie
 * jar — so the desktop app never stores a password, a token or a refresh cookie of its
 * own, and has nothing to leak if this file is read.
 */
export interface Settings {
  /** Where the web app is served, e.g. `https://beacon.example.com`. */
  serverUrl: string | null;
  /** Where the REST API is, defaulting to `serverUrl` + `/api`. */
  apiUrl: string | null;
  /** Clock in on open and out on close. The headline feature; on by default. */
  autoTrack: boolean;
  stopOnSuspend: boolean;
  stopOnLock: boolean;
  /**
   * How long the screen may stay locked before the clock stops. Without it a
   * ten-second lock would split the day into two segments for no reason.
   */
  lockGraceSeconds: number;
  language: Language;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: null,
  apiUrl: null,
  autoTrack: true,
  stopOnSuspend: true,
  stopOnLock: true,
  lockGraceSeconds: 60,
  language: 'en',
};

/**
 * The API's base URL for a given server.
 *
 * `apps/web` defaults `PUBLIC_API_URL` to the server's own origin plus `/api`, and a
 * deployment that splits them can say so explicitly. Deriving it keeps the setup
 * screen to a single field for the common case.
 */
export function apiUrlFor(settings: Settings): string | null {
  if (settings.apiUrl) return trimSlash(settings.apiUrl);
  if (!settings.serverUrl) return null;

  return `${trimSlash(settings.serverUrl)}/api`;
}

/**
 * Whether a string is a server address we are willing to load.
 *
 * `http` is allowed because an on-premise install on a private network is a supported
 * deployment and this is the address of the user's own employer, typed by the user —
 * but only those two schemes, so a stored `file:` or `javascript:` can never become
 * something the window navigates to.
 */
export function isServerUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Reads the file, discarding anything that does not match the shape. A settings file
 * that has been hand-edited into nonsense should start the app on its defaults, not
 * stop it from booting — and a `serverUrl` that no longer parses must not survive as
 * something the window is asked to load.
 */
export function readSettings(path: string): Settings {
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>;

    return {
      serverUrl: url(raw.serverUrl),
      apiUrl: url(raw.apiUrl),
      autoTrack: bool(raw.autoTrack, DEFAULT_SETTINGS.autoTrack),
      stopOnSuspend: bool(raw.stopOnSuspend, DEFAULT_SETTINGS.stopOnSuspend),
      stopOnLock: bool(raw.stopOnLock, DEFAULT_SETTINGS.stopOnLock),
      lockGraceSeconds: seconds(raw.lockGraceSeconds),
      language: LANGUAGES.includes(raw.language as Language)
        ? (raw.language as Language)
        : toLanguage(raw.language),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export function settingsPath(userData: string): string {
  return join(userData, 'settings.json');
}

function url(value: unknown): string | null {
  return typeof value === 'string' && isServerUrl(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Clamped: a zero grace defeats the point, and an hour is not a screen lock. */
function seconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.lockGraceSeconds;
  }

  return Math.min(600, Math.max(5, Math.round(value)));
}
