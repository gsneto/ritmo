import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcovonly'],
      reportsDirectory: './coverage',
      exclude: ['src/test/**', '**/*.test.{ts,tsx}', '**/vite-env.d.ts'],
    },
  },
})
