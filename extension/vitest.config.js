import { defineConfig } from 'vitest/config'

// Unit and DOM tests for the browser extension. `root` keeps vitest's include
// globs and happy-dom resolution anchored inside extension/ even though the
// scripts are launched from the repository root.
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../node_modules/.vite/extension',
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/dom/**/*.test.js'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
  },
})
