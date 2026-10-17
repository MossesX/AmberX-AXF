import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run dev` proxies /api to the Python backend (server/, port 7090); `npm run build:single` inlines everything.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  server: { proxy: { '/api': { target: process.env.AXF_API ?? 'http://127.0.0.1:7090', changeOrigin: true } } },
}));
