import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // vendor/ holds the Chromium copied in for packaging — not our source.
  { ignores: ['out/**', 'release/**', 'vendor/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build scripts run under Node directly, outside the TypeScript program.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' }
    }
  },
  {
    // The fixture site is browser code served to the recorder, not app source.
    files: ['tests/fixtures/site/**/*.js'],
    languageOptions: {
      globals: { document: 'readonly', window: 'readonly' }
    }
  },
  {
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
)
