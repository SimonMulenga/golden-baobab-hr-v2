import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    clearMocks: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
