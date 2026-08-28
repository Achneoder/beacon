import { locale } from 'svelte-i18n';
import type {
	AuthResponse,
	LoginRequest,
	Permission,
	RegisterOrganizationRequest,
	SessionUser
} from '@beacon/shared';
import { api, apiSend, setAccessToken } from '$lib/api/client';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

/**
 * The signed-in user, for the whole SPA.
 *
 * Nothing about the session is persisted: the access token is held in memory by the API
 * client and the refresh token is an httpOnly cookie the browser sends on its own. That
 * is why `bootstrap()` has to run before the first guarded route renders — a reload
 * starts with no token and has to trade the cookie for one.
 *
 * These checks are UX, not enforcement. The API re-checks every permission.
 */
class SessionState {
	#user = $state<SessionUser | null>(null);
	#status = $state<SessionStatus>('loading');

	get user(): SessionUser | null {
		return this.#user;
	}

	get status(): SessionStatus {
		return this.#status;
	}

	get isAuthenticated(): boolean {
		return this.#status === 'authenticated';
	}

	/** Whether the UI should offer an action. The API decides whether it happens. */
	can(permission: Permission): boolean {
		return this.#user?.permissions.includes(permission) ?? false;
	}

	/** Restores the session from the refresh cookie. A failure just means "signed out". */
	async bootstrap(): Promise<void> {
		try {
			this.adopt(await apiSend<AuthResponse>('/auth/refresh', 'POST'));
		} catch {
			this.clear();
		}
	}

	async login(credentials: LoginRequest): Promise<void> {
		this.adopt(await apiSend<AuthResponse>('/auth/login', 'POST', credentials));
	}

	async register(registration: RegisterOrganizationRequest): Promise<void> {
		this.adopt(await apiSend<AuthResponse>('/auth/register', 'POST', registration));
	}

	async logout(): Promise<void> {
		try {
			await api('/auth/logout', { method: 'POST' });
		} finally {
			// Even if the call fails, drop the local session — the user asked to leave.
			this.clear();
		}
	}

	private adopt(response: AuthResponse): void {
		setAccessToken(response.accessToken);
		this.#user = response.user;
		this.#status = 'authenticated';
		locale.set(response.user.locale);
	}

	private clear(): void {
		setAccessToken(null);
		this.#user = null;
		this.#status = 'anonymous';
	}
}

export const session = new SessionState();
