import type { SetupState } from '@beacon/shared';
import { api } from '$lib/api/client';

/**
 * Whether this installation still needs its organization.
 *
 * Beacon is deployed for one organization: the first registration creates it and the
 * API refuses every one after that. The auth screens ask so they stop offering a form
 * that can only fail — the answer is UX, never enforcement.
 *
 * An unreachable API answers "yes", so a first-run install is never locked out by a
 * blip. If that guess is wrong the API returns 409 and the screen says so.
 */
export async function setupRequired(): Promise<boolean> {
	try {
		return (await api<SetupState>('/auth/setup')).setupRequired;
	} catch {
		return true;
	}
}
