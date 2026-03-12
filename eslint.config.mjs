// eslint.config.mjs
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierPlugin from 'eslint-plugin-prettier';
import unusedImports from 'eslint-plugin-unused-imports';

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
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
  ]),

  {
    plugins: {
      prettier: prettierPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      'prettier/prettier': 'warn',

      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]);
