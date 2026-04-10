import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['projects/**', 'node_modules/**', 'dist/**'],
    alias: {
      vscode: new URL('./tests/__mocks__/vscode.ts', import.meta.url).pathname,
    },
  },
});