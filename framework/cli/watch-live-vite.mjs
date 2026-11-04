/**
 * Watch live — the Vite plugin every live preview runs with (framework/cli/watch-live.mjs writes a wrapper config
 * that adds it to the app's own vite.config). No dependencies beyond Node: it is loaded by absolute path.
 *
 *  - injects the framework's Watch live helper (framework/core/watch-live.ts, read from this checkout so a stale
 *    baked copy in the app doesn't matter) into the page;
 *  - serves `<base>__axf/focus` = the session's `.axf-focus.json` (only when it is about this app);
 *  - asset files (the app's assets folder) are not hot-reloaded by Vite: each change is validated the same way
 *    `axf dev` does (dev-server.mjs `assetChange`) and sent as an `axf:asset` HMR event, which the helper applies
 *    with `AxfRuntime.hotReplaceAsset` — the asset swaps in place, no reload, no lost state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetChange } from './dev-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLIENT_ID = '/@axf-watch-live/client.ts';
export const HELPER = join(HERE, '..', 'core', 'watch-live.ts');

/** `.axf-focus.json` as this app's preview should see it (null when missing, broken or about another app). */
export function readFocus(focusFile, app) {
  try {
    const f = JSON.parse(readFileSync(focusFile, 'utf8'));
    if (!f || typeof f !== 'object') return null;
    if (f.app && app && f.app !== app) return null;
    return f;
  } catch { return null; }
}

export function isAssetFile(file, assetsDirs) {
  if (!file.endsWith('.json')) return false;
  const f = resolve(file);
  return assetsDirs.some((d) => f.startsWith(resolve(d) + sep));
}

export function clientSource({ assetsServer = false } = {}) {
  return `${readFileSync(HELPER, 'utf8')}\n;installWatchLive({ base: import.meta.env.BASE_URL, hot: import.meta.hot, assetsServer: ${assetsServer ? 'true' : 'false'} });\n`;
}

export function axfWatchLive({ app = '', worktree = process.cwd(), assetsDirs = [], assetsServer = false } = {}) {
  const focusFile = join(worktree, '.axf-focus.json');
  return {
    name: 'axf-watch-live',
    apply: 'serve',
    resolveId(id) { return id === CLIENT_ID || id.endsWith(CLIENT_ID) ? CLIENT_ID : undefined; },
    load(id) { return id === CLIENT_ID ? clientSource({ assetsServer }) : undefined; },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const tag = `<script type="module" src="${CLIENT_ID}"></script>`;
        return html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag;
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? '').split('?')[0].endsWith('/__axf/focus')) return next();
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(existsSync(focusFile) ? readFocus(focusFile, app) : null));
      });
    },
    handleHotUpdate({ file, server }) {
      if (!isAssetFile(file, assetsDirs)) return undefined;
      const change = assetChange(file, existsSync(file) ? 'changed' : 'removed');
      server.ws.send({ type: 'custom', event: 'axf:asset', data: change });
      return [];
    },
  };
}

/**
 * Renders the checkout's live framework instead of the app's baked copy (src/axf/{core,react,ui,schemas}), so a
 * session changing an engine, control or the base stylesheet sees it hot-render in the app at once.
 */
export function liveFramework({ appDir, frameworkDir }) {
  const baked = resolve(appDir, 'src', 'axf') + sep;
  return {
    name: 'axf-watch-live-framework',
    apply: 'serve',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0') || source === CLIENT_ID) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || r.external) return null;
      return liveFrameworkPath(r.id, baked, frameworkDir);
    },
  };
}

/** `<app>/src/axf/react/x.tsx?q` → `<framework>/react/x.tsx?q` when that file exists; null otherwise. */
export function liveFrameworkPath(id, baked, frameworkDir) {
  const [file, ...q] = id.split('?');
  if (!file.startsWith(baked)) return null;
  const rel = file.slice(baked.length);
  if (!/^(core|react|ui|schemas)\//.test(rel)) return null;
  const live = join(frameworkDir, rel);
  return existsSync(live) ? [live, ...q].join('?') : null;
}
