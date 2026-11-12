/**
 * Row kinds (grid-row@1, lib-datagrid, Nov 12 2026, build expandable-rows-everywhere). Brett: "expandable rows with all
 * the information, with hooks to other stuff that's related. Commands, stuff I can do with it. All the grids and logs
 * need that information."
 *
 * One declarative registry per *kind of record* (a build, a pending item, a PR, a session, a UI Review item, an expense…).
 * A screen (plugin, Molly module, app view) registers, once:
 *
 *   registerRowKind({ kind, label, owner, fields?, related?, commands?, open?, load?, title? })
 *
 * and every grid, table or log whose rows say what they are (`DataGrid rowKind="build"` or `rowRef`) gets, with no
 * code of its own:
 *   - an expandable row: every field of the record (secrets redacted) plus the detail the screen supplies;
 *   - a Related section: links to what the record references (builds, branches, PRs, reports, session logs, plans, chat
 *     messages, UI Review items, accounts, employees…), from the kind's `related()` plus the fields every record shares
 *     (`autoRelated`), each opening in place (an inline card of the referenced record) or on its own screen (`open`);
 *   - row commands: buttons on the row (`button: true`), every command in its right-click / long-press menu and in the
 *     expanded row's command toolbar; multi-select aware (`multi: true` runs on every selected row of that grid);
 *   - the same commands on API / CLI / voice: each is a console action `row.<kind>.<command>:<id>[,<id>…]`, so control@1
 *     `control_act console.actions row.<kind>.<command> {args:[ids]}` (REST `/api/control`, MCP, `axf control`, voice
 *     through console commands) runs it in the open console; `control` documents the server-side control@1 form when
 *     one exists (e.g. `planner.builds <id> act hold`).
 *
 * Pure store, no React (rowdetail.tsx draws it), so it ports: the Compose twin is a deferred gap (library.json
 * placeholder `axf.datagrid.rowkinds.android`, framework/spec/PORTING.md).
 */
import { normRef, type RowRef } from './datasets';

export interface RowField { id: string; label: string; value: unknown }
export interface RelatedLink {
  kind: string;
  id: string;
  label?: string;
  icon?: string;
  /** a short reason it is related ("built on", "reviewed in") */
  note?: string;
}
export interface RowCommandContext {
  ids: string[];
  /** the records behind the ids as grids last drew them (or loaded them); may be shorter than ids when called remotely */
  records: unknown[];
  kind: string;
  dataset?: string;
}
export interface RowCommand {
  id: string;
  label: string;
  icon?: string;
  /** may run on several rows at once (the grid's selection, or `a,b,c` from a remote caller) */
  multi?: boolean;
  /** drawn as a button on the row (default: only in the menu and the expanded row's toolbar) */
  button?: boolean;
  /** offered only when this holds for the record (a record not on screen is unknown: the command is offered) */
  when?: (record: unknown, ref: RowRef) => boolean;
  /** what running it does (control@1 console domain); destructive asks first when `confirm` is set */
  effect?: 'navigate' | 'read' | 'write' | 'destructive';
  confirm?: string;
  /** the server-side control@1 / CLI form, shown in the expanded row (`{id}` = the row id) */
  control?: string;
  order?: number;
  run: (ctx: RowCommandContext) => void | Promise<unknown>;
}
export interface RowKind {
  kind: string;
  label: string;
  icon?: string;
  owner: string;
  /** other ref kinds that are the same record (e.g. `orchestrator` rows are builds) */
  aliases?: string[];
  /** the record's fields for the expanded row (default: every field of the record, `recordFields`) */
  fields?: (record: unknown) => RowField[];
  /** what the record links to (merged with `autoRelated(record)`) */
  related?: (record: unknown, ref: RowRef) => RelatedLink[];
  commands?: RowCommand[];
  /** a one-line name for a record (related cards, menus) */
  title?: (record: unknown) => string;
  /** open the record on its own screen (navigate) */
  open?: (id: string) => void;
  /** fetch a record that isn't on screen (related cards open in place) */
  load?: (id: string) => Promise<unknown>;
}

type Listener = () => void;
const kinds = new Map<string, RowKind>();
const alias = new Map<string, string>();
const listeners = new Set<Listener>();
let rev = 0;
const emit = () => { rev++; for (const l of [...listeners]) l(); };
export const subscribeRowKinds = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const rowKindsRevision = () => rev;

/** Register (or replace) a kind; returns the unregister. */
export function registerRowKind(k: RowKind): () => void {
  kinds.set(k.kind, k);
  for (const a of k.aliases ?? []) alias.set(a, k.kind);
  emit();
  return () => {
    if (kinds.get(k.kind) !== k) return;
    kinds.delete(k.kind);
    for (const a of k.aliases ?? []) if (alias.get(a) === k.kind) alias.delete(a);
    emit();
  };
}
/** Add commands / related resolvers to a kind another module owns (merged; the owner's own come first). */
const extras = new Map<string, { owner: string; commands?: RowCommand[]; related?: RowKind['related'] }[]>();
export function extendRowKind(kind: string, ext: { owner: string; commands?: RowCommand[]; related?: RowKind['related'] }): () => void {
  const list = extras.get(kind) ?? [];
  list.push(ext); extras.set(kind, list); emit();
  return () => { const l = extras.get(kind); const i = l?.indexOf(ext) ?? -1; if (l && i >= 0) { l.splice(i, 1); emit(); } };
}
export function clearOwnerRowKinds(owner: string) {
  let hit = false;
  for (const [id, k] of kinds) if (k.owner === owner) { kinds.delete(id); hit = true; }
  for (const [kind, l] of extras) { const n = l.filter((e) => e.owner !== owner); if (n.length !== l.length) { extras.set(kind, n); hit = true; } }
  if (hit) emit();
}
/**
 * The registered kind for a ref kind (aliases followed), or undefined. A kind nobody registered but someone extended
 * (`extendRowKind`) is still a kind: its label is its name and its commands are the extensions'.
 */
export const rowKind = (kind: string | undefined): RowKind | undefined => {
  if (!kind) return undefined;
  const k = kinds.get(kind) ?? kinds.get(alias.get(kind) ?? '');
  if (k) return k;
  const ex = extras.get(kind);
  return ex?.length ? { kind, label: kind.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()), owner: ex[0]!.owner } : undefined;
};
export const listRowKinds = (): RowKind[] => [...kinds.values()];
const canonical = (kind: string) => rowKind(kind)?.kind ?? kind;

// ---------------------------------------------------------------- records the grids drew (for commands and related cards)
const records = new Map<string, unknown>();
const MAX_RECORDS = 5000;
/** DataGrid notes each row's record with its ref, so a command run from a menu, a remote call or a related card finds it. */
export function noteRecord(ref: RowRef, record: unknown) {
  const key = `${canonical(ref.kind)}\u0000${ref.id}`;
  if (records.get(key) === record) return;
  records.delete(key); records.set(key, record);
  if (records.size > MAX_RECORDS) records.delete(records.keys().next().value as string);
}
export const recordFor = (kind: string, id: string): unknown => records.get(`${canonical(kind)}\u0000${id}`);

// ---------------------------------------------------------------- selection (multi-select aware commands)
const selections = new Map<string, { kind: string; ids: string[] }>();
/** A grid's current multi-selection (dataset id → ids of one kind). Empty clears it. */
export function setGridSelection(dataset: string, kind: string, ids: readonly string[]) {
  const cur = selections.get(dataset);
  if (!ids.length) { if (cur) { selections.delete(dataset); emit(); } return; }
  if (cur && cur.kind === kind && cur.ids.length === ids.length && cur.ids.every((x, i) => x === ids[i])) return;
  selections.set(dataset, { kind, ids: [...ids] }); emit();
}
export const gridSelection = (dataset: string | undefined) => (dataset ? selections.get(dataset)?.ids ?? [] : []);
/** The ids a command on `ref` applies to: the grid's selection when the row is part of it, else the row alone. */
export function targetIds(ref: RowRef, dataset?: string): string[] {
  const sel = gridSelection(dataset);
  return sel.length > 1 && sel.includes(ref.id) ? sel : [ref.id];
}

// ---------------------------------------------------------------- fields
const SECRET = /(pass(word)?|secret|token|api[-_]?key|apikey|authorization|cookie|private[-_]?key|credential|bearer)/i;
/** Counts and states that only look like secrets (`tokensUsed`, `maxTokens`, `passes`); a bare `token` is a secret. */
const SAFE_SECRET_WORDS = /^(tokens|tokensTotal|tokens?(Used|In|Out|Count|Total)|tokens?_(count|total|used|in|out)|(max|input|output|cache)Tokens|passes|passed|passing)$/i;
/** True when a field name looks like it holds a secret (its value is never drawn). */
export const isSecretField = (key: string) => SECRET.test(key) && !SAFE_SECRET_WORDS.test(key);
const label = (key: string) => key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const MAX_TEXT = 400;

/** One field's value as text (secrets redacted, objects compact JSON, long text cut). */
export function fieldText(key: string, v: unknown): string {
  if (isSecretField(key) && v != null && v !== '' && typeof v !== 'boolean' && typeof v !== 'number') return '••• hidden';
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v) && v.every((x) => x == null || typeof x !== 'object')) { const s = v.join(', '); return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s || '—'; }
  try {
    const s = JSON.stringify(v, (k, x) => (k && isSecretField(k) && x != null && typeof x !== 'object' ? '••• hidden' : x));
    return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
  } catch { return String(v); }
}
/** Every field of a record (own keys, functions skipped), labelled from its key. */
export function recordFields(record: unknown): RowField[] {
  if (record == null || typeof record !== 'object') return record == null ? [] : [{ id: 'value', label: 'Value', value: record }];
  return Object.entries(record as Record<string, unknown>).filter(([, v]) => typeof v !== 'function' && v !== undefined).map(([k, v]) => ({ id: k, label: label(k), value: v }));
}
export function fieldsFor(ref: RowRef | null, record: unknown): RowField[] {
  const k = rowKind(ref?.kind);
  try { return k?.fields ? k.fields(record) : recordFields(record); } catch { return recordFields(record); }
}

// ---------------------------------------------------------------- related links
/**
 * Fields most records share, read as links: `build`/`buildId`, `branch`, `pr`/`prNumber`/`prUrl`, `session`/`sessionId`,
 * `plan`/`planId`, `account`, `employee`/`agentId`, `review`/`reviewId`, `chatMessage`/`messageId`, `report`, `log`,
 * `approval`/`approvalId`, `step` (only with a build), and GitHub pull-request URLs in any string field.
 */
const AUTO: [RegExp, string][] = [
  [/^(build|buildId|build_id|builds|buildIds)$/, 'build'],
  [/^(branch|branches|headBranch|head_branch)$/, 'branch'],
  [/^(pr|prNumber|pr_number|prs|pull|pullRequest)$/, 'pr'],
  [/^(session|sessionId|session_id|sessions)$/, 'session'],
  [/^(plan|planId|plan_id)$/, 'plan'],
  [/^(account|accountId|account_id|accounts)$/, 'account'],
  [/^(employee|employeeId|employee_id|agentId|agent_id)$/, 'employee'],
  [/^(review|reviewId|review_id|reviewItem)$/, 'review'],
  [/^(chatMessage|messageId|message_id|chatId)$/, 'chat-message'],
  [/^(report|reportPath|report_path)$/, 'report'],
  [/^(log|logPath|log_path|sessionLog)$/, 'session-log'],
  [/^(approval|approvalId|approval_id)$/, 'approval'],
  [/^(change|changeId|change_id)$/, 'change'],
  [/^(expense|expenseId)$/, 'expense'],
];
const PR_URL = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/;
const idOf = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; const x = o.id ?? o.number ?? o.name; return typeof x === 'string' || typeof x === 'number' ? String(x) : null; }
  return null;
};
export function autoRelated(record: unknown): RelatedLink[] {
  if (!record || typeof record !== 'object') return [];
  const out: RelatedLink[] = [];
  for (const [key, v] of Object.entries(record as Record<string, unknown>)) {
    if (isSecretField(key)) continue;
    const hit = AUTO.find(([re]) => re.test(key));
    if (hit) {
      for (const x of Array.isArray(v) ? v.slice(0, 20) : [v]) {
        const id = idOf(x);
        if (id && !(hit[1] === 'pr' && !/^\d+$/.test(id.replace(/^#/, '')) && !PR_URL.test(id))) out.push({ kind: hit[1], id: hit[1] === 'pr' ? (PR_URL.exec(id)?.[1] ?? id.replace(/^#/, '')) : id, note: label(key) });
      }
      continue;
    }
    if (typeof v === 'string') { const m = PR_URL.exec(v); if (m) out.push({ kind: 'pr', id: m[1]!, note: label(key) }); }
  }
  return out;
}
/** The record's related links: the kind's own, then the shared fields; deduplicated, never the record itself. */
export function relatedFor(ref: RowRef | null, record: unknown): RelatedLink[] {
  const k = rowKind(ref?.kind);
  const own: RelatedLink[] = [];
  try { if (k?.related && ref) own.push(...k.related(record, ref)); } catch { /* a resolver that throws adds nothing */ }
  for (const e of extras.get(k?.kind ?? ref?.kind ?? '') ?? []) { try { if (e.related && ref) own.push(...e.related(record, ref)); } catch { /* ditto */ } }
  const seen = new Set<string>(ref ? [`${canonical(ref.kind)}:${ref.id}`] : []);
  const out: RelatedLink[] = [];
  for (const l of [...own, ...autoRelated(record)]) {
    const r = normRef(l); if (!r) continue;
    const key = `${canonical(r.kind)}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ ...l, ...r });
  }
  return out;
}
export const relatedLabel = (l: RelatedLink) => {
  if (l.label) return l.label;
  const k = rowKind(l.kind); const rec = recordFor(l.kind, l.id);
  const t = rec != null && k?.title ? (() => { try { return k.title!(rec); } catch { return ''; } })() : '';
  return t || (l.kind === 'pr' ? `PR #${l.id}` : l.id);
};

// ---------------------------------------------------------------- commands
export function commandsFor(ref: RowRef | null, record: unknown, opts: { buttons?: boolean; multi?: boolean } = {}): RowCommand[] {
  const k = rowKind(ref?.kind);
  if (!ref || !k) return [];
  const all = [...(k.commands ?? []), ...(extras.get(k.kind) ?? []).flatMap((e) => e.commands ?? [])];
  return all
    .filter((c) => !opts.buttons || c.button)
    .filter((c) => !opts.multi || c.multi)
    .filter((c) => { if (!c.when || record === undefined) return true; try { return c.when(record, ref); } catch { return false; } })
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}
/** Every command of every kind (for action registration and docs). */
export function allRowCommands(): { kind: RowKind; command: RowCommand }[] {
  const orphans = [...extras.keys()].filter((k) => !kinds.has(k) && !alias.has(k)).map((k) => rowKind(k)!).filter(Boolean);
  return [...kinds.values(), ...orphans].flatMap((k) => [...(k.commands ?? []), ...(extras.get(k.kind) ?? []).flatMap((e) => e.commands ?? [])].map((command) => ({ kind: k, command })));
}
/** The console action that runs a command (control@1 `console.actions`): `row.<kind>.<command>`. */
export const rowCommandAction = (kind: string, command: string) => `row.${canonical(kind)}.${command}`;
/** Find a command by kind + id. */
export function findRowCommand(kind: string, command: string): RowCommand | undefined {
  const k = rowKind(kind); if (!k) return undefined;
  return [...(k.commands ?? []), ...(extras.get(k.kind) ?? []).flatMap((e) => e.commands ?? [])].find((c) => c.id === command);
}
/**
 * Run a command on ids (one or many). Destructive commands with `confirm` ask first (`ask` returns false to stop).
 * Records come from what the grids drew; a command offered only `when` its record allows is skipped for records that don't.
 */
export async function runRowCommand(kind: string, command: string, ids: string[], opts: { dataset?: string; ask?: (q: string) => boolean } = {}): Promise<{ ok: boolean; ran: string[]; skipped: string[]; error?: string }> {
  const c = findRowCommand(kind, command);
  const k = rowKind(kind);
  if (!c || !k) return { ok: false, ran: [], skipped: ids, error: `No command "${command}" for ${kind} rows.` };
  const list = (c.multi ? ids : ids.slice(0, 1)).filter(Boolean);
  const ran: string[] = []; const skipped: string[] = []; const recs: unknown[] = [];
  for (const id of list) {
    const rec = recordFor(kind, id);
    let ok = true;
    if (c.when && rec !== undefined) { try { ok = c.when(rec, { kind: k.kind, id }); } catch { ok = false; } }
    if (ok) { ran.push(id); if (rec !== undefined) recs.push(rec); } else skipped.push(id);
  }
  if (!ran.length) return { ok: false, ran, skipped, error: `${c.label} doesn't apply to ${skipped.join(', ') || 'nothing'}.` };
  if (c.confirm && opts.ask && !opts.ask(ran.length > 1 ? `${c.confirm} (${ran.length} rows)` : c.confirm)) return { ok: false, ran: [], skipped: ids, error: 'Cancelled.' };
  try {
    await c.run({ ids: ran, records: recs, kind: k.kind, dataset: opts.dataset });
    if (c.effect !== 'navigate' && c.effect !== 'read') rowsChanged(k.kind);
    return { ok: true, ran, skipped };
  }
  catch (e) { return { ok: false, ran, skipped, error: e instanceof Error ? e.message : String(e) }; }
}
/** Parse the ids of a `row.<kind>.<command>:<ids>` action (comma separated, each URI-encoded). */
export function parseRowIds(args: string[]): string[] {
  const d = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
  return args.join(':').split(',').map((x) => d(x.trim())).filter(Boolean);
}
export const encodeRowIds = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(',');

// ---------------------------------------------------------------- rows changed (screens reload after a command)
const changed = new Map<string, Set<() => void>>();
/** Say rows of a kind changed (a command ran, or a screen saved): screens showing them reload. */
export function rowsChanged(kind: string) { for (const fn of [...(changed.get(canonical(kind)) ?? [])]) { try { fn(); } catch { /* a listener's failure stays its own */ } } }
/** Reload when rows of a kind change; returns the unsubscribe. */
export function onRowsChanged(kind: string, fn: () => void): () => void {
  const k = canonical(kind); const set = changed.get(k) ?? new Set(); set.add(fn); changed.set(k, set);
  return () => { set.delete(fn); };
}

/**
 * A command that runs an existing console action per row (`action(id, record)` → the action spec), so a kind's commands
 * reuse what its plugin already registered: `actionCommand(spec => rt.dispatch(spec), { id, label, action })`.
 */
export function actionCommand(dispatch: (spec: string) => unknown, c: Omit<RowCommand, 'run'> & { action: (id: string, record: unknown) => string }): RowCommand {
  const { action, ...rest } = c;
  return { ...rest, run: ({ ids, kind }) => { for (const id of ids) dispatch(action(id, recordFor(kind, id))); } };
}

// ---------------------------------------------------------------- the app's runtime, for kinds registered at module level
/** What a module-level kind needs from the app (navigate, run an action, toast); set by lib-datagrid when it registers. */
export interface RowRuntime { navigate(view: string): void; dispatch(spec: string): unknown; toast(message: string, kind?: 'info' | 'success' | 'warning' | 'danger', title?: string): void }
let runtimeRef: RowRuntime | null = null;
export function setRowRuntime(rt: RowRuntime | null) { runtimeRef = rt; }
/** The app's runtime once lib-datagrid registered (null before, e.g. in tests). */
export const rowRuntime = (): RowRuntime | null => runtimeRef;
