import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Beacon's frontend is client-only: adapter-static emits a plain SPA that talks to
			// the NestJS API. Do not swap this for a server-rendering adapter.
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	// Component tests mount Svelte in jsdom, so resolution must pick the client
	// build of `svelte` rather than its server entry.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : {},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.{test,spec}.{js,ts}'],
		setupFiles: ['./vitest-setup.ts'],
		alias: {
			'$env/dynamic/public': fileURLToPath(
				new URL('./src/testing/env-dynamic-public.ts', import.meta.url)
			)
		}
	}
});
