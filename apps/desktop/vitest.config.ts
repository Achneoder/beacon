import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only the Electron-free half is unit-tested: the state machine, the outbox, the
    // settings and the copy. Everything that touches Electron is wiring, and wiring is
    // what the manual pass in README's desktop section checks.
    include: ['src/**/*.test.ts'],
  },
});
