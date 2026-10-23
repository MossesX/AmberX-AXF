/**
 * Console plugins (apps/console-web/plugins/<folder>/, see plugins/README.md).
 *
 * Each plugin's web part is bundled at build time (Vite glob) and is an `AxfWebLibrary`: views, a nav
 * section, dialogs, tab renderers and actions. Which plugins run is decided by the backend
 * (`GET /api/plugins`: enabled flags, server status); without a backend, plugins enabled by default run.
 * Folders starting with "_" are templates and never load.
 */
import type { AxfWebLibrary } from './axf/react/library';
import type { EmbedPlugin, EmbedPluginTab } from './axf/core';
import { authHeaders, createApiClient, STANDARD_MESSAGES, type ApiClient } from './axf/libs/apiclient';
import { consoleTokens } from './api';

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
  /** can a host app (Patches) add this plugin to its tab group? false (default) | true (its first page) | {view, label?, icon?} */
  tabable?: boolean | { view: string; label?: string; icon?: string };
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

/**
 * Inside a host that manages plugins (embed@1 take `plugins`, Patches; Brett Oct 22 2026: "disable all plugins from the
 * apps and only enable them in Patches"): the plugins to run are the ones the host enabled for the console, whatever
 * the console's own switches say. null = the host hasn't answered yet: run none.
 */
export function hostEnabledPlugins(hostIds: readonly string[] | null): BundledPlugin[] {
  if (!hostIds) return [];
  return bundledPlugins.filter((p) => p.library && hostIds.includes(p.manifest.id));
}

/**
 * The tab a plugin offers a host app (plugin.json → `tabable`; Brett, Oct 22 2026: "tabable means it can be added to a tab
 * group"): its page `{view, label, icon}`, or null. `true` = its first page; an object names the page, which must be one
 * of the web part's views. Same rules as `checkTabable` in framework/cli/plugins.mjs and `_plugin_tab` in server/main.py.
 */
export function pluginTab(p: BundledPlugin): EmbedPluginTab | null {
  const t = p.manifest.tabable;
  const views = Object.keys(p.library?.views ?? {});
  if (!t || !views.length) return null;
  const view = t === true ? views[0]! : t.view;
  if (!views.includes(view)) return null;
  const label = (t !== true && t.label) || p.manifest.name;
  const icon = (t !== true && t.icon) || p.library?.views?.[view]?.icon;
  return { view, label, ...(icon ? { icon } : {}) };
}

/** What the console tells the host it has: every plugin that can run, whether the console itself had it on, and its tab. */
export function pluginReport(status: PluginStatus[] | null): EmbedPlugin[] {
  const on = new Set(enabledPlugins(status));
  return bundledPlugins.filter((p) => p.library).map((p) => {
    const t = pluginTab(p);
    // its own settings tab rides along, so a host (Patches) can give that plugin tab a settings tab of its own
    const settings = p.library?.settingsTabs?.[0]?.id;
    const tab = t && settings ? { ...t, settings } : t;
    return { id: p.manifest.id, name: p.manifest.name, ...(p.manifest.version ? { version: p.manifest.version } : {}), on: on.has(p), ...(tab ? { tab } : {}) };
  });
}

/**
 * Plugins the host enabled whose server part is off here: their web part runs inside the host, so their routes must
 * answer too. Only switches parts on (never off: the console on its own keeps every other choice).
 */
export function serverPartsToSwitchOn(status: PluginStatus[] | null, hostIds: readonly string[] | null): string[] {
  if (!status || !hostIds) return [];
  return hostEnabledPlugins(hostIds).map((p) => status.find((s) => s.folder === p.folder)).filter((s): s is PluginStatus => !!s && !s.enabled && s.server !== 'none').map((s) => s.folder);
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

// Function declarations (hoisted) on purpose: the eager plugin glob above runs every plugin's web part before this
// module's body, and plugins create their clients at load time.
function pluginUrl(folder: string, path: string): string { return `/api/plugins/${folder}/${path.replace(/^\/+/, '')}`; }

/** Fetch for a plugin's own server routes (/api/plugins/<folder>/...), with the console token. */
export async function pluginFetch(folder: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(pluginUrl(folder, path), { ...init, headers: authHeaders(consoleTokens, init), cache: 'no-store' });
}

/** Where a plugin's 401 message sends people (the console token lives under Settings → Account & security). */
export function tokenHome(): string { return 'Settings → Account & security'; }

/**
 * JSON client for a plugin's own server routes, with the standard messages: 401 → "Console token required (…).",
 * 404 without detail → "<label> is disabled or its server part is not running.", otherwise the server's detail.
 * `label` is the subject of that sentence ("The agent manager plugin", "Snapshot Manager"); `unavailable` replaces the sentence.
 * The client is built on first use, so plugins may call this while the console is still loading.
 */
export function pluginApi(folder: string, label: string, opts: { tokenHome?: string; unavailable?: string } = {}): ApiClient {
  let client: ApiClient | null = null;
  const c = (): ApiClient => (client ??= createApiClient({
    url: (path) => pluginUrl(folder, path),
    tokens: consoleTokens,
    fetch: (url, init) => fetch(url, init),
    messages: { unauthorized: STANDARD_MESSAGES.unauthorized(opts.tokenHome ?? tokenHome()), unavailable: opts.unavailable ?? STANDARD_MESSAGES.unavailable(label) },
  }));
  return {
    fetch: (path, init) => c().fetch(path, init),
    call: (path, init) => c().call(path, init),
    post: (path, body) => c().post(path, body),
    put: (path, body) => c().put(path, body),
    patch: (path, body) => c().patch(path, body),
    del: (path) => c().del(path),
    download: (path, name, init) => c().download(path, name, init),
    blob: (path, init, accept) => c().blob(path, init, accept),
  };
}

/** Fired on window when a plugin is enabled or disabled, so the shell re-installs plugins. */
export const PLUGINS_CHANGED = 'axf:plugins-changed';
