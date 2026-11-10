import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import base from './vite.config';

const root = fileURLToPath(new URL('.', import.meta.url));

// This app's native surface (shell-surface@1, src/surface.tsx): an ES module a shell such as Molly imports and mounts in
// its own page (no frame). The app's own build setup, built as a library after the app into dist/surface/: served at
// /surface/axhub-surface.js with its styles at /surface/axhub-surface.css (the shell links them next to the module).
export default defineConfig((env) => mergeConfig((typeof base === 'function' ? base(env) : base) as UserConfig, {
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/surface',
    emptyOutDir: true,
    lib: { entry: join(root, 'src/surface.tsx'), formats: ['es'], fileName: () => 'axhub-surface.js', cssFileName: 'axhub-surface' },
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: (a) => ((a.names ?? []).some((n) => n.endsWith('.css')) ? 'axhub-surface.css' : 'chunks/[name]-[hash][extname]') } },
  },
}));
