import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

// Auto-cleanup only registers itself when Vitest globals are enabled.
afterEach(cleanup);

/**
 * jsdom implements no layout engine and therefore no `ResizeObserver`, which
 * LayerCake constructs to size a chart against its container. Without this the
 * component throws on mount rather than rendering an empty plot.
 *
 * It stays a no-op deliberately: every element in jsdom measures zero, so a stub
 * that reported sizes would be inventing a layout. Chart geometry is the browser
 * suite's to prove; what the component tests assert is the half that survives
 * without one — the caption, the legend and the table twin.
 */
class NoopResizeObserver implements ResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver;
