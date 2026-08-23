// eslint.config.mjs
import js from '@eslint/js';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import unusedImports from 'eslint-plugin-unused-imports';
import reactHooks from 'eslint-plugin-react-hooks';

const projectFiles = ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'];

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'dist/**',
      '.vercel/**',
      'next-env.d.ts',
      '*.tsbuildinfo',
      'data/*.json',
    ],
  },

  {
    ...js.configs.recommended,
    files: projectFiles,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: projectFiles,
  })),

  {
    files: projectFiles,
    plugins: {
      '@next/next': nextPlugin,
      'unused-imports': unusedImports,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // POLISH-012: this rule would have caught the live crash before it shipped.
      // `SharedTrendChart` ran five hooks, took an early return, then ran three
      // more; a metric switch across that boundary changed the hook count and
      // dropped the standings page to the error boundary. The plugin was already
      // a devDependency and simply was not registered. Measured at ZERO
      // violations across the tree when added, and it reports exactly the three
      // offending hooks when run against the pre-fix file — so this is
      // enforcement replacing a comment that asked people not to reintroduce it.
      'react-hooks/rules-of-hooks': 'error',

      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  eslintConfigPrettier,
];
