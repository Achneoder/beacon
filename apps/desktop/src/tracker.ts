import { uptime } from 'node:os';
import { isRunning, type ClockState, type TodayStatus } from '@beacon/shared';
import { isRefusal, isSignedOut } from './errors.js';
import type { OutboxPort } from './outbox.js';

/** Why the clock is being stopped. Carried into the log, not into the API. */
export type PauseReason = 'quit' | 'suspend' | 'shutdown' | 'lock';

/**
 * The attendance API, as this app needs it. An interface rather than the client
 * itself, so the state machine below can be driven in a unit test without Electron,
 * a window or a server — the same containment the API gives its storage, mail and
 * search back ends.
 */
export interface ClockPort {
  today(): Promise<TodayStatus>;
  clockIn(): Promise<TodayStatus>;
  clockOut(at: Date): Promise<TodayStatus>;
}

/** What the tray draws. */
export type Connection = 'unknown' | 'connected' | 'offline' | 'signedOut';

export interface TrackerStatus {
  connection: Connection;
  /** The last state the server reported. `out` until we have heard from it. */
  state: ClockState;
}

export interface TrackerOptions {
  clock: ClockPort;
  outbox: OutboxPort;
  /** Read on every decision, so the tray's toggle takes effect immediately. */
  autoTrack: () => boolean;
  now?: () => Date;
  /** When the machine last booted. See {@link systemBootedAt}. */
  bootedAt?: () => Date;
  onStatus?: (status: TrackerStatus) => void;
  log?: (message: string) => void;
}

/**
 * When the clock starts and stops, and what happens when the machine disappears
 * mid-sentence.
 *
 * The rules are small enough to state:
 *
 * - Opening the app clocks in, if automatic tracking is on and the server says the
 *   user is clocked out. Nothing is assumed about what the server holds — every
 *   decision reads `today` first, because the user may have clocked in from the web
 *   app or a phone since we last looked. That reconciliation, rather than an
 *   idempotency key, is what makes every call here safe to repeat.
 * - Closing, sleeping or locking clocks out, at the instant it happened.
 * - A clock-out that could not be delivered is owed, and is replayed on the next
 *   resume or launch **still carrying its original instant**. That is the whole
 *   reason the API accepts a backdated clock-out: a machine that sleeps at 17:02 and
 *   wakes at 09:00 must bank the minutes before 17:02, not the night in between.
 *
 * Network work is serialized. Two clock-ins racing would have one refused by the
 * one-open-entry rule, and a tick landing inside a clock-out would report a state
 * that is already gone.
 */
export class Tracker {
  #status: TrackerStatus = { connection: 'unknown', state: 'out' };
  #queue: Promise<unknown> = Promise.resolve();
  /**
   * A clock-out this process never got to record, inferred at construction from the
   * heartbeat a previous process left behind — a battery pulled, a kernel panic, a
   * `SIGKILL`. Read once: everything written after construction is our own.
   */
  #unreported: Date | null;

  constructor(private readonly options: TrackerOptions) {
    this.#unreported = options.outbox.lastSeen();
  }

  get status(): TrackerStatus {
    return this.#status;
  }

  /** The app launched, or the window just signed in. */
  start(): Promise<void> {
    return this.#serial(async () => {
      await this.#flush();
      await this.#reconcile();
    });
  }

  /**
   * The machine is going away — quit, sleep, shutdown, or a screen lock that outlasted
   * its grace.
   *
   * The outbox write is synchronous and happens *first*, outside the queue, because
   * it is the only part guaranteed to complete: the OS may suspend before the request
   * is even sent. Everything after it is best-effort, and the replay is what makes
   * the result correct rather than lucky.
   */
  pause(reason: PauseReason): Promise<void> {
    if (!this.options.autoTrack()) return Promise.resolve();
    // Nothing running as far as we know. A stale `out` is the safe way to be wrong —
    // the next reconcile clocks back in, where a stale `in` would close an entry we
    // have no business closing.
    if (!isRunning(this.#status.state)) return Promise.resolve();

    const at = this.#now();
    this.options.outbox.record(at);
    this.options.log?.(`clock-out owed at ${at.toISOString()} (${reason})`);

    return this.#serial(() => this.#flush());
  }

  /** Woken up, or unlocked. */
  resume(): Promise<void> {
    return this.start();
  }

  /**
   * The poll, while a window is open. It keeps the tray honest when the user clocks
   * from the web app or a phone, and it advances the heartbeat that closes an entry
   * at roughly the right instant if this process is killed outright.
   */
  tick(): Promise<void> {
    return this.#serial(async () => {
      await this.#flush();

      const today = await this.#read();
      if (today && isRunning(today.state)) this.options.outbox.seen(this.#now());
    });
  }

  /** The tray's buttons. Deliberately ignore the toggle: the user asked directly. */
  clockInNow(): Promise<void> {
    return this.#serial(() => this.#apply(() => this.options.clock.clockIn()));
  }

  clockOutNow(): Promise<void> {
    return this.#serial(() => this.#apply(() => this.options.clock.clockOut(this.#now())));
  }

  // ------------------------------------------------------------------ internals

  /**
   * Delivers whatever clock-out is owed, and drops it once it can no longer be owed.
   *
   * Three ways it stops being owed: the server has no open entry (someone closed it),
   * the open entry began *after* the instant we owe (so it is a newer entry and not
   * ours to close), or the server refused — a refusal will refuse again, and replaying
   * it every minute forever is worse than losing it.
   */
  async #flush(): Promise<void> {
    const owed = this.options.outbox.pending() ?? this.#takeUnreported();
    if (!owed) return;

    const today = await this.#read();
    // Could not ask. The record keeps its place until the connection returns.
    if (!today) return;

    if (!isRunning(today.state)) {
      this.options.outbox.clear();
      return;
    }

    const startedAt = openedAt(today);
    if (startedAt && owed.getTime() < startedAt.getTime()) {
      this.options.log?.('dropping a clock-out that predates the open entry');
      this.options.outbox.clear();
      return;
    }

    try {
      this.#adopt(await this.options.clock.clockOut(owed));
      this.options.outbox.clear();
      this.options.log?.(`clocked out at ${owed.toISOString()}`);
    } catch (error) {
      this.#note(error);
      if (isRefusal(error)) this.options.outbox.clear();
    }
  }

  /** Clocks in when the toggle is on and the server says the user is not. */
  async #reconcile(): Promise<void> {
    const today = await this.#read();
    if (!today || today.state !== 'out' || !this.options.autoTrack()) return;

    await this.#apply(() => this.options.clock.clockIn());
  }

  /**
   * The heartbeat fallback is worth exactly one attempt, on the first flush — and
   * only when the machine itself went away.
   *
   * A heartbeat with no clock-out beside it means this process stopped without
   * recording one. That is evidence of a crash, but *not* of the machine leaving: if
   * it has been up continuously since the heartbeat was written, only the app died,
   * and the user may well have carried on working in the browser. Closing their entry
   * at the heartbeat would throw that work away — so the reboot is what licenses the
   * guess, and without one the entry is left to the reconcile.
   */
  #takeUnreported(): Date | null {
    const at = this.#unreported;
    this.#unreported = null;

    if (!at || !this.options.autoTrack()) return null;

    if (this.#bootedAt().getTime() <= at.getTime()) {
      this.options.log?.('ignoring a heartbeat from a crash the machine outlived');

      return null;
    }

    return at;
  }

  async #read(): Promise<TodayStatus | null> {
    try {
      return this.#adopt(await this.options.clock.today());
    } catch (error) {
      this.#note(error);
      return null;
    }
  }

  async #apply(call: () => Promise<TodayStatus>): Promise<void> {
    try {
      this.#adopt(await call());
    } catch (error) {
      this.#note(error);
    }
  }

  #adopt(today: TodayStatus): TodayStatus {
    this.#publish({ connection: 'connected', state: today.state });

    return today;
  }

  /** A refusal still proves the server is there and the session is good. */
  #note(error: unknown): void {
    this.#publish({
      connection: isSignedOut(error) ? 'signedOut' : isRefusal(error) ? 'connected' : 'offline',
      state: this.#status.state,
    });
  }

  #publish(status: TrackerStatus): void {
    if (status.connection === this.#status.connection && status.state === this.#status.state) {
      return;
    }

    this.#status = status;
    this.options.onStatus?.(status);
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }

  #bootedAt(): Date {
    return this.options.bootedAt?.() ?? systemBootedAt();
  }

  /** One network conversation at a time, in the order they were asked for. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    // Swallowed here only, to keep the chain alive; the caller still sees `next`.
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }
}

/**
 * When the machine last booted, from its uptime.
 *
 * `node:os`, not Electron, so the state machine above stays testable outside a
 * browser process. Note that macOS and Windows count time asleep as uptime, which is
 * exactly what is wanted here: the question is whether the machine *restarted*, not
 * whether it rested.
 */
export function systemBootedAt(now: Date = new Date()): Date {
  return new Date(now.getTime() - uptime() * 1_000);
}

/** When the entry that is currently running began. */
function openedAt(today: TodayStatus): Date | null {
  const open = today.segments.find((segment) => segment.kind === 'work' && !segment.endedAt);

  return open ? new Date(open.startedAt) : null;
}

/**
 * Bounds a shutdown path. The OS gives an app moments, not minutes, to react to a
 * suspend; waiting past that is waiting for a process that is about to be frozen.
 */
export async function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;

  await Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);

  if (timer) clearTimeout(timer);
}
