import { expect, test } from './fixtures.js';

/**
 * Clocking is the app's one genuinely stateful loop: every button writes an
 * `AttendanceEntry` and the next state comes back from the API, not from the client. The
 * shell and the Today screen share a single clock store, so both have to agree after
 * every step — that is what the sidebar assertions are for.
 */
test.describe('clocking', () => {
	test('runs a full day: in, break, back, out', async ({ ownerPage: page }) => {
		const controls = page.getByRole('group', { name: 'Clock controls' });
		const main = page.getByRole('main');

		// A brand-new owner has never clocked anything.
		await expect(main.getByText('Clocked out')).toBeVisible();
		await expect(controls.getByRole('button', { name: 'Clock in' })).toBeVisible();

		await controls.getByRole('button', { name: 'Clock in' }).click();
		await expect(main.getByText('Clocked in')).toBeVisible();
		await expect(controls.getByRole('button', { name: 'Clock out' })).toBeVisible();
		await expect(controls.getByRole('button', { name: 'Start break' })).toBeVisible();
		// The sidebar reads the same store, so it must have moved too.
		await expect(page.getByText('Clocked in')).toHaveCount(2);

		await controls.getByRole('button', { name: 'Start break' }).click();
		await expect(main.getByText('On break')).toBeVisible();
		await expect(controls.getByRole('button', { name: 'Resume work' })).toBeVisible();

		await controls.getByRole('button', { name: 'Resume work' }).click();
		await expect(main.getByText('Clocked in')).toBeVisible();

		await controls.getByRole('button', { name: 'Clock out' }).click();
		await expect(main.getByText('Clocked out')).toBeVisible();
		await expect(controls.getByRole('button', { name: 'Clock in' })).toBeVisible();
	});

	test('survives a reload — the state lives on the server', async ({ ownerPage: page }) => {
		const controls = page.getByRole('group', { name: 'Clock controls' });
		await controls.getByRole('button', { name: 'Clock in' }).click();
		await expect(page.getByRole('main').getByText('Clocked in')).toBeVisible();

		await page.reload();

		await expect(page.getByRole('main').getByText('Clocked in')).toBeVisible();
		await expect(controls.getByRole('button', { name: 'Clock out' })).toBeVisible();
	});

	test('writes the day onto the timesheet', async ({ ownerPage: page }) => {
		const controls = page.getByRole('group', { name: 'Clock controls' });
		await controls.getByRole('button', { name: 'Clock in' }).click();
		await expect(page.getByRole('main').getByText('Clocked in')).toBeVisible();
		await controls.getByRole('button', { name: 'Clock out' }).click();
		await expect(page.getByRole('main').getByText('Clocked out')).toBeVisible();

		await page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', {
				name: 'Timesheet'
			})
			.click();

		// The organization is minutes old, so the only wall-clock time in the table — the
		// durations are `H:MM` — is the segment just recorded.
		const start = page.getByRole('cell').filter({ hasText: /^\d{2}:\d{2}$/ });
		await expect(start.first()).toBeVisible();
	});
});
