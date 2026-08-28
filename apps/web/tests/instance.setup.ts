import { test as setup } from '@playwright/test';
import { installInstance } from './fixtures.js';

/**
 * Runs once, before every other project: Beacon holds one organization per
 * installation, so the suite creates it here rather than in each spec.
 */
setup('installs the organization', async ({ request }) => {
	await installInstance(request);
});
