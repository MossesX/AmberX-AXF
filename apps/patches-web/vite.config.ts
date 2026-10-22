import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { axfProjectGuard } from './src/axf/core/project';

const root = fileURLToPath(new URL('.', import.meta.url));

// AmberX build rule: no project is loaded or compiled without a validated manifest (project.manifest.json).
// `npm run dev` proxies /api to the FastAPI server (server/main.py) on API_PORT (default 7290).
export default defineConfig({
  plugins: [
    axfProjectGuard({ root, read: (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : undefined), exists: (p) => existsSync(join(root, p)) }),
    react(),
  ],
  // The banner plugins baked from the Dev Console (src/plugins, scripts/bake-banner-plugins.mjs) import the console's
  // framework and helpers as `@console/...`: the framework is Patches' own baked copy, the helpers are Patches' stand-ins.
  resolve: {
    alias: [
      { find: /^@console\/axf\//, replacement: `${join(root, 'src/axf')}/` },
      { find: /^@console\//, replacement: `${join(root, 'src/console')}/` },
    ],
  },
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? '7290'}` } },
  build: { outDir: 'dist' },
});
