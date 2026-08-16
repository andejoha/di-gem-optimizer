import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (which pulls in @vitejs/plugin-react and the
// dev-only /api proxy, neither of which the core-logic test suite needs).
// Core tests run under plain node with no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
