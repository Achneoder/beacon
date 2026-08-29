import { beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceSegment, ClockState, TodayStatus } from '@beacon/shared';
import { ApiError, NetworkError } from './errors.js';
import type { OutboxPort } from './outbox.js';
import { Tracker, type ClockPort } from './tracker.js';

const NOW = new Date('2026-08-29T17:30:00.000Z');
const STARTED_AT = new Date('2026-08-29T09:00:00.000Z');

/** An in-memory outbox with the same contract as the file-backed one. */
class FakeOutbox implements OutboxPort {
  pendingAt: Date | null = null;
  lastSeenAt: Date | null = null;

  record(at: Date): void {
    this.pendingAt ??= at;
  }
  pending(): Date | null {
    return this.pendingAt;
  }
  clear(): void {
    this.pendingAt = null;
  }
  seen(at: Date): void {
    this.lastSeenAt = at;
  }
  lastSeen(): Date | null {
    return this.lastSeenAt;
  }
}

/**
 * A server that holds one open entry at a time, so the one-open-entry rule the API
 * enforces with a unique index is enforced here too — that rule is what several of
 * these expectations turn on.
 */
class FakeClock implements ClockPort {
  calls: string[] = [];
  clockedOutAt: Date | null = null;
  failWith: Error | null = null;
  #state: ClockState = 'out';
  #startedAt: Date | null = null;

  constructor(state: ClockState = 'out', startedAt: Date | null = null) {
    this.#state = state;
    this.#startedAt = startedAt;
  }

  async today(): Promise<TodayStatus> {
    this.calls.push('today');
    this.#maybeFail();

    return this.#status();
  }

  async clockIn(): Promise<TodayStatus> {
    this.calls.push('clockIn');
    this.#maybeFail();
    if (this.#state !== 'out') throw new ApiError(400, 'you are already clocked in');

    this.#state = 'in';
    this.#startedAt = NOW;

    return this.#status();
  }

  async clockOut(at: Date): Promise<TodayStatus> {
    this.calls.push('clockOut');
    this.#maybeFail();
    if (this.#state === 'out') throw new ApiError(400, 'you are not clocked in');

    this.clockedOutAt = at;
    this.#state = 'out';
    this.#startedAt = null;

    return this.#status();
  }

  #maybeFail(): void {
    if (this.failWith) throw this.failWith;
  }

  #status(): TodayStatus {
    const segments: AttendanceSegment[] =
      this.#startedAt === null
        ? []
        : [
            {
              id: 'entry',
              kind: 'work',
              startedAt: this.#startedAt.toISOString(),
              endedAt: null,
              source: 'desktop',
              note: null,
              approvalStatus: 'approved',
              durationMinutes: null,
            },
          ];

    return {
      timezone: 'UTC',
      date: '2026-08-29',
      state: this.#state,
      since: this.#startedAt?.toISOString() ?? null,
      segments,
      workedMinutes: 0,
      breakMinutes: 0,
      targetMinutes: 480,
    };
  }
}

function trackerFor(
  clock: FakeClock,
  outbox: FakeOutbox,
  autoTrack = true,
): Tracker {
  return new Tracker({ clock, outbox, autoTrack: () => autoTrack, now: () => NOW });
}

describe('Tracker', () => {
  let outbox: FakeOutbox;

  beforeEach(() => {
    outbox = new FakeOutbox();
  });

  describe('opening the app', () => {
    it('clocks in when the server says the user is out', async () => {
      const clock = new FakeClock('out');

      await trackerFor(clock, outbox).start();

      expect(clock.calls).toContain('clockIn');
    });

    it('leaves a running entry alone rather than opening a second one', async () => {
      const clock = new FakeClock('in', STARTED_AT);

      await trackerFor(clock, outbox).start();

      expect(clock.calls).not.toContain('clockIn');
    });

    it('does nothing at all when automatic tracking is off', async () => {
      const clock = new FakeClock('out');

      await trackerFor(clock, outbox, false).start();

      expect(clock.calls).not.toContain('clockIn');
    });

    it('reports itself offline rather than guessing when the server is unreachable', async () => {
      const clock = new FakeClock('out');
      clock.failWith = new NetworkError('ECONNREFUSED');
      const tracker = trackerFor(clock, outbox);

      await tracker.start();

      expect(tracker.status.connection).toBe('offline');
      expect(clock.calls).not.toContain('clockIn');
    });

    it('knows the difference between unreachable and signed out', async () => {
      const clock = new FakeClock('out');
      clock.failWith = new ApiError(401, 'Unauthorized');
      const tracker = trackerFor(clock, outbox);

      await tracker.start();

      expect(tracker.status.connection).toBe('signedOut');
    });
  });

  describe('going away', () => {
    it('records the clock-out before sending it', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      const tracker = trackerFor(clock, outbox);
      await tracker.start();

      // Not awaited: the record has to be on disk by the time `pause` returns control,
      // not by the time its network call finishes — a suspend does not wait for us.
      const pausing = tracker.pause('suspend');
      expect(outbox.pending()).toEqual(NOW);

      await pausing;
      expect(clock.clockedOutAt).toEqual(NOW);
      expect(outbox.pending()).toBeNull();
    });

    it('does nothing when the clock is not running', async () => {
      const clock = new FakeClock('out');
      const tracker = trackerFor(clock, outbox, false);
      await tracker.start();

      await tracker.pause('lock');

      expect(outbox.pending()).toBeNull();
      expect(clock.calls).not.toContain('clockOut');
    });

    it('leaves the clock alone when automatic tracking is off', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      const tracker = trackerFor(clock, outbox, false);
      await tracker.start();

      await tracker.pause('suspend');

      expect(outbox.pending()).toBeNull();
      expect(clock.clockedOutAt).toBeNull();
    });
  });

  describe('replaying a clock-out the machine slept through', () => {
    it('closes the entry at the instant of the suspend, not the resume', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      const tracker = trackerFor(clock, outbox);
      await tracker.start();

      clock.failWith = new NetworkError('the machine went away mid-request');
      await tracker.pause('suspend');
      expect(outbox.pending()).toEqual(NOW);

      // Sixteen hours later the machine wakes up. The entry must close at 17:30, not
      // now — this is the whole reason the API accepts a backdated clock-out.
      const woke = new Date('2026-08-30T09:00:00.000Z');
      clock.failWith = null;
      const resumed = new Tracker({
        clock,
        outbox,
        autoTrack: () => true,
        now: () => woke,
      });

      await resumed.resume();

      expect(clock.clockedOutAt).toEqual(NOW);
      expect(outbox.pending()).toBeNull();
    });

    it('keeps the earliest instant when a second suspend arrives first', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      const tracker = trackerFor(clock, outbox);
      await tracker.start();

      clock.failWith = new NetworkError('offline');
      await tracker.pause('suspend');
      await tracker.pause('suspend');

      expect(outbox.pending()).toEqual(NOW);
    });

    it('drops the replay when the entry has already been closed elsewhere', async () => {
      const clock = new FakeClock('out');
      outbox.pendingAt = NOW;

      await trackerFor(clock, outbox, false).start();

      expect(outbox.pending()).toBeNull();
      expect(clock.calls).not.toContain('clockOut');
    });

    it('drops a replay that predates the open entry rather than closing it', async () => {
      // The user clocked in again — from the web, or another machine — after the
      // instant we owe. That entry is not ours to close.
      const clock = new FakeClock('in', new Date('2026-08-30T08:00:00.000Z'));
      outbox.pendingAt = NOW;

      await trackerFor(clock, outbox, false).start();

      expect(outbox.pending()).toBeNull();
      expect(clock.clockedOutAt).toBeNull();
    });

    it('drops a replay the server refuses rather than retrying it forever', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      outbox.pendingAt = NOW;
      const tracker = trackerFor(clock, outbox, false);

      // The read succeeds and the clock-out is the call that is refused.
      const original = clock.clockOut.bind(clock);
      clock.clockOut = async () => {
        void original;
        throw new ApiError(400, 'a clock-out cannot precede the clock-in');
      };

      await tracker.start();

      expect(outbox.pending()).toBeNull();
    });

    it('keeps a replay it could not deliver', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      outbox.pendingAt = NOW;
      clock.failWith = new NetworkError('still offline');

      await trackerFor(clock, outbox, false).start();

      expect(outbox.pending()).toEqual(NOW);
    });
  });

  describe('recovering from a process that was killed outright', () => {
    it('closes the entry at the last heartbeat', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      // No pending record — this process never got to make one.
      outbox.lastSeenAt = new Date('2026-08-29T14:00:00.000Z');

      await trackerFor(clock, outbox).start();

      expect(clock.clockedOutAt).toEqual(outbox.lastSeenAt);
    });

    it('ignores a heartbeat older than the entry that is open now', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      outbox.lastSeenAt = new Date('2026-08-28T14:00:00.000Z');

      await trackerFor(clock, outbox).start();

      expect(clock.clockedOutAt).toBeNull();
    });

    it('tries the heartbeat once, not on every tick', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      clock.failWith = new NetworkError('offline');
      outbox.lastSeenAt = new Date('2026-08-29T14:00:00.000Z');
      const tracker = trackerFor(clock, outbox);

      await tracker.start();
      clock.failWith = null;
      clock.calls = [];

      await tracker.tick();

      // The heartbeat is a one-shot guess. Left standing it would close the entry the
      // reconcile has since opened, every single minute.
      expect(clock.calls).not.toContain('clockOut');
    });
  });

  describe('the heartbeat', () => {
    it('advances while the clock runs', async () => {
      const clock = new FakeClock('in', STARTED_AT);

      await trackerFor(clock, outbox).tick();

      expect(outbox.lastSeen()).toEqual(NOW);
    });

    it('stays put while the clock does not', async () => {
      const clock = new FakeClock('out');

      await trackerFor(clock, outbox, false).tick();

      expect(outbox.lastSeen()).toBeNull();
    });
  });

  describe('the tray buttons', () => {
    it('clock in even when automatic tracking is off — the user asked directly', async () => {
      const clock = new FakeClock('out');

      await trackerFor(clock, outbox, false).clockInNow();

      expect(clock.calls).toContain('clockIn');
    });

    it('clock out at once, with no outbox record to replay', async () => {
      const clock = new FakeClock('in', STARTED_AT);
      const tracker = trackerFor(clock, outbox, false);

      await tracker.clockOutNow();

      expect(clock.clockedOutAt).toEqual(NOW);
      expect(outbox.pending()).toBeNull();
    });
  });
});
