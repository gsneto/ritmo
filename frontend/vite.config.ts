import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const localApiProxy = {
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: localApiProxy,
  },
  preview: {
    port: 4173,
    proxy: localApiProxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
