// Beacon's frontend ships as a static SPA — no SvelteKit server runtime.
// Routing happens in the browser and all data comes from the NestJS REST API,
// so nothing is prerendered; adapter-static emits a single index.html fallback.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
