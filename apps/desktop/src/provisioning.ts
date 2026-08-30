import { existsSync, readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { parseConnectLink, serverCandidates } from '@beacon/shared';

/**
 * What an administrator can hand the app before a person ever opens it, so that most
 * employees never see the connect screen.
 *
 * Machine-level, not per-user, on purpose: the security property is that only an
 * administrator — someone with write access to the machine itself, not the logged-in
 * user — can set it. It is still only ever a *default*, unless `locked` says otherwise:
 * see `effectiveServer` for the precedence between this, the environment and whatever
 * the user has already chosen in `settings.json`.
 */
export interface Provisioning {
  serverUrl: string | null;
  /** True: the provisioned address is enforced — no connect screen, no changing it. */
  locked: boolean;
}

const EMPTY_PROVISIONING: Provisioning = { serverUrl: null, locked: false };

/**
 * Where an administrator may drop `desktop.json`, most specific first. `readProvisioning`
 * takes the first one that exists and parses, so a per-machine file wins over none.
 */
export function provisioningPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  // `node:path`'s default `join` follows the *host* OS, not this argument — building a
  // Windows path on a Linux packaging step (or under this suite, which runs on Linux
  // CI regardless of which branch it is exercising) would otherwise come out with the
  // wrong separator. `win32`/`posix` make the result depend only on `platform`.
  if (platform === 'win32') {
    const programData = env.ProgramData ?? 'C:\\ProgramData';

    return [win32.join(programData, 'Beacon', 'desktop.json')];
  }

  if (platform === 'darwin') {
    return [posix.join('/Library', 'Application Support', 'Beacon', 'desktop.json')];
  }

  return [posix.join('/etc', 'beacon', 'desktop.json')];
}

/**
 * Reads the first provisioning file that exists, or `BEACON_SERVER_URL` /
 * `BEACON_SERVER_LOCKED` from the environment if none does — a scripted install sets
 * env vars more readily than it drops a file. Malformed input is discarded the same
 * way `readSettings` discards a hand-edited `settings.json`: provisioning must never
 * stop the app from booting.
 */
export function readProvisioning(paths: string[], env: NodeJS.ProcessEnv): Provisioning {
  for (const path of paths) {
    if (!existsSync(path)) continue;

    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { serverUrl?: unknown; locked?: unknown };
      const serverUrl = typeof raw.serverUrl === 'string' ? raw.serverUrl.trim() : '';

      if (serverUrl.length === 0 || serverCandidates(serverUrl).length === 0) continue;

      return { serverUrl, locked: raw.locked === true };
    } catch {
      continue;
    }
  }

  const envUrl = env.BEACON_SERVER_URL?.trim();
  if (envUrl && serverCandidates(envUrl).length > 0) {
    return { serverUrl: envUrl, locked: env.BEACON_SERVER_LOCKED === 'true' };
  }

  return EMPTY_PROVISIONING;
}

/**
 * The address to actually use at launch, and whether it can be changed.
 *
 * `locked` always wins — that is what turns "a default for first launch" into "an
 * enforced address" for a managed install. Otherwise a server the user has already
 * chosen wins over provisioning: a default is not licence to repoint a working install
 * out from under someone the next time an administrator edits the file.
 */
export function effectiveServer(
  configured: string | null,
  provisioning: Provisioning,
): { serverUrl: string | null; locked: boolean } {
  if (provisioning.locked && provisioning.serverUrl) {
    return { serverUrl: provisioning.serverUrl, locked: true };
  }

  if (configured) return { serverUrl: configured, locked: false };

  return { serverUrl: provisioning.serverUrl, locked: false };
}

/**
 * The `beacon://connect?url=…` address out of a cold-start `argv`, if one was passed —
 * how the link reaches an already-installed app on Windows and Linux, both on a fresh
 * launch and via the existing single-instance `second-instance` handler.
 */
export function linkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    const link = parseConnectLink(arg);
    if (link) return link;
  }

  return null;
}
