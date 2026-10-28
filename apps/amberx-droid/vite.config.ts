import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve as resolvePath, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { axfProjectGuard } from './src/axf/core/project';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = join(root, 'src');
// Console plugins installed here unchanged (src/plugins/ai-assistant, agent-manager re-export apps/console-web/plugins/*)
// import the console as `@console/...`: the framework resolves to AmberX's own baked copy, the console helpers to the
// bridge in src/console/ (server calls go through AmberX's /api/console/plugins/*).
const consoleSrc = resolvePath(root, '../console-web/src');
const consoleAxf = join(consoleSrc, 'axf') + sep;
const consoleAliases = [
  { find: /^@console\/axf\//, replacement: `${src}/axf/` },
  { find: /^@console\/plugins$/, replacement: `${src}/console/plugins.ts` },
  { find: /^@console\/pluginLifecycle$/, replacement: `${src}/console/pluginLifecycle.tsx` },
  { find: /^@console\/changeBatch$/, replacement: join(consoleSrc, 'changeBatch.tsx') },
];
/** A console file's own `./axf/...` imports use AmberX's framework copy, so there is one runtime, one React context. */
const oneFramework = {
  name: 'amberx-console-one-framework',
  enforce: 'pre' as const,
  async resolveId(this: { resolve: (s: string, i?: string, o?: object) => Promise<{ id: string } | null> }, source: string, importer?: string) {
    if (!importer || !importer.startsWith(consoleSrc) || !source.startsWith('.')) return null;
    const abs = resolvePath(importer, '..', source);
    if (!(abs + sep).startsWith(consoleAxf) && !abs.startsWith(consoleAxf)) return null;
    return this.resolve(join(src, 'axf', abs.slice(consoleAxf.length)), importer, { skipSelf: true });
  },
};

// AmberX build rule: no project is loaded or compiled without a validated manifest (project.manifest.json).
// `npm run build:single` inlines everything into one index.html (handy for sharing a preview).
export default defineConfig(({ mode }) => ({
  plugins: [
    axfProjectGuard({ root, read: (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : undefined), exists: (p) => existsSync(join(root, p)) }),
    oneFramework,
    react(),
    ...(mode === 'single' ? [viteSingleFile()] : []),
  ],
  resolve: { alias: consoleAliases, dedupe: ['react', 'react-dom'] },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  // `npm run dev`: /api goes to the AmberX server (AMBERX_DEV_OPEN=1 uvicorn main:app --app-dir server --port 7492)
  server: { proxy: { '/api': { target: process.env.AMBERX_API ?? 'http://127.0.0.1:7492', changeOrigin: false } } },
}));
