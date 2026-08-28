import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

// Auto-cleanup only registers itself when Vitest globals are enabled.
afterEach(cleanup);
