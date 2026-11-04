/**
 * build-chat-core — a build or a codebase change, told as a chat log (build-chat@1). Pure, IO-free.
 *
 * Brett, Nov 4 2026 (on Codebase changes, an expanded entry): "This needs to be displayed like the chat log."
 *
 * One input, any source (a change-log@1 entry, a Build manager row, a builds@1 record):
 *
 *   { origin?    build-origin@1 (what Brett said + addenda)
 *     brief?     the brief / prompt text (Markdown; old change-log entries have it flattened onto one line)
 *     createdAt?, startedAt?
 *     agent?     the named agent that did the work (agent id or name)
 *     model?
 *     steps?     [{ text, state: queued|running|done|failed|skipped, startedAt?, finishedAt?, note?, checks? }]
 *                (builds-store / Build manager steps `{ text, done, doneAt }` are read too)
 *     result?    { state, summary, branch?, commits?[{sha,message}], tests?{name:{state}}, at? }
 *     pr?        a PR url or "#123"
 *     events?    [{ at, text, kind?: queued|started|paused|merged|deployed|… }]   extra status lines
 *     closed?    { at, by } }
 *
 * → messages, oldest first (newest at the bottom, like a chat):
 *
 *   { id, role: brett|amber|agent|system, kind, at, text, … }
 *     brett  · said / addendum                    his words, verbatim
 *     amber  · brief                              the brief without his words and without the session rules,
 *                                                 plus `rules` [{ title, text }] (watch live, agent cap, model switches)
 *     agent  · step / commits / pr / result       `state`, `took` (ms), `checks`, `commits`, `tests`
 *     system · status                             queued, started, paused, merged, closed …
 *
 * The web port renders it with <BuildChatLog> (framework/react/components/ChatLog.tsx). Android: deferred gap
 * (framework/spec/PORTING.md), no Kotlin twin yet.
 */
import { normOrigin, dateOf, unquote, fromText } from './build-origin.mjs';

export const SCHEMA = 'build-chat@1';
export const ROLES = ['brett', 'amber', 'agent', 'system'];

/**
 * The session rules every headless launch appends to a brief (deploy/claude-headless.sh). They are the same on every
 * build, so the chat log keeps them behind "Session rules" instead of in the brief. Open list: add a marker here when
 * the launcher gains a note.
 */
export const SESSION_RULES = [
  { title: 'Watch live', re: /^Watch live:/ },
  { title: 'Agent cap', re: /^Agent cap:/ },
  { title: 'Model switches', re: /^Model switches\b/ },
];

const str = (v) => (v == null ? '' : String(v));
const isoMs = (v) => { const t = Date.parse(str(v)); return Number.isFinite(t) ? t : null; };

/**
 * Old change-log entries stored the prompt on one line (the hook squeezed every newline into a space). Put the
 * structure back where it is unambiguous: before Markdown headings, list bullets and the session-rule paragraphs.
 * Text that already has line breaks is returned as it is.
 */
export function reflow(text) {
  const t = str(text).trim();
  if (!t || t.includes('\n')) return t;
  let s = t;
  for (const r of SESSION_RULES) s = s.replace(new RegExp(`\\s+(?=${r.re.source.replace(/^\^/, '')})`, 'g'), '\n\n');
  s = s.replace(/\s+(?=#{1,6}\s)/g, '\n\n');
  // a bullet: " - " followed by bold, code or a capital letter (keeps "a - b" inside a sentence)
  s = s.replace(/\s+-\s+(?=\*\*|`|[A-Z])/g, '\n- ');
  // a heading ends where a quote or bold text starts ("## What Brett said (verbatim) \"…\"", "# Build: x **Name:** …")
  s = s.split('\n').map((l) => (/^#{1,6}\s/.test(l) ? l.replace(/\s+(?=["“]|\*\*)/, '\n') : l)).join('\n');
  return s.trim();
}

/** `## …` sections of a Markdown text, with what comes before the first heading as `{ heading: '' }`. */
function sections(text) {
  const out = [{ heading: '', level: 0, lines: [] }];
  for (const line of str(text).split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) out.push({ heading: h[2].trim(), level: h[1].length, lines: [], raw: line });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const SAID_HEAD = /\bbrett said\b/i;
const ADD_HEAD = /^addendum\b/i;

/** His words in a block body: the `> ` quote lines, else the first "…" / “…” quote, else the block itself. */
function wordsIn(lines) {
  const body = lines.join('\n').trim();
  const q = lines.filter((l) => /^\s*>/.test(l));
  if (q.length) return unquote(q.join('\n'));
  const m = /^\s*(?:[-*]\s*)?["“]([\s\S]+?)["”](?=\s|$)/.exec(body);
  if (m) return m[1].trim();
  return unquote(body.split(/\n\s*\n/)[0] ?? '');
}

/** What a said block carries after his quoted words (notes like "Screenshot: …", instructions): kept in the brief. */
function afterQuote(lines) {
  const body = lines.filter((l) => !/^\s*>/.test(l)).join('\n').trim();
  const m = /^\s*(?:[-*]\s*)?["“][\s\S]+?["”](?=\s|$)/.exec(body);
  return m ? body.slice(m[0].length).trim() : '';
}

/** The `At: <iso>` of a block's meta line (`Source: voice · At: 2026-11-03T14:05:00Z · …`). */
function metaAt(lines) {
  for (const l of lines) {
    if (/^\s*>/.test(l)) break;
    const m = /(?:^|·\s*)At:\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i.exec(l);
    if (m) return m[1];
  }
  return '';
}

/**
 * A brief → { said: [{ text, at, kind: said|addendum, verbatim }], body, rules: [{ title, text }] }.
 * `body` is the brief without the title line, Brett's words and the session rules (Markdown, for the Amber bubble).
 */
export function splitBrief(text) {
  const t = reflow(text);
  const year = /\b(20\d{2})\b/.exec(t)?.[1] ?? '';
  const said = [];
  const kept = [];
  for (const s of sections(t)) {
    if (s.level && SAID_HEAD.test(s.heading)) {
      const w = wordsIn(s.lines);
      if (w) said.push({ text: w, at: metaAt(s.lines) || dateOf(s.heading, year), kind: 'said', verbatim: /verbatim/i.test(s.heading) });
      const rest = afterQuote(s.lines);
      if (rest) kept.push(rest, '');
      continue;
    }
    if (s.level && ADD_HEAD.test(s.heading)) {
      const w = wordsIn(s.lines);
      if (w) said.push({ text: w, at: metaAt(s.lines) || dateOf(s.heading, year), kind: 'addendum', verbatim: !/paraphras/i.test(s.heading) });
      continue;
    }
    if (s.level === 1 && /^build\b/i.test(s.heading)) { kept.push(...s.lines); continue; } // the "# Build: <id>" title line
    if (s.level) kept.push(s.raw);
    kept.push(...s.lines);
  }
  const rules = [];
  const paras = kept.join('\n').split(/\n\s*\n/);
  const bodyParas = [];
  for (const p of paras) {
    const r = SESSION_RULES.find((x) => x.re.test(p.trim()));
    if (r) rules.push({ title: r.title, text: p.trim() });
    else bodyParas.push(p);
  }
  // an older brief without the block: his first quoted words, if the text announces them as his
  if (!said.length) {
    const q = fromText(t, { year, strict: true });
    if (q?.said) said.push({ text: q.said, at: q.at, kind: 'said', verbatim: !!q.verbatim });
  }
  return { said, body: bodyParas.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(), rules };
}

/** "1h 05m", "4m 10s", "12s"; '' when not both ends are known. */
export function tookText(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
}

function stepOf(s, i) {
  const o = s && typeof s === 'object' ? s : { text: str(s) };
  const state = o.state ? str(o.state) : o.done === true ? 'done' : o.done === false ? 'queued' : 'queued';
  const startedAt = str(o.startedAt);
  const finishedAt = str(o.finishedAt || o.doneAt);
  const a = isoMs(startedAt), b = isoMs(finishedAt);
  const checks = Array.isArray(o.checks) ? o.checks.length : Number.isFinite(o.checks) ? Number(o.checks) : 0;
  return {
    id: `step-${i}`, role: 'agent', kind: 'step', at: finishedAt || startedAt, text: str(o.text || o.title).trim(), state,
    took: a != null && b != null && b >= a ? b - a : null, checks, note: str(o.note), model: str(o.model),
  };
}

/** Everything that happened, as chat messages, oldest first. */
export function timeline(input = {}) {
  const i = input ?? {};
  const o = normOrigin(i.origin);
  const brief = splitBrief(i.brief || o?.brief || '');
  const created = str(i.createdAt);
  const out = [];
  // Brett: the recorded origin wins; the brief's own block fills in when there is none
  const said = o?.said
    ? [{ text: o.said, at: o.at, kind: 'said', verbatim: o.verbatim, source: o.source, link: o.link }, ...o.addenda.map((a) => ({ text: a.said, at: a.at, kind: 'addendum', verbatim: a.verbatim, source: a.source }))]
    : brief.said;
  said.forEach((m, n) => out.push({ id: `brett-${n}`, role: 'brett', kind: m.kind, at: m.at || (n === 0 ? created : ''), text: m.text, verbatim: m.verbatim !== false, source: m.source ?? '', link: m.link ?? '' }));
  if (brief.body || brief.rules.length) out.push({ id: 'amber-brief', role: 'amber', kind: 'brief', at: created, text: brief.body, rules: brief.rules });
  for (const e of i.events ?? []) if (e && e.text) out.push({ id: `ev-${out.length}`, role: 'system', kind: str(e.kind) || 'status', at: str(e.at), text: str(e.text) });
  if (i.startedAt || (created && (i.steps ?? []).length)) out.push({ id: 'started', role: 'system', kind: 'started', at: str(i.startedAt) || created, text: 'Started' });
  (i.steps ?? []).forEach((s, n) => { const m = stepOf(s, n); if (m.text) out.push(m); });
  const r = i.result && typeof i.result === 'object' ? i.result : null;
  const rAt = str(r?.at) || str(i.finishedAt) || '';
  if (r?.commits?.length) out.push({ id: 'commits', role: 'agent', kind: 'commits', at: rAt, text: '', commits: r.commits.map((c) => (typeof c === 'string' ? { sha: c } : c)), branch: str(r.branch) });
  const pr = str(i.pr);
  if (pr) out.push({ id: 'pr', role: 'agent', kind: 'pr', at: rAt, text: pr });
  if (r) out.push({ id: 'result', role: 'agent', kind: 'result', at: rAt, text: str(r.summary), state: str(r.state), tests: r.tests ?? null, branch: str(r.branch) });
  if (i.closed?.at) out.push({ id: 'closed', role: 'system', kind: 'closed', at: str(i.closed.at), text: `Closed${i.closed.by ? ` by ${i.closed.by}` : ''}` });
  return order(out);
}

/**
 * Oldest first. Messages without a time keep their place after the one before them; steps that haven't started
 * (queued, no time) go to the bottom, in their own order.
 */
export function order(list) {
  const timed = [];
  const waiting = [];
  let last = -Infinity;
  list.forEach((m, n) => {
    const t = isoMs(m.at);
    if (m.kind === 'step' && t == null && m.state === 'queued') { waiting.push(m); return; }
    const k = t ?? last;
    last = Math.max(last, k);
    timed.push({ m, k, n });
  });
  timed.sort((a, b) => (a.k - b.k) || (a.n - b.n));
  return [...timed.map((x) => x.m), ...waiting];
}

/** Counts for a header: { steps, done, failed, running }. */
export function stepCounts(messages) {
  const s = messages.filter((m) => m.kind === 'step');
  return { steps: s.length, done: s.filter((m) => m.state === 'done').length, failed: s.filter((m) => m.state === 'failed').length, running: s.filter((m) => m.state === 'running').length };
}
