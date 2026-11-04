/*
 * Headless tabs — the pure parts (no React, no network), shared by the terminal's web files and its self-test
 * (framework/spec/check-headless-tabs.mts): tab tmux names and which headless sessions get a tab. The live meter's
 * display helpers and the context chain's reveal pacing moved to the framework's claude-session library (Nov 3 2026,
 * build gizmo-companion) so AmberX's companion reads the same copy; they are re-exported here unchanged.
 */
export {
  PACE, advance, modelName, money, statusOf, steps,
  type ChainItem, type ChainNode, type ChainReason, type ChainRule, type Meter, type MeterStatus, type Speed,
} from '../../../src/axf/libs/claude-session/core';
import { advance, steps, type ChainItem, type ChainNode, type Speed } from '../../../src/axf/libs/claude-session/core';

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
