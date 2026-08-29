<script lang="ts">
	import { getContext } from 'svelte';
	import type { Readable } from 'svelte/store';
	import type { BarRow } from './types';

	/**
	 * The marks. Everything drawn inside the plot area lives here.
	 *
	 * It reads the scale and the plot size out of LayerCake's context rather than
	 * taking them as props — that is the library's own pattern, the one `Svg.svelte`
	 * uses, and it is why the geometry can stay in the library while every rectangle,
	 * tick and label stays ours and painted from `tokens.css`.
	 */
	type Props = {
		rows: BarRow[];
		maxValue: number;
		rowHeight: number;
		barHeight: number;
		segmentGap: number;
		endRadius: number;
		labelBudget: number;
		formatTick: (value: number) => string;
		fillOf: (index: number) => string;
		seriesOrder: string[];
	};

	let {
		rows,
		maxValue,
		rowHeight,
		barHeight,
		segmentGap,
		endRadius,
		labelBudget,
		formatTick,
		fillOf,
		seriesOrder
	}: Props = $props();

	type Scale = ((value: number) => number) & { ticks: (count: number) => number[] };
	const { xScale, width } = getContext<{
		xScale: Readable<Scale>;
		width: Readable<number>;
	}>('LayerCake');

	const plotHeight = $derived(rows.length * rowHeight);
	const ticks = $derived($xScale.ticks(4));

	function shorten(label: string): string {
		return label.length > labelBudget ? `${label.slice(0, labelBudget - 1)}…` : label;
	}

	/**
	 * A bar, or one segment of one, as a path.
	 *
	 * A `<rect>` cannot round two corners and leave the other two square, and a fully
	 * rounded bar detaches from its baseline. So: square where it starts, rounded at
	 * the data end, and only when the segment is wide enough for the radius to mean
	 * anything — rounding a 3px sliver turns it into a dot.
	 */
	function barPath(x0: number, x1: number, y: number, rounded: boolean): string {
		const barWidth = Math.max(0, x1 - x0);
		const radius = rounded ? Math.min(endRadius, barWidth / 2) : 0;
		const bottom = y + barHeight;

		if (radius === 0) return `M${x0},${y} H${x1} V${bottom} H${x0} Z`;

		return [
			`M${x0},${y}`,
			`H${x1 - radius}`,
			`A${radius},${radius} 0 0 1 ${x1},${y + radius}`,
			`V${bottom - radius}`,
			`A${radius},${radius} 0 0 1 ${x1 - radius},${bottom}`,
			`H${x0}`,
			'Z'
		].join(' ');
	}

	/** The stacked pieces of one row, laid out along the scale. */
	function piecesOf(row: BarRow, scale: Scale) {
		const pieces: { key: string; x0: number; x1: number; last: boolean; index: number }[] = [];
		const drawable = row.segments.filter((segment) => segment.value > 0);
		let cursor = 0;

		for (const [position, segment] of drawable.entries()) {
			const start = scale(cursor);
			cursor += segment.value;
			const last = position === drawable.length - 1;
			// The gap is surface showing through, not a stroke around the mark: it comes
			// off the end of every segment but the last, so the stack still totals right.
			const end = scale(cursor) - (last ? 0 : segmentGap);

			pieces.push({
				key: segment.seriesKey,
				x0: start,
				x1: Math.max(start, end),
				last,
				index: seriesOrder.indexOf(segment.seriesKey)
			});
		}

		return pieces;
	}

	const topOf = (index: number) => index * rowHeight + (rowHeight - barHeight) / 2;
</script>

<!--
	The whole plot is hidden from assistive technology: it is a picture of a table,
	and `BarChart` guarantees that table exists — either the caller's visible one or
	its own fallback.
-->
<g aria-hidden="true">
	{#each ticks as tick (tick)}
		<!-- Hairline, solid, one step off the surface. Never dashed: a dashed grid
		     reads as a threshold when it is only a grid. -->
		<line
			x1={$xScale(tick)}
			x2={$xScale(tick)}
			y1={0}
			y2={plotHeight}
			stroke="var(--bc-border-subtle)"
			stroke-width="1"
		/>
		<text
			x={$xScale(tick)}
			y={plotHeight + 16}
			text-anchor="middle"
			class="fill-ink-muted font-mono"
			style="font-size: 10.5px; font-variant-numeric: tabular-nums;"
		>
			{formatTick(tick)}
		</text>
	{/each}

	{#each rows as row, index (row.key)}
		{@const top = topOf(index)}
		<text
			x={-10}
			y={top + barHeight / 2 + 4}
			text-anchor="end"
			class="fill-ink"
			style="font-size: 12.5px;"
		>
			{shorten(row.label)}
			<title>{row.label}</title>
		</text>

		{#if row.segments.every((segment) => segment.value <= 0)}
			<!-- Nothing to draw is still something to see: a stub keeps the row present
			     rather than leaving a blank line in the grid. -->
			<path d={barPath(0, 3, top, false)} fill="var(--bc-chart-track)" />
		{/if}

		{#each piecesOf(row, $xScale) as piece (piece.key)}
			<path d={barPath(piece.x0, piece.x1, top, piece.last)} fill={fillOf(piece.index)} />
		{/each}

		{#if row.marker !== null && row.marker !== undefined}
			<line
				x1={$xScale(Math.min(row.marker, maxValue))}
				x2={$xScale(Math.min(row.marker, maxValue))}
				y1={top - 3}
				y2={top + barHeight + 3}
				stroke="var(--bc-ink-muted)"
				stroke-width="2"
			/>
		{/if}

		<!-- The tip value sits in the reserved right gutter rather than beside the bar
		     end, so it can never collide with a mark or be clipped by the plot. -->
		<text
			x={$width + 8}
			y={top + barHeight / 2 + 4}
			class="fill-ink-muted font-mono"
			style="font-size: 11.5px; font-variant-numeric: tabular-nums;"
		>
			{row.valueLabel}
		</text>
	{/each}
</g>
