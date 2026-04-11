import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    alias: {
      vscode: new URL('./tests/__mocks__/vscode.ts', import.meta.url).pathname,
    },
    coverage: {
      enabled: false,
    },
  },
});
