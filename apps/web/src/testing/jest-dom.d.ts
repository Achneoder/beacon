// Pulls the jest-dom matcher augmentation into svelte-check's program, so
// `expect(...).toHaveAttribute(...)` type-checks in component tests.
import '@testing-library/jest-dom/vitest';
