/*
 * API Browser — pure helpers (no React, no DOM): filtering, the tree, sample bodies from input schemas, and the
 * request "Try it" sends for an entry. test.mts covers them.
 */

export type Policy = 'instant' | 'veto' | 'confirm' | 'approve' | 'person';
export type Group = 'control' | 'plugins' | 'mcp' | 'rest' | 'cli';
export interface Schema { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; enum?: unknown[]; const?: unknown; description?: string; default?: unknown; items?: Schema; anyOf?: Schema[] }
export interface UiRef { kind: string; label: string; where: string; file: string; path: string }
export interface Entry {
  id: string; group: Group; area: string; title: string; doc: string; effect: string; policy: Policy; permission?: string;
  target?: string; op?: string; verb?: string; plugin?: string; command?: string; runs?: string; skipped?: boolean; local?: boolean;
  input: Schema; output?: string; rest: { method: string; path: string; body?: Record<string, unknown> } | null; mcp: string[]; cli: string; docs?: string;
  uiCount?: number; ui?: UiRef[];
}
export interface CoverageRow { kind: string; id: string; label: string; where: string; file: string; api: string; status: 'covered' | 'generic' | 'person-only' | 'skipped' | 'gap'; note?: string; fix?: string; count?: number; mcp?: string; cli?: string }
export interface Summary { entries: number; byGroup: Record<string, number>; byPolicy: Record<string, number>; mcpTools: number; uiElements: number; uiGaps: number }

export const GROUP_LABEL: Record<Group, string> = { control: 'control@1', plugins: 'Plugin commands', mcp: 'MCP tools', rest: 'REST routes', cli: 'CLI' };
export const POLICY_LABEL: Record<Policy, string> = { instant: 'Instant', veto: 'Veto (90 s)', confirm: 'Confirm', approve: 'Approval', person: "Brett's tap" };
export const POLICY_HINT: Record<Policy, string> = {
  instant: 'Reads and navigation run at once, from any caller.',
  veto: 'A remote caller waits out axHub\'s 90 s veto unless a pass covers it; your own click here runs it.',
  confirm: 'Deletes or resets: the first try answers with a confirm token, the second (with it) runs.',
  approve: 'Needs Brett\'s approval on axHub, never a veto countdown.',
  person: 'Only Brett\'s own tap decides it: the API brings it up, he decides.',
};
export const STATUS_LABEL: Record<CoverageRow['status'], string> = { covered: 'Named API path', generic: 'On screen (console.elements)', 'person-only': "Brett's tap", skipped: 'Skipped (reason given)', gap: 'Gap: no API path' };

const fold = (s: unknown) => String(s ?? '').toLowerCase();

/** Entries matching every word (id, title, doc, names) and the filters. */
export function filterEntries(entries: readonly Entry[], q: string, f: { group?: string; policy?: string } = {}): Entry[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return entries.filter((e) => (!f.group || e.group === f.group) && (!f.policy || e.policy === f.policy)
    && words.every((w) => fold(`${e.id} ${e.title} ${e.doc} ${e.mcp.join(' ')} ${e.cli} ${e.rest?.path ?? ''} ${e.area}`).includes(w)));
}

/** Coverage rows matching every word and the status filter. */
export function filterCoverage(rows: readonly CoverageRow[], q: string, status = ''): CoverageRow[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return rows.filter((r) => (!status || r.status === status) && words.every((w) => fold(`${r.kind} ${r.id} ${r.label} ${r.where} ${r.api}`).includes(w)));
}

/** Where an entry sits in the tree: app › area (plugin, control domain, MCP area) › group. */
export function treeOf(entries: readonly Entry[]): { id: string; label: string; areas: { id: string; label: string; groups: { id: string; label: string; entries: Entry[] }[] }[] }[] {
  const areas = new Map<string, Map<string, Entry[]>>();
  for (const e of entries) {
    const area = e.group === 'plugins' ? `plugin:${e.plugin ?? e.area}` : e.group === 'control' ? `control:${e.area}` : `${e.group}:${e.area}`;
    const g = e.group === 'control' ? e.target ?? 'control' : GROUP_LABEL[e.group];
    const m = areas.get(area) ?? new Map<string, Entry[]>();
    m.set(g, [...(m.get(g) ?? []), e]);
    areas.set(area, m);
  }
  const label = (a: string): string => { const [k = '', v = ''] = a.split(':'); return k === 'plugin' ? v : k === 'control' ? `control@1 · ${v}` : `${GROUP_LABEL[k as Group] ?? k} · ${v}`; };
  return [{
    id: 'app:console-web', label: 'Dev Console',
    areas: [...areas.entries()].sort((a, b) => label(a[0]).localeCompare(label(b[0]))).map(([id, m]) => ({ id, label: label(id), groups: [...m.entries()].map(([gid, list]) => ({ id: `${id}/${gid}`, label: gid, entries: list })) })),
  }];
}

/** A sample value for a schema: its const / default / first enum value, an empty one of its type otherwise. */
export function sampleOf(s: Schema | undefined, depth = 0): unknown {
  if (!s || depth > 3) return '';
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === 'object' || s.properties) return Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => (s.required ?? []).includes(k) || depth === 0).map(([k, v]) => [k, sampleOf(v, depth + 1)]));
  if (t === 'array') return [];
  if (t === 'number' || t === 'integer') return 0;
  if (t === 'boolean') return false;
  return '';
}

/** The body Try it starts from: the entry's own (control@1 command, plugin input, REST body), filled from its schema. */
export function sampleBody(e: Entry): Record<string, unknown> {
  if (e.group === 'control') {
    const s = sampleOf(e.input) as Record<string, unknown>;
    delete s.reason; delete s.by; delete s.confirm;
    return { ...s, ...(e.rest?.body ?? {}) };
  }
  if (e.group === 'plugins') return (sampleOf(e.input) as Record<string, unknown>) ?? {};
  if (e.group === 'rest') return {};
  return (sampleOf(e.input) as Record<string, unknown>) ?? {};
}

export interface TryRequest { method: string; url: string; body?: unknown; note?: string }

/**
 * The request Try it sends for an entry and a body: control@1 and plugin commands go to POST /api/control as one
 * whole command (the same path every remote caller takes), REST entries to their own path. null = it can't run from
 * here (MCP-only tools, CLI commands, Brett-only paths), with the reason in `why`.
 */
export function tryRequest(e: Entry, body: Record<string, unknown>, confirm = ''): TryRequest | { why: string } {
  if (e.policy === 'person' || e.skipped) return { why: e.policy === 'person' ? "Only Brett's own tap decides this: open it in the console and tap it there." : `Not callable: ${e.doc || 'skipped by its plugin'}` };
  if (e.group === 'control') return { method: 'POST', url: '/api/control', body: { $axf: 'control@1', ...body, ...(confirm ? { confirm } : {}), by: 'api-browser' } };
  if (e.group === 'plugins') {
    const read = e.effect === 'read';
    const { input, ...rest } = body as { input?: unknown };
    return { method: 'POST', url: '/api/control', body: { $axf: 'control@1', op: 'act', target: read ? 'plugins.reads' : 'plugins.commands', path: `${e.plugin}/${e.command}`, action: read ? 'read' : 'run', input: input ?? rest, ...(confirm ? { confirm } : {}), by: 'api-browser' } };
  }
  if (e.group === 'rest' && e.rest) {
    if (/[{}]/.test(e.rest.path)) {
      let url = e.rest.path;
      for (const [k, v] of Object.entries(body)) url = url.replace(`{${k}}`, encodeURIComponent(String(v)));
      if (/[{}]/.test(url)) return { why: `fill the path parameters (${url.match(/\{[^}]+\}/g)?.join(', ')}) in the body` };
      return { method: e.rest.method, url, ...(e.rest.method === 'GET' ? {} : { body }) };
    }
    if (e.rest.method === 'GET') { const qs = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString(); return { method: 'GET', url: qs ? `${e.rest.path}?${qs}` : e.rest.path }; }
    return { method: e.rest.method, url: e.rest.path, body };
  }
  if (e.group === 'mcp') return { why: 'An MCP tool: call it from a Claude session (the console MCP, or axHub). Its control@1 or REST twin can run here.' };
  return { why: `A CLI command: run \`${e.cli}\` in a terminal (the Terminal plugin can open one).` };
}

/** Does running it need a yes first (a write from here)? reads and navigation never do. */
export const needsYes = (e: Entry) => e.policy !== 'instant';

/** Counts per status, for the Coverage view's summary row. */
export function coverageCounts(rows: readonly CoverageRow[]): Record<CoverageRow['status'], number> {
  const out = { covered: 0, generic: 0, 'person-only': 0, skipped: 0, gap: 0 } as Record<CoverageRow['status'], number>;
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}
