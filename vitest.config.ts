import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    clearMocks: true,
    setupFiles: ['./src/test-setup.ts'],
    // Edge Function unit tests use Deno.test and are run with `deno test`.
    // Keep them out of Vitest's discovery so the browser/application suite is valid.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**', '**/.{idea,git,cache,output,temp}/**',
      'e2e/**',
      'supabase/functions/**/*.test.ts',
    ],
  },
})
