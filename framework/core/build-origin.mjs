/**
 * build-origin-core — what Brett said that started a build (build-origin@1). Pure, IO-free.
 *
 * Brett, Nov 3 2026 (voice): "All the build entries, like wherever it shows a build in the build manager, pending, all
 * that, I need it to show the prompt, what I said, the verbatim prompt that kicked it off, that initiated it."
 *
 * Every build record in the builds store (builds@1) may carry `origin`:
 *
 *   origin = {
 *     said:     Brett's words, verbatim, as transcribed (never edited, never paraphrased)
 *     at:       when he said it (ISO; '' when unknown)
 *     source:   voice | chat | console | code | ''      where he said it
 *     session:  the session / conversation id, if known
 *     link:     a link to that session (claude.ai chat, Session browser, …), if known
 *     by:       which Claude session / agent launched the build
 *     brief:    the full brief text the build ran from
 *     verbatim: true = his exact words; false = taken from older text afterwards (backfill) and may be paraphrased
 *     from:     where a backfilled origin came from: brief | detail | notes | threads | report | changes ('' = captured live)
 *     addenda:  [{ said, at, source, by, verbatim, summary, step }]   later changes he asked for, oldest first; summary =
 *               what Claude will do about it, step = the build step that is its check-off item (see checkoffSteps)
 *   }
 *
 * Merging two copies (the live publish, a git merge, an orchestrator write) never loses anything: `mergeOrigin` keeps
 * verbatim words over backfilled ones, fills every empty field from the other copy and unions the addenda.
 *
 * The capture side: a brief carries his words in a required block
 *
 *   ## Brett said (verbatim)
 *   Source: voice · At: 2026-11-03T14:05:00Z · Session: <id> · Link: <url>     (optional meta line)
 *   > All the build entries, like wherever it shows a build …
 *
 * and later changes as `## Addendum N (Brett, Nov 3 2026 (voice))` blocks. `parseBrief` reads both; older briefs
 * without the block fall back to the first `Brett, <date> (voice): "…"` quote (`fromText`, marked not verbatim
 * unless the text says so).
 */

export const SCHEMA = 'build-origin@1';
export const SOURCES = ['voice', 'chat', 'console', 'code'];
export const FROM = ['', 'brief', 'detail', 'notes', 'threads', 'report', 'changes'];
export const SAID_HEADING = '## Brett said (verbatim)';
export const MAX_SAID = 8000;
export const MAX_BRIEF = 30000;

const str = (v, max = 8000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const iso = (v) => { const s = str(v, 40).trim(); return ISO.test(s) ? s : ''; };
export const normSource = (v) => {
  const s = str(v, 20).trim().toLowerCase();
  if (SOURCES.includes(s)) return s;
  if (s === 'text' || s === 'claude-ai' || s === 'claude.ai' || s === 'claude-ai-text') return 'chat';
  if (s === 'claude-ai-voice' || s === 'speech') return 'voice';
  if (s === 'cli' || s === 'claude-code' || s === 'headless') return 'code';
  return '';
};

function normAddendum(a) {
  const o = a && typeof a === 'object' ? a : {};
  return {
    said: str(o.said, MAX_SAID).trim(), at: iso(o.at), source: normSource(o.source), by: str(o.by, 120), verbatim: o.verbatim !== false,
    ...(str(o.summary).trim() ? { summary: str(o.summary, 2000).trim() } : {}), // Claude's reading of it: what it will do
    ...(str(o.step) ? { step: str(o.step, 40) } : {}), // the build step that is its check-off item
  };
}

/** build-origin@1 in shape, or null when there is nothing in it (no words, no brief, no addenda). */
export function normOrigin(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = {
    said: str(v.said, MAX_SAID).trim(),
    at: iso(v.at),
    source: normSource(v.source),
    session: str(v.session, 200),
    link: str(v.link, 500),
    by: str(v.by, 120),
    brief: str(v.brief, MAX_BRIEF),
    verbatim: v.verbatim !== false,
    from: FROM.includes(v.from) ? v.from : '',
    addenda: (Array.isArray(v.addenda) ? v.addenda : []).map(normAddendum).filter((a) => a.said),
  };
  if (!o.said) o.verbatim = false;
  return o.said || o.brief || o.addenda.length ? o : null;
}

const addKey = (a) => `${a.at}|${a.said}`;

/**
 * Two copies of one build's origin → one, losing nothing. `a` is the newer copy (it wins ties). Verbatim words beat
 * backfilled ones; otherwise the copy that has words wins; every empty field is filled from the other; addenda are the
 * union (oldest first).
 */
export function mergeOrigin(a, b) {
  const x = normOrigin(a); const y = normOrigin(b);
  if (!x) return y; if (!y) return x;
  const yBetter = (!x.said && !!y.said) || (y.said && y.verbatim && !(x.said && x.verbatim));
  const [win, lose] = yBetter ? [y, x] : [x, y];
  const out = { ...win };
  const sameWords = !win.said || win.said === lose.said;
  for (const k of ['brief', 'by', 'session', 'link']) if (!out[k] && lose[k]) out[k] = lose[k];
  for (const k of ['at', 'source']) if (!out[k] && lose[k] && sameWords) out[k] = lose[k]; // when and where belong to the words
  const seen = new Map();
  for (const ad of [...y.addenda, ...x.addenda]) { const was = seen.get(addKey(ad)); seen.set(addKey(ad), was ? { ...ad, summary: ad.summary || was.summary, step: ad.step || was.step } : ad); }
  out.addenda = [...seen.values()].sort((p, q) => (p.at || '9') < (q.at || '9') ? -1 : (p.at || '9') > (q.at || '9') ? 1 : 0);
  return normOrigin(out);
}

/** Append one addendum (no duplicate of the same words at the same time). Returns the new origin. */
export function addAddendum(origin, ad, now = new Date().toISOString()) {
  const a = normAddendum({ at: now, ...ad });
  if (!a.said) throw new Error('an addendum needs what Brett said');
  const o = normOrigin(origin) ?? { said: '', at: '', source: '', session: '', link: '', by: '', brief: '', verbatim: false, from: '', addenda: [] };
  if (!o.addenda.some((x) => addKey(x) === addKey(a))) o.addenda.push(a);
  return normOrigin(o);
}

// ------------------------------------------------------------------ an addendum as a check-off item

/**
 * Every addendum on a build is a check-off item on the build (Brett, Nov 7 2026): a step `sK` with `addendum: N`, its
 * sub-steps `sK-1`, `sK-2`… with `parent: 'sK'`. They are real steps of the build, so the orchestrator ticks them like any
 * other and Plan Studio shows them as buildId-K and buildId-K-M. The item ticks itself when its last sub-step is done.
 * With no sub-steps given, the addendum is one sub-step. Returns the new steps (plain objects: the caller normalises).
 */
export function checkoffSteps(steps, n, ad, { done = false, at = '' } = {}) {
  const k = Math.max(0, ...steps.map((s) => Number(/^s(\d+)/.exec(s.id)?.[1] ?? 0))) + 1;
  const first = str(ad.said).split(/(?<=[.!?])\s|\n/)[0].trim().slice(0, 200);
  const what = str(ad.summary, 300).trim() || first;
  const subs = (Array.isArray(ad.steps) ? ad.steps : []).map((t) => str(t, 2000).trim()).filter(Boolean);
  const base = { model: steps[steps.length - 1]?.model || 'Opus', done, doneAt: done ? at : '' };
  return [
    { ...base, id: `s${k}`, text: `Addendum ${n}: ${what}`, addendum: n },
    ...(subs.length ? subs : [what]).map((text, i) => ({ ...base, id: `s${k}-${i + 1}`, text, parent: `s${k}` })),
  ];
}

/**
 * Give every addendum of a build that has none its check-off item, in place. `plans` = [{ said, summary, steps }] from a
 * brief (matched by the words); `norm(step, index)` is the caller's step normaliser. Returns how many were made.
 */
export function attachCheckoffs(b, plans = [], { norm, done = false, at = '' } = {}) {
  const o = normOrigin(b.origin);
  if (!o) return 0;
  let made = 0;
  o.addenda.forEach((a, i) => {
    if (a.step) return;
    const p = plans.find((x) => x.said === a.said) ?? {};
    const steps = checkoffSteps(b.steps, i + 1, { ...a, ...p }, { done, at });
    b.steps.push(...steps.map((s, j) => (norm ? norm(s, b.steps.length + j) : s)));
    a.step = steps[0].id;
    const summary = str(p.summary || a.summary).trim();
    if (summary) a.summary = summary;
    made += 1;
  });
  if (made) b.origin = o;
  return made;
}

/** A check-off item follows its sub-steps: done when all are done or skipped, open again when one is opened. In place. */
export function tickParents(steps, at = '') {
  for (const p of steps.filter((s) => s.addendum)) {
    const subs = steps.filter((s) => s.parent === p.id);
    if (!subs.length) continue;
    const done = subs.every((s) => s.done || s.skip);
    if (done !== !!p.done) { p.done = done; p.doneAt = done ? at : ''; }
  }
  return steps;
}

// ------------------------------------------------------------------ dates in Brett's words ("Nov 3 2026", "Oct 30")

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** "Nov 3 2026" / "Nov 3, 2026" / "2026-11-03…" → "2026-11-03" (or the ISO as is); '' when none. */
export function dateOf(text, year = '') {
  const t = str(text, 200);
  const i = /\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?)/.exec(t);
  if (i) return iso(i[1]);
  const m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?/i.exec(t);
  if (!m) return '';
  const y = m[3] || year; if (!y) return '';
  return `${y}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
const sourceIn = (text) => { const m = /\((voice|chat|text|console|code|claude\.ai)\b/i.exec(str(text, 300)); return m ? normSource(m[1]) : ''; };

// ------------------------------------------------------------------ reading a brief

/** Quote marks around a whole block or line come off; `> ` blockquote prefixes come off. */
export function unquote(text) {
  let t = str(text, MAX_SAID * 2).split('\n').map((l) => l.replace(/^\s*>\s?/, '')).join('\n').trim();
  const pairs = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’']];
  for (const [o, c] of pairs) if (t.length > 1 && t.startsWith(o) && t.endsWith(c) && !t.slice(1, -1).includes(c === '"' ? '"' : c)) t = t.slice(1, -1).trim();
  return t;
}

const META = /^(source|at|when|session|conversation|link|by|launched by)\s*:\s*(.*)$/i;
/** The meta line(s) at the top of a block: `Source: voice · At: … · Session: … · Link: …`. */
function readMeta(lines) {
  const meta = {}; let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { if (Object.keys(meta).length) continue; else continue; }
    const parts = l.split(/\s+[·|]\s+/);
    const hits = parts.map((p) => META.exec(p.trim())).filter(Boolean);
    if (!hits.length || hits.length !== parts.length) break;
    for (const h of hits) {
      const k = h[1].toLowerCase(); const v = h[2].trim();
      if (k === 'source') meta.source = normSource(v);
      else if (k === 'at' || k === 'when') meta.at = iso(v) || dateOf(v);
      else if (k === 'session' || k === 'conversation') meta.session = v;
      else if (k === 'link') meta.link = v;
      else meta.by = v;
    }
  }
  return { meta, rest: lines.slice(i) };
}

/** `## …` sections of a markdown text: [{ heading, body }]. */
function sections(text) {
  const out = []; let cur = null;
  for (const line of str(text, MAX_BRIEF * 2).split('\n')) {
    if (/^##\s+/.test(line) && !/^###/.test(line)) { cur = { heading: line.replace(/^##\s+/, '').trim(), lines: [] }; out.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return out.map((s) => ({ heading: s.heading, body: s.lines.join('\n').trim(), lines: s.lines }));
}

/**
 * An addendum block: his words, then (when the words are quoted and bullets follow) Claude's reading of them as a
 * list. The list is the summary and the sub-steps; without one the whole block is his words.
 */
function splitAddendum(lines) {
  const body = lines.join('\n').trim();
  const LIST = /^\s*(?:[-*]|\d+[.)])\s+/;
  const at = lines.findIndex((l) => LIST.test(l));
  if (at < 1 || !/^\s*(>|"|“)/.test(body)) return { said: unquote(body), summary: '', steps: [] };
  const steps = lines.slice(at).filter((l) => LIST.test(l)).map((l) => l.replace(LIST, '').trim());
  return { said: unquote(lines.slice(0, at).join('\n')), summary: steps.join(' ').slice(0, 2000), steps };
}

const SAID_RE = /^brett said\b/i;
const ADD_RE = /^addendum\b\s*(\d+)?\s*(\(.*\))?/i;

/**
 * A brief → { said, at, source, session, link, by, verbatim, from, addenda, hasBlock } (origin fields; brief not set).
 * The `## Brett said (verbatim)` block wins; without it, the first `Brett, <date> (voice): "…"` line is used and marked
 * from: 'brief' (verbatim only when the line says "verbatim").
 */
export function parseBrief(text, { year = '' } = {}) {
  const t = str(text, MAX_BRIEF * 2);
  const secs = sections(t);
  const yr = year || /\b(20\d{2})\b/.exec(t)?.[1] || '';
  const addenda = secs.filter((s) => ADD_RE.test(s.heading)).map((s) => {
    const { meta, rest } = readMeta(s.lines);
    return { ...splitAddendum(rest), at: meta.at || dateOf(s.heading, yr), source: meta.source || sourceIn(s.heading), by: meta.by || '', verbatim: !/paraphras/i.test(s.heading) };
  }).filter((a) => a.said);
  const block = secs.find((s) => SAID_RE.test(s.heading));
  if (block) {
    const { meta, rest } = readMeta(block.lines);
    const said = unquote(rest.join('\n'));
    return { said, at: meta.at || dateOf(block.heading, yr), source: meta.source || sourceIn(block.heading), session: meta.session || '', link: meta.link || '', by: meta.by || '', verbatim: !!said, from: '', addenda, hasBlock: true };
  }
  const q = fromText(t, { year: yr, strict: true });
  return { ...(q ?? { said: '', at: '', source: '', session: '', link: '', by: '', verbatim: false }), from: q ? 'brief' : '', addenda, hasBlock: false };
}

const QUOTE_OPEN = { '"': '"', '“': '”' };
/**
 * The first thing Brett is quoted saying in a free text (a brief, a pending item's detail, a note, a THREADS row):
 *   Brett, Nov 3 2026 (voice), verbatim: "…"      Brett (Oct 30 2026, voice): …      Brett: "…"
 * → { said, at, source, verbatim } or null. Quoted words are taken up to the closing quote; unquoted ones to the end of
 * the sentence line. verbatim = the text says verbatim, or the words are in quotes right after his name. `strict` keeps
 * only words announced as his (voice / said / verbatim …) or quoted.
 */
export function fromText(text, { year = '', strict = false } = {}) {
  const t = str(text, MAX_BRIEF * 2);
  const re = /Brett(?:'s words)?\b([^\n"“]{0,80}?):(?!\d{2})\s*/g; // "12:40" is a time, not the colon after his name
  const hits = []; let m;
  while ((m = re.exec(t))) {
    const lead = m[1] ?? '';
    const said = /\b(voice|chat|said|says|verbatim|words|asked|wrote)\b/i.test(lead);
    if (/\b(rule|rules|decision|pick|call|approval|card|login|account|profile)\b/i.test(lead) && !said) continue;
    const rest = t.slice(m.index + m[0].length);
    let words = ''; let quoted = false;
    if (QUOTE_OPEN[rest[0]]) { const end = findClose(rest, QUOTE_OPEN[rest[0]]); if (end > 1) { words = rest.slice(1, end); quoted = true; } }
    if (!words) words = rest.split('\n')[0].trim();
    words = words.trim();
    if (words.length < 12 || /^(\*\*|assigned agent|register in|book (this|on)|read |go given)/i.test(words)) continue; // launch chores, not his ask
    // best first: his words announced (voice / said / verbatim), then quoted words, then whatever came first
    hits.push({ rank: (said ? 0 : 2) + (quoted ? 0 : 1), at: m.index, v: { said: words.slice(0, MAX_SAID), at: dateOf(lead, year), source: sourceIn(lead), verbatim: /verbatim/i.test(lead) || quoted, session: '', link: '', by: '' } });
  }
  hits.sort((a, b) => a.rank - b.rank || a.at - b.at);
  // strict (long briefs): only words announced as his or in quotes; a stray "Brett …:" deep in a brief is not his ask
  return hits.find((h) => !strict || h.rank < 3)?.v ?? null;
}
/** Where the quote opened at 0 closes: the first close mark that ends a word (not before a blank line); -1 = none. */
function findClose(s, close) {
  const stop = s.search(/\n\s*\n/);
  const end = stop > 0 ? stop : s.length;
  for (let i = 2; i < end; i++) if (s[i] === close && !/\s/.test(s[i - 1]) && (i + 1 >= s.length || /[\s.,;:)!?\]]/.test(s[i + 1]))) return i;
  return -1;
}

/** The brief template's block, ready to put at the top of a brief. */
export function saidBlock({ said, source = '', at = '', session = '', link = '' } = {}) {
  const meta = [source && `Source: ${source}`, at && `At: ${at}`, session && `Session: ${session}`, link && `Link: ${link}`].filter(Boolean).join(' · ');
  const quoted = str(said, MAX_SAID).trim().split('\n').map((l) => `> ${l}`).join('\n');
  return [SAID_HEADING, meta, quoted || '> (Brett\'s exact words go here, unedited)'].filter(Boolean).join('\n');
}
/** An addendum block to append to a brief. */
export function addendumBlock(n, { said, source = '', at = '' } = {}) {
  const when = at ? at.slice(0, 10) : '';
  return [`## Addendum ${n} (Brett${when ? `, ${when}` : ''}${source ? ` (${source})` : ''})`, str(said, MAX_SAID).trim().split('\n').map((l) => `> ${l}`).join('\n')].join('\n');
}

/** Does a brief carry the required block with words in it? (Launchers warn when not.) */
export function briefHasSaid(text) { const p = parseBrief(text); return p.hasBlock && !!p.said; }

// ------------------------------------------------------------------ showing it

/** The collapsed-row subtitle: the first line of what he said (cut at `max`). */
export function subtitle(origin, max = 140) {
  const o = normOrigin(origin); if (!o?.said) return '';
  const first = o.said.split('\n').find((l) => l.trim()) ?? '';
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}
/** One plain-text block for CLIs, briefs and search: his words, then each addendum. */
export function originText(origin) {
  const o = normOrigin(origin); if (!o) return '';
  const head = o.said ? `Brett said${o.source ? ` (${o.source}` : ''}${o.at ? `${o.source ? ', ' : ' ('}${o.at.slice(0, 16).replace('T', ' ')}` : ''}${o.source || o.at ? ')' : ''}${o.verbatim ? '' : ' [from the ' + (o.from || 'brief') + ', may be paraphrased]'}:\n"${o.said}"` : '';
  const adds = o.addenda.map((a, i) => `Addendum ${i + 1}${a.at ? ` (${a.at.slice(0, 10)})` : ''}: "${a.said}"`);
  return [head, ...adds].filter(Boolean).join('\n');
}
/** Search text for a build's origin (words + addenda + session). */
export function searchText(origin) { const o = normOrigin(origin); return o ? [o.said, ...o.addenda.map((a) => a.said), o.session, o.by].join(' ') : ''; }
