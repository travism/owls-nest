import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Read PUBLIC_* env vars from the monorepo root .env, not the app dir.
// Astro/Vite default to the app's own directory; we override so a single
// .env at the repo root drives every package.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  site: 'https://owlsnest.com',
  integrations: [react()],
  output: 'static',
  vite: {
    envDir: repoRoot,
  },
});
