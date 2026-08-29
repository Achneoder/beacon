import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitLocale } from 'svelte-i18n';
import type { SsoSettings } from '@beacon/shared';
import '$lib/i18n';
import SsoSettingsPage from './+page.svelte';
import * as sso from '$lib/api/sso';
import { ApiError } from '$lib/api/client';

const SETTINGS: SsoSettings = {
	protocol: 'oidc',
	displayName: 'Okta',
	issuerUrl: 'https://acme.okta.com',
	clientId: 'beacon-client',
	hasClientSecret: true,
	scopes: 'openid email profile',
	emailClaim: 'email',
	allowedDomains: ['acme.test', 'acme.dev'],
	enabled: true,
	enforced: false,
	lastTestedAt: '2026-08-20T10:00:00.000Z',
	lastTestError: null,
	redirectUri: 'https://api.acme.test/api/auth/sso/callback'
};

beforeEach(async () => {
	await waitLocale('en');
	vi.spyOn(sso, 'getSettings').mockRejectedValue(
		new ApiError(404, 'no sso provider is configured')
	);
	vi.spyOn(sso, 'saveSettings').mockResolvedValue(SETTINGS);
	vi.spyOn(sso, 'deleteSettings').mockResolvedValue(undefined);
	vi.spyOn(sso, 'testSettings').mockResolvedValue({
		issuer: 'https://acme.okta.com',
		authorizationEndpoint: 'https://acme.okta.com/authorize',
		tokenEndpoint: 'https://acme.okta.com/token',
		jwksUri: 'https://acme.okta.com/jwks'
	});
	vi.stubGlobal(
		'confirm',
		vi.fn(() => true)
	);
});
afterEach(() => vi.restoreAllMocks());

describe('sso settings page', () => {
	it('offers an empty form and says nothing is configured yet, on a 404', async () => {
		render(SsoSettingsPage);

		expect(
			await screen.findByText(
				'No provider is configured yet. Fill in the form below and save to create one.'
			)
		).toBeInTheDocument();
		expect(screen.getByLabelText('Button label')).toHaveValue('');
		// Nothing to copy yet — the redirect URI only exists once a provider has been saved.
		expect(screen.queryByText('Redirect URI')).not.toBeInTheDocument();
	});

	it('prefills the form from the stored settings, never the secret', async () => {
		vi.spyOn(sso, 'getSettings').mockResolvedValue(SETTINGS);
		render(SsoSettingsPage);

		expect(await screen.findByLabelText('Button label')).toHaveValue('Okta');
		expect(screen.getByLabelText('Issuer URL')).toHaveValue('https://acme.okta.com');
		expect(screen.getByLabelText('Client secret')).toHaveValue('');
		expect(screen.getByLabelText('Client secret')).toHaveAttribute('placeholder', 'Unchanged');
		expect(screen.getByLabelText('Allowed email domains')).toHaveValue('acme.test\nacme.dev');
		expect(screen.getByText('https://api.acme.test/api/auth/sso/callback')).toBeInTheDocument();
	});

	it('saves the form, splitting allowed domains by line', async () => {
		render(SsoSettingsPage);
		await screen.findByLabelText('Button label');

		await fireEvent.input(screen.getByLabelText('Button label'), { target: { value: 'Okta' } });
		await fireEvent.input(screen.getByLabelText('Issuer URL'), {
			target: { value: 'https://acme.okta.com' }
		});
		await fireEvent.input(screen.getByLabelText('Client ID'), {
			target: { value: 'beacon-client' }
		});
		await fireEvent.input(screen.getByLabelText('Client secret'), { target: { value: 'shh' } });
		await fireEvent.input(screen.getByLabelText('Allowed email domains'), {
			target: { value: 'acme.test\n\nacme.dev\n' }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() =>
			expect(sso.saveSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					displayName: 'Okta',
					issuerUrl: 'https://acme.okta.com',
					clientId: 'beacon-client',
					clientSecret: 'shh',
					allowedDomains: ['acme.test', 'acme.dev'],
					enabled: false,
					enforced: false
				})
			)
		);
		expect(await screen.findByText('Single sign-on settings saved.')).toBeInTheDocument();
	});

	it('tests the connection and reports the discovered issuer', async () => {
		render(SsoSettingsPage);
		await screen.findByLabelText('Button label');

		await fireEvent.input(screen.getByLabelText('Issuer URL'), {
			target: { value: 'https://acme.okta.com' }
		});
		await fireEvent.input(screen.getByLabelText('Client ID'), {
			target: { value: 'beacon-client' }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

		expect(await screen.findByText('Connected. Issuer: https://acme.okta.com')).toBeInTheDocument();
	});

	it('removes the provider after confirming, and the form clears', async () => {
		vi.spyOn(sso, 'getSettings').mockResolvedValue(SETTINGS);
		render(SsoSettingsPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Remove provider' }));

		await waitFor(() => expect(sso.deleteSettings).toHaveBeenCalled());
		expect(screen.getByLabelText('Button label')).toHaveValue('');
		expect(screen.queryByRole('button', { name: 'Remove provider' })).not.toBeInTheDocument();
	});

	it('disables "require sso" until "enabled" is checked', async () => {
		render(SsoSettingsPage);
		await screen.findByLabelText('Button label');

		expect(screen.getByLabelText('Require single sign-on')).toBeDisabled();

		await fireEvent.click(screen.getByLabelText('Enabled'));

		expect(screen.getByLabelText('Require single sign-on')).not.toBeDisabled();
	});
});
