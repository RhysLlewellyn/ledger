import {loadEnv} from 'vite'
import {defineConfig} from 'vitest/config'

export default defineConfig(({mode}) => ({
  test: {
    // Node, not jsdom: what is under test here is SQL and the shape of what
    // comes back from it. Neither has a DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The performance test measures wall-clock time against a shared
    // database. Test files running in parallel would be competing for the
    // same buffer cache and the same CPU, which makes the number it asserts
    // a measurement of the test runner rather than of the query.
    fileParallelism: false,
    // The seeded dataset is large enough that a cold first query is slow.
    testTimeout: 60_000,
    env: loadEnv(mode, process.cwd(), ''),
  },
}))
