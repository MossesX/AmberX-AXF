/*
 * Molly shell engine (molly-shell@1) — the pure rules of a host shell that shows several apps while they stay separate
 * apps (Molly: AmberX, axHub, the Dev Console, Expenses). Three things, no DOM:
 *
 *   1. Instances. One app may be open more than once (two Consoles side by side). An instance id is the app id for the
 *      first copy and `<app>#<n>` from the second (`console`, `console#2`); a view path hangs off it with `/`
 *      (`console#2/nav:build`). `nextInstance` hands out the smallest free number, `normalizeInstances` checks a kept list.
 *   2. Host catalog. The host hands every guest console its own screens, settings tabs, dialogs and actions as
 *      console-command@1 catalog items whose ids carry `host:` (`hostCatalog`). The guest announces them with its own,
 *      so a remote command (REST / MCP / CLI / voice) that names one resolves on the console server exactly like a
 *      console item and comes back as an embed@1 `host-run` the host carries out (`hostRunOf`). No new server, no
 *      second sign-in: the console inside the host is the one client.
 *   3. State. `shellState` is the readable snapshot of the shell (view, app, instances and which are on screen, IDE
 *      mode, the apps that joined), the same shape the API hands out.
 *
 * The Kotlin twin (a native Molly shell) is deferred (spec/PORTING.md) and replays spec/fixtures/molly-shell.json.
 */

export const MOLLY_SHELL_CONTRACT = 'molly-shell@1';
export const INSTANCE_SEP = '#';
export const VIEW_SEP = '/';
export const HOST_ITEM_PREFIX = 'host:';
export const SHELL_LIMITS = { instances: 24, perApp: 8, catalog: 400, label: 80, id: 120, detail: 160, keywords: 12, keyword: 40, args: 8, arg: 200 } as const;
export const HOST_ITEM_KINDS = ['screen', 'settings', 'dialog', 'action'] as const;
export type HostItemKind = (typeof HOST_ITEM_KINDS)[number];

const APP_ID = /^[a-z][a-z0-9-]{0,31}$/;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9:._/#-]{0,119}$/;
const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/* ---------- instances ---------- */

export interface ShellInstance { id: string; app: string; n: number }

/** The id of the n-th copy of an app: the app id itself for the first, `<app>#<n>` after. */
export const instanceId = (app: string, n = 1): string => (n <= 1 ? app : `${app}${INSTANCE_SEP}${n}`);

/** `console#2` → { app: console, n: 2 }; `console` → n 1; anything else (a view path, junk) → null. */
export function parseInstance(id: unknown): ShellInstance | null {
  if (typeof id !== 'string' || !id) return null;
  const at = id.indexOf(INSTANCE_SEP);
  const app = at < 0 ? id : id.slice(0, at);
  if (!APP_ID.test(app)) return null;
  if (at < 0) return { id: app, app, n: 1 };
  const n = Number(id.slice(at + 1));
  if (!Number.isInteger(n) || n < 2 || n > SHELL_LIMITS.perApp || String(n) !== id.slice(at + 1)) return null;
  return { id, app, n };
}

/** The instance a shell view belongs to: `console#2/nav:build` → `console#2`; `home` (no app) → null when `apps` is given and doesn't list it. */
export function instanceOfView(view: unknown, apps?: readonly string[]): ShellInstance | null {
  if (typeof view !== 'string') return null;
  const head = view.split(VIEW_SEP)[0] ?? '';
  const inst = parseInstance(head);
  if (!inst) return null;
  return apps && !apps.includes(inst.app) ? null : inst;
}

/** The page part of a shell view (`console#2/nav:build` → `nav:build`, none → ''). */
export const pageOfView = (view: string): string => { const at = view.indexOf(VIEW_SEP); return at < 0 ? '' : view.slice(at + 1); };

/** A view of the same page on another instance: `console/nav:build` on `console#2` → `console#2/nav:build`. */
export const viewOn = (instance: string, page = ''): string => (page ? `${instance}${VIEW_SEP}${page}` : instance);

/** The open instances of one app, lowest number first. */
export function instancesOf(open: readonly string[], app: string): ShellInstance[] {
  return open.map(parseInstance).filter((i): i is ShellInstance => !!i && i.app === app).sort((a, b) => a.n - b.n);
}

/** The next free instance id of an app (the first copy is the app id), or null when the per-app cap is reached. */
export function nextInstance(open: readonly string[], app: string): string | null {
  if (!APP_ID.test(app)) return null;
  const used = new Set(instancesOf(open, app).map((i) => i.n));
  for (let n = 1; n <= SHELL_LIMITS.perApp; n++) if (!used.has(n)) return instanceId(app, n);
  return null;
}

/** "Console" for the first copy, "Console 2" after. */
export const instanceTitle = (label: string, n: number): string => (n <= 1 ? label : `${label} ${n}`);

/** A kept list of open instances, checked: strings, valid ids, known apps, no duplicates, the first copy of an app before its others, capped. */
export function normalizeInstances(raw: unknown, apps: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const i = parseInstance(v);
    if (!i || !apps.includes(i.app) || seen.has(i.id)) continue;
    seen.add(i.id); out.push(i.id);
    if (out.length >= SHELL_LIMITS.instances) break;
  }
  // the first copy of an app comes before its numbered copies, and a numbered copy without it gets it added (the app is
  // open, whatever the number)
  const emitted = new Set<string>();
  const withFirst: string[] = [];
  const push = (id: string) => { if (!emitted.has(id)) { emitted.add(id); withFirst.push(id); } };
  for (const id of out) { const i = parseInstance(id)!; if (i.n > 1) push(i.app); push(id); }
  return withFirst.slice(0, SHELL_LIMITS.instances);
}

/* ---------- host catalog (console-command@1 items the host hands a guest console) ---------- */

export interface HostCatalogItem {
  kind: HostItemKind;
  /** `host:<the host's own id>` — a screen's view, a settings tab, a dialog id, an action id */
  id: string;
  label: string;
  detail?: string;
  icon?: string;
  keywords?: string[];
  /** a settings tab's parent tab (sub-tab) */
  parent?: string;
  /** an action that takes arguments */
  params?: boolean;
}

export interface HostCatalogSource {
  kind: HostItemKind;
  id: string;
  label?: string;
  detail?: string;
  icon?: string;
  keywords?: readonly string[];
  parent?: string;
  params?: boolean;
  /** a person's tap only (console-command@1 personOnly): never handed out */
  personOnly?: boolean;
}

export const isHostItem = (id: unknown): id is string => typeof id === 'string' && id.startsWith(HOST_ITEM_PREFIX) && id.length > HOST_ITEM_PREFIX.length;
/** `host:console#2` → `console#2`; an id without the prefix comes back as is. */
export const hostItemTarget = (id: string): string => (isHostItem(id) ? id.slice(HOST_ITEM_PREFIX.length) : id);

function hostItem(raw: HostCatalogSource | Record<string, unknown> | null | undefined, host: string): HostCatalogItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!(HOST_ITEM_KINDS as readonly unknown[]).includes(o.kind)) return null;
  if (o.personOnly === true) return null;
  const own = typeof o.id === 'string' ? hostItemTarget(o.id) : '';
  if (!own || !ITEM_ID.test(own)) return null;
  const label = clip(o.label, SHELL_LIMITS.label) || own;
  const out: HostCatalogItem = { kind: o.kind as HostItemKind, id: `${HOST_ITEM_PREFIX}${own}`, label };
  const detail = clip(o.detail, SHELL_LIMITS.detail);
  out.detail = detail ? `${detail} · in ${host}` : `in ${host}`;
  const icon = clip(o.icon, SHELL_LIMITS.keyword); if (icon) out.icon = icon;
  // the host's name is always a keyword ("open the console in molly"), so it takes the last place when the list is full
  const kws = Array.isArray(o.keywords) ? o.keywords.map((k) => clip(k, SHELL_LIMITS.keyword)).filter((k) => k && k !== host).slice(0, SHELL_LIMITS.keywords - 1) : [];
  out.keywords = [...kws, host];
  const parent = clip(o.parent, SHELL_LIMITS.id); if (parent && ITEM_ID.test(parent)) out.parent = parent;
  if (o.params === true) out.params = true;
  return out;
}

/** The host's items as a guest console announces them: ids under `host:`, "in <host>" in the detail, the host's name a keyword, capped, bad ones dropped. */
export function hostCatalog(host: string, items: readonly HostCatalogSource[]): HostCatalogItem[] {
  const h = clip(host, SHELL_LIMITS.keyword) || 'host';
  const seen = new Set<string>();
  const out: HostCatalogItem[] = [];
  for (const raw of items) {
    const it = hostItem(raw, h);
    if (!it || seen.has(`${it.kind}:${it.id}`)) continue;
    seen.add(`${it.kind}:${it.id}`); out.push(it);
    if (out.length >= SHELL_LIMITS.catalog) break;
  }
  return out;
}

/** What arrives in an embed@1 `host-catalog`: the same checks, from untrusted data. Null when it isn't a list. */
export function parseHostCatalog(raw: unknown, host = 'host'): HostCatalogItem[] | null {
  if (!Array.isArray(raw)) return null;
  return hostCatalog(host, raw as HostCatalogSource[]);
}

/* ---------- host run (a guest console carries a remote command up to the host) ---------- */

export interface HostRun {
  kind: HostItemKind;
  /** the host's own id (the `host:` prefix stripped) */
  target: string;
  /** an action's arguments (`spec` = target + ':' + args joined), a dialog's arg as its first entry */
  args?: string[];
  /** a short line naming who asked (shown in the host's toast) */
  by?: string;
  label?: string;
}

/** Build a host run from a resolved console-command: the item it hit and the message's spec / arg. */
export function hostRunOf(item: Pick<HostCatalogItem, 'kind' | 'id' | 'label'>, opts: { spec?: string; arg?: string; by?: string } = {}): HostRun {
  const target = hostItemTarget(item.id);
  const out: HostRun = { kind: item.kind, target };
  if (item.kind === 'action' && opts.spec) {
    const own = hostItemTarget(opts.spec);
    if (own.startsWith(`${target}:`)) { const args = own.slice(target.length + 1).split(':').filter(Boolean).slice(0, SHELL_LIMITS.args).map((a) => a.slice(0, SHELL_LIMITS.arg)); if (args.length) out.args = args; }
  } else if (opts.arg) out.args = [clip(opts.arg, SHELL_LIMITS.arg)];
  const by = clip(opts.by, SHELL_LIMITS.keyword); if (by) out.by = by;
  const label = clip(item.label, SHELL_LIMITS.label); if (label) out.label = label;
  return out;
}

/** The action spec a host dispatches for a run (`molly.new-tab:console`), or the target for the other kinds. */
export const hostRunSpec = (r: HostRun): string => (r.kind === 'action' && r.args?.length ? `${r.target}:${r.args.join(':')}` : r.target);

/** What arrives in an embed@1 `host-run`, checked. Null when it isn't one. */
export function parseHostRun(raw: unknown): HostRun | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!(HOST_ITEM_KINDS as readonly unknown[]).includes(o.kind)) return null;
  const target = typeof o.target === 'string' ? hostItemTarget(o.target) : '';
  if (!target || !ITEM_ID.test(target)) return null;
  const out: HostRun = { kind: o.kind as HostItemKind, target };
  if (Array.isArray(o.args)) { const args = o.args.filter((a): a is string => typeof a === 'string' && !!a).slice(0, SHELL_LIMITS.args).map((a) => a.slice(0, SHELL_LIMITS.arg)); if (args.length) out.args = args; }
  const by = clip(o.by, SHELL_LIMITS.keyword); if (by) out.by = by;
  const label = clip(o.label, SHELL_LIMITS.label); if (label) out.label = label;
  return out;
}

/* ---------- shell state (what the API reads) ---------- */

export interface ShellStateInstance extends ShellInstance { /** the frame is on screen now */ on: boolean; /** the page the instance is on, when it said */ page?: string }
export interface MollyShellState {
  $axf: typeof MOLLY_SHELL_CONTRACT;
  /** the shell's own view (`console#2/nav:build`, `home`, `settings`) */
  view: string;
  /** the app that view belongs to, null on the shell's own pages */
  app: string | null;
  instance: string | null;
  instances: ShellStateInstance[];
  ide: { on: boolean; preset: string; paneLimit: number };
  /** the apps that have joined (sent their chrome) */
  connected: string[];
}

export interface ShellStateInput {
  view?: unknown;
  apps: readonly string[];
  instances?: readonly string[];
  /** instance ids whose frame is on screen */
  on?: readonly string[];
  pages?: Readonly<Record<string, string>>;
  ide?: { on?: unknown; preset?: unknown; paneLimit?: unknown } | null;
  connected?: readonly string[];
}

/** The snapshot, every field checked (unknown instances dropped, the view's own instance counted as open). */
export function shellState(input: ShellStateInput): MollyShellState {
  const view = typeof input.view === 'string' && input.view ? input.view.slice(0, 200) : 'home';
  const inst = instanceOfView(view, input.apps);
  const open = normalizeInstances([...(input.instances ?? []), ...(inst ? [inst.id] : [])], input.apps);
  const on = new Set((input.on ?? []).filter((x) => typeof x === 'string'));
  const instances: ShellStateInstance[] = open.map((id) => {
    const i = parseInstance(id)!;
    const out: ShellStateInstance = { ...i, on: on.has(id) || (inst?.id === id && on.size === 0) };
    const page = clip(input.pages?.[id], SHELL_LIMITS.id); if (page) out.page = page;
    return out;
  });
  const ide = input.ide ?? {};
  const limit = typeof ide.paneLimit === 'number' && Number.isFinite(ide.paneLimit) ? Math.max(1, Math.min(64, Math.floor(ide.paneLimit))) : 6;
  return {
    $axf: MOLLY_SHELL_CONTRACT,
    view,
    app: inst?.app ?? null,
    instance: inst?.id ?? null,
    instances,
    ide: { on: ide.on === true, preset: clip(ide.preset, SHELL_LIMITS.id) || 'ide', paneLimit: limit },
    connected: [...new Set((input.connected ?? []).filter((a): a is string => typeof a === 'string' && input.apps.includes(a)))],
  };
}
