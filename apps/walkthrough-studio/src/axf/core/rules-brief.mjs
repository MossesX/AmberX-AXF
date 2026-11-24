/**
 * Rules briefs (rules-briefs@1; build token-optimize, Brett, Nov 6 2026: optimization first). A headless build no longer
 * loads the CLAUDE.md chain: it gets its task brief plus a short rules brief. Brett keeps several saved briefs, each with
 * conditions for when it runs; a brief can instead be generated on the fly before send from the rules files.
 *
 * Generated briefs are plain code (keyword scoring over the rule bullets), so a launch never costs a token to prepare.
 * Pure: file reads are injected. Store and CLI: framework/cli/rules-brief.mjs. Seed: framework/schemas/rules-briefs.json.
 */
export const FRAME = 'rules-briefs@1';
export const BRIEF = 'rules-brief@1';
export const MODES = ['saved', 'generate'];
export const MAX_TEXT = 12000;
export const DEFAULT_MAX_CHARS = 9000;
export const DEFAULT_SOURCES = ['_claude/shared/rules/RULES.md', '_claude/rules/RULES.md'];
/** The conditions a brief can name. Open list: a new key is a line here. `list` = any of; `flag` = must equal. */
export const CONDITIONS = [
  { key: 'surface', kind: 'list', label: 'Where it runs', hint: 'headless, console-launch, swarm…' },
  { key: 'model', kind: 'list', label: 'Model', hint: 'opus, fable' },
  { key: 'agent', kind: 'list', label: 'Agent', hint: 'agent ids or names' },
  { key: 'job', kind: 'list', label: 'Job type', hint: 'feature-build, ui-review…' },
  { key: 'build', kind: 'list', label: 'Build id', hint: 'ids; a trailing * matches a prefix' },
  { key: 'profile', kind: 'list', label: 'Build profile', hint: 'current, refactor…' },
  { key: 'keywords', kind: 'list', label: 'Task brief mentions', hint: 'any of these words' },
  { key: 'ui', kind: 'flag', label: 'Changes UI', hint: 'worked out from the task brief' },
];
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 40);

export const tokensOf = (text) => Math.ceil(String(text ?? '').length / 4);
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/** One brief, cleaned. Null when it has no id or no name. */
export function normBrief(b, i = 0) {
  if (!isObj(b)) return null;
  const name = String(b.name ?? '').trim().slice(0, 80);
  const id = slug(b.id || name);
  if (!id || !name) return null;
  const mode = MODES.includes(b.mode) ? b.mode : 'saved';
  const when = {};
  const src = isObj(b.when) ? b.when : {};
  for (const c of CONDITIONS) {
    if (c.kind === 'flag') { if (typeof src[c.key] === 'boolean') when[c.key] = src[c.key]; } else { const l = strs(src[c.key]); if (l.length) when[c.key] = l; }
  }
  const out = { $axf: BRIEF, id, name, enabled: b.enabled !== false, mode, order: Number.isFinite(b.order) ? b.order : (i + 1) * 10, when, text: String(b.text ?? '').slice(0, MAX_TEXT) };
  if (mode === 'generate') {
    const n = Number(b.maxChars);
    out.maxChars = Number.isFinite(n) && n >= 200 ? Math.min(n, MAX_TEXT) : 3000;
    const sources = strs(b.sources).filter((p) => !p.startsWith('/') && !p.includes('..'));
    out.sources = sources.length ? sources : DEFAULT_SOURCES;
  }
  return out;
}

/** The whole document, cleaned, duplicates dropped (first id wins), briefs in run order. */
export function normDoc(d, seed = null) {
  const src = isObj(d) && d.$axf === FRAME && Array.isArray(d.briefs) ? d : seed;
  const seen = new Set();
  const briefs = [];
  (src?.briefs ?? []).forEach((b, i) => { const n = normBrief(b, i); if (n && !seen.has(n.id)) { seen.add(n.id); briefs.push(n); } });
  briefs.sort((a, b) => a.order - b.order);
  const max = Number(src?.maxChars);
  return { $axf: FRAME, lean: src?.lean !== false, maxChars: Number.isFinite(max) && max >= 500 ? Math.min(max, 40000) : DEFAULT_MAX_CHARS, updatedAt: String(src?.updatedAt ?? ''), updatedBy: String(src?.updatedBy ?? ''), briefs };
}

const UI_WORDS = /\b(ui|gui|screen|screens|dialog|popup|pop-up|banner|toolbar|menu|tab|tabs|page|widget|button|settings tab|settings panel|\.tsx|\.css|viewer|editor|panel)\b/i;
/** Does this task brief change UI? A word test, tuned to err towards yes: a stray UI rule costs little, a missing one costs a rebuild. */
export const touchesUi = (task) => UI_WORDS.test(String(task ?? ''));

/** What a launch knows about itself. */
export function launchContext({ task = '', surface = 'headless', model = '', agent = '', job = '', build = '', profile = '' } = {}) {
  return { task: String(task), surface: surface || 'headless', model: String(model).toLowerCase(), agent: String(agent).toLowerCase(), job: String(job).toLowerCase(), build: String(build).toLowerCase(), profile: String(profile).toLowerCase(), ui: touchesUi(task) };
}

const hit = (want, have) => { const w = want.toLowerCase(); return w.endsWith('*') ? have.startsWith(w.slice(0, -1)) : have === w; };
/** Why a brief doesn't apply to this launch, or '' when it does. */
export function whyNot(b, ctx) {
  if (!b.enabled) return 'switched off';
  for (const c of CONDITIONS) {
    const want = b.when[c.key];
    if (want === undefined) continue;
    if (c.kind === 'flag') { if (Boolean(ctx[c.key]) !== want) return `${c.label}: ${want ? 'no' : 'yes'}`; continue; }
    if (c.key === 'keywords') { const t = ctx.task.toLowerCase(); if (!want.some((w) => t.includes(w.toLowerCase()))) return `${c.label}: none of ${want.join(', ')}`; continue; }
    if (c.key === 'model') { if (!want.some((w) => ctx.model.includes(w.toLowerCase()))) return `${c.label}: ${ctx.model || 'unknown'}`; continue; }
    if (!want.some((w) => hit(w, ctx[c.key] ?? ''))) return `${c.label}: ${ctx[c.key] || 'unknown'}`;
  }
  return '';
}

/** The rule bullets of a Markdown rules file: [{title, line}]. Pure. */
export function ruleBullets(text) {
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    const m = /^- \*\*(.+?)\*\*[:.]?\s*(.*)$/.exec(raw);
    if (m) out.push({ title: m[1].replace(/\s*\(.*$/, '').replace(/[:.]$/, '').trim(), line: raw.slice(2).replace(/\*\*/g, '').replace(/<!--.*?-->/g, '').trim() });
  }
  return out;
}
const STOP = new Set('about after again against all also and any are because been before being build builds but can claude each every for from get has have here into its just like make more must new not now off once one only other our out over see she should some step steps than that the their them then there these they this those through use used using was were what when where which while who will with work would you your'.split(' '));
const wordsOf = (s) => (String(s).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w));
/** First sentence of a rule, clipped: the digest line. */
function digestLine(r, room) {
  const body = r.line.replace(/\s*\((?:[A-Z][a-z]{2} \d|Brett)[^)]*\)/, '');
  const m = /^(.{60,}?[.!?])\s/.exec(body);
  const first = (m ? m[1] : body).trim();
  return `- ${first.length > room ? `${first.slice(0, room - 1)}…` : first}`;
}
/** A digest of the rules most related to the task, built before send: every line scored by words shared with the task. */
export function generate(brief, task, read) {
  const taskWords = new Set(wordsOf(task));
  const rules = [];
  for (const p of brief.sources ?? DEFAULT_SOURCES) for (const r of ruleBullets(read(p) ?? '')) rules.push(r);
  const seen = new Set();
  const scored = rules.map((r, i) => {
    const w = new Set(wordsOf(r.title));
    let score = 0;
    for (const x of w) if (taskWords.has(x)) score += 3;
    for (const x of new Set(wordsOf(r.line))) if (taskWords.has(x)) score += 1;
    return { r, i, score: score / Math.sqrt(Math.max(1, wordsOf(r.line).length)) };
  }).filter((s) => s.score > 0 && !seen.has(s.r.title) && seen.add(s.r.title)).sort((a, b) => b.score - a.score || a.i - b.i);
  const head = brief.text.trim() || `### ${brief.name}`;
  const lines = [head];
  let used = head.length;
  for (const s of scored) {
    const l = digestLine(s.r, 400);
    if (used + l.length + 1 > brief.maxChars) break;
    lines.push(l); used += l.length + 1;
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * The rules brief for one launch: every enabled brief whose conditions match, in order, generated ones built now, cut
 * at the document's maxChars (a brief that would pass it is left out whole, never cut mid-rule).
 * → { text, chars, tokens, picked: [{id,name,mode,chars}], skipped: [{id,name,why}] }
 */
export function compose(doc, ctx, read = () => null) {
  const picked = []; const skipped = []; const parts = [];
  let used = 0;
  for (const b of doc.briefs) {
    const why = whyNot(b, ctx);
    if (why) { skipped.push({ id: b.id, name: b.name, why }); continue; }
    const text = (b.mode === 'generate' ? generate(b, ctx.task, read) : b.text).trim();
    if (!text) { skipped.push({ id: b.id, name: b.name, why: 'nothing to send' }); continue; }
    if (used + text.length > doc.maxChars) { skipped.push({ id: b.id, name: b.name, why: `over the ${doc.maxChars} character cap` }); continue; }
    parts.push(text); used += text.length + 2;
    picked.push({ id: b.id, name: b.name, mode: b.mode, chars: text.length });
  }
  const text = parts.join('\n\n');
  return { text, chars: text.length, tokens: tokensOf(text), picked, skipped };
}
