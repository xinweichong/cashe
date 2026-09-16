import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/') ||
            id.includes('node_modules/lucide-react/')
          ) return 'vendor-react'
          if (id.includes('node_modules/recharts/')) return 'vendor-charts'
          if (id.includes('node_modules/@tanstack/react-query/')) return 'vendor-query'
          if (id.includes('node_modules/@radix-ui/')) return 'vendor-ui'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // e2e/ holds Playwright specs (npm run test:visual), a separate runner/config.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
