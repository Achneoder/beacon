import { expect, test, inviteMember, signIn } from './fixtures.js';

/**
 * What only a browser can show: the combobox wiring, the debounce, and the keyboard
 * path through a popover that the component tests mount against a mocked client.
 *
 * The visibility rule itself is the API suite's job (`search.e2e-spec.ts`) — it needs
 * two accounts and a grant, and asserting it through a text field would prove less,
 * more slowly.
 */

function unique(label: string): string {
	return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

async function upload(page: import('@playwright/test').Page, title: string): Promise<void> {
	await page.goto('/documents');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'contract.pdf',
		mimeType: 'application/pdf',
		buffer: PDF
	});
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText(title)).toBeVisible();
}

const field = (page: import('@playwright/test').Page) =>
	page.getByRole('combobox', { name: 'Search documents and people' });

test.describe('search', () => {
	test('finds a document from the sidebar and opens it', async ({ ownerPage: page }) => {
		const title = unique('Zymurgy handbook');
		await upload(page, title);

		// Away from the documents screen, so the result is what navigated — not a row
		// that was already on the page.
		await page.goto('/timesheet');

		// Indexing is fire-and-forget, so the first keystrokes may genuinely miss it.
		// Retyping is what re-queries; `toPass` gives the index a moment to catch up.
		await expect(async () => {
			await field(page).fill('');
			await field(page).fill(title.split(' ')[1]);
			await expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible({
				timeout: 2000
			});
		}).toPass({ timeout: 15_000 });

		await page.getByRole('option', { name: new RegExp(title) }).click();

		// The deep link must open the document, not merely land on the documents
		// screen with an unconsumed `?open=` in the URL — that was the old assertion,
		// and it passed for a page that never read the param. The detail panel's
		// heading is only there once the document actually loaded.
		await expect(page).toHaveURL(/\/documents$/);
		await expect(page.getByRole('heading', { name: title })).toBeVisible();
	});

	test('walks the results with the arrow keys and opens one with Enter', async ({
		ownerPage: page,
		owner
	}) => {
		await page.goto('/timesheet');

		// The account invited for this test is findable by its own first name.
		await expect(async () => {
			await field(page).fill('');
			await field(page).fill(owner.lastName);
			await expect(page.getByRole('option').first()).toBeVisible({ timeout: 2000 });
		}).toPass({ timeout: 15_000 });

		// Focus never leaves the field — the active option is carried by
		// aria-activedescendant, which is the whole reason for the combobox pattern.
		await field(page).press('ArrowDown');
		await expect(field(page)).toBeFocused();
		await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

		await field(page).press('Enter');
		await expect(page).toHaveURL(/\/(people|documents)/);
	});

	test('closes on Escape without navigating', async ({ ownerPage: page, owner }) => {
		await page.goto('/timesheet');

		await field(page).fill(owner.lastName);
		await expect(page.getByRole('listbox')).toBeVisible();

		await field(page).press('Escape');

		await expect(page.getByRole('listbox')).toBeHidden();
		await expect(page).toHaveURL(/\/timesheet/);
	});

	test('stays quiet below the minimum term length', async ({ ownerPage: page }) => {
		await page.goto('/timesheet');

		await field(page).fill('a');

		await expect(page.getByRole('listbox')).toBeHidden();
	});

	test('is offered to a plain employee, who may read documents but not people', async ({
		page,
		request
	}) => {
		// The narrowest built-in role that still gets search. The case where the field
		// disappears altogether needs a role holding neither `document:read` nor
		// `employee:read`, and no role editor exists to make one — the component test
		// covers that half against a mocked session instead.
		const employee = await inviteMember(request, 'employee');
		await signIn(page, employee);

		await expect(field(page)).toBeVisible();
		await expect(page.getByRole('link', { name: 'People' })).toBeHidden();
	});
});
