import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the PWA plugin has no place in a
// unit-test run, and the engine tests are pure Node (no DOM).
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'agent/**/*.test.ts'],
  },
})
