/**
 * Reference links (build banner-ref-links, Brett Nov 3 2026: "where things are mentioned that do have a spot … clicking,
 * double clicking … the text itself … you need to be able to make it open that part. Whatever it's referenced to.").
 * ref@1: find the mentions of real things in any text (banner entries, build titles and notes, change-log lines) and
 * turn them into hooks — screens, dialogs, settings tabs / sections / single settings, plugins, toolbars, menus,
 * components, actions, builds, PRs, agents, notes and files.
 *
 * Pure (no IO, no DOM, zero tokens): the caller hands in the targets it knows (the console's search index, the builds
 * store, plugin manifests, …) and the text; matching is exact / alias / pattern, never a model.
 *
 *   target  { id: '<kind>:<key>', kind, label, aliases?, detail?, icon?, focus?, url?, status?: 'live'|'new', touches? }
 *   span    { start, end, text, ref, kind, via: 'explicit'|'id'|'label'|'alias'|'pattern', ambiguous?, candidates?, missing? }
 *   result  { $axf: 'ref@1', text, spans, refs }        refs = every id the text points at, explicit ones first
 *
 * Rules (fixture spec/fixtures/refs.json):
 *   - Explicit refs win. A build may declare what it touches (`touches: settings.terminal, toolbar.terminal` in its
 *     brief, report or any line); those ids are links where they are written, settle an ambiguous name, and a
 *     declared id with no live target is kept as `missing` (a part that is new and not live yet).
 *   - Patterns: `#123` / `PR 123` → pr:123; repo paths (apps/…, framework/…, deploy/…, _claude/…) → file:<path>.
 *   - Names: a target's label and aliases, at word boundaries, longest first, never overlapping. Several-word names
 *     match in any case; a one-word name only as written (so "terminal" in a sentence is not the Terminal screen);
 *     names shorter than 3 letters and common words (Home, Settings, Open, …) never match on their own.
 *   - A kind word after a name ("Terminal settings", "Plan Studio screen", "Banner toolbar") picks that kind and is
 *     part of the link. Several targets left: the explicit one, then the kind order below; the span is `ambiguous`
 *     and lists the others as `candidates`.
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const REF_FRAME = 'ref@1';
/** Every kind a ref can point at, in the order an ambiguous name is settled (first wins). Open: any other string works. */
export const REF_KINDS = ['screen', 'settings', 'dialog', 'plugin', 'toolbar', 'menu', 'section', 'setting', 'component', 'build', 'pr', 'agent', 'note', 'file', 'action', 'window'];
/** Words after a name that say which kind it is. */
export const REF_KIND_WORDS = {
  screen: 'screen', page: 'screen', view: 'screen', tab: 'settings', settings: 'settings', setting: 'setting',
  dialog: 'dialog', popup: 'dialog', window: 'window', plugin: 'plugin', toolbar: 'toolbar', menu: 'menu',
  section: 'section', panel: 'section', button: 'component', banner: 'component', build: 'build', agent: 'agent',
};
/** Names that are also everyday words: never a link on their own (a kind word or an explicit ref still makes them one). */
export const REF_STOP_WORDS = new Set(['home', 'settings', 'setting', 'open', 'close', 'copy', 'save', 'menu', 'more', 'help', 'search', 'back', 'next', 'done',
  'on', 'off', 'live', 'merged', 'built', 'ready', 'running', 'all', 'none', 'new', 'edit', 'remove', 'add', 'delete', 'reset', 'apply', 'cancel', 'ok',
  'yes', 'no', 'show', 'hide', 'start', 'stop', 'run', 'refresh', 'details', 'info', 'general', 'about', 'default', 'main', 'current', 'today', 'build',
  'builds', 'plugin', 'plugins', 'screen', 'page', 'view', 'list', 'notes', 'note', 'files', 'file', 'log', 'logs', 'status', 'banner', 'toolbar', 'dialog']);
export const REF_MIN_LETTERS = 3;
const MAX_TEXT = 20_000;
const FILE_RE = /(?<![\w/.-])((?:apps|framework|deploy|_claude|docs|\.github)\/[\w.@-]+(?:\/[\w.@-]+)*)/g;
const PR_RE = /(?<![\w&/])(?:#|\bPR\s*#?)(\d{1,6})\b/g;
const TOUCHES_RE = /\btouches\s*:\s*([^\n.;]*(?:\.[\w-][^\n.;]*)*)/gi;
const ID_RE = /^[a-z][\w-]*[:.][^\s,]+$/i;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
/** Lower case, same length (offsets into the folded text are offsets into the text). */
const fold = (s) => str(s, MAX_TEXT).toLowerCase().replace(/’/g, "'");
const isWordChar = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
const letters = (s) => (s.match(/\p{L}/gu) ?? []).length;
const kindRank = (k) => { const i = REF_KINDS.indexOf(k); return i < 0 ? REF_KINDS.length : i; };

/** `settings.terminal`, `settings:terminal`, `Settings:terminal` → `settings:terminal` (the first `.` or `:` splits kind from key). */
export function refId(raw) {
  const s = str(raw, 300).trim().replace(/^[<(["'`]+|[>)\]"'`,]+$/g, '');
  const m = /^([a-z][\w-]*)[:.](.+)$/i.exec(s);
  return m ? `${m[1].toLowerCase()}:${m[2]}` : '';
}

/** A target as the engine keeps it, or null when it has no id or label. */
export function normalizeRefTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = refId(raw.id) || '';
  const kind = str(raw.kind, 40) || id.split(':')[0];
  const label = str(raw.label, 200).trim();
  if (!id || !kind || !label) return null;
  const t = { id, kind, label };
  const aliases = Array.isArray(raw.aliases) ? [...new Set(raw.aliases.map((a) => str(a, 200).trim()).filter((a) => a && a !== label))].slice(0, 12) : [];
  if (aliases.length) t.aliases = aliases;
  for (const k of ['detail', 'icon', 'url', 'status']) if (str(raw[k]).trim()) t[k] = str(raw[k], 600);
  if (raw.focus && typeof raw.focus === 'object') t.focus = raw.focus;
  if (Array.isArray(raw.touches)) { const ts = raw.touches.map(refId).filter(Boolean); if (ts.length) t.touches = [...new Set(ts)].slice(0, 60); }
  if (Array.isArray(raw.reviews)) t.reviews = raw.reviews.filter((r) => r && typeof r === 'object').slice(0, 20);
  return t;
}

/** A console search entry (engines/search.ts) → a ref target. Words on a page and log rows are not things to open. */
export function refTargetFromSearch(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string') return null;
  const [pre, ...rest] = e.id.split(':');
  const key = rest.join(':');
  const f = e.focus ?? {};
  const kw = Array.isArray(e.keywords) ? e.keywords.filter((k) => typeof k === 'string') : [];
  let kind; let id; const aliases = [];
  switch (pre) {
    case 'view': kind = 'screen'; id = `screen:${key}`; break;
    case 'dialog': kind = 'dialog'; id = `dialog:${key}`; break;
    case 'settings-tab': kind = 'settings'; id = `settings:${key}`; aliases.push(str(e.label).replace(/\s+settings$/i, '')); break;
    case 'settings-panel': case 'settings-group': kind = 'section'; id = `section:${f.tab ?? ''}/${key}`; break;
    case 'setting': kind = 'setting'; id = `setting:${key}`; break;
    case 'action': kind = 'action'; id = `action:${key}`; break;
    case 'plugin': kind = 'plugin'; id = `plugin:${key}`; aliases.push(key); break;
    case 'window': kind = 'window'; id = `window:${key}`; break;
    case 'build': { kind = 'build'; const bid = kw[0] || key.split(':').pop(); id = `build:${bid}`; if (/^[a-z0-9][\w-]*-[\w-]+$/.test(bid)) aliases.push(bid); break; }
    case 'asset': {
      const [type, ...ids] = rest; const aid = ids.join(':');
      kind = type === 'toolbar' ? 'toolbar' : /menu$/.test(type ?? '') ? 'menu' : 'component';
      id = kind === 'component' ? `component:${type}.${aid}` : `${kind}:${aid}`; break;
    }
    case 'feature': kind = 'note'; id = `note:feature.${key}`; break;
    default: return null; // text:, live:, built:, pending:, framework-feature: and others are not a part of the UI to open
  }
  return normalizeRefTarget({ id, kind, label: e.label, aliases, detail: e.detail, icon: e.icon, focus: e.focus });
}

/** The phrases to look for, longest first; one phrase can name several targets. Two targets with one id are merged (first wins, the second fills gaps). */
export function refIndex(targets) {
  const byId = new Map();
  for (const raw of Array.isArray(targets) ? targets : []) {
    const t = raw && raw.id && raw.label && raw.kind ? raw : normalizeRefTarget(raw);
    if (!t) continue;
    const had = byId.get(t.id);
    if (!had) { byId.set(t.id, t); continue; }
    // the same thing from two sources: the first one's fields stand, the second fills what is missing
    const merged = { ...t, ...had };
    const aliases = [...new Set([...(had.aliases ?? []), ...(t.aliases ?? []), ...(t.label !== had.label ? [t.label] : [])])].filter((a) => a !== had.label);
    if (aliases.length) merged.aliases = aliases;
    byId.set(t.id, merged);
  }
  const phrases = new Map(); // folded phrase → { phrase, exact: Set of case-exact spellings | null, ids }
  const addPhrase = (p, t, via) => {
    const phrase = str(p, 200).trim();
    if (!phrase || letters(phrase) < REF_MIN_LETTERS) return;
    const words = phrase.split(/\s+/).length;
    const f = fold(phrase);
    if (words === 1 && REF_STOP_WORDS.has(f)) return;
    const caseSensitive = words === 1 && !/[-_/.]/.test(phrase); // one plain word: only as written; ids like build-ids any case
    let e = phrases.get(f);
    if (!e) { e = { phrase: f, caseSensitive, spellings: new Set(), ids: [] }; phrases.set(f, e); }
    if (caseSensitive) e.spellings.add(phrase); else e.caseSensitive = false;
    if (!e.ids.some((x) => x.id === t.id)) e.ids.push({ id: t.id, via });
  };
  for (const t of byId.values()) {
    addPhrase(t.label, t, 'label');
    for (const a of t.aliases ?? []) addPhrase(a, t, 'alias');
  }
  return { byId, phrases: [...phrases.values()].sort((a, b) => b.phrase.length - a.phrase.length) };
}

/** Explicit refs declared in a text: every `touches: a, b` list → [{ id, start, end }]. */
export function parseTouches(text) {
  const t = str(text, MAX_TEXT); const out = [];
  for (const m of t.matchAll(TOUCHES_RE)) {
    const listStart = m.index + m[0].indexOf(m[1]);
    for (const part of m[1].matchAll(/[^\s,]+/g)) {
      const raw = part[0].replace(/[)\]'"`]+$/, '');
      if (!ID_RE.test(raw)) continue;
      out.push({ id: refId(raw), start: listStart + part.index, end: listStart + part.index + raw.length });
    }
  }
  return out;
}

function pickTarget(ids, index, explicit, hint) {
  const known = ids.map((x) => ({ ...x, t: index.byId.get(x.id) })).filter((x) => x.t);
  if (!known.length) return null;
  const hinted = hint ? known.filter((x) => x.t.kind === hint) : [];
  const pool = hinted.length ? hinted : known;
  const declared = pool.filter((x) => explicit.has(x.id));
  const order = [...(declared.length ? declared : pool)].sort((a, b) => kindRank(a.t.kind) - kindRank(b.t.kind));
  const best = order[0];
  const tied = order.filter((x) => kindRank(x.t.kind) === kindRank(best.t.kind));
  return { best, others: (declared.length ? declared : pool).filter((x) => x !== best).map((x) => x.id), ambiguous: !declared.length && (tied.length > 1 || pool.length > 1), hinted: !!hinted.length };
}

/**
 * Every reference in `text`. opts: { explicit?: ids that win (a build's declared touches), files?: known repo paths
 * (a path not in it is still a link, `missing: true`), prs?: known PR numbers }.
 */
export function findRefs(text, index, opts = {}) {
  const t = str(text, MAX_TEXT);
  const idx = index && index.byId ? index : refIndex(index);
  const declared = parseTouches(t);
  const explicit = new Set([...(Array.isArray(opts.explicit) ? opts.explicit.map(refId).filter(Boolean) : []), ...declared.map((d) => d.id)]);
  const cands = [];
  // 1. explicit ids where they are written
  for (const d of declared) {
    const target = idx.byId.get(d.id);
    cands.push({ start: d.start, end: d.end, ref: d.id, kind: target?.kind ?? d.id.split(':')[0], via: 'explicit', prio: 0, ...(target ? {} : { missing: true }) });
  }
  // 2. patterns
  for (const m of t.matchAll(PR_RE)) {
    const n = m[1]; const id = `pr:${n}`; const known = idx.byId.has(id) || (Array.isArray(opts.prs) && opts.prs.map(String).includes(n));
    cands.push({ start: m.index, end: m.index + m[0].length, ref: id, kind: 'pr', via: 'pattern', prio: 1, ...(known ? {} : { unknown: true }) });
  }
  for (const m of t.matchAll(FILE_RE)) {
    const p = m[1].replace(/[.,:;]+$/, ''); const id = `file:${p}`;
    const missing = Array.isArray(opts.files) ? !opts.files.includes(p) : false;
    cands.push({ start: m.index, end: m.index + p.length, ref: id, kind: 'file', via: 'pattern', prio: 1, ...(missing ? { missing: true } : {}) });
  }
  // 3. names
  const low = fold(t);
  // (a case change that moves offsets is rare: then names are skipped and only explicit refs and patterns link)
  for (const p of low.length === t.length ? idx.phrases : []) {
    let from = 0;
    for (;;) {
      const at = low.indexOf(p.phrase, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + p.phrase.length;
      if (isWordChar(t[at - 1]) || isWordChar(t[end]) || t[at - 1] === '-' || t[end] === '-') continue;
      if (p.caseSensitive && !p.spellings.has(t.slice(at, end))) continue;
      // a kind word right after the name ("Terminal settings")
      const after = /^\s+([A-Za-z]+)\b/.exec(t.slice(end, end + 20));
      const hint = after ? REF_KIND_WORDS[after[1].toLowerCase()] : undefined;
      const pick = pickTarget(p.ids, idx, explicit, hint);
      if (!pick) continue;
      const spanEnd = pick.hinted ? end + after[0].length : end;
      cands.push({ start: at, end: spanEnd, ref: pick.best.id, kind: idx.byId.get(pick.best.id).kind, via: pick.best.via, prio: 2,
        ...(pick.ambiguous ? { ambiguous: true } : {}), ...(pick.others.length ? { candidates: pick.others } : {}) });
    }
  }
  // non-overlapping: explicit, then patterns, then the longest name; ties go to the earliest
  cands.sort((a, b) => a.prio - b.prio || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const taken = [];
  for (const c of cands) if (!taken.some((x) => c.start < x.end && x.start < c.end)) taken.push(c);
  taken.sort((a, b) => a.start - b.start);
  const spans = taken.map(({ prio, ...c }) => ({ ...c, text: t.slice(c.start, c.end) }));
  const refs = [...new Set([...explicit, ...spans.map((s) => s.ref)])];
  return { $axf: REF_FRAME, text: t, spans, refs };
}

/** Text split into plain runs and spans, for a renderer. */
export function refSegments(text, spans) {
  const t = str(text, MAX_TEXT); const out = []; let at = 0;
  for (const s of [...(spans ?? [])].sort((a, b) => a.start - b.start)) {
    if (s.start < at || s.end > t.length) continue;
    if (s.start > at) out.push({ text: t.slice(at, s.start) });
    out.push({ text: t.slice(s.start, s.end), span: s });
    at = s.end;
  }
  if (at < t.length) out.push({ text: t.slice(at) });
  return out;
}

/** One ref by id, or by name ("plan studio", "terminal settings") → { target } | { candidates, ambiguous } | { missing }. */
export function resolveRef(index, query) {
  const idx = index && index.byId ? index : refIndex(index);
  const q = str(query, 300).trim();
  if (!q) return { missing: true, query: q };
  const id = refId(q);
  if (id && idx.byId.has(id)) return { target: idx.byId.get(id) };
  if (/^#?\d{1,6}$/.test(q)) { const pid = `pr:${q.replace('#', '')}`; return idx.byId.has(pid) ? { target: idx.byId.get(pid) } : { target: { id: pid, kind: 'pr', label: `PR #${q.replace('#', '')}` }, unknown: true }; }
  if (id && /^(file|pr)$/.test(id.split(':')[0])) return { target: { id, kind: id.split(':')[0], label: id.slice(id.indexOf(':') + 1) }, unknown: true };
  const r = findRefs(q, idx);
  const whole = r.spans.find((s) => s.start === 0 && s.end === q.length && !s.missing);
  if (whole) return { target: idx.byId.get(whole.ref) ?? { id: whole.ref, kind: whole.kind, label: whole.text }, ...(whole.ambiguous ? { ambiguous: true, candidates: (whole.candidates ?? []).map((c) => idx.byId.get(c)).filter(Boolean) } : {}) };
  // a few words: every target whose label holds them all, best first
  const words = fold(q).split(/\s+/).filter(Boolean);
  const hits = [...idx.byId.values()].filter((t) => { const l = fold([t.label, ...(t.aliases ?? [])].join(' ')); return words.every((w) => l.includes(w)); })
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.label.length - b.label.length);
  if (!hits.length) return id ? { missing: true, query: q, id } : { missing: true, query: q };
  return hits.length === 1 ? { target: hits[0] } : { target: hits[0], ambiguous: true, candidates: hits.slice(1, 8) };
}

/** Which builds are changing a target right now (their declared touches name it, or their text links to it). */
export function refChangedBy(refIdValue, builds) {
  const id = refId(refIdValue) || str(refIdValue);
  return (Array.isArray(builds) ? builds : []).filter((b) => b && b.status !== 'live' && Array.isArray(b.touches) && b.touches.includes(id));
}

/** Where a ref leads, in one line for a peek card: what it is, whether it is live, which build is changing it. */
export function refPeek(span, index, builds) {
  const idx = index && index.byId ? index : refIndex(index);
  const target = idx.byId.get(span?.ref) ?? null;
  const changing = refChangedBy(span?.ref, builds).map((b) => ({ id: b.id, label: b.label }));
  const state = !target ? (span?.kind === 'pr' || span?.kind === 'file' ? (span?.missing ? 'missing' : 'link') : 'new') : changing.length ? 'changing' : 'live';
  const line = state === 'new' ? `New${changing[0] ? ` in ${changing[0].label}` : ''}, not live yet`
    : state === 'changing' ? `Being changed by ${changing.map((c) => c.label).join(', ')}, not live yet`
      : state === 'missing' ? 'Not in this checkout' : '';
  return { ref: span?.ref, kind: target?.kind ?? span?.kind, label: target?.label ?? span?.text ?? span?.ref, detail: target?.detail ?? '', state, line, changing,
    candidates: (span?.candidates ?? []).map((c) => idx.byId.get(c)).filter(Boolean).map((c) => ({ id: c.id, kind: c.kind, label: c.label, detail: c.detail ?? '' })) };
}

/** Builds-store build → a target (its declared touches come from its detail, steps and notes). */
export function refTargetFromBuild(b) {
  if (!b || typeof b !== 'object' || !b.id) return null;
  const text = [b.detail, ...(b.steps ?? []).map((s) => s?.text), ...(b.notes ?? []).map((n) => n?.text)].filter(Boolean).join('\n');
  const touches = [...(Array.isArray(b.touches) ? b.touches : []), ...parseTouches(text).map((d) => d.id)];
  const status = b.status === 'complete' ? 'live' : str(b.status, 40);
  return normalizeRefTarget({ id: `build:${b.id}`, kind: 'build', label: b.title || b.id, aliases: [b.id], detail: `Build · ${b.status ?? ''}${b.branch ? ` · ${b.branch}` : ''}${b.pr ? ` · PR #${String(b.pr).replace(/\D/g, '')}` : ''}`, icon: 'play', status, touches });
}
