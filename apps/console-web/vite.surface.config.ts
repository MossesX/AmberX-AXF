import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { pluginChunks } from './scripts/plugin-chunks.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

// The console's native surface (shell-surface@1, src/surface.tsx): an ES module a shell such as Molly imports and mounts
// in its own page (no frame). Built after the app into dist/surface/ (served at /surface/console-surface.js, CORS open
// like the rest of the console), its styles at /surface/console-surface.css (a shell links them next to the module), its
// chunks next to it.
export default defineConfig({
  plugins: [react(), pluginChunks({ pluginsDir: join(root, 'plugins') })],
  resolve: { alias: { '@console': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/surface',
    emptyOutDir: true,
    lib: { entry: join(root, 'src/surface.tsx'), formats: ['es'], fileName: () => 'console-surface.js', cssFileName: 'console-surface' },
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: (a) => ((a.names ?? []).some((n) => n.endsWith('.css')) ? 'console-surface.css' : 'chunks/[name]-[hash][extname]') } },
  },
});
