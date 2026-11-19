/**
 * Plugin inventory engine — plugin-inventory@1. The Plugin Manager's model on every port: what each plugin
 * (web console plugin, Android module, library) needs, who provides it, who needs it, and what clashes.
 *
 * Reference engine (TypeScript). Mirrors: Kotlin `ai.amberx.axf.kernel.plugins.PluginInventoryEngine` and the Python
 * copy in the console's Plugin Manager server part (`server/engine.py`). All three replay `spec/fixtures/plugin-inventory.json`.
 *
 * Pure: the host gathers facts (`PluginRecord`s: manifests, enabled flags, live services, env set/unset, data folder)
 * and the engine resolves them. Nothing here reads files or the network.
 *
 * Dependency entries in `requires` / `optional` are prefixed by kind (an open vocabulary):
 *   `service:<capability>`  a capability another plugin provides (`provides: ["service:axf.llm@1"]`, or registered live)
 *   `plugin:<id>`           another plugin by id (Android module `dependsOn`)
 *   anything else           declared, not checked (status `declared`)
 * Other entries of `provides` (`view:x`, `settings-tab:x`, …) are contributions; two plugins contributing one id clash.
 */

export const PLUGIN_INVENTORY_FRAME = 'plugin-inventory@1';

export type PluginHealth = 'ok' | 'partial' | 'off' | 'blocked' | 'error';
export const PLUGIN_HEALTHS: readonly PluginHealth[] = ['ok', 'partial', 'off', 'blocked', 'error'];
/** Health order for sorting: worst first. */
export const PLUGIN_HEALTH_RANK: Record<PluginHealth, number> = { error: 0, blocked: 1, partial: 2, off: 3, ok: 4 };

export type DependencyKind = 'framework' | 'service' | 'plugin' | 'env' | 'scope' | 'core' | 'other';
export type DependencyStatus =
  | 'ok' | 'missing' | 'disabled' | 'optional-missing' | 'set' | 'unset' | 'granted' | 'declared' | 'unsupported' | 'error' | 'not loaded';
export const DEPENDENCY_LABEL: Record<DependencyStatus, string> = {
  ok: 'satisfied', missing: 'missing', disabled: 'provider off', 'optional-missing': 'not installed', set: 'set', unset: 'not set',
  granted: 'granted', declared: 'declared', unsupported: 'unsupported', error: 'error', 'not loaded': 'not loaded',
};

export type ConflictSeverity = 'info' | 'warn' | 'error';

/** What a host knows about one plugin before resolution. */
export interface PluginRecord {
  /** Host key: the folder (web console), module id (Android), library id (web app). */
  folder: string;
  id: string;
  name: string;
  version: string;
  apiLevel: number | null;
  /** Host app ids it targets (`axf-console`, `*`); empty = any. */
  targets: string[];
  provides: string[];
  requires: string[];
  optional: string[];
  /** Kinds of values it edits (theme / style / layout / manager / builder). */
  uiEditor: string[];
  scopes: string[];
  enabled: boolean;
  /** Load error (manifest, web part, module start). */
  error: string | null;
  /** It ships a server part (web console) — `server` says how that went. */
  serverPart: boolean;
  server: 'none' | 'loaded' | 'error';
  /** Environment variables it reads, as set / not set — never values. */
  env: { name: string; set: boolean }[];
  /** Private data folder, relative; null when it has none or it was refused (`dataDirProblem` says why). */
  dataDir: string | null;
  dataDirProblem: string | null;
  /** Capabilities it registered live with the host (may differ from `provides`). */
  services: string[];
}

export interface LiveService { name: string; folder: string; enabled: boolean }

export interface InventoryContext {
  /** plugin@1 API levels this host runs. */
  apiLevels: number[];
  /** The host id a plugin must target (null = don't check). */
  target: string | null;
  /** Capabilities registered live with the host. */
  live: LiveService[];
}

export interface Provider { folder: string; name: string; enabled: boolean; live: boolean }

export interface Dependency {
  kind: DependencyKind;
  name: string;
  required: boolean;
  status: DependencyStatus;
  detail: string;
  providers?: Provider[];
}

export interface Dependent { folder: string; name: string; service: string; required: boolean; enabled: boolean }

export interface Conflict { id: string; kind: string; key: string; folders: string[]; detail: string; severity: ConflictSeverity }

export interface PluginInventoryItem extends PluginRecord {
  dependencies: Dependency[];
  dependents: Dependent[];
  health: PluginHealth;
  conflicts: string[];
}

export interface PluginInventory {
  items: PluginInventoryItem[];
  conflicts: Conflict[];
  counts: { total: number; enabled: number; errors: number; missingDeps: number; conflicts: number; editors: number };
}

/** Scope ids → what they mean (open: unknown scopes read "Declared scope."). */
export const SCOPE_NOTES: Record<string, string> = {
  ROUTES: 'adds server routes under /api/plugins/<folder>/ (console token on every method, 404 while disabled)',
  NETWORK: 'makes outbound network calls from the console server',
  FILES: 'reads or writes files on the console server',
  SETTINGS: 'adds settings groups or tabs',
  ASSETS: 'registers assets',
  ACTIONS: 'registers actions',
  MENU_ITEMS: 'adds menu or context-menu items',
  BACKGROUND: 'runs background work in the console server',
  NOTIFICATIONS: 'sends notifications',
  DEVICE: 'talks to devices or containers',
  IDENTITY: 'reads who is signed in',
  BILLING: 'touches billing',
};

export const serviceOf = (entry: string): string | null => (entry.startsWith('service:') ? entry.slice(8) : null);
export const pluginOf = (entry: string): string | null => (entry.startsWith('plugin:') ? entry.slice(7) : null);

/** A record with every field filled, so hosts can pass partial facts. */
export function pluginRecord(r: Partial<PluginRecord> & { folder: string; id: string; name: string }): PluginRecord {
  return {
    version: '', apiLevel: null, targets: [], provides: [], requires: [], optional: [], uiEditor: [], scopes: [], enabled: true, error: null,
    serverPart: false, server: 'none', env: [], dataDir: null, dataDirProblem: null, services: [], ...r,
  };
}

/** Capability → plugins that provide it (declared in `provides`, plus whatever registered live). */
export function resolveProviders(records: PluginRecord[], live: LiveService[]): Map<string, Provider[]> {
  const by = new Map<string, Provider[]>();
  for (const r of records) {
    for (const p of r.provides) {
      const svc = serviceOf(p);
      if (svc) (by.get(svc) ?? by.set(svc, []).get(svc)!).push({ folder: r.folder, name: r.name, enabled: r.enabled, live: r.services.includes(svc) });
    }
  }
  for (const s of live) {
    if (!s.name || !s.folder) continue;
    const list = by.get(s.name) ?? by.set(s.name, []).get(s.name)!;
    if (list.some((p) => p.folder === s.folder)) continue;
    const r = records.find((x) => x.folder === s.folder);
    list.push({ folder: s.folder, name: r ? r.name : s.folder, enabled: Boolean(s.enabled), live: true });
  }
  return by;
}

const envDetail = (name: string, plugin: string) => `${plugin} reads ${name} from the host's environment (Settings → Connections or the systems check can set it).`;

/** Everything one plugin needs, with status and who provides it. Same order on every port. */
export function dependenciesOf(r: PluginRecord, providers: Map<string, Provider[]>, records: PluginRecord[], ctx: InventoryContext): Dependency[] {
  const deps: Dependency[] = [];
  const levels = [...ctx.apiLevels].sort((a, b) => a - b);
  deps.push({
    kind: 'framework', name: `plugin@1 API level ${r.apiLevel ?? '?'}`, required: true,
    status: r.apiLevel !== null && levels.includes(r.apiLevel) ? 'ok' : 'unsupported',
    detail: `The host runs plugin@1 API level ${levels.join(', ')}.`,
  });
  if (ctx.target && r.targets.length && !r.targets.includes(ctx.target) && !r.targets.includes('*')) {
    deps.push({ kind: 'framework', name: `target ${ctx.target}`, required: true, status: 'unsupported', detail: `plugin.json "targets" must include "${ctx.target}" for this host to load it.` });
  }
  const seen = new Set<string>();
  for (const [required, entries] of [[true, r.requires], [false, r.optional]] as const) {
    for (const entry of entries) {
      const svc = serviceOf(entry);
      const pid = pluginOf(entry);
      if (pid) {
        const key = `plugin:${pid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const other = records.find((x) => x.id === pid && x.folder !== r.folder);
        const status: DependencyStatus = other ? (other.enabled ? 'ok' : 'disabled') : required ? 'missing' : 'optional-missing';
        const detail = other
          ? (other.enabled ? `Installed: ${other.name}.` : `${other.name} is installed but switched off. Enable it` + (required ? ' or this plugin can\'t work.' : ' to turn this feature on.'))
          : required ? 'Not installed, so this plugin can\'t do its job until it is.' : 'Optional: the plugin works without it; the features that use it stay hidden or greyed out.';
        deps.push({ kind: 'plugin', name: pid, required, status, detail, providers: other ? [{ folder: other.folder, name: other.name, enabled: other.enabled, live: other.enabled }] : [] });
        continue;
      }
      if (!svc) {
        deps.push({ kind: 'other', name: entry, required, status: 'declared', detail: 'Declared in the manifest; the host doesn\'t check this kind of dependency yet.' });
        continue;
      }
      if (seen.has(svc)) continue;
      seen.add(svc);
      const provs = (providers.get(svc) ?? []).filter((p) => p.folder !== r.folder);
      const status: DependencyStatus = provs.some((p) => p.enabled) ? 'ok' : provs.length ? 'disabled' : required ? 'missing' : 'optional-missing';
      const who = provs.map((p) => p.name).join(', ') || 'no installed plugin';
      const detail = status === 'ok' ? `Provided by ${who}.`
        : status === 'disabled' ? `Provided by ${who}, which is switched off. Enable it` + (required ? ' or this plugin can\'t work.' : ' to turn this feature on.')
          : required ? 'No installed plugin provides it, so this plugin can\'t do its job until one is installed.'
            : 'Optional: the plugin works without it; the features that use it stay hidden or greyed out.';
      deps.push({ kind: 'service', name: svc, required, status, providers: provs, detail });
    }
  }
  for (const e of r.env) deps.push({ kind: 'env', name: e.name, required: false, status: e.set ? 'set' : 'unset', detail: envDetail(e.name, r.name) });
  for (const s of r.scopes) deps.push({ kind: 'scope', name: s, required: true, status: 'granted', detail: SCOPE_NOTES[s.toUpperCase()] ?? 'Declared scope.' });
  if (r.serverPart) {
    deps.push({
      kind: 'core', name: 'console API', required: true, status: r.server === 'loaded' ? 'ok' : r.server === 'error' ? 'error' : 'not loaded',
      detail: `Its server part runs inside the console API and is mounted at /api/plugins/${r.folder}/.`,
    });
  }
  return deps;
}

/** Who needs this plugin: every other plugin requiring a capability it provides, or it by id. */
export function dependentsOf(r: PluginRecord, records: PluginRecord[]): Dependent[] {
  const mine = new Set<string>([...r.provides.map(serviceOf).filter((s): s is string => Boolean(s)), ...r.services]);
  const out: Dependent[] = [];
  for (const other of records) {
    if (other.folder === r.folder) continue;
    for (const [required, entries] of [[true, other.requires], [false, other.optional]] as const) {
      for (const e of entries) {
        const svc = serviceOf(e);
        const service = svc && mine.has(svc) ? svc : pluginOf(e) === r.id ? e : null;
        if (service && !out.some((d) => d.folder === other.folder && d.service === service)) out.push({ folder: other.folder, name: other.name, service, required, enabled: other.enabled });
      }
    }
  }
  return out;
}

export function healthOf(r: PluginRecord, deps: Dependency[]): PluginHealth {
  if (r.error || r.server === 'error') return 'error';
  if (deps.some((d) => d.required && (d.status === 'missing' || d.status === 'disabled' || d.status === 'unsupported'))) return 'blocked';
  if (!r.enabled) return 'off';
  if (deps.some((d) => d.status === 'optional-missing' || d.status === 'unset') || r.dataDirProblem) return 'partial';
  return 'ok';
}

/** Read-only clash report: duplicate ids, two providers of one capability, duplicate contributions, shared data folders, two enabled UI editors. */
export function conflictsOf(records: PluginRecord[]): Conflict[] {
  const out: Conflict[] = [];
  const add = (kind: string, key: string, folders: string[], detail: string, severity: ConflictSeverity = 'warn') =>
    out.push({ id: `${kind}:${key}`, kind, key, folders: [...new Set(folders)].sort(), detail, severity });
  const byId = new Map<string, string[]>();
  for (const r of records) byId.set(r.id, [...(byId.get(r.id) ?? []), r.folder]);
  for (const [pid, fs] of byId) if (fs.length > 1) add('plugin-id', pid, fs, 'Two plugins declare the same id; the host can\'t tell them apart.', 'error');
  const contrib = new Map<string, string[]>();
  for (const r of records) for (const p of r.provides) contrib.set(p, [...(contrib.get(p) ?? []), r.folder]);
  for (const [key, fs] of contrib) {
    if (new Set(fs).size < 2) continue;
    const svc = serviceOf(key);
    if (svc) add('service', svc, fs, 'More than one plugin provides this capability; the last one loaded wins (the host keeps one provider).');
    else add('contribution', key, fs, 'Two plugins contribute the same id; the last one installed replaces the other\'s.');
  }
  const data = new Map<string, string[]>();
  for (const r of records) if (r.dataDir) data.set(r.dataDir, [...(data.get(r.dataDir) ?? []), r.folder]);
  for (const [d, fs] of data) if (fs.length > 1) add('data-dir', d, fs, 'Two plugins share a data folder; uninstalling one would delete the other\'s data.', 'error');
  const editors = new Map<string, string[]>();
  for (const r of records) if (r.enabled) for (const kind of r.uiEditor) editors.set(kind, [...(editors.get(kind) ?? []), r.folder]);
  for (const [kind, fs] of editors) if (fs.length > 1) add('ui-editor', kind, fs, 'More than one enabled plugin edits these values. Allowed: the last save wins, and each editor reloads current values when it opens or regains focus.', 'info');
  return out;
}

export function inventoryCounts(items: PluginInventoryItem[], conflicts: Conflict[]): PluginInventory['counts'] {
  return {
    total: items.length,
    enabled: items.filter((i) => i.enabled).length,
    errors: items.filter((i) => i.error).length,
    missingDeps: items.filter((i) => i.dependencies.some((d) => d.required && (d.status === 'missing' || d.status === 'disabled'))).length,
    conflicts: conflicts.length,
    editors: items.filter((i) => i.uiEditor.length > 0).length,
  };
}

/** The whole inventory: records in the order given, resolved against each other and the live services. */
export function buildPluginInventory(records: PluginRecord[], ctx: InventoryContext): PluginInventory {
  const providers = resolveProviders(records, ctx.live);
  const conflicts = conflictsOf(records);
  const items: PluginInventoryItem[] = records.map((r) => {
    const dependencies = dependenciesOf(r, providers, records, ctx);
    return { ...r, dependencies, dependents: dependentsOf(r, records), health: healthOf(r, dependencies), conflicts: conflicts.filter((c) => c.folders.includes(r.folder)).map((c) => c.id) };
  });
  return { items, conflicts, counts: inventoryCounts(items, conflicts) };
}

/** The blocking problems of one item, for signals / badges. */
export function blockingOf(item: PluginInventoryItem): Dependency[] {
  return item.dependencies.filter((d) => d.required && (d.status === 'missing' || d.status === 'disabled' || d.status === 'unsupported'));
}

/* ---------- graph (the Dependencies view, same columns on every port) ---------- */

export interface GraphNode { id: string; kind: 'plugin' | 'service'; label: string; column: 0 | 1 | 2; row: number; folder?: string; missing?: boolean; providers: number }
export interface GraphEdge { from: string; to: string; kind: 'provides' | 'requires' | 'optional'; broken: boolean }
export interface PluginGraph { nodes: GraphNode[]; edges: GraphEdge[]; rows: number }

/** Columns: consumer-only plugins (standalone ones below them) | capabilities | providing plugins. Rows are half-steps (×2) so a port can scale them. */
export function pluginGraph(items: PluginInventoryItem[], live: LiveService[]): PluginGraph {
  const svc = new Map<string, { providers: number; consumers: number }>();
  const touch = (n: string) => svc.get(n) ?? svc.set(n, { providers: 0, consumers: 0 }).get(n)!;
  const edges: GraphEdge[] = [];
  for (const r of items) {
    for (const p of r.provides) { const n = serviceOf(p); if (n) { touch(n).providers += 1; edges.push({ from: `p:${r.folder}`, to: `s:${n}`, kind: 'provides', broken: !r.enabled }); } }
    for (const d of r.dependencies) if (d.kind === 'service') { touch(d.name).consumers += 1; edges.push({ from: `p:${r.folder}`, to: `s:${d.name}`, kind: d.required ? 'requires' : 'optional', broken: d.status !== 'ok' }); }
  }
  const providers = items.filter((r) => r.provides.some((p) => serviceOf(p)));
  const consumers = items.filter((r) => !providers.includes(r) && r.dependencies.some((d) => d.kind === 'service'));
  const alone = items.filter((r) => !providers.includes(r) && !consumers.includes(r));
  const services = [...svc.keys()].sort();
  const nodes: GraphNode[] = [
    ...[...consumers, ...alone].map((r, i): GraphNode => ({ id: `p:${r.folder}`, kind: 'plugin', label: r.name, column: 0, row: i * 2 + (i >= consumers.length && consumers.length ? 1 : 0), folder: r.folder, providers: 0 })),
    ...services.map((s, i): GraphNode => ({ id: `s:${s}`, kind: 'service', label: s, column: 1, row: i * 2, missing: (svc.get(s)?.providers ?? 0) === 0 && !live.some((x) => x.name === s), providers: svc.get(s)?.providers ?? 0 })),
    ...providers.map((r, i): GraphNode => ({ id: `p:${r.folder}`, kind: 'plugin', label: r.name, column: 2, row: i * 2, folder: r.folder, providers: 0 })),
  ];
  const rows = Math.max((consumers.length + alone.length) * 2 + (alone.length && consumers.length ? 1 : 0), services.length * 2, providers.length * 2, 2);
  return { nodes, edges, rows };
}
