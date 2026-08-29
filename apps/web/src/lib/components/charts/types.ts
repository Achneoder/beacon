/**
 * The shapes {@link BarChart} plots.
 *
 * Every string is pre-formatted by the caller. The chart draws; it never decides how
 * a duration or a day count reads, because that lives in `@beacon/shared` and in
 * `svelte-i18n` and must match the table beside it exactly.
 */

/** One stacked piece of a bar. `seriesKey` indexes {@link BarSeries}, never a colour. */
export interface BarSegment {
	seriesKey: string;
	value: number;
}

export interface BarRow {
	key: string;
	/** The category name, in full. Shortened for the axis; never for the table. */
	label: string;
	segments: BarSegment[];
	/**
	 * A reference value drawn as a tick across the bar — a target, a quota. Not a
	 * second series and not a second axis: it is the same scale as the bar.
	 */
	marker?: number | null;
	/** The pre-formatted value that rides the bar's tip. */
	valueLabel: string;
}

/**
 * The legend, in stacking order. Two entries is the palette's whole set: the chart
 * tokens are validated as a pair, and a third would be a new token stepped and
 * re-validated rather than a colour picked here.
 */
export interface BarSeries {
	key: string;
	label: string;
}
