import {
  INSTANCE_API_VERSION,
  isInstanceInfo,
  serverCandidates,
  type InstanceInfo,
} from '@beacon/shared';
import { NetworkError, ProtocolError } from './errors.js';

/**
 * Decides whether a typed or provisioned address is a real Beacon instance, before it
 * is ever written to `settings.json`. Electron-free by the same rule as `tracker.ts` —
 * everything decidable is decided here, behind `FetchInstanceInfo`, so it is unit
 * testable with a fake instead of a real HTTP stack.
 */

export type ProbeFailure = 'invalid' | 'unreachable' | 'notBeacon';

export type ProbeOutcome =
  | {
      ok: true;
      serverUrl: string;
      apiUrl: string;
      info: InstanceInfo;
      /**
       * The server's contract version is newer than this build understands. Never a
       * reason to refuse the connection — one generic build ships to every customer,
       * and bricking it the moment an administrator upgrades the server would leave no
       * way back. It is surfaced so the caller can log it or, later, suggest an update.
       */
      versionMismatch: boolean;
    }
  | { ok: false; reason: ProbeFailure; url: string };

/** One unauthenticated `GET <apiUrl>/instance`. `apps/desktop/src/api.ts` implements it. */
export type FetchInstanceInfo = (apiUrl: string) => Promise<InstanceInfo>;

/**
 * Tries every candidate `serverCandidates(raw)` derives, in order, and keeps the first
 * that answers as Beacon. `setupRequired: true` is accepted, not refused — the person
 * connecting may be the owner about to install the instance.
 *
 * Failure is classified by what was actually observed: `notBeacon` (something
 * answered, but never as Beacon) beats `unreachable` (nothing answered at all) — a
 * candidate that answered is more informative than one that never did, however many of
 * each there were.
 */
export async function discoverInstance(
  raw: string,
  fetchInfo: FetchInstanceInfo,
): Promise<ProbeOutcome> {
  const candidates = serverCandidates(raw);

  if (candidates.length === 0) {
    return { ok: false, reason: 'invalid', url: raw.trim() };
  }

  let notBeaconAt: string | null = null;

  for (const candidate of candidates) {
    try {
      const info = await fetchInfo(candidate.apiUrl);

      if (!isInstanceInfo(info)) {
        notBeaconAt ??= candidate.apiUrl;
        continue;
      }

      return {
        ok: true,
        serverUrl: candidate.serverUrl,
        apiUrl: candidate.apiUrl,
        info,
        versionMismatch: info.apiVersion > INSTANCE_API_VERSION,
      };
    } catch (error) {
      if (error instanceof ProtocolError) {
        notBeaconAt ??= candidate.apiUrl;
        continue;
      }

      // A NetworkError, or anything else unexpected: this candidate never answered at
      // all, which is the least informative outcome — keep trying the rest.
      if (!(error instanceof NetworkError)) throw error;
    }
  }

  if (notBeaconAt) return { ok: false, reason: 'notBeacon', url: notBeaconAt };

  return { ok: false, reason: 'unreachable', url: candidates[0].serverUrl };
}
