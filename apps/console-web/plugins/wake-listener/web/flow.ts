/**
 * What happens with a command once the wake phrase has been heard (wake-listener@1, build s2).
 *
 *  1. Something has the floor (a spoken wizard asking for a field or a confirmation, or the approvals review): the
 *     utterance is its answer.
 *  2. Else the phrase is matched against the command catalog (catalog.mjs: built-ins, every plugin command from the
 *     registry through this plugin's server, control@1 targets, the console actions registered in this page).
 *     - a complete entry runs (after "Yes or no?" when it confirms);
 *     - an entry with missing fields becomes a wizard: one question per field, then the confirmation, then it runs
 *       ("create a new project" → "What is the project called?" → "Gizmo Johnson" → "Create the project Gizmo Johnson.
 *       Yes or no?" → "yes");
 *     - the approvals review lists every call waiting on axHub one at a time: approve / deny / skip / approve all pending;
 *     - navigation, settings, scrolling, find and press go to the console's own voice intents (console-control@1).
 *  3. Nothing matched: the console's voice intents get a try; else "I don't know that one".
 * Claude mode (build voice-listener-use-claude-when-connected): with the setting on, step 2 first asks the understand
 * route (web/claudeMode.ts); its question or confirm prompt takes the floor (kind 'claude') and the answers go back to
 * it. Offline, a timeout or an error: the same transcript goes on to step 2 unchanged. Approve / deny words never go.
 * Runs are the same requests the API makes: plugin routes through /api/plugins/<plugin>/…, control@1 through
 * /api/control, actions through the action bus, approvals through lib-approvals' deciding path (the banner's relay when
 * it is there, else the hub).
 */
import type { AxfRuntime } from '@console/axf/core';
import { CONTROL_TARGETS } from '@console/axf/core/engines/control-rules.mjs';
import { authHeaders } from '@console/axf/libs/apiclient';
import { fetchApprovals, lookupApproval, type ApprovalDecision, type ApprovalItem } from '@console/axf/libs/approvals';
import { decideApproval } from '@console/axf/libs/approvals/host';
import { HUB_DEFAULT, normalizeHub } from '@console/axf/libs/hub/hub';
import { consoleTokens } from '@console/api';
import { pluginFetch } from '@console/plugins';
import { FOLDER } from '../core.mjs';
import { claudeGate, pageContext, understand, type ClaudeAnswer, type FallbackReason, type Mode, type Pending } from './claudeMode';
import { NO, SKIP, YES, answerWizard, buildCatalog, helpLine, matchCommand, requestFor, searchCatalog, speakResult, startWizard, summaryOf, type Catalog, type CatalogEntry, type Wizard } from '../catalog.mjs';

export interface FlowResult {
  ok: boolean; say: string; done: boolean;
  /** who understood the command: Claude, or the scripted matcher (with why, while Claude mode is on) */
  mode?: Mode; reason?: FallbackReason; command?: string;
}
export interface FlowHost {
  rt: AxfRuntime;
  /** speaks a line now (the loop over approvals speaks as it goes) */
  say: (text: string) => void;
  /** seconds to wait for an answer before the floor is given up */
  answerSec?: number;
  /** the floor changed hands (something is waiting for an answer, or not) */
  floor?: (busy: boolean) => void;
  /** Claude mode: the setting (axf.voice.useClaude) and how long to wait (axf.voice.claudeTimeoutSec) */
  useClaude?: boolean;
  claudeTimeoutSec?: number;
}

type Floor =
  | { kind: 'wizard'; w: Wizard }
  | { kind: 'approvals'; hub: string; items: ApprovalItem[]; i: number; decided: number }
  | { kind: 'claude'; pending: Pending; entry: CatalogEntry }
  | null;

let floor: Floor = null;
let floorTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaid = '';
let catalogCache: { at: number; serverEntries: CatalogEntry[] } | null = null;
const CATALOG_TTL_MS = 5 * 60_000;

export function hasFloor(): boolean { return floor !== null; }
export function floorLabel(): string { return floor?.kind === 'wizard' ? `Wizard: ${floor.w.entry.title}` : floor?.kind === 'approvals' ? 'Approvals review' : floor?.kind === 'claude' ? `Claude: ${floor.entry.title}` : ''; }

function setFloor(host: FlowHost, f: Floor) {
  floor = f;
  if (floorTimer) { clearTimeout(floorTimer); floorTimer = null; }
  if (f) floorTimer = setTimeout(() => { if (floor) { floor = null; host.floor?.(false); host.say('No answer. Cancelled.'); } }, Math.max(5, host.answerSec ?? 20) * 1000);
  host.floor?.(!!f);
}

/** Gives up whatever has the floor; returns the line to say. */
export function cancelFloor(): string {
  if (!floor) return '';
  const what = floor.kind === 'wizard' ? floor.w.entry.title : floor.kind === 'claude' ? floor.entry.title : 'the approvals review';
  floor = null;
  if (floorTimer) { clearTimeout(floorTimer); floorTimer = null; }
  return `Cancelled ${what}.`;
}

const remember = (s: string) => { if (s) lastSaid = s; return s; };

/* ------------------------------------------------------------------ the catalog */

export async function catalog(rt: AxfRuntime): Promise<Catalog> {
  if (!catalogCache || Date.now() - catalogCache.at > CATALOG_TTL_MS) {
    let serverEntries: CatalogEntry[] = [];
    try {
      const r = await pluginFetch(FOLDER, 'catalog');
      const j = (await r.json()) as { ok?: boolean; entries?: CatalogEntry[] };
      if (r.ok && j.ok && Array.isArray(j.entries)) serverEntries = j.entries;
    } catch { /* offline: built-ins and the page's actions still work */ }
    catalogCache = { at: Date.now(), serverEntries };
  }
  const local = buildCatalog({ actions: rt.actions.list() as unknown as { id: string; meta: Record<string, unknown> }[], targets: CONTROL_TARGETS as Record<string, unknown> });
  const seen = new Set<string>();
  const entries = [...catalogCache.serverEntries, ...local.entries].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  return { ...local, entries };
}
export function forgetCatalog() { catalogCache = null; }

/* ------------------------------------------------------------------ running an entry */

async function consoleJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await fetch(path, { ...init, headers: authHeaders(consoleTokens, init), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return r.ok ? j : { ok: false, message: (j.message as string) || (j.error as string) || (j.detail as string) || `The console answered ${r.status}.`, ...j };
}

export async function runEntry(host: FlowHost, entry: CatalogEntry, slots: Record<string, string>): Promise<FlowResult> {
  const { rt } = host;
  const req = requestFor(entry, slots);
  if (req.kind === 'plugin-route') {
    const q = new URLSearchParams(req.query as Record<string, string>).toString();
    const r = await pluginFetch(req.folder as string, `${(req.path as string).replace(/^\//, '')}${q ? `?${q}` : ''}`, { method: req.method as string, ...(req.body != null ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) } : {}) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const res = r.ok ? j : { ok: false, message: (j.message as string) || (j.detail as string) || (j.error as string) || `The console answered ${r.status}.` };
    return { ok: r.ok && res.ok !== false, say: speakResult(entry, res), done: true };
  }
  if (req.kind === 'control') {
    const res = await consoleJson('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(req.command as Record<string, unknown>), by: 'voice', reason: 'Brett, by voice (wake listener)' }) });
    return { ok: res.ok !== false, say: speakResult(entry, res), done: true };
  }
  if (req.kind === 'action') {
    const ok = rt.actions.dispatch(req.spec as string, { runtime: rt });
    return { ok, say: ok ? (entry.effect === 'navigate' ? '' : 'Done.') : `The console has no ${entry.title}.`, done: true };
  }
  return { ok: false, say: `${entry.title} is a read for the API; nothing to run here.`, done: true };
}

/* ------------------------------------------------------------------ approvals */

async function hubUrl(): Promise<string> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    const j = (await r.json()) as { hub?: string };
    const hub = normalizeHub(j.hub);
    if (hub) return hub;
  } catch { /* fall back */ }
  return HUB_DEFAULT;
}

const describe = (it: ApprovalItem) => `${it.title}${it.source?.who ? `, from ${it.source.who}` : ''}${it.kind === 'held' ? ', held on a countdown' : ''}`;
const liveItems = (items: ApprovalItem[]) => items.filter((i) => i.decisions.length && !(i.kind === 'held' && (i.veto?.shelved || i.veto?.approvedNow)));

async function decide(hub: string, item: ApprovalItem, d: ApprovalDecision): Promise<string> {
  const want: ApprovalDecision = d === 'approve' ? 'approve' : item.decisions.includes('decline') ? 'decline' : 'deny';
  if (!item.decisions.includes(want)) return `${item.title} cannot be ${want === 'approve' ? 'approved' : 'denied'} from here.`;
  try {
    const found = lookupApproval(item.id);
    const r = found?.lookup.decide ? await found.lookup.decide(found.item, want) : await decideApproval(hub, item, want);
    if (r.ok && r.opened) return `${item.title}: opened on axHub to decide there.`;
    return r.ok ? `${want === 'approve' ? 'Approved' : 'Denied'}: ${item.title}.` : `${item.title}: ${r.message || 'the hub said no'}.`;
  } catch (e) { return `${item.title}: ${(e as Error).message}.`; }
}

async function startApprovals(host: FlowHost): Promise<FlowResult> {
  const hub = await hubUrl();
  const st = await fetchApprovals(hub);
  if (st.status !== 'ok') return { ok: false, say: `I could not read the hub: ${st.error || st.status}.`, done: true };
  const items = liveItems(st.items);
  if (!items.length) return { ok: true, say: 'Nothing is waiting for approval.', done: true };
  setFloor(host, { kind: 'approvals', hub, items, i: 0, decided: 0 });
  return { ok: true, say: `${items.length} waiting. First: ${describe(items[0]!)}. Approve, deny or skip?`, done: false };
}

async function decideAll(_host: FlowHost, d: ApprovalDecision, from?: { hub: string; items: ApprovalItem[]; i: number }): Promise<FlowResult> {
  const hub = from?.hub ?? await hubUrl();
  const items = from ? from.items.slice(from.i) : liveItems((await fetchApprovals(hub)).items);
  if (!items.length) return { ok: true, say: 'Nothing is waiting for approval.', done: true };
  let n = 0; const problems: string[] = [];
  for (const it of items) { const line = await decide(hub, it, d); if (/^(Approved|Denied):/.test(line)) n++; else problems.push(line); }
  return { ok: !problems.length, say: `${d === 'approve' ? 'Approved' : 'Denied'} ${n} of ${items.length}.${problems.length ? ` ${problems.join(' ')}` : ''}`, done: true };
}

async function answerApprovals(host: FlowHost, f: Extract<Floor, { kind: 'approvals' }>, text: string): Promise<FlowResult> {
  const t = text.toLowerCase().trim();
  const item = f.items[f.i];
  if (!item) { setFloor(host, null); return { ok: true, say: "That's all.", done: true }; }
  const next = async (prefix: string): Promise<FlowResult> => {
    const i = f.i + 1;
    if (i >= f.items.length) { setFloor(host, null); return { ok: true, say: `${prefix} That's all.`.trim(), done: true }; }
    setFloor(host, { ...f, i });
    return { ok: true, say: `${prefix} Next: ${describe(f.items[i]!)}. Approve, deny or skip?`.trim(), done: false };
  };
  if (/^(approve|accept|allow|run it|yes|yeah|yep|ok|okay|go ahead)\b/.test(t) && !/\ball\b/.test(t)) return next(await decide(f.hub, item, 'approve'));
  if (/^(deny|decline|reject|block|no|nope|refuse)\b/.test(t) && !/\ball\b/.test(t)) return next(await decide(f.hub, item, 'decline'));
  if (/\b(approve|accept|allow)\b.*\b(all|everything|them all|the rest)\b|\ball\b.*\bapprove/.test(t)) { setFloor(host, null); return decideAll(host, 'approve', f); }
  if (/\b(deny|decline|reject)\b.*\b(all|everything|them all|the rest)\b/.test(t)) { setFloor(host, null); return decideAll(host, 'decline', f); }
  if (SKIP.test(t)) return next('Skipped.');
  if (/^(stop|cancel|done|enough|that s all|quit|exit|never mind)\b/.test(t)) { setFloor(host, null); return { ok: true, say: 'Stopped the review.', done: true }; }
  if (/^(what|details|tell me more|more|describe|read it)\b/.test(t)) return { ok: true, say: `${item.title}. ${item.description || item.summary || item.command}. Approve, deny or skip?`, done: false };
  if (/^(repeat|again|say that again)\b/.test(t)) return { ok: true, say: `${describe(item)}. Approve, deny or skip?`, done: false };
  return { ok: true, say: `Say approve, deny, skip, approve all, or stop. ${describe(item)}.`, done: false };
}

/* ------------------------------------------------------------------ the wizard */

async function continueWizard(host: FlowHost, w: Wizard): Promise<FlowResult> {
  if (w.step === 'run') { setFloor(host, null); return runEntry(host, w.entry, w.slots); }
  if (w.step === 'cancelled') { setFloor(host, null); return { ok: true, say: w.prompt, done: true }; }
  setFloor(host, { kind: 'wizard', w: w.step === 'retry' ? { ...w, step: w.field ? 'ask' : 'confirm' } : w });
  return { ok: true, say: w.prompt, done: false };
}

/* ------------------------------------------------------------------ built-ins */

async function builtin(host: FlowHost, what: string, slots: Record<string, string>, cat: Catalog): Promise<FlowResult> {
  switch (what) {
    case 'approvals.review': return startApprovals(host);
    case 'approvals.all': return decideAll(host, 'approve');
    case 'approvals.denyAll': return decideAll(host, 'decline');
    case 'approvals.count': { const st = await fetchApprovals(await hubUrl()); const n = st.status === 'ok' ? liveItems(st.items).length : -1; return { ok: n >= 0, say: n < 0 ? `I could not read the hub: ${st.error || st.status}.` : n ? `${n} waiting for approval. Say approve to go through them.` : 'Nothing is waiting for approval.', done: true }; }
    case 'help': return { ok: true, say: helpLine(cat), done: true };
    case 'cancel': return { ok: true, say: cancelFloor() || 'Nothing to cancel.', done: true };
    case 'repeat': return { ok: true, say: lastSaid || 'I have not said anything yet.', done: true };
    case 'wizard': {
      const q = slots.id ?? '';
      const e = cat.entries.find((x) => x.id === q) ?? searchCatalog(cat, q).find((x) => x.fields.length) ?? searchCatalog(cat, q)[0];
      if (!e) return { ok: false, say: `I have no command called ${q}.`, done: true };
      return continueWizard(host, startWizard(e, {}));
    }
    default: return { ok: false, say: `I do not know how to ${what}.`, done: true };
  }
}

/* ------------------------------------------------------------------ Claude mode */

/** A Claude answer for a known entry → run it, or put its question / confirm on the floor. Null = go scripted. */
async function claudeStep(host: FlowHost, a: ClaudeAnswer, cat: Catalog): Promise<FlowResult | null> {
  if (a.mode !== 'claude') return null;
  const entry = cat.entries.find((e) => e.id === a.command);
  if (!entry || entry.group === 'approvals') return null; // unknown here, or an approvals entry: never through Claude
  const base = { mode: 'claude' as const, command: entry.id };
  if (a.cancelled) { setFloor(host, null); return { ok: true, say: a.prompt || 'Cancelled.', done: true, ...base }; }
  if (a.run) {
    setFloor(host, null);
    if (entry.run.kind === 'builtin') return { ...(await builtin(host, entry.run.what, a.args ?? {}, cat)), ...base };
    if (entry.run.kind === 'voice') return { ...voiceFallback(host, entry.say[0]?.replace(/\{(\w+)\}/g, (_, k: string) => a.args?.[k] ?? '') ?? entry.title), ...base };
    return { ...(await runEntry(host, entry, a.args ?? {})), ...base };
  }
  if (a.pending && (a.ask || a.confirm)) { setFloor(host, { kind: 'claude', pending: a.pending, entry }); return { ok: true, say: a.prompt || a.ask || '', done: false, ...base }; }
  return null;
}

/** The answer to a Claude question or confirm. Offline mid-way: the scripted wizard takes over with what is known. */
async function answerClaude(host: FlowHost, f: Extract<Floor, { kind: 'claude' }>, text: string): Promise<FlowResult> {
  const cat = await catalog(host.rt);
  const a = await understand(text, { timeoutSec: host.claudeTimeoutSec ?? 8, pending: f.pending, context: pageContext() });
  const r = await claudeStep(host, a, cat);
  if (r) return r;
  // offline (or an unknown pick) mid-way: the scripted wizard carries on from what Claude had, with this answer
  const known = f.pending.args ?? {};
  const w = f.pending.confirm ? { ...startWizard(f.entry, known), step: 'confirm' as const, prompt: `${summaryOf(f.entry, known)}. Yes or no?` } : startWizard(f.entry, known);
  const res = await continueWizard(host, answerWizard(w, text));
  return { ...res, mode: 'scripted', reason: (a.reason || 'unknown-command') as FallbackReason, command: f.entry.id };
}

/* ------------------------------------------------------------------ one command */

function voiceFallback(host: FlowHost, text: string): FlowResult {
  const h = host.rt.actions.get('console.control.voice');
  if (!h) return { ok: false, say: "That isn't a command I know.", done: true };
  host.rt.actions.dispatch(`console.control.voice:${text}`, { runtime: host.rt });
  return { ok: true, say: '', done: true };
}

/** Runs one spoken command, or answers whatever has the floor. `done` = the floor is free again. */
export async function handleCommand(host: FlowHost, text: string): Promise<FlowResult> {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, say: '', done: !floor };
  const f = floor;
  if (f?.kind === 'approvals') { const r = await answerApprovals(host, f, t); r.say = remember(r.say); return r; }
  if (f?.kind === 'wizard') {
    if (NO.test(t.toLowerCase()) && f.w.step !== 'ask') { setFloor(host, null); return { ok: true, say: remember('Cancelled.'), done: true }; }
    const r = await continueWizard(host, answerWizard(f.w, t)); r.say = remember(r.say); return r;
  }
  if (f?.kind === 'claude') { const r = await answerClaude(host, f, t); r.say = remember(r.say); return r; }
  const cat = await catalog(host.rt);
  // Claude mode: the setting on → Claude first; approve / deny words never go (the scripted approvals path takes them)
  let reason: FallbackReason = '';
  const gate = claudeGate({ useClaude: !!host.useClaude }, t);
  if (host.useClaude) {
    if (!gate.claude) reason = gate.reason;
    else {
      const a = await understand(t, { timeoutSec: host.claudeTimeoutSec ?? 8, context: pageContext() });
      const r = await claudeStep(host, a, cat);
      if (r) { r.say = remember(r.say); return r; }
      reason = (a.mode === 'claude' ? 'unknown-command' : a.reason || 'error') as FallbackReason;
    }
  }
  const r = await scripted(host, t, cat);
  return { ...r, mode: 'scripted', ...(host.useClaude ? { reason } : {}) };
}

/** The scripted matcher and wizard (catalog.mjs): the whole path when Claude mode is off, the fallback when it is on. */
async function scripted(host: FlowHost, t: string, cat: Catalog): Promise<FlowResult> {
  const m = matchCommand(cat, t);
  if (!m) return voiceFallback(host, t);
  const { entry } = m;
  if (entry.run.kind === 'voice') return voiceFallback(host, t);
  if (entry.run.kind === 'builtin') { const r = await builtin(host, entry.run.what, m.slots, cat); r.say = remember(r.say); return r; }
  if (!entry.fields.length && !entry.confirm) { const r = await runEntry(host, entry, m.slots); r.say = remember(r.say); return r; }
  // a yes/no for an argument-free command that confirms
  if (!entry.fields.length && entry.confirm) { const w = { ...startWizard(entry, m.slots), step: 'confirm' as const, prompt: `${summaryOf(entry, m.slots)}. Yes or no?` }; const r = await continueWizard(host, w); r.say = remember(r.say); return r; }
  const r = await continueWizard(host, startWizard(entry, m.slots)); r.say = remember(r.say); return r;
}

export { YES };
