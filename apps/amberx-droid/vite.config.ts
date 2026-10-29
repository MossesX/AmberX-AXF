import { defineConfig } from 'vite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve as resolvePath, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { axfProjectGuard } from './src/axf/core/project';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = join(root, 'src');
// Console plugins that list this app in their plugin.json `targets` ("amberx-droid") are installed here unchanged:
// `virtual:amberx-console-plugins` imports their web/index.tsx. They import the console as `@console/...`: the framework
// resolves to AmberX's own baked copy, the console helpers to the bridge in src/console/ (server calls go through
// AmberX's /api/console/plugins/<folder>/*). The build writes dist/console-plugins.json, the folders the server forwards.
// Generic on purpose: nothing here names a plugin, so uninstalling one on the console just drops it from AmberX.
const APP_TARGET = 'amberx-droid';
const consolePluginsDir = resolvePath(root, '../console-web/plugins');
const consoleSrc = resolvePath(root, '../console-web/src');
const consoleAxf = join(consoleSrc, 'axf') + sep;
const consoleAliases = [
  { find: /^@console\/axf\//, replacement: `${src}/axf/` },
  { find: /^@console\/plugins$/, replacement: `${src}/console/plugins.ts` },
  { find: /^@console\/pluginLifecycle$/, replacement: `${src}/console/pluginLifecycle.tsx` },
  { find: /^@console\/changeBatch$/, replacement: join(consoleSrc, 'changeBatch.tsx') },
  { find: /^@console\/emptyState$/, replacement: join(consoleSrc, 'emptyState.tsx') }, // branded empty states + skeletons (enterprise-branding s34)
];
function consolePlugins(): { folder: string; manifest: Record<string, unknown> }[] {
  if (!existsSync(consolePluginsDir)) return [];
  return readdirSync(consolePluginsDir).filter((f) => !f.startsWith('_')).sort().flatMap((folder) => {
    const mf = join(consolePluginsDir, folder, 'plugin.json');
    if (!existsSync(mf) || !existsSync(join(consolePluginsDir, folder, 'web', 'index.tsx'))) return [];
    try {
      const manifest = JSON.parse(readFileSync(mf, 'utf8')) as Record<string, unknown>;
      return Array.isArray(manifest.targets) && manifest.targets.includes(APP_TARGET) ? [{ folder, manifest }] : [];
    } catch { return []; }
  });
}
const VIRTUAL = 'virtual:amberx-console-plugins';
const consolePluginsModule = {
  name: 'amberx-console-plugins',
  resolveId: (id: string) => (id === VIRTUAL ? '\0' + VIRTUAL : null),
  load(id: string) {
    if (id !== '\0' + VIRTUAL) return null;
    const list = consolePlugins();
    return list.map((p, i) => `import { plugin as p${i} } from ${JSON.stringify(join(consolePluginsDir, p.folder, 'web', 'index.tsx'))};`).join('\n')
      + `\nexport default [${list.map((p, i) => `{ folder: ${JSON.stringify(p.folder)}, manifest: ${JSON.stringify({ id: p.manifest.id, name: p.manifest.name, version: p.manifest.version })}, library: p${i} }`).join(', ')}];\n`;
  },
  generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
    this.emitFile({ type: 'asset', fileName: 'console-plugins.json', source: JSON.stringify({ folders: consolePlugins().map((p) => p.folder) }) + '\n' });
  },
};
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
    consolePluginsModule,
    react(),
    ...(mode === 'single' ? [viteSingleFile()] : []),
  ],
  resolve: { alias: consoleAliases, dedupe: ['react', 'react-dom'] },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  // `npm run dev`: /api goes to the AmberX server (AMBERX_DEV_OPEN=1 uvicorn main:app --app-dir server --port 7492)
  server: { proxy: { '/api': { target: process.env.AMBERX_API ?? 'http://127.0.0.1:7492', changeOrigin: false } } },
}));
