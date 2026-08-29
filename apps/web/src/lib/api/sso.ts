import type {
	SsoPublicState,
	SsoSettings,
	SsoTestResult,
	UpdateSsoSettingsRequest
} from '@beacon/shared';
import { api, apiSend } from './client';

/**
 * The SSO half of the REST API. `getPublicState` is the only call the login screen —
 * signed out — may make; everything else needs `organization:manage` and lives under
 * `/sso/settings`, mirroring `/organizations/current`.
 */
export function getPublicState(): Promise<SsoPublicState> {
	return api<SsoPublicState>('/auth/sso');
}

/** Returns a URL rather than redirecting itself — `fetch` cannot usefully follow a
 * cross-origin redirect, so the caller assigns `window.location` to it. */
export function startSso(): Promise<{ authorizationUrl: string }> {
	return apiSend<{ authorizationUrl: string }>('/auth/sso/start', 'POST');
}

export function getSettings(): Promise<SsoSettings> {
	return api<SsoSettings>('/sso/settings');
}

export function saveSettings(body: UpdateSsoSettingsRequest): Promise<SsoSettings> {
	return apiSend<SsoSettings>('/sso/settings', 'PUT', body);
}

export function deleteSettings(): Promise<void> {
	return apiSend<void>('/sso/settings', 'DELETE');
}

export function testSettings(
	body: Pick<UpdateSsoSettingsRequest, 'issuerUrl' | 'clientId' | 'clientSecret'>
): Promise<SsoTestResult> {
	return apiSend<SsoTestResult>('/sso/settings/test', 'POST', body);
}
