/*
 * Headless tabs — the pure parts (no React, no network), shared by the terminal's web files and its self-test
 * (framework/spec/check-headless-tabs.mts): tab tmux names, the live meter's display helpers, which headless sessions
 * get a tab, and the context chain's reveal pacing.
 */

/** The bits of a tab's Open these helpers read. */
export interface OpenLike { kind: string; attach?: string; via?: string }
export interface Headless { name: string; createdAt: number; agent?: string; model?: string; kind?: string; attached?: number }
const HEADLESS_NAME = /^axf-[A-Za-z0-9._-]{1,64}$/;

/** Tabs that can live in a tmux session: shells and Claude Code on the VPS or in the console (not container TTYs). */
export const persistable = (o: OpenLike) => !o.attach && (o.kind === 'console' || o.kind === 'vps' || (o.kind === 'claude' && (o.via ?? 'console') !== 'container'));
/** A fresh tmux name for a tab: axt-<what>-<random>. Pure apart from the random part. */
export function tmuxName(o: OpenLike, rand = Math.random().toString(36).slice(2, 8)): string {
  const what = o.kind === 'claude' ? `claude-${o.via ?? 'console'}` : o.kind;
  return `axt-${what}-${rand}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
}

/** The sessions to open: running, not shown by any live tab, not closed by Brett. Oldest first. Pure. */
export function toOpen(items: Headless[], shown: Set<string>, closedSet: Set<string>): Headless[] {
  return items.filter((h) => HEADLESS_NAME.test(h.name) && !shown.has(h.name) && !closedSet.has(h.name)).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 'When a new session starts' (terminal-no-focus, Nov 4 2026, Brett: "I don't want the terminal to come to the front on
 * every session."): nothing = no tab by itself; quiet (default) = a background tab in an open terminal window, never a
 * new window, never a tab switch, plus a count on the Terminal toolbar icon; front = open it and raise the window.
 */
export type NewSessionMode = 'nothing' | 'quiet' | 'front';
export const NEW_SESSION_MODES: NewSessionMode[] = ['nothing', 'quiet', 'front'];
/** The toolbar badge (runtime counter) the Terminal icon shows: new headless sessions Brett hasn't looked at. */
export const NEW_SESSIONS_BADGE = 'terminal.sessions.new';
export const newSessionMode = (v: unknown): NewSessionMode => (NEW_SESSION_MODES.includes(v as NewSessionMode) ? (v as NewSessionMode) : 'quiet');

/**
 * What the watcher does with the sessions toOpen() picked. Pure.
 *  open  — add a tab now (`raise` = bring the window to the front and switch to it)
 *  wait  — quiet with no terminal window open: no window pops; they count on the badge and get a background tab once
 *          Brett opens the Terminal himself
 */
export function planNew(mode: NewSessionMode, fresh: Headless[], hasWindow: boolean): { open: Headless[]; wait: Headless[]; raise: boolean } {
  if (mode === 'nothing') return { open: [], wait: [], raise: false };
  if (mode === 'front') return { open: fresh, wait: [], raise: true };
  return hasWindow ? { open: fresh, wait: [], raise: false } : { open: [], wait: fresh, raise: false };
}

export type MeterStatus = 'starting' | 'working' | 'waiting' | 'done' | 'failed';
export interface Meter {
  session: string; name: string; agent: string; model: string; modelKey: string; status: MeterStatus; toolRunning: boolean; ended: boolean;
  costUsd: number; costEstimated: boolean; priced: boolean; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  turns: number; tools: number; runs: number; lastEventAt: string; startedAt: string; chainCount: number; chainVersion: number;
}

const WAIT_AFTER_MS = 60_000;
/** working → waiting when nothing came for a minute and no tool is running (Claude Code is quiet). Pure. */
export function statusOf(m: Pick<Meter, 'status' | 'toolRunning' | 'lastEventAt'> | null | undefined, now = Date.now()): MeterStatus | null {
  if (!m) return null;
  if (m.status === 'working' && !m.toolRunning && now - Date.parse(m.lastEventAt) > WAIT_AFTER_MS) return 'waiting';
  return m.status;
}
/** 'claude-opus-5-5' → 'Opus 5.5', 'opus' → 'Opus', '' → ''. Pure. */
export function modelName(id: string): string {
  const m = /(fable|opus|sonnet|haiku)[-_ ]?(\d+)?(?:[-_.](\d+))?/i.exec(id || '');
  if (!m) return id || '';
  const fam = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
  return m[2] ? `${fam} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : fam;
}
/** $0.00 under $10, $12.3 under $100, $123 above. Pure. */
export function money(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return v < 10 ? `$${v.toFixed(2)}` : v < 100 ? `$${v.toFixed(1)}` : `$${Math.round(v)}`;
}


export interface ChainRule { kind: 'heading' | 'item'; level: number; text: string }
/** Why a file is in the chain (claude-meter.mjs): Claude Code loaded it, an @import, a mention the session followed, … */
export type ChainReason = 'session-start' | 'import' | 'reference' | 'session-start rule' | 'read' | 'nested memory';
export interface ChainItem { i: number; path: string; rel: string; via: string; reason?: ChainReason | string; depth: number; parent: string; parentI?: number; why?: string; at: string; rules: ChainRule[] }
/** A chain item with the items it pulled in. */
export interface ChainNode extends ChainItem { children: ChainNode[] }
export type Speed = 'slow' | 'normal' | 'fast' | 'instant';

/** Characters per second and the pause after each rule, per speed. */
export const PACE: Record<Speed, { cps: number; pauseMs: number }> = {
  slow: { cps: 18, pauseMs: 900 }, normal: { cps: 45, pauseMs: 450 }, fast: { cps: 140, pauseMs: 120 }, instant: { cps: Infinity, pauseMs: 0 },
};

/** The reveal order: each file (rule -1 = its header), then each of its rules. Pure. */
export function steps(items: ChainItem[]): { item: number; rule: number; len: number }[] {
  const out: { item: number; rule: number; len: number }[] = [];
  items.forEach((it, k) => { out.push({ item: k, rule: -1, len: 0 }); it.rules.forEach((r, j) => out.push({ item: k, rule: j, len: r.text.length })); });
  return out;
}

/** Advance a reveal cursor by `ms` of time. Returns the new {step, chars, wait}. Pure, so the pacing is testable. */
export function advance(cur: { step: number; chars: number; wait: number }, seq: { len: number; rule: number }[], ms: number, speed: Speed): { step: number; chars: number; wait: number } {
  const pace = PACE[speed];
  let { step, chars, wait } = cur;
  let left = ms;
  while (left > 0 && step < seq.length) {
    if (wait > 0) { const w = Math.min(wait, left); wait -= w; left -= w; if (wait > 0) break; step++; chars = 0; continue; }
    const s = seq[step]!;
    if (s.rule === -1) { wait = pace.pauseMs; if (!wait) { step++; chars = 0; } continue; }
    if (!Number.isFinite(pace.cps)) { chars = s.len; } else { const n = Math.floor((left * pace.cps) / 1000); if (n <= 0) break; const take = Math.min(n, s.len - chars); chars += take; left -= (take * 1000) / pace.cps; }
    if (chars >= s.len) { wait = pace.pauseMs; if (!wait) { step++; chars = 0; } }
  }
  return { step, chars, wait };
}


/**
 * The chain as a tree (terminal-drag-chain-tree, Nov 3 2026, Brett: "every file that is chained, it needs to open
 * indented"): each item under the item that pulled it in. The parent is `parentI` when it names an earlier item, else
 * the earlier item whose `rel` is `parent`, else (older chain files that only kept `depth`) the nearest earlier item one
 * level up; anything else is a root. Children keep load order. Same rules as the server's `tree` (console-terminal
 * sessions.chain_tree). Pure.
 */
export function chainTree(items: readonly ChainItem[]): ChainNode[] {
  const nodes = items.map((it) => ({ ...it, children: [] as ChainNode[] }));
  const roots: ChainNode[] = [];
  const byRel = new Map<string, number>();
  nodes.forEach((n, k) => {
    let up = -1;
    if (typeof n.parentI === 'number' && n.parentI >= 0 && n.parentI < k) up = n.parentI;
    else if (n.parent && byRel.has(n.parent)) up = byRel.get(n.parent)!;
    else if (n.depth > 0) for (let j = k - 1; j >= 0; j--) if (nodes[j]!.depth === n.depth - 1) { up = j; break; }
    (up >= 0 ? nodes[up]!.children : roots).push(n);
    if (!byRel.has(n.rel)) byRel.set(n.rel, k);
  });
  return roots;
}

/** Item positions (`i` = index in `items`) depth-first, skipping the children of collapsed nodes (`collapsed` holds `i`). Pure. */
export function treeOrder(tree: readonly ChainNode[], collapsed: ReadonlySet<number> = new Set()): number[] {
  const out: number[] = [];
  const walk = (ns: readonly ChainNode[]) => { for (const n of ns) { out.push(n.i); if (!collapsed.has(n.i)) walk(n.children); } };
  walk(tree);
  return out;
}

/**
 * Tree reveal: files appear depth-first, each typing out its rules at the chosen speed. `done` = item positions fully
 * shown; `cur` = the file being revealed (rule -1 = its header pause). A file the session takes in later that lands
 * earlier in the tree is simply next. Picking a file replays it (`replay`). Pure, so the pacing is testable.
 */
export interface Reveal { done: number[]; cur: { item: number; step: number; chars: number; wait: number } | null }
export const REVEAL0: Reveal = { done: [], cur: null };
export function revealTick(r: Reveal, items: readonly ChainItem[], order: readonly number[], ms: number, speed: Speed): Reveal {
  let done = r.done; let cur = r.cur; let left = ms;
  for (let guard = 0; guard < items.length + 1; guard++) {
    if (!cur) { const next = order.find((k) => !done.includes(k) && k < items.length); if (next === undefined) break; cur = { item: next, step: 0, chars: 0, wait: 0 }; }
    const seq = steps([items[cur.item]!]);
    const a = advance(cur, seq, left, speed);
    cur = { item: cur.item, ...a };
    if (a.step < seq.length) break;
    done = [...done, cur.item]; cur = null;
    if (speed !== 'instant') break; // one file per tick; All shows everything at once
    left = 1;
  }
  return { done, cur };
}
/** Replay one file from its header (it stays visible; the rest carries on afterwards). Pure. */
export const replay = (r: Reveal, item: number): Reveal => ({ done: r.done.filter((k) => k !== item), cur: { item, step: 0, chars: 0, wait: 0 } });
/** Rules of item `k` shown so far, and whether one is mid-typing. Pure. */
export function shownOf(r: Reveal, k: number, items: readonly ChainItem[]): { rules: number; typing: number; chars: number } {
  if (r.cur?.item === k) { const rule = r.cur.step - 1; return { rules: Math.max(0, rule), typing: rule >= 0 && rule < items[k]!.rules.length ? rule : -1, chars: r.cur.chars }; }
  return { rules: r.done.includes(k) ? items[k]!.rules.length : 0, typing: -1, chars: 0 };
}
