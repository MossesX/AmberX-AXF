/**
 * Pipeline demos (pipeline-demo@1): the pure rules of the Demonstration Designer's Pipelines mode, loaded by Node (the
 * store, the CLI, the server) and the browser (the player, the behind-the-scenes panel), so every surface behaves the
 * same. No model, no network, no clock: the caller passes the time.
 *
 * A pipeline demo is a guided walkthrough of one kind of pipeline (voice-to-app, add a feature, skin swap, parallel
 * split, auto-fix, new project, approval flow): narrated chapters you can skip, each naming the console screen the
 * walkthrough moves to (focus mode follows it), and the behind-the-scenes events of that chapter (orchestrator
 * decisions, model picks, step splits, agent logs, git, tests, axHub calls) with their offsets in the chapter. The
 * player turns a demo into one timeline; speed, pause, skip and restart are pure functions of the player state.
 */

export const FRAME = 'pipeline-demo@1';
export const RECORDING_FRAME = 'pipeline-recording@1';

/** The kinds of behind-the-scenes lines, in panel filter order, with the --fx colour token each is drawn in. */
export const EVENT_KINDS = Object.freeze([
  { id: 'orchestrator', label: 'Orchestrator', tone: 'accent' },
  { id: 'model', label: 'Model picks', tone: 'info' },
  { id: 'split', label: 'Step splits', tone: 'info' },
  { id: 'agent', label: 'Agent log', tone: 'text' },
  { id: 'git', label: 'Git', tone: 'warning' },
  { id: 'test', label: 'Tests', tone: 'success' },
  { id: 'axhub', label: 'axHub', tone: 'accent' },
  { id: 'focus', label: 'Focus', tone: 'muted' },
  { id: 'error', label: 'Errors', tone: 'danger' },
]);
export const KIND_IDS = EVENT_KINDS.map((k) => k.id);

/** The pipeline types the library ships one demo of (the picker of the designer). */
export const PIPELINE_TYPES = Object.freeze([
  { id: 'voice-to-app', label: 'Voice to app', about: 'Say an idea, get an Android app.' },
  { id: 'add-feature', label: 'Add a feature', about: 'A new feature in an app that already exists.' },
  { id: 'skin-swap', label: 'Skin swap', about: 'A new look across the whole app in one move.' },
  { id: 'parallel-split', label: 'Parallel split build', about: 'One build split into slots that run at once.' },
  { id: 'auto-fix', label: 'Fix a failing build', about: 'A red build found, fixed and landed without anyone.' },
  { id: 'new-project', label: 'New project from a template', about: 'A whole new project from a template.' },
  { id: 'approval-flow', label: 'Approval flow', about: 'Veto or approve by voice before anything lands.' },
  { id: 'custom', label: 'Custom', about: 'Your own pipeline, scripted in the designer.' },
]);
export const TYPE_IDS = PIPELINE_TYPES.map((t) => t.id);

/** The console screens a chapter can move to (focus mode); any registered view id works, these are the usual ones. */
export const SCREENS = Object.freeze([
  { view: 'home', label: 'Home' },
  { view: 'voice-notes', label: 'Voice notes' },
  { view: 'build-orchestrator', label: 'Orchestrator' },
  { view: 'builds', label: 'Builds and steps' },
  { view: 'ui-review', label: 'UI Review' },
  { view: 'theme-manager', label: 'Themes and skins' },
  { view: 'project-wizard', label: 'New project' },
  { view: 'build-breaker', label: 'Build Breaker' },
  { view: 'shipped-features', label: 'Shipped features (landing)' },
  { view: 'demonstration-designer', label: 'Demonstration Designer' },
]);

export const MODES = Object.freeze(['replay', 'live']);
export const SPEEDS = Object.freeze([0.5, 1, 1.5, 2, 4]);
export const DOCKS = Object.freeze(['dock', 'float', 'full']);
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const VIEW = /^[a-z][a-z0-9-]{0,47}$/;

const str = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const slug = (v) => str(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'pipeline-demo';

/* ---------------- normalising ---------------- */

/** One behind-the-scenes line: { at (seconds into its chapter), kind, text, source? }. */
export function normalizeEvent(e, i = 0) {
  const kind = KIND_IDS.includes(e?.kind) ? e.kind : 'agent';
  return { at: num(e?.at, 0, 600, i * 0.8), kind, text: str(e?.text, 300) || '…', ...(e?.source ? { source: str(e.source, 60) } : {}) };
}

/** One chapter: { id, title, say, view, selector, seconds, events, live? }. */
export function normalizeChapter(c, i = 0) {
  const events = (Array.isArray(c?.events) ? c.events : []).slice(0, 80).map(normalizeEvent).sort((a, b) => a.at - b.at);
  const lastAt = events.length ? events[events.length - 1].at : 0;
  const say = str(c?.say, 800);
  const seconds = num(c?.seconds, 2, 600, Math.max(6, Math.ceil(lastAt) + 2, Math.round(say.split(' ').length / 2.6)));
  return {
    id: ID.test(c?.id ?? '') ? c.id : `c${i + 1}`,
    title: str(c?.title, 80) || `Chapter ${i + 1}`,
    say,
    view: VIEW.test(c?.view ?? '') ? c.view : '',
    selector: str(c?.selector, 200),
    seconds: Math.max(seconds, Math.ceil(lastAt) + 1),
    events,
    live: (Array.isArray(c?.live) ? c.live : []).filter((p) => typeof p === 'string' && /^[a-z][a-z0-9-]{1,40}$/.test(p)).slice(0, 6),
  };
}

/** A pipeline demo (pipeline-demo@1): validated, every chapter normalised, ids unique. */
export function normalizeDemo(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const chapters = (Array.isArray(r.chapters) ? r.chapters : []).slice(0, 40).map(normalizeChapter);
  const seen = new Set();
  for (const [i, c] of chapters.entries()) { while (seen.has(c.id)) c.id = `${c.id}-${i + 1}`; seen.add(c.id); }
  const name = str(r.name, 80) || 'Pipeline demo';
  return {
    $axf: FRAME,
    id: ID.test(r.id ?? '') ? r.id : slug(name),
    name,
    type: TYPE_IDS.includes(r.type) ? r.type : 'custom',
    summary: str(r.summary, 300),
    voice: (Array.isArray(r.voice) ? r.voice : []).map((v) => str(v, 60).toLowerCase()).filter(Boolean).slice(0, 8),
    builtIn: !!r.builtIn,
    chapters,
    updatedAt: str(r.updatedAt, 40),
  };
}

export function validateDemo(raw) {
  const errs = [];
  if (!raw || typeof raw !== 'object') return ['a pipeline demo is an object'];
  if (raw.id && !ID.test(raw.id)) errs.push('id is lowercase letters, digits and dashes (2 to 48)');
  if (!str(raw.name)) errs.push('a pipeline demo needs a name');
  if (!Array.isArray(raw.chapters) || !raw.chapters.length) errs.push('a pipeline demo needs at least one chapter');
  for (const [i, c] of (raw.chapters ?? []).entries()) {
    if (!str(c?.title) && !str(c?.say)) errs.push(`chapter ${i + 1} needs a title or narration`);
    if (c?.view && !VIEW.test(c.view)) errs.push(`chapter ${i + 1}: "${c.view}" is not a screen id`);
  }
  return errs;
}

export const demoSeconds = (d) => d.chapters.reduce((s, c) => s + c.seconds, 0);
export const typeLabel = (t) => PIPELINE_TYPES.find((x) => x.id === t)?.label ?? 'Custom';
export const screenLabel = (v) => SCREENS.find((s) => s.view === v)?.label ?? v;

export function summarize(d) {
  return { id: d.id, name: d.name, type: d.type, typeLabel: typeLabel(d.type), summary: d.summary, chapters: d.chapters.length, events: d.chapters.reduce((s, c) => s + c.events.length, 0), seconds: demoSeconds(d), screens: [...new Set(d.chapters.map((c) => c.view).filter(Boolean))], voice: d.voice, builtIn: d.builtIn, updatedAt: d.updatedAt };
}

/* ---------------- the timeline ---------------- */

/**
 * The demo as one timeline: chapters with their start second, every event with its absolute second (chapter start +
 * its offset) and the chapter it belongs to. A focus event is added at the start of each chapter that names a screen.
 */
export function timeline(d) {
  const chapters = [];
  const events = [];
  let t = 0;
  for (const [i, c] of d.chapters.entries()) {
    chapters.push({ index: i, id: c.id, title: c.title, say: c.say, view: c.view, selector: c.selector, start: t, end: t + c.seconds });
    if (c.view) events.push({ t, chapter: i, kind: 'focus', text: `focus → ${c.view}${c.selector ? ` ${c.selector}` : ''} (${screenLabel(c.view)})` });
    for (const e of c.events) events.push({ t: t + e.at, chapter: i, kind: e.kind, text: e.text, ...(e.source ? { source: e.source } : {}) });
    t += c.seconds;
  }
  events.sort((a, b) => a.t - b.t);
  return { total: t, chapters, events };
}

export const chapterAt = (tl, t) => { const i = tl.chapters.findIndex((c) => t >= c.start && t < c.end); return i < 0 ? (t >= tl.total ? tl.chapters.length - 1 : 0) : i; };
export const eventsUntil = (tl, t) => tl.events.filter((e) => e.t <= t);

/* ---------------- the player (pure state; the browser runs the clock) ---------------- */

/** status idle | playing | paused | done; at = demo seconds played; speed = multiplier; dock = dock | float | full. */
export function playerInit(over = {}) {
  return { status: 'idle', at: 0, speed: 1, mode: 'replay', dock: 'dock', id: '', ...over };
}

/**
 * One move of the player: play, pause, resume, toggle, tick {dt} (wall seconds), next, prev, chapter {index}, seek {at},
 * speed {speed}, restart, stop, dock {dock}. Answers the new state; tick moves `at` by dt × speed and ends at the total.
 */
export function playerReduce(s, a, tl) {
  const total = tl?.total ?? 0;
  const clampAt = (x) => Math.min(total, Math.max(0, x));
  switch (a?.type) {
    case 'play': return { ...s, status: 'playing', at: s.status === 'done' ? 0 : s.at };
    case 'pause': return s.status === 'playing' ? { ...s, status: 'paused' } : s;
    case 'resume': return s.status === 'paused' ? { ...s, status: 'playing' } : s;
    case 'toggle': return s.status === 'playing' ? { ...s, status: 'paused' } : { ...s, status: 'playing', at: s.status === 'done' ? 0 : s.at };
    case 'tick': {
      if (s.status !== 'playing') return s;
      const at = clampAt(s.at + num(a.dt, 0, 10, 0) * s.speed);
      return at >= total ? { ...s, at: total, status: 'done' } : { ...s, at };
    }
    case 'next': { const i = chapterAt(tl, s.at) + 1; return i >= tl.chapters.length ? { ...s, at: total, status: 'done' } : { ...s, at: tl.chapters[i].start }; }
    case 'prev': { const i = chapterAt(tl, s.at); const c = tl.chapters[i]; const back = c && s.at - c.start > 1.5 ? i : Math.max(0, i - 1); return { ...s, at: tl.chapters[back]?.start ?? 0, status: s.status === 'done' ? 'paused' : s.status }; }
    case 'chapter': { const c = tl.chapters[num(a.index, 0, 999, 0)]; return c ? { ...s, at: c.start, status: s.status === 'done' ? 'paused' : s.status } : s; }
    case 'seek': return { ...s, at: clampAt(num(a.at, 0, 1e6, 0)) };
    case 'speed': return { ...s, speed: num(a.speed, 0.25, 8, 1) };
    case 'restart': return { ...s, at: 0, status: 'playing' };
    case 'stop': return { ...s, status: 'idle', at: 0 };
    case 'dock': return DOCKS.includes(a.dock) ? { ...s, dock: a.dock } : s;
    case 'mode': return MODES.includes(a.mode) ? { ...s, mode: a.mode } : s;
    default: return s;
  }
}

/* ---------------- the behind-the-scenes panel ---------------- */

/** Lines a filter keeps: kinds (empty = all) and words (every word must appear, any case). */
export function filterEvents(events, { kinds = [], q = '' } = {}) {
  const words = str(q, 120).toLowerCase().split(' ').filter(Boolean);
  return events.filter((e) => (!kinds.length || kinds.includes(e.kind)) && words.every((w) => `${e.kind} ${e.text} ${e.source ?? ''}`.toLowerCase().includes(w)));
}

/** "mm:ss" of a demo second. */
export const clock = (t) => { const s = Math.max(0, Math.floor(t)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** One panel line as plain text (the CLI prints these; Copy copies them). */
export const lineText = (e) => `${clock(e.t)} ${e.kind.padEnd(12)} ${e.text}`;

/* ---------------- voice: "run the voice-to-app demo" ---------------- */

/**
 * The demo a spoken or typed phrase names: an exact id, a voice phrase, the name or the type label, best match first;
 * filler words ("run", "the", "demo", "pipeline", "play", "show me") are ignored. Answers the demo id or ''.
 */
export function matchDemo(phrase, demos) {
  const clean = (v) => ` ${str(v, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(run|play|start|show|me|the|a|an|demo|demos|pipeline|pipelines|walkthrough|please|of|for)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const p = clean(phrase).trim();
  if (!p) return '';
  const exact = demos.find((d) => d.id === str(phrase, 60).toLowerCase());
  if (exact) return exact.id;
  let best = ''; let score = 0;
  for (const d of demos) {
    const names = [d.id.replace(/-/g, ' '), d.name, typeLabel(d.type), d.type.replace(/-/g, ' '), ...(d.voice ?? [])].map((n) => clean(n).trim()).filter(Boolean);
    for (const n of names) {
      const s = n === p ? 100 : n.includes(p) || p.includes(n) ? 60 + Math.min(n.length, p.length) : p.split(' ').filter((w) => w.length > 2 && n.split(' ').includes(w)).length * 10;
      if (s > score) { score = s; best = d.id; }
    }
  }
  return score >= 10 ? best : '';
}

/* ---------------- live runs: probe output becomes events ---------------- */

/** The read-only probes a live chapter may run (the store maps each to a real command; nothing is written). */
export const PROBES = Object.freeze({
  'git-log': { kind: 'git', about: 'the last commits of the checkout' },
  'git-status': { kind: 'git', about: 'what is changed in the checkout' },
  'sandbox-builds': { kind: 'orchestrator', about: 'the builds of the test-sandbox project' },
  'model-pick': { kind: 'model', about: 'the model policy deciding each step of the chapter' },
  'step-split': { kind: 'split', about: 'the narration split into steps the way the rules splitter does' },
  'plugin-test': { kind: 'test', about: 'this plugin\'s own self-test' },
  'theme-check': { kind: 'test', about: 'the theme check over this plugin' },
  'agent-slots': { kind: 'agent', about: 'the agent slots and who holds them' },
  'axhub-ping': { kind: 'axhub', about: 'what an axHub call of the chapter would carry (dry run)' },
});

/** Output lines of a probe as events at even offsets inside the chapter (first line at `from`). */
export function probeEvents(probe, lines, { from = 0.5, span = 6 } = {}) {
  const kind = PROBES[probe]?.kind ?? 'agent';
  const kept = (lines ?? []).map((l) => str(l, 300)).filter(Boolean).slice(0, 40);
  const step = kept.length > 1 ? span / kept.length : 0;
  return kept.map((text, i) => ({ at: Math.round((from + i * step) * 10) / 10, kind: /\b(error|failed|not ok|✗)\b/i.test(text) && kind !== 'git' ? 'error' : kind, text, source: probe }));
}

/** A recording (pipeline-recording@1) of a live run: the demo with what really ran added to each chapter's lines. */
export function recordingOf(d, liveByChapter, at) {
  const chapters = d.chapters.map((c) => ({ ...c, events: [...c.events, ...(liveByChapter[c.id] ?? [])].sort((a, b) => a.at - b.at) }));
  return { $axf: RECORDING_FRAME, demo: d.id, recordedAt: str(at, 40), demoData: normalizeDemo({ ...d, chapters }) };
}

/* ---------------- deep link ---------------- */

/** `?axf-pipeline=<id>[&axf-autoplay=1][&axf-mode=live]`. */
export function pipelineLink(origin, id, { play = false, mode = '' } = {}) {
  const q = new URLSearchParams({ 'axf-pipeline': id });
  if (play) q.set('axf-autoplay', '1');
  if (mode === 'live') q.set('axf-mode', 'live');
  return `${origin || ''}/?${q.toString()}`;
}
export function parsePipelineLink(search) {
  const q = new URLSearchParams(search || '');
  const id = q.get('axf-pipeline');
  if (!id || !(ID.test(id) || id === 'library')) return null;
  return { id, play: q.get('axf-autoplay') === '1', mode: q.get('axf-mode') === 'live' ? 'live' : 'replay' };
}
