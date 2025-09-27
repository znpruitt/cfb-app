/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 'latest',
    project: false, // set to your tsconfig path if you want type-aware rules
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'unused-imports', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'next', // same as "eslint-config-next"
    'next/core-web-vitals',
    'plugin:prettier/recommended', // enables eslint-plugin-prettier + displays Prettier errors in ESLint
    'prettier', // turns off ESLint rules that conflict with Prettier
  ],
  settings: {
    react: { version: 'detect' },
  },
  ignorePatterns: [
    'node_modules/',
    '.next/',
    'out/',
    'build/',
    'coverage/',
    '*.config.js',
    '*.config.cjs',
    '*.config.mjs',
    '**/*.d.ts',
  ],
  rules: {
    // Let Prettier handle formatting:
    'prettier/prettier': ['error'],

    // Helpful hygiene:
    'unused-imports/no-unused-imports': 'error',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // React/Next niceties:
    'react/react-in-jsx-scope': 'off', // Next.js
    'react/jsx-boolean-value': ['warn', 'never'],
    'react/self-closing-comp': 'warn',

    // TS tweaks (loosen as needed):
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      files: ['**/*.{js,jsx,ts,tsx}'],
      rules: {
        // Prefer const for React components and helpers
        'no-var': 'error',
      },
    },
    {
      files: ['**/*.test.{ts,tsx,js,jsx}'],
      env: { jest: true },
    },
  ],
};
