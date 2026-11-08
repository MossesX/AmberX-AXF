/**
 * demo rules — demonstration@1, book@1, clip@1 and docs@1 (Brett, Nov 7 2026: "I want to be able to generate a
 * demonstration … write my own book with it … interactive HTML, TypeScript documentation … every time we generate a
 * clip it needs to automatically attach a shitload of keywords to it, and it needs itself to be an asset going to a
 * registry"). Four asset types in the asset@1 envelope, all built on the walkthrough engine (walkthrough@1 steps
 * { say, do, target }, the shape Molly's guide plays and the recorder films):
 *
 *   demonstration  a narrated demo of one glossary entry: steps (say, do = console action, target = what to highlight,
 *                  wait), the surface it runs on (live UI, a preview, the recorder), a voice, demos chained after it,
 *                  the entry it is about and the entries it covers, auto-tagged keywords, where it was generated from.
 *   book           chapters made of items (glossary entries, demonstrations, clips, another book's chapter) with the
 *                  wizard's plan (total and per-chapter minutes, style, theme, narrator), the documentation to make
 *                  with it (depth, format, how interactive) and the outputs (video, chapter clips).
 *   clip           a generated clip / demo / chapter / walkthrough / video: its source, media (video, poster,
 *                  captions, seconds), where and how it was recorded, a transcript, chained clips, the entries shown
 *                  and a large auto-extracted keyword set.
 *   docs           generated documentation: its source (a book, a demonstration, entries), depth, format,
 *                  interactivity, the files it is made of, when, and a hash of the sources it was made from.
 *
 * ONE registry (DEMO_ENUMS, DEMO_LIMITS, the defaults) drives both validators (core/validate.ts and the build engine),
 * the normalisers, the generator (a demonstration from a glossary entry), the book planner (wizard, minutes, moves,
 * outline), the walkthrough conversion, the clip tagger and the docs plan every driver uses (the console plugin, the
 * CLI, MCP). Pure, no I/O, no network, no model: generating a demonstration, planning a book, tagging a clip or
 * planning docs costs zero tokens. Unknown fields are dropped. Kotlin twin deferred (PORTING.md).
 */

export const DEMONSTRATION_TYPE = 'demonstration';
export const BOOK_TYPE = 'book';
export const CLIP_TYPE = 'clip';
export const DOCS_TYPE = 'docs';
/** The four types, in asset-types.json order. */
export const DEMO_TYPES = [DEMONSTRATION_TYPE, BOOK_TYPE, CLIP_TYPE, DOCS_TYPE];
export const WALKTHROUGH_FRAME = 'walkthrough@1';

/** Open lists: later builds add words here, never a new type. */
export const DEMO_ENUMS = {
  surface: ['live', 'preview', 'recorder'],
  generatedFrom: ['glossary', 'manual', 'book', 'help-intro', 'recorder'],
  bookStyle: ['quickstart', 'tutorial', 'tour', 'reference', 'deep-dive'],
  docsDepth: ['light', 'standard', 'deep', 'extreme'],
  docsFormat: ['markdown', 'html', 'interactive-html-ts'],
  docsInteractive: ['none', 'examples', 'live'],
  clipKind: ['clip', 'demo', 'chapter', 'walkthrough', 'video'],
  sourceKind: ['entry', 'demonstration', 'book', 'chapter', 'walkthrough', 'manual'],
  docsSource: ['book', 'demonstration', 'entries'],
  fileKind: ['index', 'page', 'asset', 'script', 'style', 'data', 'media'],
};

export const DEMO_LIMITS = {
  steps: [1, 60], say: 600, action: 200, target: 200, highlight: 80, title: 120, wait: 30000, chain: 20, keywords: 200, entries: 200,
  speed: [0.5, 2], totalMinutes: 600, chapterMinutes: 120, chapters: 200, items: 500, note: 300, files: 2000, transcript: 2000, seconds: 86400, path: 300,
};

/** Reading speed used for length estimates (words per minute) and the pause every step costs. */
export const DEMO_WPM = 160;
export const STEP_PAUSE_S = 1.2;

export const DEMONSTRATION_DEFAULTS = {
  about: '', entries: [], app: 'console', surface: 'live', steps: [], voice: { narrator: '', speed: 1 }, chain: [], keywords: [],
  generated: { from: 'manual', at: '', build: '' }, editable: true,
};
export const BOOK_DEFAULTS = {
  about: '', plan: { totalMinutes: 0, chapterMinutes: 5, style: 'tutorial', theme: '', narrator: '', speed: 1 }, chapters: [],
  docs: { enabled: false, depth: 'standard', format: 'html', interactive: 'none', includeApi: true, includeScreens: true },
  outputs: { video: true, chapterClips: true }, keywords: [],
};
export const CLIP_DEFAULTS = {
  kind: 'clip', source: { kind: 'manual', id: '', chapter: '' }, media: { video: '', poster: '', captions: '', audio: '', seconds: 0, width: 0, height: 0 },
  recorded: { at: '', app: '', url: '', viewport: { width: 0, height: 0 }, designPackage: '', voice: '' }, transcript: [], chain: [], entries: [], keywords: [],
};
export const DOCS_DEFAULTS = {
  source: { kind: 'entries', id: '', entries: [] }, depth: 'standard', format: 'html', interactive: 'none', files: [], generatedAt: '', sourceHash: '', build: '', keywords: [],
};

/* ================================================================== shared pieces */

const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** An id inside an asset (a chapter, a step): one character is enough. */
const KEY = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A glossary entry id: `<kind>:<rest>` (plugin:build-manager, control:console-web:ui-review:approve, concept:asset). */
const ENTRY_ID = /^[a-z][a-z0-9-]*:[^\s]{1,200}$/;
/** An asset reference inside a book: demonstration/<id>, clip/<id>, book/<id>, book/<id>#<chapter>. */
const ASSET_REF = /^(demonstration|clip|book)\/([a-z0-9][a-z0-9-]{1,47})(?:#([a-z0-9][a-z0-9-]{0,47}))?$/;
/** A console action spec (walkthrough@1: the same rule as the Molly guide), never a URL or script. */
const ACTION = /^[a-z][a-z0-9._-]*(:[^\s<>"'`]{0,160})?$/;
const BAD_SCHEME = /^(javascript|data|vbscript|file|https?):/i;
const BAD_TARGET = /[<>{}`]|^javascript/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const STOP = new Set('the a an and or of to in on for is it its as by at be with from this that are was not no can any every each one into than then when what which who how your you his her their our out up all also only more most so do does use used uses here there like just'.split(' '));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = (list, v, d) => (list.includes(v) ? v : d);
const slugs = (v, max) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && SLUG.test(x)))].slice(0, max);
const ids = (v, max) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && ENTRY_ID.test(x)))].slice(0, max);

/** A relative path inside a data folder or the repo, or an https URL: no leading slash, no `..`, no backslashes. */
export const safePath = (p) => typeof p === 'string' && p.length > 0 && p.length <= DEMO_LIMITS.path && (/^https:\/\/[^\s"'<>]+$/.test(p) || (!p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[a-z]+:/i.test(p)));

/** Turn any text into an id (slug, 1..48; an asset id needs 2, which every generated name gives). */
export function slugify(s, fallback = 'item') {
  const x = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return KEY.test(x) ? x : fallback;
}

/**
 * Auto-tagging: every meaningful word of every part (lower case, split on anything that isn't a letter, digit, @ . or -),
 * stop words and bare numbers dropped, deduped in order, up to `max` (clips get the large set). Pure.
 */
export function autoKeywords(parts, max = DEMO_LIMITS.keywords) {
  const out = new Set();
  const walk = (p) => {
    if (Array.isArray(p)) { p.forEach(walk); return; }
    if (p === null || p === undefined) return;
    for (const w of String(p).toLowerCase().split(/[^a-z0-9@.-]+/)) {
      const k = w.replace(/^[.-]+|[.-]+$/g, '');
      if (k.length > 2 && !STOP.has(k) && !/^\d+$/.test(k)) out.add(k);
      if (out.size >= max) return;
    }
  };
  walk(parts);
  return [...out].slice(0, max);
}

/** Words in a text (for length estimates). */
export const wordCount = (s) => (String(s ?? '').match(/\S+/g) ?? []).length;

/** Parse a book item reference: an asset (`demonstration/x`, `clip/x`, `book/x#ch`) or a glossary entry id. null when neither. */
export function parseRef(ref) {
  const r = str(ref, 260);
  const m = ASSET_REF.exec(r);
  if (m) return { kind: m[1], id: m[2], chapter: m[3] ?? '', ref: r };
  if (ENTRY_ID.test(r)) return { kind: 'entry', id: r, chapter: '', ref: r };
  return null;
}
export const makeRef = (kind, id, chapter = '') => (kind === 'entry' ? id : `${kind}/${id}${chapter ? `#${chapter}` : ''}`);

/* ================================================================== steps (walkthrough@1 shape + highlight, wait, title) */

function cleanStep(s) {
  if (!isObj(s)) return null;
  const say = str(s.say, DEMO_LIMITS.say);
  if (!say) return null;
  let act = str(s.do, DEMO_LIMITS.action);
  if (act && (BAD_SCHEME.test(act) || !ACTION.test(act))) act = '';
  let target = str(s.target, DEMO_LIMITS.target);
  if (BAD_TARGET.test(target)) target = '';
  const out = { say, do: act, target };
  const title = str(s.title, DEMO_LIMITS.title); if (title) out.title = title;
  const highlight = str(s.highlight, DEMO_LIMITS.highlight); if (highlight) out.highlight = highlight;
  const wait = int(s.wait, 0, DEMO_LIMITS.wait, 0); if (wait) out.wait = wait;
  const id = str(s.id, 48); if (KEY.test(id)) out.id = id;
  return out;
}

function stepErrors(steps, where) {
  const e = [];
  if (!Array.isArray(steps)) return [`${where} must be a list of steps { say, do?, target?, highlight?, wait? }`];
  if (steps.length < DEMO_LIMITS.steps[0] || steps.length > DEMO_LIMITS.steps[1]) e.push(`${where} needs ${DEMO_LIMITS.steps[0]} to ${DEMO_LIMITS.steps[1]} steps`);
  steps.slice(0, DEMO_LIMITS.steps[1]).forEach((s, i) => {
    const at = `${where}[${i}]`;
    if (!isObj(s)) { e.push(`${at} must be an object`); return; }
    if (typeof s.say !== 'string' || !s.say.trim()) e.push(`${at}.say is what the narrator says (required)`);
    else if (s.say.length > DEMO_LIMITS.say) e.push(`${at}.say is longer than ${DEMO_LIMITS.say} characters`);
    if (s.do !== undefined && s.do !== '' && (typeof s.do !== 'string' || BAD_SCHEME.test(s.do) || !ACTION.test(s.do))) e.push(`${at}.do must be a console action spec (e.g. nav:builds, settings.open:plugins), never a URL or script`);
    if (s.target !== undefined && (typeof s.target !== 'string' || BAD_TARGET.test(s.target))) e.push(`${at}.target must be a data-axf-id, view id or CSS selector without < > { } \``);
    if (s.wait !== undefined && !(Number.isInteger(s.wait) && s.wait >= 0 && s.wait <= DEMO_LIMITS.wait)) e.push(`${at}.wait must be 0 to ${DEMO_LIMITS.wait} ms`);
    if (s.highlight !== undefined && typeof s.highlight !== 'string') e.push(`${at}.highlight must be the label shown on the highlight`);
  });
  return e;
}

/** Seconds a list of steps takes to play: words at DEMO_WPM, plus each step's wait and a pause per step. */
export function stepsSeconds(steps, wpm = DEMO_WPM) {
  let s = 0;
  for (const st of Array.isArray(steps) ? steps : []) s += (wordCount(st?.say) / wpm) * 60 + (Number(st?.wait) || 0) / 1000 + STEP_PAUSE_S;
  return Math.round(s * 10) / 10;
}

/* ================================================================== demonstration@1 */

export function demonstrationErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const e = [];
  if (raw.about !== undefined && raw.about !== '' && !(typeof raw.about === 'string' && ENTRY_ID.test(raw.about))) e.push('data.about must be the glossary entry id this demonstrates (e.g. plugin:build-manager)');
  if (raw.entries !== undefined && (!Array.isArray(raw.entries) || raw.entries.length > DEMO_LIMITS.entries || raw.entries.some((x) => typeof x !== 'string' || !ENTRY_ID.test(x)))) e.push(`data.entries must be up to ${DEMO_LIMITS.entries} glossary entry ids`);
  if (raw.app !== undefined && !/^[a-z][a-z0-9-]{0,39}$/.test(raw.app ?? '')) e.push('data.app must be an app id (console, axhub-web, amberx-droid…)');
  if (raw.surface !== undefined && !DEMO_ENUMS.surface.includes(raw.surface)) e.push(`data.surface must be one of ${DEMO_ENUMS.surface.join(', ')}`);
  e.push(...stepErrors(raw.steps, 'data.steps'));
  if (raw.voice !== undefined) {
    if (!isObj(raw.voice)) e.push('data.voice must be { narrator?, speed? }');
    else if (raw.voice.speed !== undefined && !(typeof raw.voice.speed === 'number' && raw.voice.speed >= DEMO_LIMITS.speed[0] && raw.voice.speed <= DEMO_LIMITS.speed[1])) e.push(`data.voice.speed must be ${DEMO_LIMITS.speed[0]} to ${DEMO_LIMITS.speed[1]}`);
  }
  if (raw.chain !== undefined && (!Array.isArray(raw.chain) || raw.chain.length > DEMO_LIMITS.chain || raw.chain.some((x) => !SLUG.test(x ?? '')))) e.push(`data.chain must be up to ${DEMO_LIMITS.chain} demonstration ids played after this one`);
  if (raw.keywords !== undefined && (!Array.isArray(raw.keywords) || raw.keywords.length > DEMO_LIMITS.keywords || raw.keywords.some((x) => typeof x !== 'string'))) e.push(`data.keywords must be up to ${DEMO_LIMITS.keywords} words`);
  if (raw.generated !== undefined) {
    if (!isObj(raw.generated)) e.push('data.generated must be { from, at?, build? }');
    else if (raw.generated.from !== undefined && !DEMO_ENUMS.generatedFrom.includes(raw.generated.from)) e.push(`data.generated.from must be one of ${DEMO_ENUMS.generatedFrom.join(', ')}`);
  }
  if (raw.editable !== undefined && typeof raw.editable !== 'boolean') e.push('data.editable must be true or false');
  return e;
}

export function normalizeDemonstration(raw) {
  const o = isObj(raw) ? raw : {};
  const D = DEMONSTRATION_DEFAULTS;
  const v = isObj(o.voice) ? o.voice : {}; const g = isObj(o.generated) ? o.generated : {};
  const steps = (Array.isArray(o.steps) ? o.steps : []).map(cleanStep).filter(Boolean).slice(0, DEMO_LIMITS.steps[1]);
  const about = typeof o.about === 'string' && ENTRY_ID.test(o.about) ? o.about : D.about;
  return {
    about,
    entries: [...new Set([...(about ? [about] : []), ...ids(o.entries, DEMO_LIMITS.entries)])].slice(0, DEMO_LIMITS.entries),
    app: /^[a-z][a-z0-9-]{0,39}$/.test(o.app ?? '') ? o.app : D.app,
    surface: pick(DEMO_ENUMS.surface, o.surface, D.surface),
    steps,
    voice: { narrator: str(v.narrator, 80), speed: num(v.speed, DEMO_LIMITS.speed[0], DEMO_LIMITS.speed[1], D.voice.speed) },
    chain: slugs(o.chain, DEMO_LIMITS.chain),
    keywords: autoKeywords([Array.isArray(o.keywords) ? o.keywords : []], DEMO_LIMITS.keywords),
    generated: { from: pick(DEMO_ENUMS.generatedFrom, g.from, D.generated.from), at: str(g.at, 40), build: str(g.build, 120) },
    editable: o.editable !== false,
  };
}

/** How long a demonstration plays (seconds), at its own voice speed. */
export const demonstrationSeconds = (data) => Math.round((stepsSeconds(data?.steps) / (num(data?.voice?.speed, 0.5, 2, 1))) * 10) / 10;

/** A demonstration asset (envelope + data) as walkthrough@1, the shape Molly's guide window plays. */
export function demonstrationToWalkthrough(asset) {
  const d = normalizeDemonstration(asset?.data);
  return { $axf: WALKTHROUGH_FRAME, id: slugify(asset?.id, 'demonstration'), title: str(asset?.name, DEMO_LIMITS.title) || 'Demonstration', app: d.app, steps: d.steps.map((s) => ({ say: s.say, do: s.do, target: s.target })), source: 'demonstration' };
}

/**
 * The help target a glossary entry's id names (control:<scope>:<plugin>:<target> → <target>; screen:<scope>:view:<id> →
 * view:<id>); '' for entries that are not on a screen.
 */
export function helpTargetOf(entry) {
  const id = str(entry?.id, 300);
  const m = /^(control|screen|setting):([a-z0-9-]+):(.*)$/.exec(id);
  if (!m) return '';
  let rest = m[3];
  if (entry?.plugin && rest.startsWith(`${entry.plugin}:`)) rest = rest.slice(entry.plugin.length + 1);
  return rest;
}

/** The console view a glossary entry lives on: a `view:<id>` in its `where`, its own screen id, or its plugin's view (through `lookup`). */
export function viewOf(entry, lookup) {
  const fromWhere = (e) => (Array.isArray(e?.where) ? e.where.find((w) => typeof w === 'string' && w.startsWith('view:')) : undefined);
  const own = fromWhere(entry);
  if (own) return own.slice(5);
  const t = helpTargetOf(entry);
  if (t.startsWith('view:')) return t.slice(5);
  if (entry?.plugin && typeof lookup === 'function') {
    const p = lookup(`plugin:${entry.plugin}`);
    const pv = fromWhere(p);
    if (pv) return pv.slice(5);
  }
  return '';
}

const joinWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const sentence = (s) => { const t = str(s, DEMO_LIMITS.say); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };

/**
 * Generate a demonstration from a glossary entry (glossary-catalog@1 entry: id, term, kind, category, summary, detail,
 * app, plugin, where, api, related, children, keywords). `lookup(id)` answers other entries (for the plugin's view and
 * the names of related entries). Returns { id, name, description, data } ready for the asset@1 envelope. Zero tokens.
 */
export function demonstrationFromEntry(entry, { lookup, at = '', build = '', app } = {}) {
  const term = str(entry?.term, DEMO_LIMITS.title) || str(entry?.id, 120) || 'this';
  const kindLabel = str(entry?.kind, 40).replace(/-/g, ' ');
  const view = viewOf(entry, lookup);
  const target = helpTargetOf(entry);
  const isSetting = entry?.kind === 'setting' || /^(toggle|slider|field|tab)$/.test(entry?.tags?.[1] ?? '');
  const steps = [];
  // 1. what it is, moving the console to it
  const open = view ? `nav:${view}` : isSetting && entry?.plugin ? `settings.open:${entry.plugin}` : entry?.kind === 'setting' ? 'settings.open:plugins' : '';
  steps.push({ say: `${term}${kindLabel ? `, a ${kindLabel}` : ''}: ${sentence(entry?.summary) || 'here it is.'}`, do: open, target: target && !target.startsWith('view:') ? target : '', title: term, highlight: target && !target.startsWith('view:') ? term : '' });
  // 2. the longer story
  const detail = str(entry?.detail, DEMO_LIMITS.say);
  if (detail && detail !== str(entry?.summary, DEMO_LIMITS.say)) steps.push({ say: detail, do: '', target: '' , title: 'What it does' });
  // 3. where it appears
  const where = [entry?.app, ...(Array.isArray(entry?.where) ? entry.where.filter((w) => typeof w === 'string' && !w.includes(':')) : [])].filter(Boolean);
  if (where.length) steps.push({ say: `You find it in ${joinWords([...new Set(where)].slice(0, 4))}${entry?.plugin ? `, part of the ${lookup?.(`plugin:${entry.plugin}`)?.term ?? entry.plugin} plugin` : ''}.`, do: '', target: target && !target.startsWith('view:') ? target : '', title: 'Where' });
  // 4. its API
  const api = Array.isArray(entry?.api) ? entry.api : [];
  const rest = api.filter((a) => a?.kind === 'rest').map((a) => a.name); const mcp = api.filter((a) => a?.kind === 'mcp').map((a) => a.name); const cli = api.filter((a) => a?.kind === 'cli').map((a) => a.name);
  if (rest.length || mcp.length || cli.length) {
    const bits = [];
    if (rest.length) bits.push(`over REST (${rest.slice(0, 2).join(', ')}${rest.length > 2 ? ` and ${rest.length - 2} more` : ''})`);
    if (mcp.length) bits.push(`as the MCP tool${mcp.length > 1 ? 's' : ''} ${mcp.slice(0, 3).join(', ')}`);
    if (cli.length) bits.push(`from the command line (${cli[0]})`);
    steps.push({ say: `You can also reach it from outside the console: ${joinWords(bits)}.`, do: '', target: '', title: 'API' });
  }
  // 5. what it contains
  const children = (Array.isArray(entry?.children) ? entry.children : []).map((id) => lookup?.(id)).filter(Boolean);
  if (children.length) steps.push({ say: `It brings ${children.length} piece${children.length === 1 ? '' : 's'} of its own, like ${joinWords(children.slice(0, 3).map((c) => c.term))}.`, do: '', target: '', title: 'Contains' });
  // 6. see also
  const related = (Array.isArray(entry?.related) ? entry.related : []).map((id) => lookup?.(id)).filter(Boolean);
  if (related.length) steps.push({ say: `Related: ${joinWords(related.slice(0, 4).map((r) => r.term))}.`, do: '', target: '', title: 'See also' });
  const appId = app || (entry?.app === 'axHub web' ? 'axhub-web' : entry?.app === 'AmberX' ? 'amberx-droid' : 'console');
  const data = normalizeDemonstration({
    about: entry?.id, entries: [entry?.id, ...(Array.isArray(entry?.related) ? entry.related : [])], app: appId, surface: 'live', steps,
    keywords: demonstrationKeywords(entry, steps), generated: { from: 'glossary', at, build },
  });
  return { id: slugify(`demo-${entry?.id ?? term}`, 'demo'), name: `${term} demonstration`, description: `A generated demonstration of ${term}: ${str(entry?.summary, 200)}`, data };
}

/** The keyword set a demonstration carries: the entry's words, kind, category, app, plugin, API names and every step's words and targets. */
export function demonstrationKeywords(entry, steps = []) {
  return autoKeywords([
    'demonstration', 'demo', 'walkthrough', entry?.term, entry?.kind, entry?.category, entry?.app, entry?.plugin, entry?.keywords ?? [], entry?.id,
    (Array.isArray(entry?.api) ? entry.api : []).map((a) => a?.name), (Array.isArray(steps) ? steps : []).map((s) => [s?.title, s?.target, s?.do, s?.say]),
  ], DEMO_LIMITS.keywords);
}

/* ================================================================== book@1 */

function planErrors(p) {
  if (!isObj(p)) return ['data.plan must be { totalMinutes, chapterMinutes, style, theme?, narrator?, speed? }'];
  const e = [];
  if (p.totalMinutes !== undefined && !(Number.isInteger(p.totalMinutes) && p.totalMinutes >= 0 && p.totalMinutes <= DEMO_LIMITS.totalMinutes)) e.push(`data.plan.totalMinutes must be 0 (no limit) to ${DEMO_LIMITS.totalMinutes}`);
  if (p.chapterMinutes !== undefined && !(Number.isInteger(p.chapterMinutes) && p.chapterMinutes >= 1 && p.chapterMinutes <= DEMO_LIMITS.chapterMinutes)) e.push(`data.plan.chapterMinutes must be 1 to ${DEMO_LIMITS.chapterMinutes}`);
  if (p.style !== undefined && !DEMO_ENUMS.bookStyle.includes(p.style)) e.push(`data.plan.style must be one of ${DEMO_ENUMS.bookStyle.join(', ')}`);
  if (p.theme !== undefined && p.theme !== '' && !SLUG.test(p.theme ?? '')) e.push('data.plan.theme must be a design package id');
  if (p.speed !== undefined && !(typeof p.speed === 'number' && p.speed >= DEMO_LIMITS.speed[0] && p.speed <= DEMO_LIMITS.speed[1])) e.push(`data.plan.speed must be ${DEMO_LIMITS.speed[0]} to ${DEMO_LIMITS.speed[1]}`);
  return e;
}

export function docsOptionErrors(d, where = 'data.docs', requireAll = false) {
  if (!isObj(d)) return [`${where} must be { enabled?, depth, format, interactive }`];
  const e = [];
  if (d.enabled !== undefined && typeof d.enabled !== 'boolean') e.push(`${where}.enabled must be true or false`);
  const on = requireAll || d.enabled === true;
  if ((on || d.depth !== undefined) && !DEMO_ENUMS.docsDepth.includes(d.depth)) e.push(`${where}.depth must be one of ${DEMO_ENUMS.docsDepth.join(', ')}`);
  if ((on || d.format !== undefined) && !DEMO_ENUMS.docsFormat.includes(d.format)) e.push(`${where}.format must be one of ${DEMO_ENUMS.docsFormat.join(', ')}`);
  if ((on || d.interactive !== undefined) && !DEMO_ENUMS.docsInteractive.includes(d.interactive)) e.push(`${where}.interactive must be one of ${DEMO_ENUMS.docsInteractive.join(', ')}`);
  if (d.interactive === 'live' && d.format !== 'interactive-html-ts') e.push(`${where}.interactive "live" needs format "interactive-html-ts" (live components run only there)`);
  if (d.interactive === 'examples' && d.format === 'markdown') e.push(`${where}.interactive "examples" needs an HTML format (markdown can't run them)`);
  return e;
}

export function bookErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const e = [...planErrors(raw.plan)];
  if (!Array.isArray(raw.chapters)) e.push('data.chapters must be a list of chapters { id, title, minutes?, intro?, items }');
  else {
    if (raw.chapters.length > DEMO_LIMITS.chapters) e.push(`data.chapters holds more than ${DEMO_LIMITS.chapters} chapters`);
    const seen = new Set();
    raw.chapters.slice(0, DEMO_LIMITS.chapters).forEach((c, i) => {
      const at = `data.chapters[${i}]`;
      if (!isObj(c)) { e.push(`${at} must be an object`); return; }
      if (!KEY.test(c.id ?? '')) e.push(`${at}.id must be a slug (lowercase letters, digits and dashes)`);
      else if (seen.has(c.id)) e.push(`${at}.id "${c.id}" is used twice`);
      seen.add(c.id);
      if (typeof c.title !== 'string' || !c.title.trim()) e.push(`${at}.title is required`);
      if (c.minutes !== undefined && !(Number.isInteger(c.minutes) && c.minutes >= 0 && c.minutes <= DEMO_LIMITS.chapterMinutes)) e.push(`${at}.minutes must be 0 (its share) to ${DEMO_LIMITS.chapterMinutes}`);
      if (c.items !== undefined) {
        if (!Array.isArray(c.items) || c.items.length > DEMO_LIMITS.items) e.push(`${at}.items must be a list of up to ${DEMO_LIMITS.items} items { ref, minutes?, note? }`);
        else c.items.forEach((it, j) => {
          if (!isObj(it) || !parseRef(it.ref)) e.push(`${at}.items[${j}].ref must be a glossary entry id or demonstration/<id>, clip/<id>, book/<id>#<chapter>`);
          else if (it.minutes !== undefined && !(Number.isInteger(it.minutes) && it.minutes >= 0 && it.minutes <= DEMO_LIMITS.chapterMinutes)) e.push(`${at}.items[${j}].minutes must be 0 (its share) to ${DEMO_LIMITS.chapterMinutes}`);
        });
      }
    });
  }
  if (raw.docs !== undefined) e.push(...docsOptionErrors(raw.docs));
  if (raw.outputs !== undefined) {
    if (!isObj(raw.outputs)) e.push('data.outputs must be { video?, chapterClips? }');
    else for (const k of ['video', 'chapterClips']) if (raw.outputs[k] !== undefined && typeof raw.outputs[k] !== 'boolean') e.push(`data.outputs.${k} must be true or false`);
  }
  if (raw.keywords !== undefined && (!Array.isArray(raw.keywords) || raw.keywords.some((x) => typeof x !== 'string'))) e.push('data.keywords must be a list of words');
  return e;
}

function cleanChapter(c, i) {
  if (!isObj(c)) return null;
  const items = (Array.isArray(c.items) ? c.items : []).map((it) => {
    if (!isObj(it)) return null;
    const ref = parseRef(it.ref);
    if (!ref) return null;
    const out = { ref: ref.ref };
    const minutes = int(it.minutes, 0, DEMO_LIMITS.chapterMinutes, 0); if (minutes) out.minutes = minutes;
    const note = str(it.note, DEMO_LIMITS.note); if (note) out.note = note;
    return out;
  }).filter(Boolean).slice(0, DEMO_LIMITS.items);
  return { id: KEY.test(c.id ?? '') ? c.id : slugify(c.title, `chapter-${i + 1}`), title: str(c.title, DEMO_LIMITS.title) || `Chapter ${i + 1}`, minutes: int(c.minutes, 0, DEMO_LIMITS.chapterMinutes, 0), intro: str(c.intro, DEMO_LIMITS.say), items, collapsed: c.collapsed === true };
}

export function normalizeDocsOptions(d, D = BOOK_DEFAULTS.docs) {
  const o = isObj(d) ? d : {};
  let format = pick(DEMO_ENUMS.docsFormat, o.format, D.format);
  let interactive = pick(DEMO_ENUMS.docsInteractive, o.interactive, D.interactive);
  if (interactive === 'live' && format !== 'interactive-html-ts') format = 'interactive-html-ts';
  if (interactive === 'examples' && format === 'markdown') interactive = 'none';
  return { enabled: o.enabled === true, depth: pick(DEMO_ENUMS.docsDepth, o.depth, D.depth), format, interactive, includeApi: o.includeApi !== false, includeScreens: o.includeScreens !== false };
}

export function normalizeBook(raw) {
  const o = isObj(raw) ? raw : {};
  const D = BOOK_DEFAULTS;
  const p = isObj(o.plan) ? o.plan : {}; const out = isObj(o.outputs) ? o.outputs : {};
  const seen = new Set();
  const chapters = (Array.isArray(o.chapters) ? o.chapters : []).map(cleanChapter).filter(Boolean).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, DEMO_LIMITS.chapters);
  return {
    about: str(o.about, 600),
    plan: {
      totalMinutes: int(p.totalMinutes, 0, DEMO_LIMITS.totalMinutes, D.plan.totalMinutes), chapterMinutes: int(p.chapterMinutes, 1, DEMO_LIMITS.chapterMinutes, D.plan.chapterMinutes),
      style: pick(DEMO_ENUMS.bookStyle, p.style, D.plan.style), theme: SLUG.test(p.theme ?? '') ? p.theme : '', narrator: str(p.narrator, 80), speed: num(p.speed, DEMO_LIMITS.speed[0], DEMO_LIMITS.speed[1], D.plan.speed),
    },
    chapters,
    docs: normalizeDocsOptions(o.docs),
    outputs: { video: out.video !== false, chapterClips: out.chapterClips !== false },
    keywords: autoKeywords([Array.isArray(o.keywords) ? o.keywords : []], DEMO_LIMITS.keywords),
  };
}

/**
 * The wizard's plan: how many chapters a book of `totalMinutes` gets at `chapterMinutes` each (or `count` chapters), and
 * the minutes of each (the remainder goes to the last). No total = `count` chapters (default 3) of chapterMinutes each.
 */
export function bookPlan({ totalMinutes = 0, chapterMinutes = 5, count = 0 } = {}) {
  const total = int(totalMinutes, 0, DEMO_LIMITS.totalMinutes, 0);
  const per = int(chapterMinutes, 1, DEMO_LIMITS.chapterMinutes, 5);
  const n = Number.isInteger(count) && count > 0 ? Math.min(count, DEMO_LIMITS.chapters) : total ? Math.max(1, Math.ceil(total / per)) : 3;
  const minutes = [];
  if (total) { const base = Math.floor(total / n); for (let i = 0; i < n; i++) minutes.push(base); minutes[n - 1] += total - base * n; } else for (let i = 0; i < n; i++) minutes.push(per);
  return { count: n, totalMinutes: total || per * n, chapterMinutes: per, minutes };
}

/** A new book's data from the wizard: the plan, `count` empty chapters named Chapter 1…, docs and outputs as asked. */
export function newBook({ title = '', about = '', totalMinutes = 0, chapterMinutes = 5, count = 0, style = 'tutorial', theme = '', narrator = '', speed = 1, docs, outputs } = {}) {
  const plan = bookPlan({ totalMinutes, chapterMinutes, count });
  return normalizeBook({
    about: about || title, plan: { totalMinutes: plan.totalMinutes, chapterMinutes: plan.chapterMinutes, style, theme, narrator, speed },
    chapters: plan.minutes.map((m, i) => ({ id: `chapter-${i + 1}`, title: `Chapter ${i + 1}`, minutes: totalMinutes ? m : 0, items: [] })),
    docs, outputs, keywords: autoKeywords([title, about, style], 40),
  });
}

/**
 * Minutes per chapter and per item: explicit minutes win; the rest share what is left of the total (or the plan's
 * chapter minutes when the book has no total). Returns { total, chapters: [{ id, minutes, items: [{ ref, minutes }] }] }.
 */
export function bookMinutes(data) {
  const b = normalizeBook(data);
  const explicit = b.chapters.reduce((s, c) => s + c.minutes, 0);
  const open = b.chapters.filter((c) => !c.minutes).length;
  const share = open ? (b.plan.totalMinutes ? Math.max(0, b.plan.totalMinutes - explicit) / open : b.plan.chapterMinutes) : 0;
  const chapters = b.chapters.map((c) => {
    const minutes = c.minutes || Math.round(share * 10) / 10;
    const itemExplicit = c.items.reduce((s, it) => s + (it.minutes ?? 0), 0);
    const itemOpen = c.items.filter((it) => !it.minutes).length;
    const itemShare = itemOpen ? Math.max(0, minutes - itemExplicit) / itemOpen : 0;
    return { id: c.id, title: c.title, minutes, items: c.items.map((it) => ({ ref: it.ref, minutes: it.minutes ?? Math.round(itemShare * 10) / 10 })) };
  });
  return { total: Math.round(chapters.reduce((s, c) => s + c.minutes, 0) * 10) / 10, chapters };
}

/** Move an item from one spot to another (drag, context menu, column icons): pure, returns a new book data. Out-of-range = unchanged. */
export function moveItem(data, from, to) {
  const b = normalizeBook(data);
  const src = b.chapters.find((c) => c.id === from?.chapter); const dst = b.chapters.find((c) => c.id === to?.chapter);
  if (!src || !dst || !Number.isInteger(from.index) || from.index < 0 || from.index >= src.items.length) return b;
  const [item] = src.items.splice(from.index, 1);
  const at = Number.isInteger(to.index) ? Math.max(0, Math.min(dst.items.length, to.index)) : dst.items.length;
  dst.items.splice(at, 0, item);
  return b;
}

/** Move a chapter to another position (0-based). */
export function moveChapter(data, fromIndex, toIndex) {
  const b = normalizeBook(data);
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= b.chapters.length) return b;
  const [c] = b.chapters.splice(fromIndex, 1);
  b.chapters.splice(Math.max(0, Math.min(b.chapters.length, Number.isInteger(toIndex) ? toIndex : b.chapters.length)), 0, c);
  return b;
}

/** Add an item (a ref) to a chapter at an index (default: the end); a ref already in that chapter moves instead of doubling. */
export function addItem(data, chapterId, ref, index) {
  const b = normalizeBook(data);
  const c = b.chapters.find((x) => x.id === chapterId);
  const r = parseRef(ref);
  if (!c || !r || c.items.length >= DEMO_LIMITS.items) return b;
  const have = c.items.findIndex((it) => it.ref === r.ref);
  if (have >= 0) return moveItem(b, { chapter: chapterId, index: have }, { chapter: chapterId, index });
  c.items.splice(Number.isInteger(index) ? Math.max(0, Math.min(c.items.length, index)) : c.items.length, 0, { ref: r.ref });
  return b;
}

/**
 * The outline of one or more books for a collapsible tree: a node per book, chapters under it, items under those,
 * with minutes and counts. `resolve(ref)` may answer { title } for an item's label.
 */
export function bookOutline(books, resolve) {
  return (Array.isArray(books) ? books : []).map((a) => {
    const d = normalizeBook(a?.data); const m = bookMinutes(d);
    return {
      key: `book/${a?.id ?? ''}`, label: str(a?.name, DEMO_LIMITS.title) || a?.id || 'Book', minutes: m.total, count: d.chapters.reduce((s, c) => s + c.items.length, 0),
      children: d.chapters.map((c, i) => ({
        key: `book/${a?.id ?? ''}#${c.id}`, label: c.title, minutes: m.chapters[i].minutes, collapsed: c.collapsed, count: c.items.length,
        children: c.items.map((it, j) => { const r = parseRef(it.ref); return { key: `${a?.id ?? ''}#${c.id}/${j}`, ref: it.ref, kind: r?.kind ?? 'entry', label: resolve?.(it.ref)?.title ?? r?.id ?? it.ref, minutes: m.chapters[i].items[j].minutes, note: it.note ?? '' }; }),
      })),
    };
  });
}

/**
 * Preview the whole book as one walkthrough@1: each chapter's intro, then every item's steps (`resolve(ref)` answers
 * { title, steps? } — a demonstration's steps, a clip's transcript as steps, or a generated demo for an entry). Capped
 * at the walkthrough step limit per chapter so the preview stays playable.
 */
export function bookToWalkthrough(asset, resolve, { maxSteps = 400 } = {}) {
  const d = normalizeBook(asset?.data);
  const steps = [];
  for (const c of d.chapters) {
    steps.push({ say: c.intro || `Chapter: ${c.title}.`, do: '', target: '' });
    for (const it of c.items) {
      const r = resolve?.(it.ref);
      for (const s of (Array.isArray(r?.steps) ? r.steps : [{ say: r?.title ? `Next: ${r.title}.` : `Next: ${it.ref}.` }]).map(cleanStep).filter(Boolean)) steps.push({ say: s.say, do: s.do, target: s.target });
      if (steps.length >= maxSteps) break;
    }
    if (steps.length >= maxSteps) break;
  }
  return { $axf: WALKTHROUGH_FRAME, id: slugify(asset?.id, 'book'), title: str(asset?.name, DEMO_LIMITS.title) || 'Book', app: 'console', steps: steps.slice(0, maxSteps), source: 'book' };
}

/* ================================================================== clip@1 */

export function clipErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const e = [];
  if (raw.kind !== undefined && !DEMO_ENUMS.clipKind.includes(raw.kind)) e.push(`data.kind must be one of ${DEMO_ENUMS.clipKind.join(', ')}`);
  const s = raw.source;
  if (!isObj(s) || !DEMO_ENUMS.sourceKind.includes(s.kind)) e.push(`data.source.kind must be one of ${DEMO_ENUMS.sourceKind.join(', ')}`);
  else if (s.kind !== 'manual' && !(typeof s.id === 'string' && s.id.trim())) e.push(`data.source.id names the ${s.kind} this clip came from`);
  const m = raw.media;
  if (!isObj(m)) e.push('data.media must be { video?, poster?, captions?, audio?, seconds }');
  else {
    if (!(typeof m.seconds === 'number' && m.seconds >= 0 && m.seconds <= DEMO_LIMITS.seconds)) e.push(`data.media.seconds must be 0 to ${DEMO_LIMITS.seconds}`);
    for (const k of ['video', 'poster', 'captions', 'audio']) if (m[k] !== undefined && m[k] !== '' && !safePath(m[k])) e.push(`data.media.${k} must be a path inside the data folder or an https URL`);
  }
  if (raw.recorded !== undefined) {
    if (!isObj(raw.recorded)) e.push('data.recorded must be { at, app?, url?, viewport?, designPackage?, voice? }');
    else if (raw.recorded.at !== undefined && raw.recorded.at !== '' && !ISO.test(raw.recorded.at)) e.push('data.recorded.at must be an ISO time');
  }
  if (raw.transcript !== undefined && (!Array.isArray(raw.transcript) || raw.transcript.length > DEMO_LIMITS.transcript || raw.transcript.some((t) => !isObj(t) || typeof t.say !== 'string' || typeof t.at !== 'number'))) e.push(`data.transcript must be up to ${DEMO_LIMITS.transcript} lines { at (seconds), say }`);
  if (raw.chain !== undefined && (!Array.isArray(raw.chain) || raw.chain.length > DEMO_LIMITS.chain || raw.chain.some((x) => !SLUG.test(x ?? '')))) e.push(`data.chain must be up to ${DEMO_LIMITS.chain} clip ids played after this one`);
  if (raw.entries !== undefined && (!Array.isArray(raw.entries) || raw.entries.some((x) => typeof x !== 'string' || !ENTRY_ID.test(x)))) e.push('data.entries must be glossary entry ids');
  if (raw.keywords !== undefined && (!Array.isArray(raw.keywords) || raw.keywords.length > DEMO_LIMITS.keywords || raw.keywords.some((x) => typeof x !== 'string'))) e.push(`data.keywords must be up to ${DEMO_LIMITS.keywords} words`);
  return e;
}

export function normalizeClip(raw) {
  const o = isObj(raw) ? raw : {};
  const D = CLIP_DEFAULTS;
  const s = isObj(o.source) ? o.source : {}; const m = isObj(o.media) ? o.media : {}; const r = isObj(o.recorded) ? o.recorded : {}; const vp = isObj(r.viewport) ? r.viewport : {};
  const path = (p) => (safePath(p) ? p : '');
  return {
    kind: pick(DEMO_ENUMS.clipKind, o.kind, D.kind),
    source: { kind: pick(DEMO_ENUMS.sourceKind, s.kind, D.source.kind), id: str(s.id, 300), chapter: str(s.chapter, 48) },
    media: { video: path(m.video), poster: path(m.poster), captions: path(m.captions), audio: path(m.audio), seconds: num(m.seconds, 0, DEMO_LIMITS.seconds, 0), width: int(m.width, 0, 16384, 0), height: int(m.height, 0, 16384, 0) },
    recorded: { at: ISO.test(r.at ?? '') ? r.at : '', app: str(r.app, 40), url: /^https:\/\/[^\s"'<>]+$/.test(r.url ?? '') ? r.url : '', viewport: { width: int(vp.width, 0, 16384, 0), height: int(vp.height, 0, 16384, 0) }, designPackage: SLUG.test(r.designPackage ?? '') ? r.designPackage : '', voice: str(r.voice, 80) },
    transcript: (Array.isArray(o.transcript) ? o.transcript : []).filter((t) => isObj(t) && typeof t.say === 'string' && typeof t.at === 'number').map((t) => ({ at: Math.max(0, Math.round(t.at * 100) / 100), say: str(t.say, DEMO_LIMITS.say) })).slice(0, DEMO_LIMITS.transcript),
    chain: slugs(o.chain, DEMO_LIMITS.chain),
    entries: ids(o.entries, DEMO_LIMITS.entries),
    keywords: autoKeywords([Array.isArray(o.keywords) ? o.keywords : []], DEMO_LIMITS.keywords),
  };
}

/**
 * The large keyword set every generated clip carries: the clip's kind and source, every entry's term / kind / category /
 * keywords, the plugins and assets shown, the actions and targets of every step, every word of the narration, the
 * app, the design package and the voice. `entries` are glossary entries, `steps` walkthrough steps.
 */
export function clipKeywords({ kind, source, entries = [], steps = [], transcript = [], recorded = {}, extra = [] } = {}) {
  return autoKeywords([
    'clip', kind, source?.kind, source?.id, source?.chapter,
    entries.map((e) => [e?.term, e?.kind, e?.category, e?.app, e?.plugin, e?.keywords ?? [], e?.id, e?.summary]),
    steps.map((s) => [s?.title, s?.do, s?.target, s?.highlight, s?.say]),
    transcript.map((t) => t?.say),
    recorded?.app, recorded?.designPackage, recorded?.voice, extra,
  ], DEMO_LIMITS.keywords);
}

/**
 * A clip from a demonstration asset that was recorded: media + recording facts in, source / entries / transcript (one
 * line per step at its estimated time) / keywords out. Returns { id, name, description, data }.
 */
export function clipFromDemonstration(asset, media, recorded = {}, { entries = [], kind = 'demo', at = '' } = {}) {
  const d = normalizeDemonstration(asset?.data);
  let t = 0; const transcript = [];
  for (const s of d.steps) { transcript.push({ at: Math.round(t * 100) / 100, say: s.say }); t += (wordCount(s.say) / DEMO_WPM) * 60 / d.voice.speed + (s.wait ?? 0) / 1000 + STEP_PAUSE_S; }
  const seconds = typeof media?.seconds === 'number' && media.seconds > 0 ? media.seconds : Math.round(t * 10) / 10;
  const data = normalizeClip({
    kind, source: { kind: 'demonstration', id: asset?.id ?? '' }, media: { ...(isObj(media) ? media : {}), seconds }, recorded: { at: recorded.at || at, app: recorded.app || d.app, ...recorded },
    transcript, entries: d.entries, keywords: clipKeywords({ kind, source: { kind: 'demonstration', id: asset?.id }, entries, steps: d.steps, recorded, extra: [asset?.name, d.keywords] }),
  });
  return { id: slugify(`clip-${asset?.id ?? 'demo'}`, 'clip'), name: `${str(asset?.name, 100) || asset?.id || 'Demonstration'} (clip)`, description: `A recorded clip of ${str(asset?.name, 100) || asset?.id}: ${Math.round(seconds)} s.`, data };
}

/* ================================================================== docs@1 */

export function docsErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const e = [];
  const s = raw.source;
  if (!isObj(s) || !DEMO_ENUMS.docsSource.includes(s.kind)) e.push(`data.source.kind must be one of ${DEMO_ENUMS.docsSource.join(', ')}`);
  else if (s.kind === 'entries' ? !(Array.isArray(s.entries) && s.entries.length && s.entries.every((x) => typeof x === 'string' && ENTRY_ID.test(x))) : !SLUG.test(s.id ?? '')) e.push(s?.kind === 'entries' ? 'data.source.entries must list the glossary entry ids documented' : `data.source.id must be the ${s.kind} id documented`);
  e.push(...docsOptionErrors({ depth: raw.depth, format: raw.format, interactive: raw.interactive }, 'data', true));
  if (!Array.isArray(raw.files)) e.push('data.files must be a list of { path, kind, title?, bytes? }');
  else if (raw.files.length > DEMO_LIMITS.files) e.push(`data.files holds more than ${DEMO_LIMITS.files} files`);
  else raw.files.forEach((f, i) => {
    if (!isObj(f) || !safePath(f.path) || /^https:/.test(f.path ?? '')) e.push(`data.files[${i}].path must be a relative path inside the docs folder`);
    else if (!DEMO_ENUMS.fileKind.includes(f.kind)) e.push(`data.files[${i}].kind must be one of ${DEMO_ENUMS.fileKind.join(', ')}`);
  });
  if (raw.generatedAt !== undefined && raw.generatedAt !== '' && !ISO.test(raw.generatedAt)) e.push('data.generatedAt must be an ISO time');
  if (raw.keywords !== undefined && (!Array.isArray(raw.keywords) || raw.keywords.some((x) => typeof x !== 'string'))) e.push('data.keywords must be a list of words');
  return e;
}

export function normalizeDocs(raw) {
  const o = isObj(raw) ? raw : {};
  const D = DOCS_DEFAULTS;
  const s = isObj(o.source) ? o.source : {};
  const opt = normalizeDocsOptions({ enabled: true, depth: o.depth, format: o.format, interactive: o.interactive }, { ...D, depth: D.depth, format: D.format, interactive: D.interactive });
  return {
    source: { kind: pick(DEMO_ENUMS.docsSource, s.kind, D.source.kind), id: SLUG.test(s.id ?? '') ? s.id : '', entries: ids(s.entries, DEMO_LIMITS.entries) },
    depth: opt.depth, format: opt.format, interactive: opt.interactive,
    files: (Array.isArray(o.files) ? o.files : []).filter((f) => isObj(f) && safePath(f.path) && !/^https:/.test(f.path) && DEMO_ENUMS.fileKind.includes(f.kind)).map((f) => ({ path: f.path, kind: f.kind, title: str(f.title, DEMO_LIMITS.title), bytes: int(f.bytes, 0, 1e12, 0) })).slice(0, DEMO_LIMITS.files),
    generatedAt: ISO.test(o.generatedAt ?? '') ? o.generatedAt : '', sourceHash: str(o.sourceHash, 64), build: str(o.build, 120),
    keywords: autoKeywords([Array.isArray(o.keywords) ? o.keywords : []], DEMO_LIMITS.keywords),
  };
}

/** What each depth adds (the generator follows this list, the wizard shows it). */
export const DOCS_DEPTH_ABOUT = {
  light: 'One page: the book\'s chapters with a short summary of every item.',
  standard: 'An index page plus one page per chapter: every item\'s summary, detail, where it appears and its links.',
  deep: 'Standard, plus a page per item with its full API (REST, MCP, CLI), what it contains, what links to it, and the demonstration steps.',
  extreme: 'Deep, plus runnable examples for every item\'s API, live components embedded from the real app, a search index and the TypeScript sources: the real deal, not static pages.',
};

const ext = (format) => (format === 'markdown' ? 'md' : 'html');

/**
 * The files a documentation build makes, from the docs options and the book's chapters (`items(chapter)` → the item
 * refs). Pure: the generator writes exactly these. Interactive HTML + TS adds the runtime script, styles and the data
 * every page reads; `live` adds the live-frame script.
 */
export function docsPlan(options, chapters = []) {
  const o = normalizeDocsOptions({ ...(isObj(options) ? options : {}), enabled: true });
  const x = ext(o.format);
  const files = [{ path: `index.${x}`, kind: 'index', title: 'Contents' }];
  const level = DEMO_ENUMS.docsDepth.indexOf(o.depth);
  const chs = Array.isArray(chapters) ? chapters : [];
  if (level >= 1) for (const c of chs) files.push({ path: `chapters/${slugify(c?.id ?? c?.title, 'chapter')}.${x}`, kind: 'page', title: str(c?.title, DEMO_LIMITS.title) || 'Chapter' });
  if (level >= 2) {
    const seen = new Set();
    for (const c of chs) for (const it of Array.isArray(c?.items) ? c.items : []) {
      const r = parseRef(it?.ref ?? it);
      if (!r || seen.has(r.ref)) continue;
      seen.add(r.ref);
      files.push({ path: `items/${slugify(r.ref, 'item')}.${x}`, kind: 'page', title: r.ref });
    }
  }
  if (o.format !== 'markdown') files.push({ path: 'docs.css', kind: 'style', title: 'Styles (theme tokens)' });
  if (o.format === 'interactive-html-ts') {
    files.push({ path: 'docs.ts', kind: 'script', title: 'Interactive runtime (TypeScript)' }, { path: 'docs.js', kind: 'script', title: 'Interactive runtime (compiled)' }, { path: 'data/book.json', kind: 'data', title: 'The book and its entries' });
    if (level >= 3 || o.interactive !== 'none') files.push({ path: 'data/examples.json', kind: 'data', title: 'Runnable API examples' });
    if (o.interactive === 'live') files.push({ path: 'live.ts', kind: 'script', title: 'Live components (frames of the real app)' }, { path: 'live.js', kind: 'script', title: 'Live components (compiled)' });
  }
  if (level >= 3) files.push({ path: 'data/search.json', kind: 'data', title: 'Search index' });
  return { depth: o.depth, format: o.format, interactive: o.interactive, files };
}

/* ================================================================== one validator entry point + schemas */

/** Validation messages for the four types' data (empty for other types). Same messages in both validators. */
export function demoAssetErrors(type, raw) {
  if (type === DEMONSTRATION_TYPE) return demonstrationErrors(raw);
  if (type === BOOK_TYPE) return bookErrors(raw);
  if (type === CLIP_TYPE) return clipErrors(raw);
  if (type === DOCS_TYPE) return docsErrors(raw);
  return [];
}

/** Fill defaults and drop unknown fields for any of the four types (data only; never throws). */
export function normalizeDemoAsset(type, raw) {
  if (type === DEMONSTRATION_TYPE) return normalizeDemonstration(raw);
  if (type === BOOK_TYPE) return normalizeBook(raw);
  if (type === CLIP_TYPE) return normalizeClip(raw);
  if (type === DOCS_TYPE) return normalizeDocs(raw);
  return isObj(raw) ? raw : {};
}

const stepSchema = { type: 'object', required: ['say'], properties: { id: { type: 'string' }, say: { type: 'string', maxLength: DEMO_LIMITS.say }, do: { type: 'string', maxLength: DEMO_LIMITS.action }, target: { type: 'string', maxLength: DEMO_LIMITS.target }, highlight: { type: 'string', maxLength: DEMO_LIMITS.highlight }, title: { type: 'string' }, wait: { type: 'integer', minimum: 0, maximum: DEMO_LIMITS.wait } } };
const keywords = { type: 'array', maxItems: DEMO_LIMITS.keywords, items: { type: 'string' } };
const docsOpts = { depth: { enum: DEMO_ENUMS.docsDepth }, format: { enum: DEMO_ENUMS.docsFormat }, interactive: { enum: DEMO_ENUMS.docsInteractive } };

/** JSON Schema properties for editors (build engine → schemas/json/<type>.schema.json). */
export function demoSchemaProperties(type) {
  if (type === DEMONSTRATION_TYPE) return {
    about: { type: 'string', description: 'the glossary entry id this demonstrates' }, entries: { type: 'array', items: { type: 'string' }, maxItems: DEMO_LIMITS.entries },
    app: { type: 'string' }, surface: { enum: DEMO_ENUMS.surface }, steps: { type: 'array', minItems: DEMO_LIMITS.steps[0], maxItems: DEMO_LIMITS.steps[1], items: stepSchema },
    voice: { type: 'object', properties: { narrator: { type: 'string' }, speed: { type: 'number', minimum: DEMO_LIMITS.speed[0], maximum: DEMO_LIMITS.speed[1] } } },
    chain: { type: 'array', maxItems: DEMO_LIMITS.chain, items: { type: 'string' } }, keywords,
    generated: { type: 'object', properties: { from: { enum: DEMO_ENUMS.generatedFrom }, at: { type: 'string' }, build: { type: 'string' } } }, editable: { type: 'boolean' },
  };
  if (type === BOOK_TYPE) return {
    about: { type: 'string' },
    plan: { type: 'object', properties: { totalMinutes: { type: 'integer', minimum: 0, maximum: DEMO_LIMITS.totalMinutes }, chapterMinutes: { type: 'integer', minimum: 1, maximum: DEMO_LIMITS.chapterMinutes }, style: { enum: DEMO_ENUMS.bookStyle }, theme: { type: 'string' }, narrator: { type: 'string' }, speed: { type: 'number' } } },
    chapters: { type: 'array', maxItems: DEMO_LIMITS.chapters, items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' }, minutes: { type: 'integer', minimum: 0 }, intro: { type: 'string' }, collapsed: { type: 'boolean' }, items: { type: 'array', maxItems: DEMO_LIMITS.items, items: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' }, minutes: { type: 'integer', minimum: 0 }, note: { type: 'string' } } } } } } },
    docs: { type: 'object', properties: { enabled: { type: 'boolean' }, ...docsOpts, includeApi: { type: 'boolean' }, includeScreens: { type: 'boolean' } } },
    outputs: { type: 'object', properties: { video: { type: 'boolean' }, chapterClips: { type: 'boolean' } } }, keywords,
  };
  if (type === CLIP_TYPE) return {
    kind: { enum: DEMO_ENUMS.clipKind },
    source: { type: 'object', required: ['kind'], properties: { kind: { enum: DEMO_ENUMS.sourceKind }, id: { type: 'string' }, chapter: { type: 'string' } } },
    media: { type: 'object', required: ['seconds'], properties: { video: { type: 'string' }, poster: { type: 'string' }, captions: { type: 'string' }, audio: { type: 'string' }, seconds: { type: 'number', minimum: 0 }, width: { type: 'integer' }, height: { type: 'integer' } } },
    recorded: { type: 'object', properties: { at: { type: 'string' }, app: { type: 'string' }, url: { type: 'string' }, viewport: { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } } }, designPackage: { type: 'string' }, voice: { type: 'string' } } },
    transcript: { type: 'array', maxItems: DEMO_LIMITS.transcript, items: { type: 'object', required: ['at', 'say'], properties: { at: { type: 'number' }, say: { type: 'string' } } } },
    chain: { type: 'array', maxItems: DEMO_LIMITS.chain, items: { type: 'string' } }, entries: { type: 'array', items: { type: 'string' } }, keywords,
  };
  if (type === DOCS_TYPE) return {
    source: { type: 'object', required: ['kind'], properties: { kind: { enum: DEMO_ENUMS.docsSource }, id: { type: 'string' }, entries: { type: 'array', items: { type: 'string' } } } },
    ...docsOpts,
    files: { type: 'array', maxItems: DEMO_LIMITS.files, items: { type: 'object', required: ['path', 'kind'], properties: { path: { type: 'string' }, kind: { enum: DEMO_ENUMS.fileKind }, title: { type: 'string' }, bytes: { type: 'integer' } } } },
    generatedAt: { type: 'string' }, sourceHash: { type: 'string' }, build: { type: 'string' }, keywords,
  };
  return {};
}
