import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BarChart from './BarChart.svelte';
import type { BarRow, BarSeries } from './types';

/**
 * jsdom reports every element as zero-sized, so LayerCake's responsive box never
 * resolves and the plot itself does not render here. That is the right split
 * anyway: the geometry belongs to the library and to the browser suite, and what
 * this file is for is the half a chart gets wrong without anyone noticing — whether
 * a reader who cannot see it can still read it, and whether identity survives
 * without colour.
 */

const SERIES: BarSeries[] = [
	{ key: 'taken', label: 'Taken' },
	{ key: 'pending', label: 'Pending' }
];

const ROWS: BarRow[] = [
	{
		key: 'u1',
		label: 'Ada Lovelace',
		segments: [
			{ seriesKey: 'taken', value: 12 },
			{ seriesKey: 'pending', value: 2 }
		],
		valueLabel: '14 days'
	},
	{
		key: 'u2',
		label: 'A Person With A Very Long Name Indeed',
		segments: [{ seriesKey: 'taken', value: 5 }],
		valueLabel: '5 days'
	}
];

const base = {
	title: 'Holiday taken',
	rows: ROWS,
	series: SERIES,
	formatTick: (value: number) => String(value)
};

describe('BarChart', () => {
	it('names itself, so the figure is not an unlabelled picture', () => {
		render(BarChart, { props: { ...base, subtitle: 'Days, this year' } });

		expect(screen.getByRole('heading', { name: 'Holiday taken' })).toBeInTheDocument();
		expect(screen.getByText('Days, this year')).toBeInTheDocument();
	});

	it('always shows a legend for two series, so identity is never colour alone', () => {
		render(BarChart, { props: base });

		expect(screen.getByText('Taken')).toBeInTheDocument();
		expect(screen.getByText('Pending')).toBeInTheDocument();
	});

	it('shows no legend box for a single series — the title already names it', () => {
		render(BarChart, {
			props: { ...base, series: [{ key: 'worked', label: 'Worked' }] }
		});

		expect(screen.queryByText('Worked')).not.toBeInTheDocument();
	});

	it('adds the reference tick to the legend when a row carries one', () => {
		render(BarChart, {
			props: {
				...base,
				series: [{ key: 'worked', label: 'Worked' }],
				markerLabel: 'Expected',
				rows: [{ ...ROWS[0], marker: 20 }]
			}
		});

		expect(screen.getByText('Expected')).toBeInTheDocument();
	});

	it('falls back to a table of its own when no visible table is named', () => {
		render(BarChart, { props: base });

		const table = screen.getByRole('table', { name: 'Holiday taken' });
		expect(table).toBeInTheDocument();
		// In full, not shortened the way the axis label is.
		expect(
			screen.getByRole('rowheader', { name: 'A Person With A Very Long Name Indeed' })
		).toBeInTheDocument();
		expect(screen.getByRole('cell', { name: '14 days' })).toBeInTheDocument();
	});

	it('points at the caller table instead of duplicating it', () => {
		const { container } = render(BarChart, {
			props: { ...base, describedBy: 'absence-table' }
		});

		expect(screen.queryByRole('table')).not.toBeInTheDocument();
		expect(container.querySelector('figure')).toHaveAttribute('aria-describedby', 'absence-table');
	});

	it('says so when there is nothing to plot, rather than drawing an empty grid', () => {
		render(BarChart, { props: { ...base, rows: [], emptyLabel: 'Nothing in this range' } });

		expect(screen.getByText('Nothing in this range')).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});
});
