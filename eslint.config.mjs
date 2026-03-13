// eslint.config.mjs
import js from '@eslint/js';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import unusedImports from 'eslint-plugin-unused-imports';

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
      prettier: prettierPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      'prettier/prettier': 'warn',

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
];
