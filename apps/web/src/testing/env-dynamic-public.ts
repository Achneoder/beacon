// Test double for `$env/dynamic/public`, which only exists inside the SvelteKit
// runtime. Aliased in by vite.config.ts so unit tests can import app modules directly.
export const env: Record<string, string | undefined> = {};
