/**
 * Glossary walkthroughs (investor demos): the pure rules shared by the generator (walkthroughs.mjs, the server, the CLI)
 * and the console (the Walkthrough Generator page and the walkthrough player). No I/O, no imports, no model.
 *
 * Flow: pick glossary entries + write a prompt → a request (glossary-walkthrough-request@1) → a brief (markdown, what
 * Claude is asked) → the chain: one Claude call per feature, each answering a small JSON (steps, docs card, try-it), a
 * zero-token template standing in for any feature Claude did not answer → a saved walkthrough
 * (glossary-walkthrough@1), versioned, that plays back in the console or the demo sandbox with no live Claude.
 *
 * A walkthrough is also written out as AXF assets the rest of the plugin already knows: one demonstration@1 per feature
 * and one book@1 (style "tour") whose chapters are the features, so it shows in the Demonstration Designer, the Book
 * Builder and the glossary like everything else. The bundle file is the self-contained copy the sandbox plays.
 */

export const REQUEST_FRAME = 'glossary-walkthrough-request@1';
export const BUNDLE_FRAME = 'glossary-walkthrough@1';

/** Open lists: later builds add words here. */
export const WT_ENUMS = {
  audience: ['investors', 'customers', 'developers', 'team'],
  style: ['showcase', 'tour', 'tutorial', 'deep-dive'],
  depth: ['brief', 'standard', 'deep'],
  mode: ['template', 'claude'],
  stepKind: ['narrate', 'show', 'try', 'docs'],
  source: ['claude', 'template'],
};

export const WT_LIMITS = {
  terms: [1, 60], prompt: 2000, title: 120, about: 600, steps: [1, 12], say: 600, action: 200, target: 200, highlight: 80,
  stepTitle: 120, wait: 30000, points: 8, point: 300, headline: 200, versions: 50, related: 8, api: 12, note: 300,
};

export const WT_DEFAULTS = { audience: 'investors', style: 'showcase', depth: 'standard', tryIt: true, app: 'console', mode: 'claude', intro: true };

/** How many steps each depth asks per feature (the template trims to the same). */
export const DEPTH_STEPS = { brief: 3, standard: 5, deep: 8 };

const ENTRY_ID = /^[a-z][a-z0-9-]*:[^\s]{1,280}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const pick = (list, v, d) => (list.includes(v) ? v : d);
const int = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

export function slugify(s, fallback = 'walkthrough') {
  const out = String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return out.length >= 2 ? out : fallback;
}

/** A short stable hash (djb2, base 36) for ids and change detection. */
export function shortHash(s) {
  let h = 5381;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ================================================================== request */

export function requestErrors(raw) {
  if (!isObj(raw)) return ['the request must be an object'];
  const e = [];
  const terms = Array.isArray(raw.terms) ? raw.terms : null;
  if (!terms) e.push('terms must be a list of glossary entry ids');
  else {
    const good = terms.filter((t) => typeof t === 'string' && ENTRY_ID.test(t));
    if (good.length < WT_LIMITS.terms[0]) e.push('pick at least one glossary entry');
    if (new Set(good).size > WT_LIMITS.terms[1]) e.push(`at most ${WT_LIMITS.terms[1]} glossary entries per walkthrough`);
    const bad = terms.filter((t) => !(typeof t === 'string' && ENTRY_ID.test(t)));
    if (bad.length) e.push(`not glossary entry ids: ${bad.slice(0, 3).map(String).join(', ')}`);
  }
  if (raw.prompt !== undefined && typeof raw.prompt !== 'string') e.push('prompt must be text');
  else if (typeof raw.prompt === 'string' && raw.prompt.length > WT_LIMITS.prompt) e.push(`prompt is longer than ${WT_LIMITS.prompt} characters`);
  for (const k of ['audience', 'style', 'depth', 'mode']) {
    if (raw[k] !== undefined && !WT_ENUMS[k].includes(raw[k])) e.push(`${k} must be one of ${WT_ENUMS[k].join(', ')}`);
  }
  if (raw.id !== undefined && raw.id !== '' && !ID.test(raw.id)) e.push('id must be lowercase letters, digits and dashes (2 to 48)');
  return e;
}

/** The request with defaults filled in, unknown fields dropped, terms de-duplicated in the order picked. */
export function normalizeRequest(raw) {
  const o = isObj(raw) ? raw : {};
  const terms = [...new Set((Array.isArray(o.terms) ? o.terms : []).filter((t) => typeof t === 'string' && ENTRY_ID.test(t)))].slice(0, WT_LIMITS.terms[1]);
  const prompt = typeof o.prompt === 'string' ? o.prompt.trim().slice(0, WT_LIMITS.prompt) : '';
  const title = str(o.title, WT_LIMITS.title);
  return {
    $axf: REQUEST_FRAME,
    id: typeof o.id === 'string' && ID.test(o.id) ? o.id : '',
    title,
    prompt,
    terms,
    audience: pick(WT_ENUMS.audience, o.audience, WT_DEFAULTS.audience),
    style: pick(WT_ENUMS.style, o.style, WT_DEFAULTS.style),
    depth: pick(WT_ENUMS.depth, o.depth, WT_DEFAULTS.depth),
    mode: pick(WT_ENUMS.mode, o.mode, WT_DEFAULTS.mode),
    tryIt: o.tryIt !== false,
    intro: o.intro !== false,
    app: /^[a-z][a-z0-9-]{0,39}$/.test(o.app ?? '') ? o.app : WT_DEFAULTS.app,
  };
}

/** The walkthrough's id: the request's own, else its title, else a hash of the terms. */
export function walkthroughIdOf(request) {
  const r = normalizeRequest(request);
  if (r.id) return r.id;
  if (r.title) return slugify(r.title);
  return `walkthrough-${shortHash(r.terms.join(","))}`;
}

/** The walkthrough's title: the request's own, else built from the first terms. */
export function titleOf(request, entries = []) {
  const r = normalizeRequest(request);
  if (r.title) return r.title;
  const names = entries.map((e) => e?.term).filter(Boolean);
  if (!names.length) return 'Walkthrough';
  return str(names.length <= 3 ? `${names.join(', ')} walkthrough` : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`, WT_LIMITS.title);
}

const AUDIENCE_NOTE = {
  investors: 'Investors: lead with the value and what is unique, keep jargon out, show it working, one idea per step.',
  customers: 'Customers: what it does for them and how to use it, plain words, show the steps they would take.',
  developers: 'Developers: how it works, its API (REST, MCP, CLI) and contracts, exact names.',
  team: 'The team: where it lives, how it fits with the rest, what to watch for.',
};

/**
 * The brief (markdown): what the person asked, the audience, the features picked (with what the glossary says about
 * each) and the output contract every chain step answers. Shown before generating and saved with the walkthrough.
 */
export function briefOf(request, entries = []) {
  const r = normalizeRequest(request);
  const byId = new Map(entries.filter(Boolean).map((e) => [e.id, e]));
  const lines = [
    `# ${titleOf(r, entries)}`,
    '',
    '## Prompt (verbatim)',
    '',
    ...(r.prompt ? r.prompt.split('\n').map((l) => `> ${l}`) : ['> (no prompt: demonstrate and explain each feature)']),
    '',
    '## Shape',
    '',
    `- Audience: ${r.audience}. ${AUDIENCE_NOTE[r.audience]}`,
    `- Style: ${r.style}; depth: ${r.depth} (about ${DEPTH_STEPS[r.depth]} steps per feature).`,
    `- Try it: ${r.tryIt ? 'every feature ends with a step the viewer does themselves' : 'off'}.`,
    `- Plays in: ${r.app}, recorded ahead of time, no live model during playback.`,
    '',
    `## Features (${r.terms.length})`,
    '',
  ];
  r.terms.forEach((id, i) => {
    const e = byId.get(id);
    lines.push(e ? `${i + 1}. **${e.term}** (${e.kind}, \`${id}\`): ${str(e.summary, 300)}` : `${i + 1}. \`${id}\` (not in the glossary any more; skipped)`);
  });
  lines.push('', '## Each feature answers', '', '```json', FEATURE_SHAPE, '```');
  return lines.join('\n');
}

const FEATURE_SHAPE = `{
  "headline": "one line: why this matters",
  "points": ["2-5 short documentation points"],
  "steps": [{ "kind": "narrate|show|try|docs", "title": "short", "say": "what the narrator says", "do": "console action or empty", "target": "element to highlight or empty", "highlight": "label on the highlight" }]
}`;

/** The system prompt for each chain step. */
export const FEATURE_SYSTEM = [
  'You write one chapter of a guided, interactive product walkthrough of AmberX AXF (a cross-platform app framework whose UI is hot-swappable JSON assets) and its Dev Console.',
  'The walkthrough is generated ahead of time and played back later with no model: everything you write is read out loud and shown as-is.',
  'Answer with ONE JSON object and nothing else, shaped exactly like the example in the request.',
  'Rules: use only the actions and targets given in the request (or leave do/target empty); never invent screens, numbers or customers; short sentences a narrator can read; no markdown inside strings.',
].join(' ');

/**
 * The user message of one chain step: the brief's prompt and shape, the feature's glossary entry, the template steps
 * (the actions and targets that really exist) and the output contract.
 */
export function featurePrompt(request, entry, { template = [], index = 0, total = 1, related = [] } = {}) {
  const r = normalizeRequest(request);
  const n = DEPTH_STEPS[r.depth];
  const api = (Array.isArray(entry?.api) ? entry.api : []).slice(0, WT_LIMITS.api).map((a) => `${a.kind}: ${a.name}`);
  const acts = [...new Set(template.flatMap((s) => [s.do && `do "${s.do}"`, s.target && `target "${s.target}"`]).filter(Boolean))];
  const text = [
    `Walkthrough prompt: ${r.prompt || 'Demonstrate and explain these features.'}`,
    `Audience: ${r.audience}. ${AUDIENCE_NOTE[r.audience]}`,
    `Style: ${r.style}. This is feature ${index + 1} of ${total}.`,
    '',
    `Feature: ${entry?.term ?? ''} (${entry?.kind ?? ''}, id ${entry?.id ?? ''})`,
    `Category: ${entry?.category ?? ''}`,
    `Summary: ${str(entry?.summary, 400)}`,
    entry?.detail ? `Detail: ${str(entry.detail, 900)}` : '',
    entry?.app ? `Appears in: ${[entry.app, ...(entry.where ?? []).filter((w) => !String(w).includes(':'))].join(', ')}` : '',
    api.length ? `API: ${api.join('; ')}` : '',
    related.length ? `Related: ${related.map((x) => x.term).join(', ')}` : '',
    acts.length ? `Actions and targets that exist (use only these): ${acts.join(', ')}` : 'No on-screen actions exist for it: leave do and target empty.',
    '',
    `Write ${n} steps (at most ${WT_LIMITS.steps[1]}).${r.tryIt ? ' The last one is kind "try": invite the viewer to do it themselves on the highlighted target (or, with no target, to try the idea).' : ''}`,
    'Answer with JSON shaped like:',
    FEATURE_SHAPE,
  ].filter((l) => l !== '');
  return { system: FEATURE_SYSTEM, messages: [{ role: 'user', content: text.join('\n') }] };
}

/* ================================================================== steps + features */

/** One clean step: kind, title, say (required), do, target, highlight, wait. Null when it has nothing to say. */
export function cleanStep(raw, allowed) {
  if (!isObj(raw)) return null;
  const say = str(raw.say, WT_LIMITS.say);
  if (!say) return null;
  let doAct = str(raw.do, WT_LIMITS.action);
  let target = str(raw.target, WT_LIMITS.target);
  if (allowed) { if (doAct && !allowed.do.has(doAct)) doAct = ''; if (target && !allowed.target.has(target)) target = ''; }
  return {
    kind: pick(WT_ENUMS.stepKind, raw.kind, doAct || target ? 'show' : 'narrate'),
    title: str(raw.title, WT_LIMITS.stepTitle),
    say,
    do: doAct,
    target,
    highlight: str(raw.highlight, WT_LIMITS.highlight),
    wait: int(raw.wait, 0, WT_LIMITS.wait, 0),
  };
}

/** The JSON object inside a model reply (a ```json fence, else the outermost braces). Null when there is none. */
export function extractJson(text) {
  const t = String(text ?? '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const tries = [fence?.[1], t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)].filter((x) => x && x.trim().startsWith('{'));
  for (const x of tries) { try { const v = JSON.parse(x); if (isObj(v)) return v; } catch { /* next */ } }
  return null;
}

/**
 * Parse one chain step's reply. Actions and targets not in the template's set are dropped (the model may not invent
 * screens). Answers { ok, steps, headline, points, error }.
 */
export function parseFeatureReply(text, { template = [], tryIt = true } = {}) {
  const v = extractJson(text);
  if (!v) return { ok: false, steps: [], headline: '', points: [], error: 'no JSON object in the reply' };
  const allowed = { do: new Set(template.map((s) => s.do).filter(Boolean)), target: new Set(template.map((s) => s.target).filter(Boolean)) };
  const steps = (Array.isArray(v.steps) ? v.steps : []).map((s) => cleanStep(s, allowed)).filter(Boolean).slice(0, WT_LIMITS.steps[1]);
  if (!steps.length) return { ok: false, steps: [], headline: '', points: [], error: 'the reply had no usable steps' };
  if (!tryIt) for (const s of steps) if (s.kind === 'try') s.kind = s.target || s.do ? 'show' : 'narrate';
  const points = (Array.isArray(v.points) ? v.points : []).map((p) => str(p, WT_LIMITS.point)).filter(Boolean).slice(0, WT_LIMITS.points);
  return { ok: true, steps, headline: str(v.headline, WT_LIMITS.headline), points, error: '' };
}

/** The try-it step a template feature ends with. */
export function tryStepOf(entry, template = []) {
  const on = template.find((s) => s.target) ?? template.find((s) => s.do);
  const term = entry?.term ?? 'it';
  if (on?.target) return { kind: 'try', title: 'Try it', say: `Your turn: tap ${on.highlight || term} to try it yourself.`, do: on.do || '', target: on.target, highlight: on.highlight || term, wait: 0 };
  return { kind: 'try', title: 'Try it', say: `Your turn: open ${term} and look around. Tap Next when you are ready.`, do: on?.do || '', target: '', highlight: '', wait: 0 };
}

/**
 * A feature from its glossary entry and the zero-token template demonstration (demonstrationFromEntry's data.steps),
 * trimmed to the depth, with a try-it step last; `reply` (parseFeatureReply's answer) replaces the steps and docs when ok.
 */
export function featureOf(entry, template = [], request = {}, { reply = null, demonstration = '', related = [], error = '' } = {}) {
  const r = normalizeRequest(request);
  const n = DEPTH_STEPS[r.depth];
  const base = template.map((s) => cleanStep({ ...s, kind: s.do || s.target ? 'show' : 'narrate' })).filter(Boolean);
  let steps; let source; let headline; let points;
  if (reply?.ok) { steps = reply.steps; source = 'claude'; headline = reply.headline; points = reply.points; }
  else {
    steps = base.slice(0, Math.max(1, r.tryIt ? n - 1 : n));
    if (r.tryIt) steps.push(tryStepOf(entry, base));
    source = 'template';
    headline = str(entry?.summary, WT_LIMITS.headline);
    points = [entry?.detail, ...(base.slice(1).map((s) => s.say))].map((p) => str(p, WT_LIMITS.point)).filter(Boolean).slice(0, 4);
  }
  return {
    entry: str(entry?.id, 300),
    term: str(entry?.term, WT_LIMITS.title) || str(entry?.id, WT_LIMITS.title),
    kind: str(entry?.kind, 40),
    category: str(entry?.category, 200),
    demonstration: ID.test(demonstration) ? demonstration : '',
    source,
    error: str(error || (reply && !reply.ok ? reply.error : ''), WT_LIMITS.note),
    docs: {
      headline,
      summary: str(entry?.summary, WT_LIMITS.about),
      detail: str(entry?.detail, 1200),
      points,
      api: (Array.isArray(entry?.api) ? entry.api : []).slice(0, WT_LIMITS.api).map((a) => ({ kind: str(a?.kind, 10), name: str(a?.name, 200) })).filter((a) => a.name),
      where: [entry?.app, ...(Array.isArray(entry?.where) ? entry.where : [])].filter((w) => typeof w === 'string' && w && !w.includes(':')).slice(0, 6),
      related: related.filter(Boolean).slice(0, WT_LIMITS.related).map((x) => ({ id: str(x.id, 300), term: str(x.term, WT_LIMITS.title) })),
    },
    steps: steps.slice(0, WT_LIMITS.steps[1]),
  };
}

/* ================================================================== bundle (the saved walkthrough) */

export function nextVersion(prev) {
  const m = SEMVER.exec(String(prev ?? ''));
  return m ? `${m[1]}.${Number(m[2]) + 1}.0` : '1.0.0';
}

/** The intro and outro steps of a walkthrough. */
export function introOf(title, features, request) {
  const r = normalizeRequest(request);
  const names = features.map((f) => f.term);
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return {
    intro: r.intro ? { kind: 'narrate', title, say: str(`Welcome. This walkthrough shows ${list}. Each part shows it working, then lets you try it. Use Next and Back any time.`, WT_LIMITS.say), do: '', target: '', highlight: '', wait: 0 } : null,
    outro: r.intro ? { kind: 'narrate', title: 'That is the tour', say: str(`That was ${list}. Open any part again from the list, or read its docs.`, WT_LIMITS.say), do: '', target: '', highlight: '', wait: 0 } : null,
  };
}

/**
 * Put a walkthrough together: request, brief, features, generator facts, and the history carried from `previous` with
 * this version on top. `at` is an ISO time (the caller's clock; this module has none).
 */
export function assembleBundle({ request, brief = '', features = [], previous = null, at = '', generator = {}, note = '', book = '' }) {
  const r = normalizeRequest(request);
  const prev = previous && previous.$axf === BUNDLE_FRAME ? previous : null;
  const id = prev?.id ?? walkthroughIdOf(r);
  const name = titleOf(r, features.map((f) => ({ term: f.term })));
  const version = nextVersion(prev?.version);
  const { intro, outro } = introOf(name, features, r);
  const sources = features.map((f) => f.source);
  const mode = sources.every((s) => s === 'template') ? 'template' : 'claude';
  const entry = { version, at: str(at, 40), mode, terms: features.length, note: str(note, WT_LIMITS.note) || (prev ? 'Regenerated' : 'Generated') };
  return normalizeBundle({
    $axf: BUNDLE_FRAME, id, name, version,
    createdAt: prev?.createdAt || at, updatedAt: at,
    request: { ...r, id }, brief: String(brief).slice(0, 20000),
    generator: { mode, model: str(generator.model, 80), at, ms: int(generator.ms, 0, 1e9, 0), chain: (Array.isArray(generator.chain) ? generator.chain : []).slice(0, WT_LIMITS.terms[1]) },
    intro, outro, features, book: book || id,
    history: [entry, ...(prev?.history ?? [])].slice(0, WT_LIMITS.versions),
  });
}

export function bundleErrors(raw) {
  if (!isObj(raw)) return ['the walkthrough must be an object'];
  const e = [];
  if (raw.$axf !== BUNDLE_FRAME) e.push(`$axf must be ${BUNDLE_FRAME}`);
  if (!ID.test(raw.id ?? '')) e.push('id must be lowercase letters, digits and dashes (2 to 48)');
  if (!SEMVER.test(raw.version ?? '')) e.push('version must be semver (1.2.0)');
  if (!Array.isArray(raw.features) || !raw.features.length) e.push('a walkthrough needs at least one feature');
  else raw.features.forEach((f, i) => {
    if (!isObj(f)) { e.push(`features[${i}] must be an object`); return; }
    if (!str(f.term, 200)) e.push(`features[${i}].term is missing`);
    if (!Array.isArray(f.steps) || !f.steps.some((s) => str(s?.say, WT_LIMITS.say))) e.push(`features[${i}] needs at least one step with something to say`);
  });
  return e;
}

export function normalizeBundle(raw) {
  const o = isObj(raw) ? raw : {};
  const features = (Array.isArray(o.features) ? o.features : []).filter(isObj).map((f) => ({
    entry: str(f.entry, 300), term: str(f.term, WT_LIMITS.title), kind: str(f.kind, 40), category: str(f.category, 200),
    demonstration: ID.test(f.demonstration ?? '') ? f.demonstration : '', source: pick(WT_ENUMS.source, f.source, 'template'), error: str(f.error, WT_LIMITS.note),
    docs: {
      headline: str(f.docs?.headline, WT_LIMITS.headline), summary: str(f.docs?.summary, WT_LIMITS.about), detail: str(f.docs?.detail, 1200),
      points: (Array.isArray(f.docs?.points) ? f.docs.points : []).map((p) => str(p, WT_LIMITS.point)).filter(Boolean).slice(0, WT_LIMITS.points),
      api: (Array.isArray(f.docs?.api) ? f.docs.api : []).filter(isObj).map((a) => ({ kind: str(a.kind, 10), name: str(a.name, 200) })).filter((a) => a.name).slice(0, WT_LIMITS.api),
      where: (Array.isArray(f.docs?.where) ? f.docs.where : []).map((w) => str(w, 80)).filter(Boolean).slice(0, 6),
      related: (Array.isArray(f.docs?.related) ? f.docs.related : []).filter(isObj).map((x) => ({ id: str(x.id, 300), term: str(x.term, WT_LIMITS.title) })).filter((x) => x.term).slice(0, WT_LIMITS.related),
    },
    steps: (Array.isArray(f.steps) ? f.steps : []).map((s) => cleanStep(s)).filter(Boolean).slice(0, WT_LIMITS.steps[1]),
  })).filter((f) => f.term && f.steps.length).slice(0, WT_LIMITS.terms[1]);
  const g = isObj(o.generator) ? o.generator : {};
  return {
    $axf: BUNDLE_FRAME,
    id: ID.test(o.id ?? '') ? o.id : 'walkthrough',
    name: str(o.name, WT_LIMITS.title) || 'Walkthrough',
    version: SEMVER.test(o.version ?? '') ? o.version : '1.0.0',
    createdAt: str(o.createdAt, 40), updatedAt: str(o.updatedAt, 40),
    request: normalizeRequest(o.request),
    brief: typeof o.brief === 'string' ? o.brief.slice(0, 20000) : '',
    generator: {
      mode: pick(WT_ENUMS.mode, g.mode, 'template'), model: str(g.model, 80), at: str(g.at, 40), ms: int(g.ms, 0, 1e9, 0),
      chain: (Array.isArray(g.chain) ? g.chain : []).filter(isObj).map((c) => ({ entry: str(c.entry, 300), source: pick(WT_ENUMS.source, c.source, 'template'), ms: int(c.ms, 0, 1e9, 0), error: str(c.error, WT_LIMITS.note) })).slice(0, WT_LIMITS.terms[1]),
    },
    intro: o.intro ? cleanStep(o.intro) : null,
    outro: o.outro ? cleanStep(o.outro) : null,
    features,
    book: ID.test(o.book ?? '') ? o.book : '',
    history: (Array.isArray(o.history) ? o.history : []).filter(isObj).map((h) => ({ version: SEMVER.test(h.version ?? '') ? h.version : '1.0.0', at: str(h.at, 40), mode: pick(WT_ENUMS.mode, h.mode, 'template'), terms: int(h.terms, 0, 1000, 0), note: str(h.note, WT_LIMITS.note) })).slice(0, WT_LIMITS.versions),
  };
}

/** What a list shows for a saved walkthrough. */
export function summarizeBundle(b) {
  const n = normalizeBundle(b);
  return {
    id: n.id, name: n.name, version: n.version, updatedAt: n.updatedAt, createdAt: n.createdAt, mode: n.generator.mode, model: n.generator.model,
    features: n.features.length, steps: playSteps(n).length, claude: n.features.filter((f) => f.source === 'claude').length,
    terms: n.features.map((f) => f.term), prompt: n.request.prompt, audience: n.request.audience, versions: n.history.length, book: n.book,
  };
}

/**
 * The flat list the player walks: the intro, every feature's steps (each tagged with its feature index and the step's
 * place in it), the outro.
 */
export function playSteps(bundle) {
  const b = bundle?.$axf === BUNDLE_FRAME && Array.isArray(bundle.features) ? bundle : normalizeBundle(bundle);
  const out = [];
  if (b.intro) out.push({ ...b.intro, feature: -1, part: 0, parts: 1 });
  b.features.forEach((f, fi) => f.steps.forEach((s, si) => out.push({ ...s, feature: fi, part: si, parts: f.steps.length })));
  if (b.outro) out.push({ ...b.outro, feature: -1, part: 0, parts: 1 });
  return out;
}

/** Where each feature starts in playSteps (for the player's chapter list). */
export function featureStarts(bundle) {
  const steps = playSteps(bundle);
  const starts = [];
  steps.forEach((s, i) => { if (s.feature >= 0 && s.part === 0) starts[s.feature] = i; });
  return starts;
}

/** The bundle as walkthrough@1 (what Molly's guide and the recorder play). */
export function bundleToWalkthrough(bundle) {
  const b = normalizeBundle(bundle);
  return { $axf: 'walkthrough@1', id: b.id, title: b.name, app: b.request.app, steps: playSteps(b).map((s) => ({ say: s.say, do: s.do, target: s.target })), source: 'glossary-walkthrough' };
}

/** Did a click on `el` hit the try-it step's target? `matches(el, selector)` is the DOM's closest() test (injected for tests). */
export function tryHit(step, el, selectorsOf, closest) {
  if (!step || step.kind !== 'try' || !step.target || !el) return false;
  for (const sel of selectorsOf(step.target)) { try { if (closest(el, sel)) return true; } catch { /* a bad selector */ } }
  return false;
}

/** What changed between two versions: terms added and removed, features whose steps changed. */
export function diffBundles(a, b) {
  const A = normalizeBundle(a); const B = normalizeBundle(b);
  const ta = new Map(A.features.map((f) => [f.entry || f.term, f])); const tb = new Map(B.features.map((f) => [f.entry || f.term, f]));
  const sig = (f) => shortHash(JSON.stringify(f.steps) + JSON.stringify(f.docs));
  return {
    added: [...tb.keys()].filter((k) => !ta.has(k)).map((k) => tb.get(k).term),
    removed: [...ta.keys()].filter((k) => !tb.has(k)).map((k) => ta.get(k).term),
    changed: [...tb.keys()].filter((k) => ta.has(k) && sig(ta.get(k)) !== sig(tb.get(k))).map((k) => tb.get(k).term),
  };
}

/** The exported file a demo sandbox serves beside the console: a same-origin .json path only ('' otherwise). */
export function safeSrc(src) {
  const s = String(src ?? '').trim();
  return /^\/?[a-z0-9][a-z0-9/_.-]*\.json$/i.test(s) && !s.split('/').includes('..') && !s.includes('//') ? s : '';
}
