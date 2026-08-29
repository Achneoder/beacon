import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The one piece of state that has to survive the machine going away.
 *
 * Two facts live here, both in `userData/outbox.json`:
 *
 * - `pendingAt` — a clock-out that was decided but may not have been delivered. It is
 *   written *before* the request goes out, because a suspend can cut the request off
 *   mid-flight and the whole point is to be able to replay it afterwards.
 * - `lastSeenAt` — a heartbeat, refreshed while the clock runs. It is the fallback
 *   when the process never got to decide anything at all: a battery pulled, a kernel
 *   panic, a `SIGKILL`. Closing the entry there is wrong by at most one heartbeat
 *   interval; closing it at the next launch could be wrong by a weekend.
 *
 * Writes are synchronous. An async write at suspend is a write that does not happen.
 */
export interface OutboxPort {
  /** Records a clock-out that is about to be attempted. */
  record(at: Date): void;
  /** The clock-out still owed, if any. */
  pending(): Date | null;
  /** Called once the server has taken it. */
  clear(): void;
  /** The heartbeat, while the clock runs. */
  seen(at: Date): void;
  lastSeen(): Date | null;
}

interface Persisted {
  pendingAt?: string | null;
  lastSeenAt?: string | null;
}

export class FileOutbox implements OutboxPort {
  #state: Persisted;

  constructor(private readonly path: string) {
    this.#state = read(path);
  }

  record(at: Date): void {
    // Never overwrite a clock-out that is still owed: the older instant is the one
    // that closes the entry correctly. A suspend followed by a resume that fails to
    // deliver, then a second suspend, must still close at the first.
    if (this.#state.pendingAt) return;

    this.#state.pendingAt = at.toISOString();
    this.#flush();
  }

  pending(): Date | null {
    return instant(this.#state.pendingAt);
  }

  clear(): void {
    if (!this.#state.pendingAt) return;

    this.#state.pendingAt = null;
    this.#flush();
  }

  seen(at: Date): void {
    this.#state.lastSeenAt = at.toISOString();
    this.#flush();
  }

  lastSeen(): Date | null {
    return instant(this.#state.lastSeenAt);
  }

  #flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.#state, null, 2)}\n`, 'utf8');
  }
}

export function outboxPath(userData: string): string {
  return join(userData, 'outbox.json');
}

function read(path: string): Persisted {
  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Persisted;
  } catch {
    // A half-written file loses at most one clock-out's precision — the tracker
    // falls back to reconciling against the server. Refusing to boot would be worse.
    return {};
  }
}

function instant(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
