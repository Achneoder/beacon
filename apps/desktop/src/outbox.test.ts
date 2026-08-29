import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOutbox, outboxPath } from './outbox.js';

describe('FileOutbox', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beacon-outbox-'));
    path = outboxPath(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty when nothing has been written', () => {
    const outbox = new FileOutbox(path);

    expect(outbox.pending()).toBeNull();
    expect(outbox.lastSeen()).toBeNull();
  });

  it('survives the process that wrote it', () => {
    const at = new Date('2026-08-29T17:30:00.000Z');
    new FileOutbox(path).record(at);

    // The point of the file: this is a different process, after the machine slept.
    expect(new FileOutbox(path).pending()).toEqual(at);
  });

  it('keeps the first instant when a second clock-out is recorded', () => {
    const outbox = new FileOutbox(path);
    const first = new Date('2026-08-29T17:30:00.000Z');

    outbox.record(first);
    outbox.record(new Date('2026-08-29T18:00:00.000Z'));

    // A suspend that was never delivered, then a second suspend: the entry has to
    // close at the first, which is when the machine actually stopped being used.
    expect(outbox.pending()).toEqual(first);
  });

  it('forgets a clock-out once it has been taken', () => {
    const outbox = new FileOutbox(path);
    outbox.record(new Date('2026-08-29T17:30:00.000Z'));

    outbox.clear();

    expect(outbox.pending()).toBeNull();
    expect(new FileOutbox(path).pending()).toBeNull();
  });

  it('advances the heartbeat, and remembers it across a restart', () => {
    const outbox = new FileOutbox(path);
    outbox.seen(new Date('2026-08-29T17:00:00.000Z'));
    const latest = new Date('2026-08-29T17:01:00.000Z');
    outbox.seen(latest);

    expect(new FileOutbox(path).lastSeen()).toEqual(latest);
  });

  it('reads a half-written file as empty rather than refusing to start', () => {
    writeFileSync(path, '{"pendingAt": "2026-08-29T17:3', 'utf8');

    expect(new FileOutbox(path).pending()).toBeNull();
  });

  it('ignores an instant it cannot parse', () => {
    writeFileSync(path, JSON.stringify({ pendingAt: 'soon', lastSeenAt: null }), 'utf8');

    expect(new FileOutbox(path).pending()).toBeNull();
  });
});
