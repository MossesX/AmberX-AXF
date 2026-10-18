/**
 * Plugin Manager data: the server inventory (GET /api/plugins/plugin-manager/inventory) merged with what each
 * plugin's web part contributes (its views, dialogs, nav entries, settings tabs), so every row knows whether the
 * plugin has a UI or settings to open. Without the console API it falls back to the bundled manifests.
 */
import { useCallback, useEffect, useState } from 'react';
import { bundledPlugins, pluginFetch, PLUGINS_CHANGED, type BundledPlugin } from '@console/plugins';

export const FOLDER = 'plugin-manager';

export type Health = 'ok' | 'partial' | 'off' | 'blocked' | 'error';
export type DepStatus = 'ok' | 'missing' | 'disabled' | 'optional-missing' | 'set' | 'unset' | 'granted' | 'declared' | 'unsupported' | 'error' | 'not loaded';

export interface Dependency {
  kind: 'framework' | 'service' | 'env' | 'scope' | 'core' | 'other';
  name: string;
  required: boolean;
  status: DepStatus;
  detail: string;
  providers?: { folder: string; name: string; enabled: boolean; live?: boolean }[];
}
export interface Dependent { folder: string; name: string; service: string; required: boolean; enabled: boolean }
export interface Conflict { id: string; kind: string; key: string; folders: string[]; detail: string; severity: 'info' | 'warn' | 'error' }
export interface LogLine { at: number; channel: string; level: string; text: string }

/** What a plugin's web part gives the user to open. */
export interface PluginUi {
  views: { id: string; title: string; icon?: string }[];
  dialogs: { id: string; title: string }[];
  settingsTabs: { id: string; label: string }[];
  settingsCount: number;
  contextItems: number;
}

export interface PluginRow {
  folder: string;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  kind: string;
  apiLevel: number | null;
  scopes: string[];
  provides: string[];
  requires: string[];
  optional: string[];
  uiEditor: string[];
  builtWith: { model?: string; replacedBy?: string } | null;
  enabled: boolean;
  enabledByDefault: boolean;
  server: 'none' | 'loaded' | 'error';
  error: string | null;
  removed: boolean;
  parts: Record<'web' | 'server' | 'install' | 'uninstall' | 'hooks' | 'selfTest' | 'readme', boolean>;
  lifecycle: { managed: boolean; dataDir: string | null; dataDirProblem: string | null; data: { files: number; bytes: number }; mentions: string[] };
  code: { files: number; bytes: number };
  env: { name: string; set: boolean }[];
  services: string[];
  logCount: number;
  lastLog: LogLine | null;
  backups: number;
  dependencies: Dependency[];
  dependents: Dependent[];
  conflicts: string[];
  health: Health;
  ui: PluginUi;
  webProblem?: string;
}

export interface Inventory {
  items: PluginRow[];
  conflicts: Conflict[];
  services: { name: string; folder: string; enabled: boolean }[];
  counts: { total: number; enabled: number; errors: number; missingDeps: number; conflicts: number; editors: number };
  live: boolean;
}

export function uiOf(p?: BundledPlugin): PluginUi {
  const lib = p?.library;
  const tabs = (lib?.settingsTabs ?? []).map((t) => ({ id: t.id, label: t.label }));
  const tabIds = new Set(tabs.map((t) => t.id));
  return {
    views: Object.entries(lib?.views ?? {}).map(([id, v]) => ({ id, title: v.title, icon: v.icon })),
    dialogs: Object.entries(lib?.dialogs ?? {}).map(([id, d]) => ({ id, title: String((d as { title?: unknown }).title ?? id) })),
    settingsTabs: tabs,
    settingsCount: (lib?.settingsPanels ?? []).filter((x) => tabIds.has(x.tab)).length + (lib?.settings ?? []).filter((g) => tabIds.has(g.tab ?? '')).length,
    contextItems: (lib?.contextMenu ?? []).reduce((n, c) => n + c.items.filter((i) => !i.separator).length, 0),
  };
}

/** Clashes only the browser can see: two plugins' web parts using the same view / dialog / settings-tab id. */
function webConflicts(): Conflict[] {
  const seen = new Map<string, string[]>();
  for (const p of bundledPlugins) {
    const lib = p.library;
    if (!lib) continue;
    const keys = [
      ...Object.keys(lib.views ?? {}).map((k) => `view:${k}`),
      ...Object.keys(lib.dialogs ?? {}).map((k) => `dialog:${k}`),
      ...(lib.settingsTabs ?? []).map((t) => `settings-tab:${t.id}`),
    ];
    for (const k of keys) seen.set(k, [...(seen.get(k) ?? []), p.folder]);
  }
  return [...seen.entries()]
    .filter(([, fs]) => new Set(fs).size > 1)
    .map(([key, fs]) => ({ id: `web:${key}`, kind: 'web-contribution', key, folders: [...new Set(fs)].sort(), detail: 'Two plugins register this id in the browser; the one installed last replaces the other.', severity: 'warn' as const }));
}

function offline(): Inventory {
  const items: PluginRow[] = bundledPlugins.map((p) => {
    const m = p.manifest as BundledPlugin['manifest'] & { requires?: string[]; optional?: string[]; uiEditor?: string[]; builtWith?: PluginRow['builtWith'] };
    const enabled = m.enabledByDefault !== false && !p.problem;
    return {
      folder: p.folder, id: m.id, name: m.name, version: m.version, description: m.description ?? '', author: m.author ?? '', kind: m.kind,
      apiLevel: m.apiLevel ?? null, scopes: m.scopes ?? [], provides: m.provides ?? [], requires: m.requires ?? [], optional: m.optional ?? [],
      uiEditor: m.uiEditor ?? [], builtWith: m.builtWith ?? null, enabled, enabledByDefault: m.enabledByDefault !== false, server: 'none',
      error: p.problem ?? null, removed: false,
      parts: { web: Boolean(p.library), server: false, install: false, uninstall: false, hooks: false, selfTest: false, readme: false },
      lifecycle: { managed: false, dataDir: null, dataDirProblem: null, data: { files: 0, bytes: 0 }, mentions: [] },
      code: { files: 0, bytes: 0 }, env: [], services: [], logCount: 0, lastLog: null, backups: 0,
      dependencies: [...(m.requires ?? []).map((n) => dep(n, true)), ...(m.optional ?? []).map((n) => dep(n, false))],
      dependents: [], conflicts: [], health: p.problem ? 'error' : enabled ? 'ok' : 'off', ui: uiOf(p), webProblem: p.problem,
    };
  });
  const conflicts = webConflicts();
  for (const it of items) it.conflicts = conflicts.filter((c) => c.folders.includes(it.folder)).map((c) => c.id);
  return { items, conflicts, services: [], live: false, counts: count(items, conflicts) };
}

function dep(entry: string, required: boolean): Dependency {
  const svc = entry.startsWith('service:') ? entry.slice(8) : entry;
  return { kind: entry.startsWith('service:') ? 'service' : 'other', name: svc, required, status: 'declared', detail: 'The console API is offline, so this can’t be checked right now.' };
}

function count(items: PluginRow[], conflicts: Conflict[]): Inventory['counts'] {
  return {
    total: items.length,
    enabled: items.filter((i) => i.enabled).length,
    errors: items.filter((i) => i.error).length,
    missingDeps: items.filter((i) => i.dependencies.some((d) => d.required && (d.status === 'missing' || d.status === 'disabled'))).length,
    conflicts: conflicts.length,
    editors: items.filter((i) => i.uiEditor.length).length,
  };
}

export async function loadInventory(): Promise<Inventory> {
  try {
    const r = await pluginFetch(FOLDER, 'inventory');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return offline();
    const j = (await r.json()) as Omit<Inventory, 'live'>;
    const byFolder = new Map(bundledPlugins.map((p) => [p.folder, p]));
    const extra = webConflicts();
    const conflicts = [...j.conflicts, ...extra];
    const items = j.items.map((it) => {
      const b = byFolder.get(it.folder);
      return { ...it, ui: uiOf(b), webProblem: b?.problem, conflicts: [...it.conflicts, ...extra.filter((c) => c.folders.includes(it.folder)).map((c) => c.id)] };
    });
    return { items, conflicts, services: j.services, live: true, counts: { ...j.counts, conflicts: conflicts.length } };
  } catch {
    return offline();
  }
}

export async function loadLogs(folder: string, level = ''): Promise<LogLine[]> {
  try {
    const r = await pluginFetch(FOLDER, `logs/${folder}?limit=300${level ? `&level=${level}` : ''}`);
    if (!r.ok) return [];
    return ((await r.json()) as { lines: LogLine[] }).lines;
  } catch {
    return [];
  }
}

export async function loadFiles(folder: string): Promise<{ path: string; bytes: number }[]> {
  try {
    const r = await pluginFetch(FOLDER, `plugin/${folder}`);
    if (!r.ok) return [];
    return ((await r.json()) as { files: { path: string; bytes: number }[] }).files;
  } catch {
    return [];
  }
}

/** Live inventory: reloads when plugins are enabled/disabled anywhere in the console and on demand. */
export function useInventory() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setInv(await loadInventory()); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void reload();
    const on = () => void reload();
    globalThis.addEventListener(PLUGINS_CHANGED, on);
    return () => globalThis.removeEventListener(PLUGINS_CHANGED, on);
  }, [reload]);
  return { inv, loading, reload };
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const monogram = (name: string) => name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
export const HEALTH_LABEL: Record<Health, string> = { ok: 'Healthy', partial: 'Partly set up', off: 'Off', blocked: 'Blocked', error: 'Error' };
export const HEALTH_TONE: Record<Health, 'success' | 'warning' | 'danger' | 'accent' | undefined> = { ok: 'success', partial: 'warning', off: undefined, blocked: 'danger', error: 'danger' };
export const DEP_TONE = (s: DepStatus): 'success' | 'warning' | 'danger' | 'accent' | undefined =>
  s === 'ok' || s === 'set' ? 'success' : s === 'missing' || s === 'unsupported' || s === 'error' ? 'danger' : s === 'disabled' || s === 'unset' || s === 'optional-missing' || s === 'not loaded' ? 'warning' : s === 'granted' ? 'accent' : undefined;
export const DEP_LABEL: Record<DepStatus, string> = {
  ok: 'satisfied', missing: 'missing', disabled: 'provider off', 'optional-missing': 'not installed', set: 'set', unset: 'not set', granted: 'granted',
  declared: 'declared', unsupported: 'unsupported', error: 'error', 'not loaded': 'not loaded',
};
