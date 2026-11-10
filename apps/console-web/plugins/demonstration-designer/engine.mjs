/**
 * Demonstration Designer engine (pitch-script@1, plugin-local; Brett, Nov 9 2026: "I want a demonstration designer
 * plugin" — for pitching the product, dead simple: pick what, how long, which voice, press Generate).
 *
 * Pure: no I/O, no DOM, no model, no tokens. Node (demos.mjs, the CLI, the server) and the browser (web/) load this
 * same file. It turns a topic from the registry (a plugin, a screen, a UI element: its name, its description and the
 * help text of its screens and controls) into a pitch script in the demonstration@1 shape the framework already plays
 * (steps of say / do / target / highlight / wait):
 *
 *   hook      "Meet X." plus the strongest benefit sentence, over the first screen
 *   scenes    the best screens of the topic (the ones with help text and controls), each a benefit line about the
 *             screen and one or two highlighted controls
 *   closing   the call to action
 *
 * The script is fitted to the length asked for (words at the narrator's pace plus a pause per step; dwell time is
 * added when the words run short, the weakest beats go first when they run long). Spec words (ids, paths, `@1` names,
 * file names) are kept out of what is spoken: benefits, not specs.
 *
 * Also here: the production settings registry (narration, stage, music, logo, export) with its normaliser, the plain
 * text form of a script for the "tweak the script" box and its parser, steps from a record-by-doing session, topics
 * from the console's live search index, and the music plan the stage plays. Kotlin twin: none (console only).
 */

export const PITCH_FRAME = 'pitch-script@1';
export const PITCH_WPM = 150;
export const STEP_PAUSE_S = 1.2;
/** Lengths offered by the main flow (minutes). Any 1..30 is accepted by the API. */
export const LENGTHS = [1, 2, 3, 5, 10];
export const MOODS = ['calm', 'upbeat', 'minimal'];
export const HIGHLIGHTS = ['spotlight', 'outline'];
export const FORMATS = ['auto', 'mp4', 'webm'];
export const CAPTION_SIZES = ['sm', 'md', 'lg'];
export const TOPIC_KINDS = ['plugin', 'screen', 'ui-element', 'dialog', 'setting'];
/** Narrators the picker always offers; the browser adds its device voices after them. */
export const NARRATORS = [{ value: '', label: 'Device voice (default)' }, { value: 'silent', label: 'Captions only, no voice' }];

export const PITCH_LIMITS = { minutes: [1, 30], steps: 60, say: 600, cta: 300, product: 80, zoom: [1, 2.5], volume: [0, 100], logoSeconds: [0, 10] };

export const SETTINGS_DEFAULTS = {
  script: { minutes: 2, product: 'AmberX AXF', cta: 'Ready to see it on your own data? Open the console and try it today.', wpm: PITCH_WPM, benefitsFirst: true },
  narration: { voice: '', speed: 1, captions: true, captionSize: 'md' },
  stage: { zoom: true, maxZoom: 1.6, highlight: 'spotlight', controls: true, logoIntro: true, logoOutro: true, logoSeconds: 2.5 },
  music: { on: true, volume: 8, mood: 'calm' },
  export: { format: 'auto', transcode: true, keep: 12 },
  advanced: { show: true },
};

/* ================================================================== small helpers (no imports: the browser loads this too) */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = (list, v, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const STOP = new Set('the a an and or of to in on for is it its as by at be with from this that are was not no can any every each one into than then when what which who how your you his her their our out up all also only more most so do does use used uses here there like just'.split(' '));

export const wordCount = (s) => (String(s ?? '').match(/\S+/g) ?? []).length;

/** Turn any text into an id (slug, 1..48). */
export function slugify(s, fallback = 'item') {
  const x = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(x) ? x : fallback;
}

/** Keywords: every meaningful word of every part, stop words and bare numbers dropped, deduped in order. */
export function autoKeywords(parts, max = 120) {
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

export function fmtSeconds(s) {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${String(n % 60).padStart(2, '0')} s`;
}

/* ================================================================== settings (pitch-settings@1) */

export function normalizeSettings(raw) {
  const o = isObj(raw) ? raw : {};
  const D = SETTINGS_DEFAULTS;
  const s = isObj(o.script) ? o.script : {}; const n = isObj(o.narration) ? o.narration : {}; const st = isObj(o.stage) ? o.stage : {};
  const m = isObj(o.music) ? o.music : {}; const e = isObj(o.export) ? o.export : {}; const a = isObj(o.advanced) ? o.advanced : {};
  return {
    script: { minutes: int(s.minutes, PITCH_LIMITS.minutes[0], PITCH_LIMITS.minutes[1], D.script.minutes), product: str(s.product, PITCH_LIMITS.product) || D.script.product, cta: str(s.cta, PITCH_LIMITS.cta) || D.script.cta, wpm: int(s.wpm, 90, 220, D.script.wpm), benefitsFirst: bool(s.benefitsFirst, D.script.benefitsFirst) },
    narration: { voice: str(n.voice, 120), speed: num(n.speed, 0.5, 2, D.narration.speed), captions: bool(n.captions, D.narration.captions), captionSize: pick(CAPTION_SIZES, n.captionSize, D.narration.captionSize) },
    stage: { zoom: bool(st.zoom, D.stage.zoom), maxZoom: num(st.maxZoom, PITCH_LIMITS.zoom[0], PITCH_LIMITS.zoom[1], D.stage.maxZoom), highlight: pick(HIGHLIGHTS, st.highlight, D.stage.highlight), controls: bool(st.controls, D.stage.controls), logoIntro: bool(st.logoIntro, D.stage.logoIntro), logoOutro: bool(st.logoOutro, D.stage.logoOutro), logoSeconds: num(st.logoSeconds, PITCH_LIMITS.logoSeconds[0], PITCH_LIMITS.logoSeconds[1], D.stage.logoSeconds) },
    music: { on: bool(m.on, D.music.on), volume: int(m.volume, PITCH_LIMITS.volume[0], PITCH_LIMITS.volume[1], D.music.volume), mood: pick(MOODS, m.mood, D.music.mood) },
    export: { format: pick(FORMATS, e.format, D.export.format), transcode: bool(e.transcode, D.export.transcode), keep: int(e.keep, 1, 200, D.export.keep) },
    advanced: { show: bool(a.show, D.advanced.show) },
  };
}

/** Apply a partial change ({ section: { key: value } }) to settings; unknown sections and keys are dropped by the normaliser. */
export function mergeSettings(current, patch) {
  const c = normalizeSettings(current);
  const p = isObj(patch) ? patch : {};
  const out = {};
  for (const k of Object.keys(c)) out[k] = { ...c[k], ...(isObj(p[k]) ? p[k] : {}) };
  return normalizeSettings(out);
}

/** The settings as flat `section.key` rows (what the CLI prints and `set` takes). */
export function flattenSettings(s) {
  const n = normalizeSettings(s);
  const rows = [];
  for (const [sec, obj] of Object.entries(n)) for (const [k, v] of Object.entries(obj)) rows.push({ key: `${sec}.${k}`, value: v });
  return rows;
}

/** Parse a CLI value for a settings key ("true", "8", "calm") against the default's type. */
export function settingFromText(key, text) {
  const [sec, k] = String(key).split('.');
  const d = SETTINGS_DEFAULTS[sec]?.[k];
  if (d === undefined) throw new Error(`unknown setting "${key}" (one of ${flattenSettings({}).map((r) => r.key).join(', ')})`);
  const t = String(text ?? '').trim();
  const v = typeof d === 'boolean' ? /^(true|on|yes|1)$/i.test(t) : typeof d === 'number' ? Number(t) : t;
  if (typeof d === 'number' && !Number.isFinite(v)) throw new Error(`"${key}" needs a number`);
  return { [sec]: { [k]: v } };
}

/* ================================================================== topics */

/**
 * A topic as the registry (registry.mjs) or the live search index hands it in: what can be pitched.
 *   { id, kind, label, description, app, screens: [{ view, label, text, controls: [{ label, text }] }], keywords }
 */
export function normalizeTopic(raw) {
  const o = isObj(raw) ? raw : {};
  const label = str(o.label, 120) || str(o.id, 120) || 'This';
  const screens = (Array.isArray(o.screens) ? o.screens : []).filter(isObj).map((s) => ({
    view: str(s.view, 80), label: str(s.label, 120) || str(s.view, 80) || label, text: str(s.text, 1200),
    controls: (Array.isArray(s.controls) ? s.controls : []).filter((c) => isObj(c) && str(c.label, 80)).map((c) => ({ label: str(c.label, 80), text: str(c.text, 600), target: str(c.target, 200) })).slice(0, 40),
  })).slice(0, 24);
  return { id: str(o.id, 200) || `topic:${slugify(label)}`, kind: pick(TOPIC_KINDS, o.kind, 'screen'), label, description: str(o.description, 2000), app: str(o.app, 40) || 'console', screens, keywords: autoKeywords([o.keywords, label], 40), ...(str(o.plugin, 80) ? { plugin: str(o.plugin, 80) } : {}) };
}

/** Topics from the console's live search index (views, dialogs, settings tabs): any UI element can be pitched. */
export function topicsFromSearch(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => isObj(e) && str(e.label, 120));
  // settings rows every plugin repeats (About, Opens in, Appearance, Install & uninstall…) are boilerplate, not a topic
  const counts = new Map();
  for (const e of list) if (e.kind === 'setting') counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
  const out = [];
  for (const e of list) {
    const f = isObj(e.focus) ? e.focus : {};
    if (e.kind === 'view' && str(f.view, 80)) out.push(normalizeTopic({ id: `screen:${f.view}`, kind: 'screen', label: e.label, description: str(e.detail, 200), screens: [{ view: f.view, label: e.label, text: '' }], keywords: e.keywords }));
    else if (e.kind === 'dialog' && str(f.id, 80)) out.push(normalizeTopic({ id: `dialog:${f.id}`, kind: 'dialog', label: e.label, description: str(e.detail, 200), screens: [], keywords: e.keywords }));
    else if ((e.kind === 'setting' || e.kind === 'settings-tab') && str(f.tab, 80) && (counts.get(e.label) ?? 0) <= 1) out.push(normalizeTopic({ id: `setting:${f.tab}${f.anchor ? `:${f.anchor}` : ''}`, kind: 'setting', label: e.label, description: str(e.detail, 200), screens: [], keywords: e.keywords }));
  }
  return out;
}

/** What the picker shows before a word is typed: the richest plugins and screens first (help text, screens, controls). */
export function featuredTopics(topics, limit = 8) {
  const score = (t) => (t.kind === 'plugin' ? 6 : t.kind === 'screen' ? 3 : 0) + Math.min(4, (t.screens ?? []).length) + (t.description ? 2 : 0) + Math.min(3, (t.screens ?? []).reduce((n, s) => n + (s.controls?.length ?? 0), 0) / 3);
  return (Array.isArray(topics) ? topics : []).filter((t) => t.kind === 'plugin' || t.kind === 'screen').map((t) => [score(t), t]).sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, limit).map((x) => x[1]);
}

/** Merge registry topics (rich) with live ones (complete); the registry wins on the same id or screen. */
export function mergeTopics(registry, live) {
  const out = [...(Array.isArray(registry) ? registry : [])];
  const have = new Set(out.map((t) => t.id));
  const views = new Set(out.flatMap((t) => (t.screens ?? []).map((s) => s.view)).filter(Boolean));
  for (const t of Array.isArray(live) ? live : []) {
    if (have.has(t.id)) continue;
    if (t.kind === 'screen' && t.screens?.[0]?.view && views.has(t.screens[0].view)) continue;
    have.add(t.id); out.push(t);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

/** Every word must match (label, description, kind, keywords, screens); label hits first. */
export function searchTopics(topics, q, limit = 50) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const list = Array.isArray(topics) ? topics : [];
  if (!words.length) return list.slice(0, limit);
  const scored = [];
  for (const t of list) {
    const label = t.label.toLowerCase();
    const hay = `${label} ${t.kind} ${t.id} ${t.description.toLowerCase()} ${(t.keywords ?? []).join(' ')} ${(t.screens ?? []).map((s) => s.label).join(' ').toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let s = 0;
    for (const w of words) s += label === w ? 50 : label.startsWith(w) ? 20 : label.includes(w) ? 10 : 1;
    if (t.kind === 'plugin') s += 3;
    scored.push([s, t]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, limit).map((x) => x[1]);
}

/* ================================================================== words: benefits, not specs */

const BENEFIT = ['you', 'your', 'one place', 'at once', 'never', 'without', 'no ', 'zero', 'every', 'instant', 'live', 'real time', 'save', 'faster', 'simple', 'clean', 'any', 'whole', 'automatic', 'itself', 'by itself', 'one tap', 'one change', 'keeps', 'knows', 'follows', 'ready', 'free', 'safe', 'stays', 'reach', 'see', 'pick', 'tap'];
const SPEC = /(@\d|\.mjs|\.json|\.py|\.ts\b|\.tsx|\/api\/|--[a-z]|_[a-z]|\bCLI\b|\bMCP\b|\bREST\b|\bAPI\b|\bJSON\b|\bSQLite\b|\bFTS5\b|\bPOST\b|\bGET\b|\bPUT\b|\bDELETE\b|\bcapability\b|\bplugin-|\bself-test|\bschema|\bfixture|\bengine\b|\bnormali[sz]e|\bvalidator)/;

/** Sentences of a text, parentheses and code dropped, short fragments skipped. */
export function sentences(text) {
  const clean = String(text ?? '').replace(/\([^)]*\)/g, ' ').replace(/`[^`]*`/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim()).filter((s) => wordCount(s) >= 4);
}

/** How much a sentence sells (benefit words up, spec words down, very long sentences down). */
export function benefitScore(s) {
  const t = ` ${String(s).toLowerCase()} `;
  let score = 0;
  for (const w of BENEFIT) if (t.includes(` ${w}`) || t.includes(w)) score += 2;
  const specs = (String(s).match(SPEC) ?? []).length + (String(s).match(/[@/_]/g) ?? []).length;
  score -= specs * 3;
  const n = wordCount(s);
  if (n > 32) score -= Math.ceil((n - 32) / 6);
  if (n < 6) score -= 1;
  return score;
}

/** A sentence made speakable: no ids, "the user" becomes "you", capitalised, ending in a full stop; '' when nothing is left. */
export function speakable(s, max = PITCH_LIMITS.say) {
  let t = String(s ?? '').replace(/\([^)]*\)/g, ' ').replace(/`[^`]*`/g, ' ')
    .replace(/\b[a-z0-9-]+@\d+\b/g, '').replace(/\b[\w./-]+\.(mjs|mts|json|py|ts|tsx|md)\b/g, '').replace(/\/api\/\S+/g, '')
    .replace(/\bthe user\b/gi, 'you').replace(/\busers\b/gi, 'people').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').replace(/[;:]\s*$/, '.').trim();
  t = t.replace(/^[\s,;:.-]+/, '');
  if (wordCount(t) < 3) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t.slice(0, max);
}

/** The best sentences of a text, best first (ties keep the writer's order). */
export function benefitSentences(text, max = 6) {
  return sentences(text).map((s, i) => ({ s: speakable(s), score: benefitScore(s), i })).filter((x) => x.s && x.score > -4)
    .sort((a, b) => b.score - a.score || a.i - b.i).slice(0, max).map((x) => x.s);
}

/** The first sentence that says what it is (what the hook opens with). */
export const whatItIs = (text) => speakable(sentences(text)[0] ?? '', 240);

/* ================================================================== steps and time */

/** Seconds a list of steps plays: words at `wpm`, each step's wait, a pause per step. */
export function stepsSeconds(steps, { wpm = PITCH_WPM, speed = 1 } = {}) {
  let s = 0;
  for (const st of Array.isArray(steps) ? steps : []) s += ((wordCount(st?.say) / wpm) * 60) / (speed || 1) + (Number(st?.wait) || 0) / 1000 + STEP_PAUSE_S;
  return Math.round(s * 10) / 10;
}

/** Whole running time: logo intro + steps + logo outro. */
export function pitchSeconds(steps, pitch = {}) {
  const logo = (pitch.logoIntro === false ? 0 : (pitch.logoSeconds ?? 2.5)) + (pitch.logoOutro === false ? 0 : (pitch.logoSeconds ?? 2.5));
  return Math.round((stepsSeconds(steps, { wpm: pitch.wpm, speed: pitch.speed }) + logo) * 10) / 10;
}

const pageHead = (view) => (view ? `[data-axf-view="${view}"] .fx-pagehead` : '');
const openScreen = (view) => (view ? `nav:${view}` : '');

/** The screens worth showing, best first: help text and controls count; capped by the time there is. */
export function pickScreens(topic, targetSeconds) {
  const t = normalizeTopic(topic);
  const scored = t.screens.map((s, i) => ({ s, i, score: (s.text ? 4 : 0) + Math.min(6, s.controls.length) + (s.view ? 2 : 0) }));
  const max = Math.max(1, Math.min(8, Math.floor(Math.max(0, targetSeconds - 20) / 22) + 1));
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.s);
}

/**
 * The pitch script of a topic. `opts`: minutes, voice { narrator, speed }, cta, product, wpm, logoIntro, logoOutro,
 * logoSeconds. Returns { id, name, description, data (demonstration@1 shape), pitch (the production facts), plan }.
 */
export function generatePitch(topic, opts = {}) {
  const t = normalizeTopic(topic);
  const minutes = int(opts.minutes, PITCH_LIMITS.minutes[0], PITCH_LIMITS.minutes[1], SETTINGS_DEFAULTS.script.minutes);
  const voice = { narrator: str(opts.voice?.narrator ?? opts.narrator, 120), speed: num(opts.voice?.speed ?? opts.speed, 0.5, 2, 1) };
  const wpm = int(opts.wpm, 90, 220, PITCH_WPM);
  const cta = str(opts.cta, PITCH_LIMITS.cta) || SETTINGS_DEFAULTS.script.cta;
  const product = str(opts.product, PITCH_LIMITS.product) || SETTINGS_DEFAULTS.script.product;
  const pitch = { minutes, wpm, speed: voice.speed, logoIntro: opts.logoIntro !== false, logoOutro: opts.logoOutro !== false, logoSeconds: num(opts.logoSeconds, 0, 10, 2.5), product, cta, topic: t.id, topicLabel: t.label, kind: t.kind };
  const logo = (pitch.logoIntro ? pitch.logoSeconds : 0) + (pitch.logoOutro ? pitch.logoSeconds : 0);
  const target = Math.max(15, minutes * 60 - logo);

  const screens = pickScreens(t, target);
  const first = screens[0];
  const benefits = benefitSentences(t.description, 6);
  const what = whatItIs(t.description);
  const lead = benefits[0] && benefits[0] !== what ? benefits[0] : what || `${t.label} is part of ${product}.`;

  // weight: 100 = never cut (hook, closing), scenes 60, extra benefit lines 40, control beats 10..30
  const steps = [];
  steps.push({ weight: 100, step: { title: 'Hook', say: `Meet ${t.label}. ${lead}`, do: openScreen(first?.view), target: '', highlight: '', wait: 600 } });
  const pool = benefits.filter((b) => b !== lead && b !== what);
  if (what && what !== lead) pool.unshift(what);
  // screens without help text borrow the next unused benefit line of the topic, so no scene is empty
  const borrowed = screens.filter((s) => !benefitSentences(s.text, 1).length).map(() => pool.shift()).filter(Boolean);
  // a longer pitch gets more of the story: more benefit lines and more highlighted controls per screen
  const extrasMax = target > 150 ? 5 : 3; const beatsMax = target > 240 ? 5 : target > 150 ? 4 : 3;
  pool.slice(0, extrasMax).forEach((b, i) => steps.push({ weight: 40 - i * 5, step: { title: 'Why it matters', say: b, do: '', target: '', highlight: '' } }));
  for (const s of screens) {
    const line = benefitSentences(s.text, 2);
    const own = line.length ? line.join(' ') : borrowed.shift();
    const say = own ? `${s.label}. ${own}` : screens.length === 1 ? `${s.label}: everything in one screen, on your real data.` : `Then ${s.label}: one tap away.`;
    steps.push({ weight: 60, step: { title: s.label, say, do: openScreen(s.view), target: pageHead(s.view), highlight: s.label, wait: 500 } });
    const beats = s.controls.map((c, i) => ({ c, i, score: benefitScore(c.text) + (c.text ? 2 : -3) })).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, beatsMax);
    beats.forEach((b, i) => {
      const words = benefitSentences(b.c.text, 1)[0] ?? '';
      steps.push({ weight: 30 - i * 8, step: { title: b.c.label, say: words ? `${b.c.label}: ${words.charAt(0).toLowerCase()}${words.slice(1)}` : `One tap on ${b.c.label}.`, do: '', target: b.c.target || `text=${b.c.label}`, highlight: b.c.label } });
    });
  }
  steps.push({ weight: 100, step: { title: 'Call to action', say: cta, do: '', target: '', highlight: '', wait: 800 } });

  const fitted = fitToLength(steps, target, { wpm, speed: voice.speed });
  const data = {
    about: t.kind === 'plugin' && t.plugin ? `plugin:${t.plugin}` : '', entries: t.kind === 'plugin' && t.plugin ? [`plugin:${t.plugin}`] : [], app: t.app, surface: 'live', steps: fitted.steps,
    voice, chain: [], keywords: autoKeywords(['pitch', 'demo', 'demonstration', t.label, t.kind, t.keywords, screens.map((s) => [s.label, s.controls.map((c) => c.label)]), fitted.steps.map((s) => s.say)], 120),
    generated: { from: 'manual', at: str(opts.at, 40), build: str(opts.build, 120) }, editable: true,
  };
  const id = slugify(`pitch-${t.label}-${minutes}m`, 'pitch');
  const seconds = pitchSeconds(fitted.steps, pitch);
  return {
    $axf: PITCH_FRAME, id, name: `${t.label} pitch (${minutes} min)`, description: `A ${minutes}-minute pitch of ${t.label}: ${lead}`.slice(0, 600), data, pitch,
    plan: { targetSeconds: minutes * 60, seconds, steps: fitted.steps.length, screens: screens.map((s) => s.label), cut: fitted.cut, dwell: fitted.dwell },
  };
}

/**
 * Fit weighted steps ({ weight, step }) to `target` seconds: the lightest beats go first when the words run long (the
 * hook and the closing never), long says are cut to their first sentence next; when the words run short the scenes
 * dwell (wait) a little longer. Returns { steps, cut, dwell }.
 */
export function fitToLength(weighted, target, { wpm = PITCH_WPM, speed = 1 } = {}) {
  let list = weighted.map((w) => ({ weight: w.weight, step: { ...w.step } }));
  const secs = () => stepsSeconds(list.map((x) => x.step), { wpm, speed });
  let cut = 0;
  while (secs() > target * 1.08 && list.length > 2) {
    const candidates = list.map((x, i) => ({ x, i })).filter((c) => c.x.weight < 100);
    if (!candidates.length) break;
    const victim = candidates.reduce((a, b) => (b.x.weight < a.x.weight ? b : a));
    // a scene whose beats are gone still goes before the hook / closing
    list.splice(victim.i, 1); cut++;
  }
  if (secs() > target * 1.08) for (const x of list) { const first = sentences(x.step.say)[0]; if (first && first.length < x.step.say.length && x.weight < 100) x.step.say = first; }
  let dwell = 0;
  const room = target - secs();
  const scenes = list.filter((x) => x.step.do || x.step.target);
  if (room > 2 && scenes.length) {
    const per = Math.min(4000, Math.round((room / scenes.length) * 1000));
    for (const x of scenes) { x.step.wait = Math.min(30000, (x.step.wait ?? 0) + per); dwell += per; }
  }
  const steps = list.map((x) => cleanStep(x.step)).filter(Boolean).slice(0, PITCH_LIMITS.steps);
  return { steps, cut, dwell: Math.round(dwell / 1000) };
}

const ACTION = /^[a-z][a-z0-9._-]*(:[^\s<>"'`]{0,160})?$/;
const BAD_TARGET = /[<>{}`]|^javascript/i;

/** A step as demonstration@1 keeps it (the same cleaning as the framework's demo rules). */
export function cleanStep(s) {
  if (!isObj(s)) return null;
  const say = str(s.say, PITCH_LIMITS.say);
  if (!say) return null;
  let act = str(s.do, 200); if (act && !ACTION.test(act)) act = '';
  let target = str(s.target, 200); if (BAD_TARGET.test(target)) target = '';
  const out = { say, do: act, target };
  const title = str(s.title, 120); if (title) out.title = title;
  const highlight = str(s.highlight, 80); if (highlight) out.highlight = highlight;
  const wait = int(s.wait, 0, 30000, 0); if (wait) out.wait = wait;
  return out;
}

/* ================================================================== the script as text (the tweak box) */

/** Steps as plain text: one block per step, `# Title` then the words, blank line between. */
export function scriptText(steps) {
  return (Array.isArray(steps) ? steps : []).map((s) => `${s.title ? `# ${s.title}\n` : ''}${s.say}`).join('\n\n');
}

/**
 * Text back into steps: blocks split on blank lines, a `# Title` line names the step. A block keeps the do / target /
 * highlight / wait of the step at the same position in `base`; new blocks have none. Empty text = the base unchanged.
 */
export function parseScript(text, base = []) {
  const blocks = String(text ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return (Array.isArray(base) ? base : []).map(cleanStep).filter(Boolean);
  return blocks.map((b, i) => {
    const lines = b.split('\n');
    let title = '';
    if (/^#\s*/.test(lines[0] ?? '')) title = lines.shift().replace(/^#\s*/, '').trim();
    const prev = isObj(base?.[i]) ? base[i] : {};
    return cleanStep({ ...prev, title: title || prev.title || '', say: lines.join(' ').replace(/\s+/g, ' ').trim() });
  }).filter(Boolean).slice(0, PITCH_LIMITS.steps);
}

/* ================================================================== record by doing */

/**
 * Steps from a recording session: events [{ kind: 'nav', view, label }, { kind: 'click', label, target }] in order.
 * A nav opens the screen; a click highlights the control. Consecutive repeats are merged. Words are drafted so the
 * script plays at once and can be tweaked.
 */
export function stepsFromRecording(events, { product = SETTINGS_DEFAULTS.script.product } = {}) {
  const out = [];
  let last = '';
  for (const e of Array.isArray(events) ? events : []) {
    if (!isObj(e)) continue;
    if (e.kind === 'nav' && str(e.view, 80)) {
      const key = `nav:${e.view}`;
      if (key === last) continue;
      last = key;
      const label = str(e.label, 120) || e.view;
      out.push(cleanStep({ title: label, say: `Now ${label}.`, do: `nav:${e.view}`, target: pageHead(e.view), highlight: label, wait: 500 }));
    } else if (e.kind === 'click' && str(e.label, 80)) {
      const key = `click:${e.label}`;
      if (key === last) continue;
      last = key;
      out.push(cleanStep({ title: e.label, say: `One tap on ${e.label}.`, do: '', target: str(e.target, 200) || `text=${e.label}`, highlight: e.label }));
    }
  }
  if (!out.length) return [];
  out.unshift(cleanStep({ title: 'Hook', say: `Here is ${product}, as you would use it.`, do: out[0].do, target: '', wait: 400 }));
  return out.filter(Boolean).slice(0, PITCH_LIMITS.steps);
}

/* ================================================================== music the stage plays (synthesised, no files) */

/** A chord loop per mood: tempo and chords as frequencies (Hz). The stage plays them on soft oscillators. */
export function musicPlan(mood = 'calm') {
  const m = pick(MOODS, mood, 'calm');
  const C = 261.63, D = 293.66, E = 329.63, F = 349.23, G = 392.0, A = 440.0, B = 493.88;
  if (m === 'upbeat') return { bpm: 104, beat: 4, chords: [[C, E, G], [G, B, D * 2], [A, C * 2, E * 2], [F, A, C * 2]], wave: 'triangle', gain: 1 };
  if (m === 'minimal') return { bpm: 60, beat: 8, chords: [[C, G], [A, E], [F, C * 2], [G, D * 2]], wave: 'sine', gain: 0.8 };
  return { bpm: 72, beat: 8, chords: [[C, E, G, B], [A, C * 2, E * 2, G * 2], [F, A, C * 2, E * 2], [G, B, D * 2, F * 2]], wave: 'sine', gain: 1 };
}

/* ================================================================== links */

/** The deep link that opens the designer on a demo (and plays it when `play`). */
export function shareLink(origin, id, { play = false } = {}) {
  const base = String(origin ?? '').replace(/\/$/, '');
  return `${base}/?axf-demo=${encodeURIComponent(slugify(id, 'demo'))}${play ? '&axf-autoplay=1' : ''}`;
}

/** What `?axf-demo=` on the console's address asks for (null when nothing). */
export function parseDeepLink(search) {
  try {
    const p = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
    const id = slugify(p.get('axf-demo') ?? '', '');
    return id ? { id, play: p.get('axf-autoplay') === '1' } : null;
  } catch { return null; }
}
