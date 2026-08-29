<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { WEEKDAYS, type CalendarDay } from '@beacon/shared';
	import { cellTint } from '$lib/absence/labels';

	/**
	 * The month grid: always six rows, Monday first.
	 *
	 * Every cell is a real `<button>`, which is the whole accessibility story here —
	 * the canvas selects a range by hovering and clicking, and a div with a click
	 * handler would leave keyboard users with no way in at all. Tab reaches each day,
	 * Enter and Space pick it, and the focus ring comes from the base stylesheet.
	 */
	type Props = {
		days: CalendarDay[];
		/** `YYYY-MM` — days outside it are drawn as padding. */
		month: string;
		/** `YYYY-MM-DD` in the user's zone, ringed in accent. */
		today: string;
		/** The range picked so far: `to` is null between the two clicks. */
		selection: { from: string; to: string | null } | null;
		onPick: (date: string) => void;
	};

	let { days, month, today, selection, onPick }: Props = $props();

	function inSelection(date: string): boolean {
		if (!selection) return false;
		const to = selection.to ?? selection.from;

		return (
			date >= (selection.from < to ? selection.from : to) &&
			date <= (selection.from < to ? to : selection.from)
		);
	}

	function dayNumber(date: string): string {
		return String(Number(date.slice(8, 10)));
	}

	/**
	 * The six weeks, as six rows. A `gridcell` has to be owned by a `row` — a flat run
	 * of 42 cells under the grid is invalid ARIA, and a screen reader reading it has
	 * no week to announce.
	 */
	const weeks = $derived(
		Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
			days.slice(index * 7, index * 7 + 7)
		)
	);
</script>

<div role="grid" aria-label={$_('calendar.grid')} class="mt-4">
	<div role="row" class="grid grid-cols-7 gap-1 pb-2">
		{#each WEEKDAYS as weekday (weekday)}
			<span role="columnheader" class="text-center text-2xs font-semibold text-ink-muted">
				{$_(`calendar.weekdayShort.${weekday}`)}
			</span>
		{/each}
	</div>

	{#each weeks as week (week[0].date)}
		<div role="row" class="grid grid-cols-7 gap-1 pb-1">
			{#each week as day (day.date)}
				{@const outside = !day.date.startsWith(month)}
				{@const first = day.absences[0]}
				<button
					type="button"
					role="gridcell"
					aria-current={day.date === today ? 'date' : undefined}
					aria-selected={inSelection(day.date)}
					onclick={() => onPick(day.date)}
					class="flex min-h-16 flex-col items-start gap-1 rounded-control border p-1.5 text-left
				       transition-[background-color,border-color] duration-150
				       {inSelection(day.date)
						? 'border-accent bg-accent-soft'
						: 'border-transparent hover:border-border-default'}
				       {day.weekend && !first ? 'bg-surface-muted' : ''}
				       {outside ? 'opacity-40' : ''}"
				>
					<span
						class="font-mono text-2xs {day.date === today
							? 'rounded-full bg-accent-fill px-1.5 text-white'
							: 'text-ink-muted'}"
					>
						{dayNumber(day.date)}
					</span>

					{#if day.holiday}
						<span class="w-full truncate rounded-sm bg-border-subtle px-1 text-2xs text-ink-muted">
							{day.holiday}
						</span>
					{/if}

					{#each day.absences.slice(0, 2) as absence (absence.id)}
						<span
							class="w-full truncate rounded-sm px-1 text-2xs font-semibold {cellTint(
								absence.colorRole
							)} {absence.status === 'pending' ? 'opacity-70' : ''}"
						>
							{absence.typeName}
						</span>
					{/each}

					{#if day.absences.length > 2}
						<span class="px-1 text-2xs text-ink-muted">+{day.absences.length - 2}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/each}
</div>
