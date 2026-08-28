import { expect, test } from './fixtures.js';

/**
 * The calendar is the one screen where the browser does arithmetic the server will
 * redo: it prints the cost of a selection from `@beacon/shared` before anything is
 * sent, and the API freezes its own figure onto the row. This walks the whole loop —
 * pick, send, withdraw — so the two cannot quietly disagree.
 */

/** The Monday on or before the first of the month, which is cell 0 of the grid. */
function gridStart(month: Date): Date {
	const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
	first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));

	return first;
}

/**
 * The first working day strictly after today, as its index into the 42-cell grid.
 *
 * Strictly after, because an absence whose last day has passed settles to `taken` the
 * moment anyone reads it — and these specs want to watch a request sit at pending.
 */
function futureWorkingDayCell(): number {
	const today = new Date();
	const start = gridStart(today);
	const at = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

	do {
		at.setUTCDate(at.getUTCDate() + 1);
	} while (at.getUTCDay() === 0 || at.getUTCDay() === 6);

	return Math.round((at.getTime() - start.getTime()) / 86_400_000);
}

test.describe('the calendar', () => {
	test('draws six weeks of the current month', async ({ ownerPage: page }) => {
		await page.goto('/calendar');

		const grid = page.getByRole('grid', { name: 'Absences by day' });
		await expect(grid.getByRole('gridcell')).toHaveCount(42);
		// Six weeks plus the weekday header.
		await expect(grid.getByRole('row')).toHaveCount(7);

		// The eight types are seeded on first read, so their arrival is visible on
		// screen — in the legend — rather than only in the network tab.
		await expect(page.getByText('Vacation').first()).toBeVisible();
		await expect(page.getByText('Home office').first()).toBeVisible();
	});

	test('prices a selection before it is sent, then books it', async ({ ownerPage: page }) => {
		await page.goto('/calendar');

		const grid = page.getByRole('grid', { name: 'Absences by day' });
		const cell = grid.getByRole('gridcell').nth(futureWorkingDayCell());

		await expect(page.getByText('Pick the first day of your absence.')).toBeVisible();

		await cell.click();
		await expect(
			page.getByText('Now pick the last day — or the same day again for a single day.')
		).toBeVisible();

		// The same day twice is how the design asks for a single day off.
		await cell.click();

		// Twice over: the hint under the grid and the request card's own cost line.
		// The card printed a bare "· 1" until the unit was put back on it.
		await expect(page.getByText(/· 1 day$/)).toHaveCount(2);
		await expect(page.getByRole('heading', { level: 2, name: 'New request' })).toBeVisible();

		await page.getByRole('button', { name: 'Send request' }).click();
		await expect(page.getByText('Your request has been sent.')).toBeVisible();

		// It lands on the grid and in the list below it.
		await expect(cell.getByText('Vacation')).toBeVisible();
		const request = page.getByRole('listitem').filter({ hasText: 'Pending' }).first();
		await expect(request).toBeVisible();
		await expect(request.getByText('1 day')).toBeVisible();
	});

	test('shows the request on the approvals screen', async ({ ownerPage: page }) => {
		await page.goto('/calendar');

		const grid = page.getByRole('grid', { name: 'Absences by day' });
		const cell = grid.getByRole('gridcell').nth(futureWorkingDayCell());
		await cell.click();
		await cell.click();
		await page.getByRole('button', { name: 'Send request' }).click();
		await expect(page.getByText('Your request has been sent.')).toBeVisible();

		await page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: 'Approvals' })
			.click();

		await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeVisible();
		await expect(page.getByRole('listitem').filter({ hasText: 'Vacation' }).first()).toBeVisible();
	});

	test('takes a pending request back', async ({ ownerPage: page }) => {
		await page.goto('/calendar');

		const grid = page.getByRole('grid', { name: 'Absences by day' });
		const cell = grid.getByRole('gridcell').nth(futureWorkingDayCell());
		await cell.click();
		await cell.click();
		await page.getByRole('button', { name: 'Send request' }).click();
		await expect(page.getByText('Your request has been sent.')).toBeVisible();

		await page.getByRole('button', { name: 'Withdraw' }).click();
		await expect(page.getByText('Request withdrawn.')).toBeVisible();

		await expect(page.getByText('You have not asked for any time off yet.')).toBeVisible();
		// And the day is free again, so the same range can be asked for a second time.
		await expect(cell.getByText('Vacation')).toHaveCount(0);
	});

	test('refuses a second absence over days already spoken for', async ({ ownerPage: page }) => {
		await page.goto('/calendar');

		const grid = page.getByRole('grid', { name: 'Absences by day' });
		const cell = grid.getByRole('gridcell').nth(futureWorkingDayCell());

		// Each send has to land before the next begins: a successful one clears the
		// selection, which would otherwise pull the form out from under the second.
		await cell.click();
		await cell.click();
		await page.getByRole('button', { name: 'Send request' }).click();
		await expect(page.getByText('Your request has been sent.')).toBeVisible();

		await cell.click();
		await cell.click();
		await page.getByRole('button', { name: 'Send request' }).click();

		// The refusal has to name the rule. "Something went wrong" is useless advice
		// when the fix is "those days are already booked".
		await expect(
			page.getByText(
				'Those days already carry an absence. Withdraw it first, or pick another range.'
			)
		).toBeVisible();
	});
});
