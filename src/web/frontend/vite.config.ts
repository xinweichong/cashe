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
        // Groups capture their modules' dependencies too, so the base vendor
        // group must outrank the charts group; otherwise Recharts' group
        // absorbs React and shared utilities and every route loads Recharts.
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|lucide-react|clsx|tailwind-merge|class-variance-authority|react-is|use-sync-external-store)[\\/]/,
              priority: 40,
            },
            { name: 'vendor-query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 30 },
            { name: 'vendor-ui', test: /node_modules[\\/]@radix-ui[\\/]/, priority: 30 },
            { name: 'vendor-charts', test: /node_modules[\\/]recharts[\\/]/, priority: 10 },
          ],
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
