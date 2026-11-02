import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { axfProjectGuard } from './src/axf/core/project';

const root = fileURLToPath(new URL('.', import.meta.url));

// AmberX build rule: no project is loaded or compiled without a validated manifest (project.manifest.json).
// `npm run build:single` inlines everything into one index.html (handy for sharing a preview).
export default defineConfig(({ mode }) => ({
  plugins: [
    axfProjectGuard({ root, read: (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : undefined), exists: (p) => existsSync(join(root, p)) }),
    react(),
    ...(mode === 'single' ? [viteSingleFile()] : []),
  ],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
