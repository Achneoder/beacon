/**
 * The clock state, shared so the sidebar, the Today screen and the API agree.
 *
 * Break is a state of its own, not a gap between two entries: the control offers
 * different actions in each state (`in` → clock out / start break; `break` → resume /
 * clock out; `out` → clock in / add a manual entry) and only a *running* state pulses.
 *
 * Phase 2 adds the entries themselves. This is only the vocabulary.
 */
export const CLOCK_STATES = ['in', 'break', 'out'] as const;

export type ClockState = (typeof CLOCK_STATES)[number];

/** Whether the state is running, and so whether the status dot pulses. */
export function isRunning(state: ClockState): boolean {
  return state !== 'out';
}
