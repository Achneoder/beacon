import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { SearchResult } from '@beacon/shared';
import '$lib/i18n';
import SearchField from './SearchField.svelte';
import * as searchApi from '$lib/api/search';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...args: unknown[]) => goto(...args) }));

const results: SearchResult[] = [
	{
		type: 'document',
		id: 'd1',
		title: 'Payslip January',
		subtitle: 'Payslips',
		href: '/documents?open=d1'
	},
	{ type: 'employee', id: 'u1', title: 'Lena Hartmann', subtitle: 'Designer', href: '/people/u1' }
];

/** The debounce is real time; the tests drive it rather than waiting it out. */
function typeInto(input: HTMLElement, value: string) {
	return fireEvent.input(input, { target: { value } });
}

const field = () => screen.getByRole('combobox', { name: 'Search documents and people' });

beforeEach(async () => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	goto.mockReset();
	vi.spyOn(searchApi, 'search').mockResolvedValue({ results, available: true });
	await waitLocale('en');
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('SearchField', () => {
	it('queries once the term is long enough, and groups what comes back', async () => {
		render(SearchField);

		await typeInto(field(), 'pay');
		await vi.advanceTimersByTimeAsync(250);

		await waitFor(() => expect(searchApi.search).toHaveBeenCalledWith('pay'));
		expect(screen.getByRole('group', { name: 'Documents' })).toBeInTheDocument();
		expect(screen.getByRole('group', { name: 'People' })).toBeInTheDocument();
		expect(screen.getAllByRole('option')).toHaveLength(2);
	});

	it('never queries below the minimum term length', async () => {
		render(SearchField);

		await typeInto(field(), 'p');
		await vi.advanceTimersByTimeAsync(250);

		expect(searchApi.search).not.toHaveBeenCalled();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});

	it('debounces, so a typed word is one request rather than four', async () => {
		render(SearchField);

		await typeInto(field(), 'pa');
		await typeInto(field(), 'pay');
		await typeInto(field(), 'pays');
		await vi.advanceTimersByTimeAsync(250);

		await waitFor(() => expect(searchApi.search).toHaveBeenCalledTimes(1));
		expect(searchApi.search).toHaveBeenCalledWith('pays');
	});

	it('moves the active option with the arrow keys without moving focus', async () => {
		render(SearchField);
		const input = field();

		await typeInto(input, 'pay');
		await vi.advanceTimersByTimeAsync(250);
		await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(input).toHaveAttribute('aria-activedescendant');
		expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

		// Wraps, so the list can be walked without watching it.
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
	});

	it('opens the active result on Enter', async () => {
		render(SearchField);
		const input = field();

		await typeInto(input, 'pay');
		await vi.advanceTimersByTimeAsync(250);
		await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(goto).toHaveBeenCalledWith('/documents?open=d1');
	});

	it('does nothing on Enter when no option is active', async () => {
		render(SearchField);
		const input = field();

		await typeInto(input, 'pay');
		await vi.advanceTimersByTimeAsync(250);
		await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(goto).not.toHaveBeenCalled();
	});

	it('closes on Escape and stays put', async () => {
		render(SearchField);
		const input = field();

		await typeInto(input, 'pay');
		await vi.advanceTimersByTimeAsync(250);
		await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});

	it('opens a result on click', async () => {
		render(SearchField);

		await typeInto(field(), 'lena');
		await vi.advanceTimersByTimeAsync(250);
		await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

		await fireEvent.click(screen.getByRole('option', { name: /Lena Hartmann/ }));

		expect(goto).toHaveBeenCalledWith('/people/u1');
	});

	it('says so when nothing matched', async () => {
		vi.spyOn(searchApi, 'search').mockResolvedValue({ results: [], available: true });
		render(SearchField);

		await typeInto(field(), 'zzz');
		await vi.advanceTimersByTimeAsync(250);

		await waitFor(() => expect(screen.getAllByText('No matches').length).toBeGreaterThan(0));
	});

	it('treats a failed search as an empty one rather than trapping the user', async () => {
		vi.spyOn(searchApi, 'search').mockRejectedValue(new Error('offline'));
		render(SearchField);

		await typeInto(field(), 'pay');
		await vi.advanceTimersByTimeAsync(250);

		await waitFor(() => expect(screen.getAllByText('No matches').length).toBeGreaterThan(0));
	});

	it('marks itself as a combobox controlling the result list', async () => {
		render(SearchField);
		const input = field();

		expect(input).toHaveAttribute('aria-expanded', 'false');
		expect(input).toHaveAttribute('aria-controls', 'sidebar-search-results');
		expect(input).toHaveAttribute('aria-autocomplete', 'list');

		await typeInto(input, 'pay');
		await vi.advanceTimersByTimeAsync(250);

		await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'));
	});
});
