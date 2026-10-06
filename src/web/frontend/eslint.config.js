import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // src/landing is the public marketing surface (approved 2026-10-06). Its
    // Kokonut-derived components set no precedent for the app, so app code may
    // not import them; App.tsx lazy-loads the page itself.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/landing/**', 'src/App.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@/landing', '@/landing/*', '**/landing/*'], message: 'src/landing is the marketing surface; the app may not import it.' }] }],
    },
  },
])
