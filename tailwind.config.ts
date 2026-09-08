// tailwind.config.ts
//
// THIS FILE IS NOT LOADED. Editing it has no effect on the build.
//
// Tailwind v4 reads a JS/TS config only through an `@config` directive in CSS.
// `src/app/globals.css` does a plain `@import 'tailwindcss'` and there is no `@config`
// anywhere in this repo, so nothing below reaches the compiler.
//
// What actually governs theming is `src/app/globals.css` — specifically
// `@custom-variant dark (&)`, which makes every `dark:` utility match UNCONDITIONALLY
// (the POLISH-010 dark-only theme). The `darkMode: 'media'` line below is therefore not
// merely unused, it is FALSE: `dark:` is unconditional here, not media-driven.
//
// The file is kept because six `package.json` scripts lint and prettier-check it, which is
// also why it looks maintained. Retiring it is Item 159 in `docs/next-tasks.md`.
import type { Config } from 'tailwindcss';

const config: Config = {
  // No `content` in v4
  darkMode: 'media',
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
