<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import BarMarks from './BarMarks.svelte';
	import type { BarRow, BarSeries } from './types';

	/**
	 * The one chart component, per the roadmap: everything Beacon plots goes through
	 * here so theme and locale formatting stay one decision.
	 *
	 * **LayerCake owns the geometry, `BarMarks` owns the ink.** The library supplies
	 * the responsive box, the padding and the x scale with its nice ticks; every
	 * rectangle, tick and label is ours, painted from `tokens.css`. That split is why
	 * a batteries-included chart library was the wrong dependency here: one that
	 * ships its own theme would have to be argued out of it on every screen, and the
	 * appearance toggle would need JavaScript instead of a CSS variable.
	 *
	 * **The plot is `aria-hidden`.** A bar chart is a picture of a table, so the
	 * figure points at the real table beside it with `aria-describedby` rather than
	 * duplicating every value into a second, invisible one. Without `describedBy` it
	 * renders its own visually-hidden table instead — the chart is never the only
	 * way to read a number.
	 */
	type Props = {
		title: string;
		/** One line under the title: what is plotted, and in what unit. */
		subtitle?: string;
		rows: BarRow[];
		/** Stacking order, and the legend. One entry renders no legend box. */
		series: BarSeries[];
		/** The legend entry for the reference tick, when any row carries one. */
		markerLabel?: string;
		/** Formats an axis tick. Every other string is pre-formatted by the caller. */
		formatTick: (value: number) => string;
		/** The id of the visible table this chart pictures. */
		describedBy?: string;
		/** Shown in place of the plot when there is nothing to draw. */
		emptyLabel?: string;
		class?: string;
	};

	let {
		title,
		subtitle,
		rows,
		series,
		markerLabel,
		formatTick,
		describedBy,
		emptyLabel,
		class: extra = ''
	}: Props = $props();

	/** Per-row band. Bars cap well under it and the rest is deliberate air. */
	const ROW_HEIGHT = 34;
	const BAR_HEIGHT = 18;
	/** Room for the x-axis labels, so the card never grows an inner scrollbar. */
	const AXIS_BAND = 26;
	const PADDING = { top: 6, right: 76, bottom: AXIS_BAND, left: 132 };
	const SEGMENT_GAP = 2;
	const END_RADIUS = 4;
	/** What fits in the 132px left gutter at 12.5px before a label needs shortening. */
	const LABEL_BUDGET = 18;

	const totals = $derived(
		rows.map((row) => row.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0))
	);
	const markers = $derived(rows.map((row) => Math.max(0, row.marker ?? 0)));
	/**
	 * The domain never collapses: a table of people who all worked nothing is a real
	 * answer, and a zero-width scale would draw every bar full.
	 */
	const maxValue = $derived(Math.max(1, ...totals, ...markers));
	const plotHeight = $derived(rows.length * ROW_HEIGHT);
	const hasMarker = $derived(rows.some((row) => (row.marker ?? null) !== null));
	const seriesOrder = $derived(series.map((entry) => entry.key));

	/** Series colours come from the validated pair; nothing cycles past it. */
	function fillOf(index: number): string {
		return index <= 0 ? 'var(--bc-chart-1)' : 'var(--bc-chart-2)';
	}

	const total = (row: BarRow) =>
		row.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
</script>

<figure class="m-0 {extra}" aria-describedby={describedBy}>
	<figcaption>
		<h3 class="text-sm font-semibold tracking-tight">{title}</h3>
		{#if subtitle}<p class="mt-0.5 text-2xs text-ink-muted">{subtitle}</p>{/if}
	</figcaption>

	{#if series.length > 1 || hasMarker}
		<!-- Identity is never colour alone. The label wears an ink token and the swatch
		     beside it carries the hue — a series colour used as text would be
		     illegible at this size and would fail contrast besides. -->
		<ul class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
			{#each series as entry, index (entry.key)}
				<li class="flex items-center gap-1.5 text-2xs text-ink-muted">
					<span class="h-2.5 w-2.5 shrink-0 rounded-[3px]" style:background-color={fillOf(index)}
					></span>
					{entry.label}
				</li>
			{/each}
			{#if hasMarker && markerLabel}
				<li class="flex items-center gap-1.5 text-2xs text-ink-muted">
					<span class="h-3.5 w-0.5 shrink-0 bg-ink-muted"></span>
					{markerLabel}
				</li>
			{/if}
		</ul>
	{/if}

	{#if rows.length === 0}
		<p class="mt-4 text-sm text-ink-muted">{emptyLabel}</p>
	{:else}
		<div class="mt-3" style:height="{plotHeight + PADDING.top + PADDING.bottom}px">
			<LayerCake data={rows} x={total} xDomain={[0, maxValue]} xNice={4} padding={PADDING}>
				<Svg>
					<BarMarks
						{rows}
						{maxValue}
						{formatTick}
						{fillOf}
						{seriesOrder}
						rowHeight={ROW_HEIGHT}
						barHeight={BAR_HEIGHT}
						segmentGap={SEGMENT_GAP}
						endRadius={END_RADIUS}
						labelBudget={LABEL_BUDGET}
					/>
				</Svg>
			</LayerCake>
		</div>

		{#if !describedBy}
			<table class="sr-only">
				<caption>{title}</caption>
				<tbody>
					{#each rows as row (row.key)}
						<tr>
							<th scope="row">{row.label}</th>
							<td>{row.valueLabel}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}
</figure>
