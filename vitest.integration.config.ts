import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // Each suite launches a real Chromium; the default 5s timeout is not enough.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Browsers are heavy and the fixture server binds a port per file.
    fileParallelism: false,
    reporters: 'default'
  }
})
