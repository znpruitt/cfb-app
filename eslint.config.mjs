// eslint.config.mjs
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import pluginPrettier from "eslint-plugin-prettier";
import pluginUnusedImports from "eslint-plugin-unused-imports";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  // Next.js + TypeScript base configs
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Ignores (replacement for .eslintignore)
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "dist/**",
      ".vercel/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
      // If you want to lint JSON data, remove the line below:
      "data/*.json",
    ],
  },

  // Register plugins and rules (flat config style)
  {
    plugins: {
      prettier: pluginPrettier,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      // Prettier integration (requires plugin registration above)
      "prettier/prettier": "warn",

      // Unused imports/vars hygiene
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      // Optional: common React/TS relaxations for Next.js
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
