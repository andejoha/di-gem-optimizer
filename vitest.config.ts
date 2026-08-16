import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (which pulls in @vitejs/plugin-react, not
// needed for the core-logic test suite). Core tests run under plain node
// with no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
