import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run dev` proxies /api to the Python backend (server/, port 7090); `npm run build:single` inlines everything.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  // Console plugins (./plugins) import the console's framework and helpers as `@console/...`.
  resolve: { alias: { '@console': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  server: { proxy: { '/api': { target: process.env.AXF_API ?? 'http://127.0.0.1:7090', changeOrigin: true } } },
}));
