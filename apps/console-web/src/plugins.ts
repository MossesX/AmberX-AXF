/**
 * Console plugins (apps/console-web/plugins/<folder>/, see plugins/README.md).
 *
 * Each plugin's web part is bundled at build time (Vite glob) and is an `AxfWebLibrary`: views, a nav
 * section, dialogs, tab renderers and actions. Which plugins run is decided by the backend
 * (`GET /api/plugins`: enabled flags, server status); without a backend, plugins enabled by default run.
 * Folders starting with "_" are templates and never load.
 */
import type { AxfWebLibrary } from './axf/react/library';

export interface PluginManifest {
  $axf: 'plugin@1';
  id: string;
  name: string;
  version: string;
  kind: string;
  apiLevel: number;
  description?: string;
  author?: string;
  provides?: string[];
  scopes?: string[];
  targets?: string[];
  enabledByDefault?: boolean;
}

export interface BundledPlugin {
  folder: string;
  manifest: PluginManifest;
  library?: AxfWebLibrary;
  /** Why the web part couldn't be used, if it couldn't. */
  problem?: string;
}

export interface PluginStatus {
  folder: string;
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  enabled: boolean;
  server: 'none' | 'loaded' | 'error';
  error: string | null;
}

const manifests = import.meta.glob(['../plugins/*/plugin.json', '!../plugins/_*/**'], { eager: true, import: 'default' }) as Record<string, PluginManifest>;
const webParts = import.meta.glob(['../plugins/*/web/index.tsx', '!../plugins/_*/**'], { eager: true }) as Record<string, { plugin?: AxfWebLibrary }>;

const folderOf = (path: string) => path.split('/')[2] ?? '';

export const bundledPlugins: BundledPlugin[] = Object.entries(manifests)
  .map(([path, manifest]) => {
    const folder = folderOf(path);
    const web = webParts[`../plugins/${folder}/web/index.tsx`];
    const out: BundledPlugin = { folder, manifest };
    if (manifest?.$axf !== 'plugin@1') out.problem = 'plugin.json is not a plugin@1 manifest';
    else if (!(manifest.targets ?? []).includes('axf-console')) out.problem = 'plugin.json targets do not include "axf-console"';
    else if (!web) out.problem = 'no web/index.tsx';
    else if (!web.plugin || typeof web.plugin !== 'object') out.problem = 'web/index.tsx does not export `plugin`';
    else if (web.plugin.id !== manifest.id) out.problem = `web part id "${web.plugin.id}" differs from plugin.json id "${manifest.id}"`;
    else out.library = web.plugin;
    return out;
  })
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

/** Plugins to run, given the backend's status list (or null when there is no backend). */
export function enabledPlugins(status: PluginStatus[] | null): BundledPlugin[] {
  return bundledPlugins.filter((p) => {
    if (!p.library) return false;
    const s = status?.find((x) => x.folder === p.folder);
    return s ? s.enabled : p.manifest.enabledByDefault !== false;
  });
}

export async function fetchPluginStatus(): Promise<PluginStatus[] | null> {
  try {
    const r = await fetch('/api/plugins', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return ((await r.json()) as { items: PluginStatus[] }).items;
  } catch {
    return null;
  }
}

/** Fetch for a plugin's own server routes (/api/plugins/<folder>/...), with the console token. */
export async function pluginFetch(folder: string, path: string, init: RequestInit = {}): Promise<Response> {
  let token = '';
  try { token = localStorage.getItem('axf-console:token') ?? ''; } catch { /* storage blocked */ }
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`/api/plugins/${folder}/${path.replace(/^\/+/, '')}`, { ...init, headers, cache: 'no-store' });
}

/** Fired on window when a plugin is enabled or disabled, so the shell re-installs plugins. */
export const PLUGINS_CHANGED = 'axf:plugins-changed';
