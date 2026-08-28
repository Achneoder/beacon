import { browser } from '$app/environment';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = 'beacon-theme';

function read(): Theme {
	if (!browser) return 'system';
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return (THEMES as readonly string[]).includes(stored ?? '') ? (stored as Theme) : 'system';
	} catch {
		return 'system';
	}
}

/**
 * Theme preference, persisted per browser.
 *
 * `system` removes `data-theme` so the tokens fall back to
 * `prefers-color-scheme`; `light`/`dark` pin it. A matching inline script in
 * `app.html` applies the stored value before first paint.
 */
class ThemeState {
	#current = $state<Theme>('system');

	constructor() {
		this.#current = read();
	}

	get current(): Theme {
		return this.#current;
	}

	set(next: Theme) {
		this.#current = next;
		if (!browser) return;
		if (next === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			/* storage blocked — the preference just does not survive a reload */
		}
	}

	toggle() {
		this.set(this.#current === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new ThemeState();
