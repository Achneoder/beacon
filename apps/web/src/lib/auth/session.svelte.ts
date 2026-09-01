import { locale } from 'svelte-i18n';
import type {
	AcceptInvitationRequest,
	AuthResponse,
	LoginRequest,
	Permission,
	RegisterOrganizationRequest,
	SessionUser
} from '@beacon/shared';
import { api, apiSend, onRefreshFailure, setAccessToken } from '$lib/api/client';

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

	constructor() {
		// A mid-session refresh failing means the refresh cookie is gone or expired —
		// the session is over. Leaving `authenticated` up would strand the user in a
		// shell where every request 401s; the layout watches this state and sends
		// them to the login screen instead.
		onRefreshFailure(() => this.clear());
	}

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
			await this.adopt(await apiSend<AuthResponse>('/auth/refresh', 'POST'));
		} catch {
			this.clear();
		}
	}

	async login(credentials: LoginRequest): Promise<void> {
		await this.adopt(await apiSend<AuthResponse>('/auth/login', 'POST', credentials));
	}

	async register(registration: RegisterOrganizationRequest): Promise<void> {
		await this.adopt(await apiSend<AuthResponse>('/auth/register', 'POST', registration));
	}

	/**
	 * Finishes an invitation. The token in the link is the credential, so this needs
	 * no existing session — and acceptance signs the newcomer straight in.
	 */
	async acceptInvitation(request: AcceptInvitationRequest): Promise<void> {
		await this.adopt(await apiSend<AuthResponse>('/invitations/accept', 'POST', request));
	}

	async logout(): Promise<void> {
		try {
			await api('/auth/logout', { method: 'POST' });
		} finally {
			// Even if the call fails, drop the local session — the user asked to leave.
			this.clear();
		}
	}

	/** Keeps the sidebar and header current after the user edits their own profile. */
	patch(changes: Partial<SessionUser>): void {
		if (this.#user) this.#user = { ...this.#user, ...changes };
	}

	/**
	 * Re-reads the account, which is what lets a change to the organization's default
	 * language show up without a reload. `SessionUser.locale` is resolved per request
	 * against the organization, so the API is the only side that can answer it.
	 */
	async reload(): Promise<void> {
		if (!this.isAuthenticated) return;

		await this.apply(await api<SessionUser>('/auth/me'));
	}

	private async adopt(response: AuthResponse): Promise<void> {
		setAccessToken(response.accessToken);
		this.#status = 'authenticated';
		await this.apply(response.user);
	}

	/**
	 * The language comes from the API already resolved — the person's own choice when
	 * they made one, the organization's `defaultLocale` when they did not.
	 *
	 * Awaited rather than fired and forgotten: `locale.set` has to fetch the dictionary,
	 * and the root layout gates its first render on `bootstrap()`, so awaiting here is
	 * what opens the app in the right language instead of repainting out of English a
	 * tick later.
	 */
	private async apply(user: SessionUser): Promise<void> {
		this.#user = user;
		await locale.set(user.locale);
	}

	private clear(): void {
		setAccessToken(null);
		this.#user = null;
		this.#status = 'anonymous';
	}
}

export const session = new SessionState();
