import { readFile } from 'node:fs/promises';
import { expect, inviteMember, signIn, test } from './fixtures.js';

/**
 * What only this layer can prove.
 *
 * The component tests mock the client, so every call there resolves whatever the
 * caller was handed — a `report:read` that the token does not actually carry would
 * pass all of them. And the API suite never renders anything, so it cannot see that
 * a chart drew, that a table lined up with it, or that the export reached the
 * browser as a file rather than as a 401 page named `.csv`.
 *
 * One organization for the whole run and one invited account per test, so the
 * figures below are asserted against *this* person's row rather than against
 * organization totals another spec is also writing to.
 */
test.describe('reports', () => {
	test('shows the manager dashboard and the attendance table', async ({ ownerPage, owner }) => {
		await ownerPage
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: 'Reports' })
			.click();
		await expect(ownerPage.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();

		// The three dashboard tiles.
		await expect(ownerPage.getByText('Awaiting you')).toBeVisible();
		await expect(ownerPage.getByText('Out this week')).toBeVisible();
		await expect(ownerPage.getByText('Overtime bank')).toBeVisible();

		const table = ownerPage.locator('#reports-attendance-table');
		await expect(table).toBeVisible();
		// This account exists and has a schedule, so it is on the report with a target
		// even though it has never clocked in. Not `toHaveCount(1)`: every test in the
		// run invites its own account into the one organization, and the fixture gives
		// them all the same name.
		const row = table.getByRole('row').filter({ hasText: `${owner.firstName} ${owner.lastName}` });
		await expect(row.first()).toBeVisible();
		await expect(table.getByRole('rowheader', { name: 'Total' })).toBeVisible();

		await expect(ownerPage.getByText('Something went wrong. Please try again.')).toBeHidden();
	});

	test('draws the charts against the tables they picture', async ({ ownerPage }) => {
		await ownerPage.goto('/reports');
		await expect(ownerPage.locator('#reports-attendance-table')).toBeVisible();

		// LayerCake only resolves a size in a real browser, so this is the layer that
		// can say the plot actually rendered rather than collapsing to nothing.
		const plot = ownerPage.locator('figure[aria-describedby="reports-attendance-table"] svg');
		await expect(plot).toBeVisible();
		await expect(plot.locator('path').first()).toBeVisible();
		expect((await plot.boundingBox())?.height ?? 0).toBeGreaterThan(40);

		// The legend names the reference tick; identity is never colour alone.
		await expect(
			ownerPage.locator('figure[aria-describedby="reports-attendance-table"]').getByText('Expected')
		).toBeVisible();

		await expect(
			ownerPage.locator('figure[aria-describedby="reports-absence-table"] svg')
		).toBeVisible();
	});

	test('re-queries the range and the grouping against the same slice', async ({ ownerPage }) => {
		await ownerPage.goto('/reports');
		await expect(ownerPage.locator('#reports-attendance-table')).toBeVisible();

		await ownerPage.getByRole('button', { name: 'Department' }).click();
		await expect(
			ownerPage
				.locator('#reports-attendance-table')
				.getByRole('columnheader', { name: 'Department' })
		).toBeVisible();
		// Everyone in this run is invited without one, so the bucket has to be named
		// rather than dropped — a total that quietly excluded them would not add up.
		await expect(
			ownerPage.locator('#reports-attendance-table').getByRole('rowheader', { name: /Unassigned/ })
		).toBeVisible();

		await ownerPage.getByRole('button', { name: 'This year' }).click();
		await expect(ownerPage.locator('#reports-attendance-table')).toBeVisible();
		await expect(ownerPage.getByText('Something went wrong. Please try again.')).toBeHidden();
	});

	test('downloads the export as a real CSV file', async ({ ownerPage }) => {
		await ownerPage.goto('/reports');
		await expect(ownerPage.locator('#reports-attendance-table')).toBeVisible();

		const [download] = await Promise.all([
			ownerPage.waitForEvent('download'),
			ownerPage.getByRole('button', { name: 'Export CSV' }).click()
		]);

		// The server names the file, and the name carries the range that was served.
		expect(download.suggestedFilename()).toMatch(
			/^beacon-attendance-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/
		);

		const path = await download.path();
		const contents = await readFile(path, 'utf8');

		// The BOM, so Excel reads it as UTF-8 rather than the host code page — the one
		// thing an API-level assertion cannot confirm arrived through the browser.
		expect(contents.startsWith('\uFEFF')).toBe(true);
		expect(contents).toContain('employee_number,name,email,department,date,worked_hours');
		expect(contents.trim().split('\r\n').length).toBeGreaterThan(1);
	});

	test('is not offered to an employee, who holds no report:read', async ({ page, request }) => {
		const employee = await inviteMember(request, 'employee');
		await signIn(page, employee);

		const nav = page.getByRole('navigation', { name: 'Main navigation' });
		await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Reports' })).toBeHidden();
	});
});
