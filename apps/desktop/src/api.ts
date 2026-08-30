import { net, type Session } from 'electron';
import { isInstanceInfo, type ClockOutRequest, type ClockRequest, type InstanceInfo, type TodayStatus } from '@beacon/shared';
import { ApiError, NetworkError, ProtocolError } from './errors.js';
import type { ClockPort } from './tracker.js';
import type { FetchInstanceInfo } from './discovery.js';

/** A response body larger than this is not a Beacon JSON reply — stop reading it. */
const MAX_PROBE_BODY_BYTES = 65_536;

/**
 * The attendance API, called from the main process.
 *
 * **Where the credential comes from.** Nowhere: the app has none of its own. The user
 * signs in inside the window, against the served web app, exactly as they would in a
 * browser — so the `HttpOnly` refresh cookie lands in Electron's cookie jar. These
 * requests ride that same jar (`useSessionCookies`), which is what lets the main
 * process keep the clock after the window is gone. Nothing is stored on disk, and the
 * desktop app never sees a password or a token it has to protect.
 *
 * **Why CORS is not involved.** `net` requests from the main process send no `Origin`,
 * so the API's fail-closed `CORS_ORIGIN` list needs no desktop entry and an
 * installation needs no configuration change to support this client.
 *
 * The refresh-and-retry dance mirrors `apps/web/src/lib/api/client.ts`: a 401 buys one
 * refresh and one retry. Rotation is safe — sharing one jar makes this look to the API
 * exactly like a second browser tab, which `REFRESH_REPLAY_GRACE_MS` already tells
 * apart from a stolen token.
 */
export class ApiClient implements ClockPort {
  #accessToken: string | null = null;
  #refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly session: Session,
    private readonly timeoutMs = 10_000,
  ) {}

  today(): Promise<TodayStatus> {
    return this.#call<TodayStatus>('/attendance/me/today', 'GET');
  }

  clockIn(): Promise<TodayStatus> {
    const body: ClockRequest = { source: 'desktop' };

    return this.#call<TodayStatus>('/attendance/clock-in', 'POST', body);
  }

  clockOut(at: Date): Promise<TodayStatus> {
    const body: ClockOutRequest = { at: at.toISOString() };

    return this.#call<TodayStatus>('/attendance/clock-out', 'POST', body);
  }

  /** Whether the jar currently holds a session — what the tray asks on start-up. */
  async isSignedIn(): Promise<boolean> {
    return this.#refresh();
  }

  async #call<T>(path: string, method: string, body?: unknown): Promise<T> {
    try {
      return await this.#request<T>(path, method, body);
    } catch (error) {
      const expired = error instanceof ApiError && error.status === 401;
      if (!expired || !(await this.#refresh())) throw error;

      return this.#request<T>(path, method, body);
    }
  }

  /**
   * Shared across callers so a burst that all 401 refreshes once rather than five
   * times — five rotations would invalidate each other, and the family revocation
   * that follows a replay would sign the user out of the web app too.
   */
  async #refresh(): Promise<boolean> {
    this.#refreshing ??= (async () => {
      try {
        const { accessToken } = await this.#request<{ accessToken: string }>(
          '/auth/refresh',
          'POST',
        );
        this.#accessToken = accessToken;

        return true;
      } catch {
        this.#accessToken = null;

        return false;
      } finally {
        this.#refreshing = null;
      }
    })();

    return this.#refreshing;
  }

  /**
   * One request. `net` is Electron's own stack rather than Node's, which is what gives
   * it the session's cookie jar and the system proxy configuration an on-premise
   * install is likely to sit behind.
   */
  #request<T>(path: string, method: string, body?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = net.request({
        method,
        url: `${this.baseUrl}${path}`,
        session: this.session,
        useSessionCookies: true,
      });

      request.setHeader('Content-Type', 'application/json');
      request.setHeader('Accept', 'application/json');
      if (this.#accessToken) request.setHeader('Authorization', `Bearer ${this.#accessToken}`);

      // A request left hanging at suspend would keep the whole shutdown path waiting
      // on a socket the OS is about to freeze.
      const timer = setTimeout(() => {
        request.abort();
        reject(new NetworkError(`${method} ${path} timed out`));
      }, this.timeoutMs);
      const settle = (finish: () => void) => {
        clearTimeout(timer);
        finish();
      };

      request.on('response', (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', (error: Error) =>
          settle(() => reject(new NetworkError(error.message))),
        );
        response.on('end', () =>
          settle(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = response.statusCode;

            if (status >= 400) return reject(new ApiError(status, messageOf(text, method, path)));

            if (!text) return resolve(undefined as T);

            try {
              resolve(JSON.parse(text) as T);
            } catch {
              // A 2xx that is not JSON — a captive portal, a proxy's own page, a server
              // that answered but is not Beacon. Not a network failure: it heard back.
              reject(new ProtocolError(`${method} ${path} did not return JSON`));
            }
          }),
        );
      });

      request.on('error', (error) => settle(() => reject(new NetworkError(error.message))));
      request.on('abort', () => settle(() => reject(new NetworkError(`${method} ${path} aborted`))));

      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
  }
}

/** Nest replies with `{ statusCode, message, error }`; surface its message. */
function messageOf(text: string, method: string, path: string): string {
  try {
    const body = JSON.parse(text) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;

    if (message) return message;
  } catch {
    /* not JSON — fall through */
  }

  return `${method} ${path} failed`;
}

/**
 * One unauthenticated probe of `<apiUrl>/instance`, used only by the connect screen
 * before a server address is ever saved. Deliberately separate from `ApiClient`:
 *
 * - `useSessionCookies: false` — the address is only a candidate, and it must never see
 *   the refresh cookie of whatever server is currently configured.
 * - No retry, no refresh, no `Authorization` header — there is no session yet.
 * - A shorter timeout, because a person is watching the connect screen rather than a
 *   background tracker; several candidates are tried per typed address (see
 *   `serverCandidates` in `@beacon/shared`), so a slow default would make the worst
 *   case a long wait for an obviously wrong address.
 *
 * Throws `NetworkError` when nothing answered (DNS, refused, TLS, timeout) and
 * `ProtocolError` when something did but not with a Beacon `InstanceInfo` body — the
 * distinction `discovery.ts` uses to tell "unreachable" from "not a Beacon server".
 */
export function fetchInstanceInfo(
  apiUrl: string,
  session: Session,
  timeoutMs = 5_000,
): Promise<InstanceInfo> {
  return new Promise<InstanceInfo>((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: `${apiUrl}/instance`,
      session,
      useSessionCookies: false,
      redirect: 'manual',
    });

    request.setHeader('Accept', 'application/json');

    let settled = false;
    const timer = setTimeout(() => {
      request.abort();
      reject(new NetworkError(`GET ${apiUrl}/instance timed out`));
    }, timeoutMs);
    // Guards against the `abort()` calls below (overflow, timeout) also firing the
    // `abort` event — without it, that second settle would silently overwrite an
    // already-decided outcome with a misleading NetworkError, since a request that
    // *answered* with too much data is not the same as one that never answered at all.
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };

    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;

      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PROBE_BODY_BYTES) {
          // Something answered — with too much to be a Beacon `InstanceInfo` body —
          // so this is decided the moment the limit is crossed, not deferred to
          // whatever the subsequent `abort()` produces.
          settle(() => reject(new ProtocolError(`GET ${apiUrl}/instance sent too much`)));
          request.abort();
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', (error: Error) => settle(() => reject(new NetworkError(error.message))));
      response.on('end', () =>
        settle(() => {
          const text = Buffer.concat(chunks).toString('utf8');

          try {
            const body: unknown = text ? JSON.parse(text) : null;

            if (!isInstanceInfo(body)) {
              return reject(new ProtocolError(`${apiUrl} did not answer as a Beacon API`));
            }

            resolve(body);
          } catch {
            reject(new ProtocolError(`${apiUrl} did not return JSON`));
          }
        }),
      );
    });

    request.on('error', (error) => settle(() => reject(new NetworkError(error.message))));
    request.on('abort', () =>
      settle(() => reject(new NetworkError(`GET ${apiUrl}/instance aborted`))),
    );

    request.end();
  });
}

/** `fetchInstanceInfo` bound to a session, matching the `FetchInstanceInfo` port `discovery.ts` expects. */
export function instanceProbe(session: Session, timeoutMs?: number): FetchInstanceInfo {
  return (apiUrl: string) => fetchInstanceInfo(apiUrl, session, timeoutMs);
}
