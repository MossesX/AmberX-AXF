/**
 * Plugin Manager data: the server inventory (GET /api/plugins/plugin-manager/inventory) merged with what each
 * plugin's web part contributes (its views, dialogs, nav entries, settings tabs), so every row knows whether the
 * plugin has a UI or settings to open. Without the console API the bundled manifests go through the same engine.
 */
import { useCallback, useEffect, useState } from 'react';
import { bundledPlugins, pluginFetch, PLUGINS_CHANGED, type BundledPlugin } from '@console/plugins';
import { buildPluginInventory, DEPENDENCY_LABEL, PLUGIN_HEALTH_RANK, pluginRecord, type Conflict, type Dependency, type DependencyStatus, type Dependent, type InventoryContext, type LiveService, type PluginHealth, type PluginInventory, type PluginInventoryItem, type PluginRecord } from '@console/axf/core/engines/plugins';
import { installedLibraryRecord } from '@console/axf/react/library';

export const FOLDER = 'plugin-manager';

/*
 * The model is the framework's plugin inventory engine (plugin-inventory@1, `core/engines/plugins.ts`): dependencies,
 * dependents, health, clashes and the graph are resolved by the same code on the web, in the console's Python server
 * (`server/engine.py`) and in the Kotlin kernel. The console server resolves live (it knows enabled flags, server parts,
 * env, data folders); without it the browser resolves the bundled manifests with the very same engine.
 */
export type Health = PluginHealth;
export type DepStatus = DependencyStatus;
export type { Dependency, Dependent, Conflict };
export interface LogLine { at: number; channel: string; level: string; text: string }

/** What a plugin's web part gives the user to open. */
export interface PluginUi {
  views: { id: string; title: string; icon?: string }[];
  dialogs: { id: string; title: string }[];
  settingsTabs: { id: string; label: string }[];
  settingsCount: number;
  contextItems: number;
}

/** One plugin as the manager shows it: the engine's item + what the console server and the browser bundle know. */
export interface PluginRow extends PluginInventoryItem {
  description: string;
  author: string;
  kind: string;
  builtWith: { model?: string; builtAt?: string; rebuildOf?: string; replacedBy?: string } | null;
  enabledByDefault: boolean;
  removed: boolean;
  loaded: boolean;
  parts: Record<'web' | 'server' | 'install' | 'uninstall' | 'hooks' | 'selfTest' | 'readme', boolean>;
  lifecycle: { managed: boolean; dataDir: string | null; dataDirProblem: string | null; data: { files: number; bytes: number }; mentions: string[] };
  code: { files: number; bytes: number };
  logCount: number;
  lastLog: LogLine | null;
  backups: number;
  ui: PluginUi;
  webProblem?: string;
}

export interface Inventory {
  items: PluginRow[];
  conflicts: Conflict[];
  services: LiveService[];
  counts: PluginInventory['counts'];
  live: boolean;
}

export function uiOf(p?: BundledPlugin): PluginUi {
  const lib = p?.library;
  if (!lib) return { views: [], dialogs: [], settingsTabs: [], settingsCount: 0, contextItems: 0 };
  return installedLibraryRecord(lib).ui!;
}

/** Contribution ids only the browser can see (views, dialogs, settings tabs), so clashes between web parts are reported by the engine too. */
function webContributions(p: BundledPlugin): string[] {
  return p.library ? installedLibraryRecord(p.library).contributes ?? [] : [];
}

const EMPTY_PARTS: PluginRow['parts'] = { web: false, server: false, install: false, uninstall: false, hooks: false, selfTest: false, readme: false };
const EMPTY_LC: PluginRow['lifecycle'] = { managed: false, dataDir: null, dataDirProblem: null, data: { files: 0, bytes: 0 }, mentions: [] };

/** The bundled manifest as an engine record (what the browser knows without the API). */
function recordOf(p: BundledPlugin): PluginRecord {
  const m = p.manifest as BundledPlugin['manifest'] & { requires?: string[]; optional?: string[]; uiEditor?: string[] };
  return pluginRecord({
    folder: p.folder, id: m.id, name: m.name, version: m.version, apiLevel: m.apiLevel ?? null, targets: m.targets ?? [],
    provides: [...(m.provides ?? []), ...webContributions(p).filter((c) => !(m.provides ?? []).includes(c))],
    requires: m.requires ?? [], optional: m.optional ?? [], uiEditor: m.uiEditor ?? [], scopes: m.scopes ?? [],
    enabled: m.enabledByDefault !== false && !p.problem, error: p.problem ?? null,
  });
}

export const OFFLINE_CONTEXT: InventoryContext = { apiLevels: [1], target: 'axf-console', live: [] };

function offline(): Inventory {
  const byFolder = new Map(bundledPlugins.map((p) => [p.folder, p]));
  const inv = buildPluginInventory(bundledPlugins.map(recordOf), OFFLINE_CONTEXT);
  const items: PluginRow[] = inv.items.map((it) => {
    const p = byFolder.get(it.folder)!;
    const m = p.manifest as BundledPlugin['manifest'] & { builtWith?: PluginRow['builtWith'] };
    return {
      ...it, description: m.description ?? '', author: m.author ?? '', kind: m.kind, builtWith: m.builtWith ?? null, enabledByDefault: m.enabledByDefault !== false,
      removed: false, loaded: false, parts: { ...EMPTY_PARTS, web: Boolean(p.library) }, lifecycle: EMPTY_LC, code: { files: 0, bytes: 0 }, logCount: 0, lastLog: null, backups: 0,
      ui: uiOf(p), webProblem: p.problem,
    };
  });
  return { items, conflicts: inv.conflicts, services: [], live: false, counts: inv.counts };
}

/**
 * The server resolves with its own copy of the engine, but only the browser sees web contributions (view / dialog /
 * settings-tab ids), so they are re-resolved here: the server's records + the bundle's contributions through the engine.
 */
function mergeWebContributions(j: ServerInventory): { items: PluginInventoryItem[]; conflicts: Conflict[]; counts: PluginInventory['counts'] } {
  const byFolder = new Map(bundledPlugins.map((p) => [p.folder, p]));
  const records: PluginRecord[] = j.items.map((it) => {
    const p = byFolder.get(it.folder);
    const extra = p ? webContributions(p).filter((c) => !it.provides.includes(c)) : [];
    return pluginRecord({ ...stripItem(it), provides: [...it.provides, ...extra] });
  });
  return buildPluginInventory(records, { apiLevels: [1], target: 'axf-console', live: j.services });
}

const stripItem = (it: PluginInventoryItem): PluginRecord => {
  const { dependencies: _d, dependents: _e, health: _h, conflicts: _c, ...rec } = it as PluginInventoryItem & Record<string, unknown>;
  return pluginRecord(rec as PluginRecord);
};

interface ServerInventory { frame?: string; items: PluginRow[]; conflicts: Conflict[]; services: LiveService[]; counts: PluginInventory['counts'] }

export async function loadInventory(): Promise<Inventory> {
  try {
    const r = await pluginFetch(FOLDER, 'inventory');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return offline();
    const j = (await r.json()) as ServerInventory;
    const byFolder = new Map(bundledPlugins.map((p) => [p.folder, p]));
    const merged = mergeWebContributions(j);
    const items: PluginRow[] = j.items.map((it) => {
      const b = byFolder.get(it.folder);
      const m = merged.items.find((x) => x.folder === it.folder)!;
      return { ...it, ...m, ui: uiOf(b), webProblem: b?.problem, error: it.error ?? b?.problem ?? null };
    });
    return { items, conflicts: merged.conflicts, services: j.services, live: true, counts: merged.counts };
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
export const DEP_LABEL: Record<DepStatus, string> = DEPENDENCY_LABEL;
export const HEALTH_RANK = PLUGIN_HEALTH_RANK;
