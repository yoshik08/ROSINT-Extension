import { defineConfig } from 'vitest/config'

// Live-browser end-to-end tests. They need a real Reddit session and are
// skipped unless REDDIT_HIDDEN_USER and REDDIT_VISIBLE_USER are set; see
// extension/tests/e2e/README.md.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['tests/e2e/**/*.e2e.js'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
