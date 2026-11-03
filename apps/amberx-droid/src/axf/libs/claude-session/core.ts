/*
 * claude-session — the pure parts of a Claude session that more than one app shows (no React, no network).
 *
 * Harvested (Nov 3 2026, build gizmo-companion) from the console Terminal's headless tabs
 * (apps/console-web/plugins/console-terminal/web/headless-core.ts: the live meter, model names, money, the context
 * chain's reveal pacing) and AmberX's assistant (conversation list, spoken replies, interrupt words, the assistant's
 * name), so the Terminal and AmberX's companion (Gizmo) read one copy. The Terminal re-exports these unchanged.
 *
 * Chats themselves are assistant@1 (framework/core/assistant.ts); this file only adds what a companion UI needs on top.
 */
import { ALLOWED_MODELS, DEFAULT_MODEL, MODEL_LABELS, modelId } from '../../core/model-policy.mjs';
import type { ConversationSummary } from '../../core/assistant';

/* ---------------------------------------------------------------- live meters (headless Claude Code sessions) */

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

/* ---------------------------------------------------------------- the context chain (CLAUDE.md, rules, memory) */

export interface ChainRule { kind: 'heading' | 'item'; level: number; text: string }
export interface ChainItem { i: number; path: string; rel: string; via: string; depth: number; parent: string; at: string; rules: ChainRule[] }
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

/* ---------------------------------------------------------------- the companion (who it is) */

/** The companion's face and name (Brett, Nov 3 2026: Gizmo replaces agent Molly; Molly is the app that brings it all together). */
export const COMPANION = {
  id: 'gizmo',
  name: 'Gizmo',
  /** the agent-manager agent the chats run as (its persona, tools and approvals live there) */
  agentId: 'gizmo',
  /** the name he replaced in AmberX's assistant texts */
  replaces: 'Molly',
  tagline: 'Your AmberX sidekick: chat, talk, build and check on the crew.',
} as const;

/**
 * An assistant text with the old assistant's name swapped for the companion's ("Ask Molly" → "Ask Gizmo"), whole words
 * only and case kept, so "Molly's" and "MOLLY" follow and "Mollyx" doesn't. Pure.
 */
export function renameAssistant(text: string, from: string = COMPANION.replaces, to: string = COMPANION.name): string {
  if (!text || !from) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${esc}\\b`, 'gi'), (w) => (w === w.toUpperCase() && w.length > 1 ? to.toUpperCase() : w[0] === w[0]!.toLowerCase() ? to.toLowerCase() : to));
}

/* ---------------------------------------------------------------- conversations (assistant@1 summaries) */

/** Pinned first, then newest first. Returns a new array. Pure. */
export function orderConversations<T extends Pick<ConversationSummary, 'pinned' | 'updatedAt'>>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** Every word of `q` in the title, preview or tags (case-insensitive). Empty query = all. Pure. */
export function filterConversations<T extends Pick<ConversationSummary, 'title' | 'preview' | 'tags'>>(items: T[], q: string): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((c) => { const hay = `${c.title}\n${c.preview}\n${c.tags.join(' ')}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

export type DayGroup = 'Pinned' | 'Today' | 'Yesterday' | 'This week' | 'Earlier';
/** The list's section for a chat: Pinned, Today, Yesterday, This week (last 7 days) or Earlier, in local time. Pure. */
export function dayGroup(c: Pick<ConversationSummary, 'pinned' | 'updatedAt'>, now = Date.now()): DayGroup {
  if (c.pinned) return 'Pinned';
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  if (c.updatedAt >= t0) return 'Today';
  if (c.updatedAt >= t0 - 86_400_000) return 'Yesterday';
  if (c.updatedAt >= t0 - 6 * 86_400_000) return 'This week';
  return 'Earlier';
}
/** Ordered, filtered and grouped in list order. Pure. */
export function groupConversations<T extends ConversationSummary>(items: T[], q = '', now = Date.now()): { group: DayGroup; items: T[] }[] {
  const out: { group: DayGroup; items: T[] }[] = [];
  for (const c of orderConversations(filterConversations(items, q))) {
    const g = dayGroup(c, now);
    const last = out[out.length - 1];
    if (last && last.group === g) last.items.push(c); else out.push({ group: g, items: [c] });
  }
  return out;
}

/* ---------------------------------------------------------------- models (model-policy@1) */

export interface ChatModel { key: string; id: string; label: string }
/** The models a chat may pick: the policy's allowed list (Opus, Fable), default first. Pure. */
export function chatModels(): ChatModel[] {
  const keys = [DEFAULT_MODEL, ...ALLOWED_MODELS.filter((m) => m !== DEFAULT_MODEL)];
  return keys.map((k) => ({ key: k, id: modelId(k), label: MODEL_LABELS[k] }));
}
/** A stored or asked-for model as a Claude Code id the policy allows (Sonnet/Haiku run as Opus, coerced up). '' = default. Pure. */
export function chatModelId(m: string | null | undefined): string {
  return m ? modelId(m) : '';
}

/* ---------------------------------------------------------------- budget */

export interface Budget { spentUsd: number; capUsd: number; ratio: number; level: 'off' | 'ok' | 'warn' | 'over'; left: string }
/** Where a cap stands: off (no cap), ok, warn (80 % or more) or over. Pure. */
export function budgetState(spentUsd: number, capUsd: number): Budget {
  const spent = Number.isFinite(spentUsd) && spentUsd > 0 ? spentUsd : 0;
  if (!(capUsd > 0)) return { spentUsd: spent, capUsd: 0, ratio: 0, level: 'off', left: '' };
  const ratio = spent / capUsd;
  return { spentUsd: spent, capUsd, ratio, level: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok', left: money(Math.max(0, capUsd - spent)) };
}

/* ---------------------------------------------------------------- speech (spoken replies, talk mode) */

/**
 * A markdown reply as words to say: code blocks become "(code in the chat)", links keep their text, tables, headings,
 * emphasis, list marks and inline code marks go, URLs are left out. Pure.
 */
export function speakable(md: string): string {
  return (md || '')
    .replace(/```[\s\S]*?(```|$)/g, ' (code in the chat) ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Speakable text in sentence-sized chunks (at most `max` characters) so speech can start before the reply ends. Pure. */
export function sentences(text: string, max = 220): string[] {
  const out: string[] = [];
  for (const part of text.split(/(?<=[.!?…])\s+|\n+/)) {
    let p = part.trim();
    while (p.length > max) { const cut = p.lastIndexOf(' ', max); const at = cut > max / 2 ? cut : max; out.push(p.slice(0, at).trim()); p = p.slice(at).trim(); }
    if (p) out.push(p);
  }
  return out;
}

/** How much of a streaming reply is ready to speak: complete sentences only, after `spoken` characters. Pure. */
export function readyToSpeak(text: string, spoken: number, done: boolean): { chunk: string; upTo: number } {
  const rest = text.slice(spoken);
  if (done) return { chunk: rest, upTo: text.length };
  if (/```/.test(rest) && (rest.match(/```/g) ?? []).length % 2 === 1) { const at = rest.indexOf('```'); return at > 0 ? cutAt(rest.slice(0, at), spoken) : { chunk: '', upTo: spoken }; }
  return cutAt(rest, spoken);
}
function cutAt(rest: string, spoken: number): { chunk: string; upTo: number } {
  const m = /[\s\S]*[.!?…](\s|$)|[\s\S]*\n/.exec(rest);
  if (!m) return { chunk: '', upTo: spoken };
  return { chunk: m[0], upTo: spoken + m[0].length };
}

/** Words that stop the companion talking at once (Brett talking over it). Only short utterances count. */
export const INTERRUPT_WORDS = ['stop', 'wait', 'hold on', 'hang on', 'shut up', 'quiet', 'enough', 'pause', 'cancel', 'never mind', 'nevermind', 'okay okay', 'ok ok', 'no no'];
/** True when a heard phrase means "stop talking": an interrupt word as most of a short utterance. Pure. */
export function isInterrupt(heard: string): boolean {
  const t = (heard || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 5) return false;
  return INTERRUPT_WORDS.some((w) => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`) || t === `${COMPANION.name.toLowerCase()} ${w}`);
}

/* ---------------------------------------------------------------- tool cards */

export interface ToolCardView { id: string; title: string; detail: string; state: 'running' | 'ok' | 'failed'; icon: string }
const TOOL_LABELS: [RegExp, string, string][] = [
  [/^axhub_call$|axhub/i, 'axHub', 'plug'],
  [/repo_(read|search)|read_file|grep|glob/i, 'Read the code', 'search'],
  [/vps|shell|bash|run/i, 'VPS command', 'terminal'],
  [/github|pull|merge/i, 'GitHub', 'git-branch'],
  [/memory/i, 'Memory', 'book-open'],
  [/build|orchestr|queue/i, 'Builds', 'hammer'],
  [/review|ui-review/i, 'UI Review', 'image'],
  [/fetch|web|http/i, 'Web', 'globe'],
];
/** One tool call (LiveReply.tools entry or a message's tool log) as a card's title, detail and state. Pure. */
export function toolCard(t: { id: string; name: string; input?: string; ok?: boolean; preview?: string; done?: boolean }): ToolCardView {
  const hit = TOOL_LABELS.find(([re]) => re.test(t.name));
  let detail = t.input ?? '';
  try { const j = JSON.parse(detail) as Record<string, unknown>; const tool = typeof j.tool === 'string' ? j.tool : typeof j.name === 'string' ? j.name : ''; if (tool) detail = tool; } catch { /* plain text input */ }
  return { id: t.id, title: hit ? `${hit[1]} · ${t.name}` : t.name, detail: detail.slice(0, 160), state: !t.done ? 'running' : t.ok === false ? 'failed' : 'ok', icon: hit?.[2] ?? 'wrench' };
}
