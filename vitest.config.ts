import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    setupFiles: ['tests/setup.ts'],
    // Ordinary test runs must never touch real Google accounts or the user's token file.
    env: {
      GOOGLE_TOKEN_PATH: '/nonexistent/google-docs-mcp-test/tokens.json',
    },
  },
});
