import type { ClockState, TodayStatus } from '@beacon/shared';
import * as attendance from '$lib/api/attendance';
import { session } from '$lib/auth/session.svelte';

/**
 * Today's clock, shared by the sidebar's status card and the Today screen.
 *
 * One instance, because two would drift: clocking in from the Today panel has to move
 * the dot in the sidebar in the same tick. Every clock call returns the whole of
 * today, so a mutation is just an assignment — there is no local state to reconcile.
 *
 * Nothing here counts seconds. The live readout ticks in `Clock` from the
 * server-supplied `since` instant, so a laptop that sleeps wakes up with the right
 * total rather than one short by however long it was out.
 */
class ClockState_ {
	#today = $state<TodayStatus | null>(null);
	#pending = $state(false);
	#loaded = $state(false);

	get today(): TodayStatus | null {
		return this.#today;
	}

	get state(): ClockState {
		return this.#today?.state ?? 'out';
	}

	/** When the current state began — what the live counter runs from. */
	get since(): string | null {
		return this.#today?.since ?? null;
	}

	/** True while a clock call is in flight, so the buttons can refuse a double press. */
	get pending(): boolean {
		return this.#pending;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Only for a caller that may actually clock; a read without the permission 403s. */
	get enabled(): boolean {
		return session.can('attendance:read');
	}

	async refresh(): Promise<void> {
		if (!this.enabled) return;

		try {
			this.#today = await attendance.getToday();
		} catch {
			// A failed read leaves the last known state on screen rather than blanking
			// the sidebar — the next refresh, on focus or on an action, corrects it.
		} finally {
			this.#loaded = true;
		}
	}

	clockIn = () => this.#run(() => attendance.clockIn());
	clockOut = () => this.#run(() => attendance.clockOut());
	startBreak = () => this.#run(() => attendance.startBreak());
	stopBreak = () => this.#run(() => attendance.stopBreak());

	/** Surfaces the failure to the caller; the pending flag is cleared either way. */
	async #run(call: () => Promise<TodayStatus>): Promise<void> {
		if (this.#pending) return;
		this.#pending = true;

		try {
			this.#today = await call();
		} finally {
			this.#pending = false;
		}
	}

	reset(): void {
		this.#today = null;
		this.#loaded = false;
	}
}

export const clock = new ClockState_();
