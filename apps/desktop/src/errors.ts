/**
 * The distinction the tracker turns on: did the server refuse, or did it never hear?
 *
 * A refusal is final — replaying it forever would be a loop. A network failure is
 * temporary, and the clock-out it could not deliver has to stay in the outbox until
 * the connection comes back. Kept out of `api.ts` so the tracker can tell them apart
 * without importing Electron.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never got an answer — offline, DNS, a refused connection, a timeout. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** A refusal that will refuse again: retrying changes nothing. */
export function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/** The session is over and only the window can start a new one. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
