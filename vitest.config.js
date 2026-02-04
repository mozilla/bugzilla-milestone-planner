/**
 * Vitest configuration for unit tests
 * @see https://vitest.dev/config/
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files pattern
    include: ['test/unit/**/*.test.js'],

    // Environment (using node by default for pure algorithm tests)
    environment: 'node',

    // Global test timeout
    testTimeout: 10000,

    // Reporter
    reporters: ['verbose', 'json'],

    // Output file for JSON reporter
    outputFile: {
      json: 'test-results/unit-results.json'
    },

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'test-results/coverage',
      include: ['js/**/*.js']
    },

    // Global setup/teardown
    setupFiles: [],

    // Pool options
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
});
