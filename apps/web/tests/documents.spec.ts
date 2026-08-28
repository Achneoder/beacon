import { expect, test, inviteMember, signIn } from './fixtures.js';

/**
 * Runs against the one shared instance every browser spec uses, so a row's title is
 * made unique per test rather than asserting on the *first* document — another spec
 * (or an earlier test in this file) may have already filed one.
 */
function unique(label: string): string {
	return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

async function upload(
	page: import('@playwright/test').Page,
	title: string,
	filename = 'contract.pdf'
): Promise<void> {
	await page.goto('/documents');
	await page.locator('input[type="file"]').setInputFiles({
		name: filename,
		mimeType: 'application/pdf',
		buffer: PDF
	});
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText(title)).toBeVisible();
}

test.describe('documents', () => {
	test('uploads a document and opens it through a signed URL', async ({ ownerPage: page }) => {
		const title = unique('Employee handbook');
		await upload(page, title);

		// The size is real, not a placeholder — the bytes actually reached the store.
		const row = page.getByRole('row', { name: title });
		await expect(row.getByText(/\d+ B/)).toBeVisible();

		// Not waitForLoadState: the fixture is a magic-byte stub, not a real PDF, and
		// Chromium's own PDF viewer can hang trying to render it. The signed URL
		// resolving to something other than about:blank is what a signed URL was
		// actually minted, which is the thing under test.
		const [popup] = await Promise.all([
			page.waitForEvent('popup'),
			row.getByRole('button', { name: 'Open' }).click()
		]);
		await expect.poll(() => popup.url()).not.toBe('about:blank');
		await popup.close();
	});

	test('a second version replaces the current one', async ({ ownerPage: page }) => {
		const title = unique('Policy');
		await upload(page, title);

		await page.getByText(title).click();
		await expect(page.getByText('Version history')).toBeVisible();
		await expect(page.getByText('v1')).toBeVisible();

		// The detail panel's own "upload new version" dropzone precedes the page's
		// main upload dropzone in the DOM.
		await page
			.locator('input[type="file"]')
			.first()
			.setInputFiles({ name: 'policy-v2.pdf', mimeType: 'application/pdf', buffer: PDF });

		await expect(page.getByText('v2')).toBeVisible();
	});

	test('an employee can upload but is not offered the access panel', async ({
		browser,
		request
	}) => {
		const member = await inviteMember(request, 'employee');
		const context = await browser.newContext();
		const page = await context.newPage();

		await signIn(page, member);
		const title = unique('My certificate');
		await upload(page, title);

		await page.getByText(title).click();
		await expect(page.getByText('Version history')).toBeVisible();
		await expect(page.getByText('Who can see this')).toHaveCount(0);

		await context.close();
	});

	test('one employee cannot see a document filed by another', async ({ browser, request }) => {
		const a = await inviteMember(request, 'employee');
		const b = await inviteMember(request, 'employee');

		const contextA = await browser.newContext();
		const pageA = await contextA.newPage();
		await signIn(pageA, a);
		const title = unique('A private file');
		await upload(pageA, title);
		await contextA.close();

		const contextB = await browser.newContext();
		const pageB = await contextB.newPage();
		await signIn(pageB, b);
		await pageB.goto('/documents');
		await expect(pageB.getByText(title)).toHaveCount(0);
		await contextB.close();
	});
});
