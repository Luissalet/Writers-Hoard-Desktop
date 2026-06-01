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
    rules: {
      // Block native window.confirm/alert/prompt — they can auto-resolve
      // across the browser tab lifecycle (laptop close/open, Page Lifecycle
      // `frozen` → `active`) and have caused real data loss in this project.
      // Use `ConfirmDialog` from `@/engines/_shared` for destructive actions.
      // See tasks/lessons.md lesson #12.
      'no-restricted-globals': [
        'error',
        {
          name: 'confirm',
          message:
            'Use `ConfirmDialog` from `@/engines/_shared` instead — native confirm() can auto-resolve on tab resume and has caused data loss.',
        },
        {
          name: 'alert',
          message:
            'Native alert() blocks the JS thread and can behave unpredictably across the tab lifecycle. Prefer a React-owned notification or modal.',
        },
        {
          name: 'prompt',
          message:
            'Native prompt() is unreliable across the tab lifecycle. Use a React-owned input modal.',
        },
      ],
    },
  },
])
