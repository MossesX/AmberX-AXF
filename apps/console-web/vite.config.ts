import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { axfProjectGuard } from './src/axf/core/project';
import { alertsServiceWorker } from './src/axf/libs/alerts/vite-plugin.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

// `npm run dev` proxies /api to the Python backend (server/, port 7090); `npm run build:single` inlines everything.
export default defineConfig(({ mode }) => ({
  // AmberX build rule: no project is loaded or compiled without a validated manifest (project.manifest.json).
  plugins: [
    axfProjectGuard({ root, read: (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : undefined), exists: (p) => existsSync(join(root, p)) }),
    react(),
    // the alerts library's web push service worker, served and built as /alerts-sw.js
    alertsServiceWorker(),
    ...(mode === 'single' ? [viteSingleFile()] : []),
  ],
  // Console plugins (./plugins) import the console's framework and helpers as `@console/...`.
  resolve: { alias: { '@console': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  server: { proxy: { '/api': { target: process.env.AXF_API ?? 'http://127.0.0.1:7090', changeOrigin: true } } },
}));
