/**
 * Build docs and walkthroughs — the pure core (build-docs@1). No I/O: the CLI (cli.mjs), the host runner (runner.mjs),
 * the console's server part and the web part all use these rules, so a job means the same thing everywhere.
 *
 *   job        build-docs-job@1   one request: docs or video, for one or more builds (or single steps), its options,
 *                                 state, progress and outputs
 *   source     build-docs-source@1  what a build is made of (gather.mjs): Brett's words, steps, report, diff, screens,
 *                                 commands, settings — the only thing docs and scripts are written from
 *   script     walkthrough-video@1 (data form)  chapters → scenes { say, do: [{ op, … }] }: the click path the recorder
 *                                 plays. Only the ops in ACT_OPS exist, so a script (hand-edited or from a model) can
 *                                 never run code in the recorder.
 */

export const JOB_FORMAT = 'build-docs-job@1';
export const SOURCE_FORMAT = 'build-docs-source@1';
export const SCRIPT_FORMAT = 'walkthrough-video@1';
export const KINDS = ['docs', 'video'];

/* ------------------------------------------------------------------ options */

export const AUDIENCES = [
  { id: 'me', label: 'Me (Brett)', about: 'short, plain, what it does and where to tap' },
  { id: 'developer', label: 'Developer', about: 'files, contracts, commands, checks, how to extend it' },
  { id: 'end-user', label: 'End user', about: 'how to use it, step by step, no internals' },
];
export const DEPTHS = [
  { id: 'brief', label: 'Brief' },
  { id: 'standard', label: 'Standard' },
  { id: 'deep', label: 'Deep' },
];
/** Video lengths offered in the dialog (seconds); custom is any whole number of seconds in LENGTH_RANGE. */
export const LENGTHS = [
  { id: 30, label: '30 s' }, { id: 60, label: '1 min' }, { id: 120, label: '2 min' }, { id: 300, label: '5 min' },
];
export const LENGTH_RANGE = { min: 15, max: 1800 };
export const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, output: { width: 1920, height: 1080 } },
  phone: { width: 412, height: 915, output: { width: 720, height: 1600 } },
};
export const SPEED_RANGE = { min: 0.75, max: 1.3 };
/** Piper voices the recorder can download (same list as the walkthrough recorder's load.mjs). */
export const VOICES = [
  'en_US-kristin-medium', 'en_US-amy-medium', 'en_US-lessac-medium', 'en_US-hfc_female-medium', 'en_US-ljspeech-medium',
  'en_US-ryan-medium', 'en_US-joe-medium', 'en_US-hfc_male-medium', 'en_GB-alba-medium', 'en_GB-jenny_dioco-medium',
];
/** Words per second Piper speaks at speed 1 (≈150 per minute): the length → script budget. */
export const WORDS_PER_SECOND = 2.5;
/** Seconds a scene lasts on average: a scene is one line of narration plus one or two moves on screen. */
export const SCENE_SECONDS = 9;

export const DOC_DEFAULTS = Object.freeze({ audience: 'me', depth: 'standard', screenshots: true, ai: true, notes: '' });
export const VIDEO_DEFAULTS = Object.freeze({
  length: 60, focus: '', features: [], viewport: 'desktop', theme: '', layout: '', narration: true,
  voice: 'en_US-kristin-medium', captions: true, speed: 1, intro: true, outro: true, ai: true,
});

const str = (v, max = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\u0000/g, '').slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const one = (v, list, dflt) => (list.includes(v) ? v : dflt);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const DESIGN_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

export function normDocOptions(raw) {
  const o = obj(raw);
  return {
    audience: one(o.audience, AUDIENCES.map((a) => a.id), DOC_DEFAULTS.audience),
    depth: one(o.depth, DEPTHS.map((d) => d.id), DOC_DEFAULTS.depth),
    screenshots: o.screenshots !== false,
    ai: o.ai !== false,
    notes: str(o.notes, 4000).trim(),
  };
}

export function normVideoOptions(raw) {
  const o = obj(raw);
  const len = Math.round(Number(o.length));
  const speed = Number(o.speed);
  return {
    length: Number.isFinite(len) ? clamp(len, LENGTH_RANGE.min, LENGTH_RANGE.max) : VIDEO_DEFAULTS.length,
    focus: str(o.focus, 4000).trim(),
    features: [...new Set(arr(o.features).map((f) => str(f, 120).trim()).filter(Boolean))].slice(0, 60),
    viewport: one(o.viewport, Object.keys(VIEWPORTS), VIDEO_DEFAULTS.viewport),
    theme: DESIGN_RE.test(str(o.theme)) ? str(o.theme) : '',
    layout: DESIGN_RE.test(str(o.layout)) ? str(o.layout) : '',
    narration: o.narration !== false,
    voice: one(o.voice, VOICES, VIDEO_DEFAULTS.voice),
    captions: o.captions !== false,
    speed: Number.isFinite(speed) ? Math.round(clamp(speed, SPEED_RANGE.min, SPEED_RANGE.max) * 100) / 100 : 1,
    intro: o.intro !== false,
    outro: o.outro !== false,
    ai: o.ai !== false,
  };
}

/** What a length buys: words of narration and scenes (intro/outro cards included). */
export function budget(lengthSec, speed = 1) {
  const s = clamp(Math.round(Number(lengthSec) || VIDEO_DEFAULTS.length), LENGTH_RANGE.min, LENGTH_RANGE.max);
  return { seconds: s, words: Math.round(s * WORDS_PER_SECOND * speed), scenes: clamp(Math.round(s / SCENE_SECONDS), 2, 200) };
}

export const fmtLength = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);

/* ------------------------------------------------------------------ targets */

/** `<build>` or `<build>/<step>` (what a right-click hands over) → { build, step }. */
export function parseTarget(t) {
  const raw = typeof t === 'string' ? t : `${obj(t).build ?? obj(t).id ?? ''}${obj(t).step ? `/${obj(t).step}` : ''}`;
  const [build, step = ''] = raw.trim().split('/');
  if (!ID_RE.test(build ?? '')) return null;
  if (step && !/^[a-z0-9][a-z0-9-]{0,30}$/i.test(step)) return null;
  return { build, step };
}
export const targetKey = (t) => (t.step ? `${t.build}/${t.step}` : t.build);

/** Built enough to document? A build that is built / complete, or one with the step (or any step) done. */
export function documentable(build, step = '') {
  const b = obj(build);
  if (step) return arr(b.steps).some((s) => s.id === step && s.done);
  return ['built', 'complete'].includes(b.status) || arr(b.steps).some((s) => s.done);
}

/* ------------------------------------------------------------------ jobs */

export const STATES = ['queued', 'gathering', 'writing', 'planning', 'script-ready', 'recording', 'rendering', 'publishing', 'done', 'failed', 'cancelled'];
export const ACTIVE = ['queued', 'gathering', 'writing', 'planning', 'recording', 'rendering', 'publishing'];
export const FINAL = ['done', 'failed', 'cancelled'];
export const STATE_LABEL = {
  queued: 'Queued', gathering: 'Reading the build', writing: 'Writing', planning: 'Planning the script', 'script-ready': 'Script ready — approve it',
  recording: 'Recording', rendering: 'Rendering', publishing: 'Publishing', done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
};

export function newJobId(kind, now = new Date(), rnd = Math.random) {
  const d = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${kind === 'video' ? 'vid' : 'doc'}-${d}-${Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, '0')}`;
}
export const JOB_ID_RE = /^(doc|vid)-\d{12}-[a-z0-9]{4}$/;

/** A job as stored (unknown fields dropped, every list a list). */
export function normJob(raw) {
  const o = obj(raw);
  const kind = one(o.kind, KINDS, 'docs');
  const targets = arr(o.targets).map(parseTarget).filter(Boolean);
  const out = obj(o.outputs);
  return {
    $axf: JOB_FORMAT,
    id: str(o.id, 40),
    kind,
    title: str(o.title, 200),
    targets,
    options: kind === 'video' ? normVideoOptions(o.options) : normDocOptions(o.options),
    state: one(o.state, STATES, 'queued'),
    progress: clamp(Number(o.progress) || 0, 0, 100),
    message: str(o.message, 600),
    mode: one(o.mode, ['ai', 'template', ''], ''),
    by: str(o.by, 80),
    rerunOf: str(o.rerunOf, 40),
    createdAt: str(o.createdAt, 40),
    updatedAt: str(o.updatedAt, 40),
    finishedAt: str(o.finishedAt, 40),
    cancel: o.cancel === true,
    log: arr(o.log).map((l) => ({ at: str(obj(l).at, 40), text: str(obj(l).text, 400) })).slice(-60),
    outputs: {
      docs: arr(out.docs).map((d) => ({ path: str(obj(d).path, 300), build: str(obj(d).build, 80), url: str(obj(d).url, 600) })),
      pr: out.pr ? { number: Number(obj(out.pr).number) || 0, url: str(obj(out.pr).url, 600), branch: str(obj(out.pr).branch, 200) } : null,
      video: str(out.video, 200),
      captions: str(out.captions, 200),
      poster: str(out.poster, 200),
      script: str(out.script, 200),
      transcript: str(out.transcript, 200),
      duration: Number(out.duration) || 0,
      plans: arr(out.plans).map((p) => str(p, 80)).filter(Boolean),
    },
  };
}

export function createJob({ kind, targets, options, by = '', rerunOf = '', title = '' }, now = new Date(), rnd = Math.random) {
  const k = one(kind, KINDS, null);
  if (!k) throw new Error('kind must be docs or video');
  const ts = arr(targets).map(parseTarget).filter(Boolean);
  if (!ts.length) throw new Error('pick at least one build or step');
  if (ts.length > 20) throw new Error('20 builds at most in one job');
  const at = now.toISOString();
  return normJob({ id: newJobId(k, now, rnd), kind: k, title: title || ts.map(targetKey).join(', '), targets: ts, options, by, rerunOf, state: 'queued', createdAt: at, updatedAt: at, log: [{ at, text: 'Queued' }] });
}

/** Move a job on: refuses to leave a final state, and a cancelled job stays cancelled. */
export function advance(job, patch, now = new Date()) {
  const j = normJob(job);
  if (FINAL.includes(j.state) && patch.state && patch.state !== j.state && !patch.force) throw new Error(`job ${j.id} is ${j.state}`);
  const at = now.toISOString();
  const next = normJob({ ...j, ...patch, outputs: { ...j.outputs, ...obj(patch.outputs) }, updatedAt: at,
    log: patch.say ? [...j.log, { at, text: patch.say }] : j.log });
  if (FINAL.includes(next.state) && !next.finishedAt) next.finishedAt = at;
  if (next.state === 'done') next.progress = 100;
  return next;
}

/** Re-run with tweaks: a new job, same targets, the old options with the changes on top. */
export function rerun(job, tweaks = {}, by = '', now = new Date(), rnd = Math.random) {
  const j = normJob(job);
  return createJob({ kind: j.kind, targets: obj(tweaks).targets ?? j.targets, options: { ...j.options, ...obj(obj(tweaks).options) }, by, rerunOf: j.id, title: j.title }, now, rnd);
}

/* ------------------------------------------------------------------ source */

/** A gathered source made safe to write from (gather.mjs builds it; the AI prompt and templates read only this). */
export function normSource(raw) {
  const o = obj(raw);
  const b = obj(o.build);
  return {
    $axf: SOURCE_FORMAT,
    build: {
      id: str(b.id, 80), title: str(b.title, 200), category: str(b.category, 80), detail: str(b.detail, 4000), status: str(b.status, 30),
      profile: str(b.profile, 40), branch: str(b.branch, 200), pr: str(b.pr, 20), builtAt: str(b.builtAt, 40),
      steps: arr(b.steps).map((s) => ({ id: str(obj(s).id, 30), text: str(obj(s).text, 600), done: obj(s).done === true, model: str(obj(s).model, 20), note: str(obj(s).note, 600) })),
      notes: arr(b.notes).map((n) => str(obj(n).text ?? n, 1200)).filter(Boolean).slice(-10),
    },
    step: o.step ? { id: str(obj(o.step).id, 30), text: str(obj(o.step).text, 600) } : null,
    origin: { said: str(obj(o.origin).said, 8000), at: str(obj(o.origin).at, 40), source: str(obj(o.origin).source, 30),
      addenda: arr(obj(o.origin).addenda).map((a) => ({ text: str(obj(a).text ?? obj(a).said ?? a, 4000), at: str(obj(a).at, 40) })).filter((a) => a.text) },
    report: o.report ? { path: str(obj(o.report).path, 300), text: str(obj(o.report).text, 30000) } : null,
    diff: { ref: str(obj(o.diff).ref, 200), files: arr(obj(o.diff).files).map((f) => ({ path: str(obj(f).path, 300), add: Number(obj(f).add) || 0, del: Number(obj(f).del) || 0 })).slice(0, 400) },
    folders: arr(o.folders).map((f) => ({ path: str(obj(f).path, 200), kind: one(obj(f).kind, ['plugin', 'app', 'framework', 'other'], 'other'), name: str(obj(f).name, 120), app: str(obj(f).app, 60) })),
    screens: arr(o.screens).map((s) => ({ kind: one(obj(s).kind, ['view', 'dialog', 'settings', 'page'], 'view'), id: str(obj(s).id, 120), label: str(obj(s).label, 120), app: str(obj(s).app, 60), url: str(obj(s).url, 400), from: str(obj(s).from, 200) })).filter((s) => s.id),
    commands: arr(o.commands).map((c) => ({ id: str(obj(c).id, 120), title: str(obj(c).title, 200), method: str(obj(c).method, 8), path: str(obj(c).path, 200), mcp: str(obj(c).mcp, 120), cli: str(obj(c).cli, 300) })).filter((c) => c.id || c.path),
    settings: arr(o.settings).map((s) => ({ key: str(obj(s).key, 160), label: str(obj(s).label, 200), tab: str(obj(s).tab, 80) })).filter((s) => s.key),
    menus: arr(o.menus).map((m) => ({ label: str(obj(m).label, 160), where: str(obj(m).where, 120) })).filter((m) => m.label),
    help: arr(o.help).map((h) => ({ id: str(obj(h).id, 160), label: str(obj(h).label, 200), text: str(obj(h).text, 600) })).filter((h) => h.text).slice(0, 80),
    readme: o.readme ? { path: str(obj(o.readme).path, 300), text: str(obj(o.readme).text, 12000) } : null,
    about: str(o.about, 1200),
    warnings: arr(o.warnings).map((w) => str(w, 300)),
  };
}

/** Where a build's docs go: its main plugin's or app's docs/ folder, else docs/builds/ at the repo root. */
export function docPath(src) {
  const s = normSource(src);
  const main = s.folders.find((f) => f.kind === 'plugin') ?? s.folders.find((f) => f.kind === 'app');
  const name = `${s.build.id}${s.step ? `-${s.step.id}` : ''}.md`;
  return main ? `${main.path.replace(/\/$/, '')}/docs/${name}` : `docs/builds/${name}`;
}

/* ------------------------------------------------------------------ docs (template) */

const quote = (t) => t.split('\n').map((l) => `> ${l}`).join('\n');
const bullets = (xs) => xs.map((x) => `- ${x}`).join('\n');
const firstLines = (t, n) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('|')).slice(0, n);
const human = (id) => id.replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** A build's name as said aloud or on a card: the title up to its first colon, dash or bracket, 60 characters at most. */
export function shortName(build) {
  const b = obj(build);
  const t = str(b.title, 200).split(/\s*(?::|—| - |\(|;)\s*/)[0].trim();
  return (t || human(str(b.id))).slice(0, 60);
}

/** Markdown docs without a model: everything comes straight from the source, nothing is made up. */
export function templateDoc(src, rawOpts = {}) {
  const s = normSource(src);
  const o = normDocOptions(rawOpts);
  const dev = o.audience === 'developer';
  const user = o.audience === 'end-user';
  const deep = o.depth === 'deep';
  const brief = o.depth === 'brief';
  const L = [];
  const title = s.step ? `${shortName(s.build)}: ${s.step.text.split(/[.;:]/)[0].slice(0, 80)}` : shortName(s.build);
  L.push(`# ${title}`, '');
  if (s.build.title && s.build.title !== title && !s.step) L.push(s.build.title, '');
  const meta = [`Build \`${s.build.id}\``, s.build.status && `status ${s.build.status}`, s.build.pr && `PR ${s.build.pr}`, s.build.branch && `branch \`${s.build.branch}\``].filter(Boolean);
  if (!user) L.push(`_${meta.join(' · ')}_`, '');
  if (o.notes) L.push('> **Covered on request:** ' + o.notes.replace(/\n+/g, ' '), '');

  L.push('## What it does', '');
  const what = s.step ? s.step.text : [s.about, s.report ? firstLines(s.report.text, 3).join(' ') : '', s.build.detail].find((t) => t && t.length > 20) || s.build.title;
  L.push(what, '');
  if (!user && s.origin.said) {
    L.push('### What Brett asked for (verbatim)', '', quote(s.origin.said), '');
    for (const [i, a] of s.origin.addenda.entries()) L.push(`**Addendum ${i + 1}${a.at ? ` (${a.at.slice(0, 10)})` : ''}:**`, '', quote(a.text), '');
  }

  const screens = s.screens;
  if (screens.length) {
    L.push('## How to use it', '');
    screens.forEach((sc, i) => {
      const where = sc.kind === 'settings' ? `Settings → Plugins → **${sc.label}**` : sc.kind === 'dialog' ? `the **${sc.label}** dialog` : `**${sc.label}**${sc.app ? ` (${sc.app})` : ''}`;
      L.push(`${i + 1}. Open ${where}.${sc.url ? ` Link: ${sc.url}` : ''}`);
      const help = s.help.filter((h) => h.id.startsWith(sc.id) || h.label === sc.label).slice(0, brief ? 1 : 4);
      for (const h of help) L.push(`   - ${h.label ? `**${h.label}:** ` : ''}${h.text}`);
    });
    L.push('');
  }
  const steps = s.build.steps.filter((x) => x.done && (!s.step || x.id === s.step.id));
  if (steps.length && !brief) {
    L.push(user ? '## What you can do' : '## What was built, step by step', '');
    L.push(bullets(steps.map((x) => (user ? x.text : `**${x.id}** ${x.text}${x.note ? ` — ${x.note}` : ''}`))), '');
  }
  if (s.menus.length) L.push('## Menus and right-click actions', '', bullets(s.menus.map((m) => `${m.label}${m.where ? ` (${m.where})` : ''}`)), '');
  if (s.settings.length) L.push('## Settings', '', bullets(s.settings.slice(0, brief ? 6 : 40).map((x) => `**${x.label || x.key}**${dev ? ` — \`${x.key}\`` : ''}${x.tab ? ` (tab ${x.tab})` : ''}`)), '');
  if (s.commands.length && !user) {
    L.push('## Commands (voice, API, MCP, CLI)', '');
    L.push('| Command | API | MCP | CLI |', '| --- | --- | --- | --- |');
    for (const c of s.commands.slice(0, deep ? 80 : 25)) L.push(`| ${c.title || c.id} | ${c.method && c.path ? `\`${c.method} ${c.path}\`` : ''} | ${c.mcp ? `\`${c.mcp}\`` : ''} | ${c.cli ? `\`${c.cli}\`` : ''} |`);
    L.push('', 'Every command also answers by voice in Molly (say its title).', '');
  }
  if (dev && s.diff.files.length) {
    const byFolder = new Map();
    for (const f of s.diff.files) { const k = f.path.split('/').slice(0, f.path.startsWith('apps/console-web/plugins/') ? 4 : 2).join('/'); byFolder.set(k, (byFolder.get(k) ?? 0) + 1); }
    L.push('## Files', '', bullets([...byFolder].sort((a, b) => b[1] - a[1]).slice(0, deep ? 40 : 12).map(([k, n]) => `\`${k}\` (${n} file${n === 1 ? '' : 's'})`)), '');
  }
  if (s.report && !brief && !user) {
    const lines = firstLines(s.report.text, deep ? 20 : 6);
    if (lines.length) L.push('## From the build report', '', ...lines.map((l) => (l.startsWith('-') ? l : `- ${l}`)), '', `Full report: \`${s.report.path}\``, '');
  }
  L.push('## Troubleshooting', '');
  const tips = [];
  if (s.screens.some((x) => x.kind === 'settings')) tips.push('Nothing shows up? Check the plugin is switched on in Settings → Plugins → Plugin manager.');
  if (s.commands.length) tips.push('A command answers 404: the plugin is off, or the console has not reloaded since it was installed.');
  if (s.build.status !== 'complete') tips.push(`The build is ${s.build.status || 'not merged yet'}: what is described here may not be on main until its PR lands.`);
  tips.push('Still stuck? Right-click the build → Create documentation again with Deep depth, or ask Claude with this file open.');
  L.push(bullets(tips), '');
  L.push('---', `_Written by Build docs (template) from the build record${s.report ? ', its report' : ''}${s.diff.files.length ? ' and its diff' : ''}._`, '');
  return L.join('\n');
}

/** The AI's brief for docs: the source, the options, and the shape wanted. */
export function aiDocPrompt(src, rawOpts = {}) {
  const s = normSource(src);
  const o = normDocOptions(rawOpts);
  const aud = AUDIENCES.find((a) => a.id === o.audience);
  const system = [
    'You write Markdown documentation for features of the AmberX AXF framework and its Dev Console.',
    'Write only from the material given. Never invent screens, settings, commands or behaviour that are not in it; when something is unclear, leave it out.',
    'Clean, professional English. No marketing words. Use the exact names of screens, buttons, settings and commands as given.',
    'Sections, in this order (skip one only when there is nothing for it): # <title>, ## What it does, ## How to use it (numbered, screen by screen), ## Settings, ## Menus and right-click actions, ## Commands (voice, API, MCP, CLI) as a table, ## Troubleshooting.',
    o.audience !== 'end-user' ? "Quote Brett's own words verbatim in a '### What Brett asked for (verbatim)' block under What it does." : 'Leave out internals: no file paths, no build ids.',
  ].join('\n');
  const user = [
    `Audience: ${aud.label} (${aud.about}). Depth: ${o.depth}.`,
    o.notes ? `Cover especially: ${o.notes}` : '',
    'Material (JSON):',
    JSON.stringify({ ...s, report: s.report ? { ...s.report, text: s.report.text.slice(0, 12000) } : null, diff: { ...s.diff, files: s.diff.files.slice(0, 120) } }),
    'Answer with the Markdown document only.',
  ].filter(Boolean).join('\n\n');
  return { system, messages: [{ role: 'user', content: user }], maxTokens: o.depth === 'deep' ? 6000 : o.depth === 'brief' ? 1500 : 3500 };
}

/** A model's docs answer, made safe: Markdown only, a title, no HTML scripts. '' = unusable (use the template). */
export function cleanAiDoc(text) {
  let t = str(text, 120000).trim();
  const fence = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/<\s*(script|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '').replace(/<\s*(script|iframe|object|embed)[^>]*>/gi, '');
  if (!/^#\s+\S/m.test(t) || t.length < 120) return '';
  return `${t}\n\n---\n_Written by Build docs (AI) from the build record; check it against the code before relying on it._\n`;
}

/* ------------------------------------------------------------------ video script */

/** The moves a scene may make (record.mjs helpers). Arguments are data only, checked here. */
export const ACT_OPS = {
  open: ['url'], view: ['name', 'label'], hl: ['sel', 'label'], click: ['sel', 'label'], scroll: ['dy'], wait: ['ms'],
  go: ['title'], calm: [], card: ['title', 'sub'], settings: ['tab', 'sub'], menu: ['top'], dialog: ['id'],
};
/** Origins a scene may open (the live apps behind the hub's wall; the recorder answers every write in the browser). */
export const ALLOWED_ORIGINS = ['https://console.amberxai.com', 'https://axhub.amberxai.com', 'https://amberx.amberxai.com', 'https://walkthrough.amberxai.com', 'https://molly.amberxai.com'];
export const APP_URLS = { 'console-web': 'https://console.amberxai.com/', 'axhub-web': 'https://axhub.amberxai.com/', 'amberx-droid': 'https://amberx.amberxai.com/', 'walkthrough-studio': 'https://walkthrough.amberxai.com/', molly: 'https://molly.amberxai.com/' };

function normAct(a) {
  const o = obj(a);
  const op = str(o.op, 20);
  if (!(op in ACT_OPS)) return null;
  const out = { op };
  for (const k of ACT_OPS[op]) {
    if (o[k] == null || o[k] === '') continue;
    if (k === 'dy') out.dy = clamp(Math.round(Number(o.dy) || 0), -4000, 4000);
    else if (k === 'ms') out.ms = clamp(Math.round(Number(o.ms) || 0), 0, 15000);
    else if (k === 'url') { const u = str(o.url, 600); if (!allowedUrl(u)) return null; out.url = u; }
    else if (k === 'sel') { const v = str(o.sel, 300); if (/javascript:|<\s*script/i.test(v)) return null; out.sel = v; }
    else out[k] = str(o[k], 160);
  }
  return out;
}
export function allowedUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && ALLOWED_ORIGINS.includes(x.origin); } catch { return /^#\/?[\w./:-]*$/.test(u); }
}

const cleanSay = (t) => str(t, 400).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** A script made safe and fitted to the options: known ops only, chapter ids, the viewport, voice, speed, captions. */
export function normScript(raw, rawOpts = {}, meta = {}) {
  const o = normVideoOptions(rawOpts);
  const r = obj(raw);
  const vp = VIEWPORTS[o.viewport];
  const ids = new Set();
  const chapters = arr(r.chapters).map((c, i) => {
    let id = str(obj(c).id, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || `part-${i + 1}`;
    if (!/^[a-z0-9]/.test(id)) id = `p${id}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const url = allowedUrl(str(obj(c).url)) ? str(obj(c).url) : '';
    return {
      id, title: str(obj(c).title, 60) || `Part ${i + 1}`, device: o.viewport, url,
      scenes: arr(obj(c).scenes).map((s) => ({ say: cleanSay(obj(s).say), do: arr(obj(s).do).map(normAct).filter(Boolean).slice(0, 12) })).filter((s) => s.say.length >= 10),
    };
  }).filter((c) => c.scenes.length);
  return {
    $axf: SCRIPT_FORMAT,
    id: str(meta.id ?? r.id, 60) || 'build-walkthrough',
    title: str(meta.title ?? r.title, 120) || 'Build walkthrough',
    source: 'build-docs',
    app: str(meta.app ?? r.app, 60) || 'console-web',
    url: allowedUrl(str(meta.url ?? r.url)) ? str(meta.url ?? r.url) : APP_URLS['console-web'],
    device: o.viewport,
    viewport: { width: VIEWPORTS.phone.width, height: VIEWPORTS.phone.height },
    desktop: { width: VIEWPORTS.desktop.width, height: VIEWPORTS.desktop.height },
    output: { ...vp.output, crf: 26, preset: 'veryfast' },
    voice: o.voice, speed: o.speed, narration: o.narration, captions: o.captions,
    theme: o.theme, layout: o.layout, length: o.length,
    chapters,
  };
}

/** Problems with a script (strings; empty = it can be recorded). */
export function scriptErrors(script) {
  const s = obj(script);
  const e = [];
  if (s.$axf !== SCRIPT_FORMAT) e.push(`script must be ${SCRIPT_FORMAT}`);
  if (!arr(s.chapters).length) e.push('no chapters');
  for (const [i, c] of arr(s.chapters).entries()) {
    if (!arr(c.scenes).length) e.push(`chapter ${i + 1}: no scenes`);
    for (const [k, sc] of arr(c.scenes).entries()) {
      if (cleanSay(sc.say).length < 10) e.push(`chapter ${i + 1} scene ${k + 1}: narration too short`);
      for (const a of arr(sc.do)) if (!normAct(a)) e.push(`chapter ${i + 1} scene ${k + 1}: move "${obj(a).op}" is not allowed`);
    }
  }
  return e;
}

export const scriptWords = (script) => arr(obj(script).chapters).reduce((n, c) => n + arr(c.scenes).reduce((m, s) => m + cleanSay(s.say).split(/\s+/).filter(Boolean).length, 0), 0);
/** About how long the script runs (seconds): narration time, or 4 s a scene with narration off. */
export function scriptSeconds(script) {
  const s = obj(script);
  const scenes = arr(s.chapters).reduce((n, c) => n + arr(c.scenes).length, 0);
  const speech = scriptWords(s) / (WORDS_PER_SECOND * (Number(s.speed) || 1));
  return Math.round(Math.max(speech, scenes * 4) + scenes * 0.6);
}

/** Cut a script down to its scene budget: the intro and outro stay, the middle keeps chapters in order. */
export function fitScript(script, rawOpts = {}) {
  const o = normVideoOptions(rawOpts);
  const b = budget(o.length, o.speed);
  const s = obj(script);
  let left = b.scenes;
  const chapters = [];
  const all = arr(s.chapters);
  const fixed = all.filter((c) => c.id === 'intro' || c.id === 'outro').reduce((n, c) => n + c.scenes.length, 0);
  left -= fixed;
  for (const c of all) {
    if (c.id === 'intro' || c.id === 'outro') { chapters.push(c); continue; }
    if (left <= 0) continue;
    const scenes = c.scenes.slice(0, left);
    left -= scenes.length;
    chapters.push({ ...c, scenes });
  }
  return { ...s, chapters };
}

/** One plain sentence on what the build is: the plugin's own description, the report, else the brief (not a note). */
export function summaryLine(src) {
  const s = normSource(src);
  const first = (t) => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  const report = s.report ? firstLines(s.report.text, 1)[0] ?? '' : '';
  for (const t of [s.about, report, s.build.detail]) { const f = first(t); if (f && f.length > 20 && !/^(brett|chat|plan:|branch|pr\b)/i.test(f)) return f; }
  return 'Here is what it does and how to use it.';
}

/** Words the scene may use so the whole script lands near its length. */
const lineFor = (text, words) => { const t = speakable(text); const w = t.split(/\s+/).filter(Boolean); return w.length <= words ? t : `${w.slice(0, words).join(' ').replace(/[,;:]$/, '')}.`; };
/** Text made for speaking: no code bits (`x`, file paths, format ids like plan@1, arrows), no bracketed asides. */
export function speakable(text) {
  return str(text, 2000)
    .replace(/`[^`]*`/g, '')
    .replace(/\([^)]*[@/→=][^)]*\)/g, '')
    .replace(/\b([a-z][\w-]*)@\d+\b/gi, '$1')
    .replace(/(?:^|\s)[\w.-]+\/[\w./-]+/g, ' ')
    .replace(/\s*[→+|]\s*/g, ', ')
    .replace(/\s+([,.;:])/g, '$1').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
}

/**
 * The script without a model: intro card, one chapter per screen the build added (open it, show the main area, then
 * the focus picks), the steps that were built in order, an outro card. Fitted to the length budget.
 */
export function planScript(src, rawOpts = {}) {
  const s = normSource(src);
  const o = normVideoOptions(rawOpts);
  const b = budget(o.length, o.speed);
  const per = Math.max(10, Math.round(b.words / b.scenes));
  const name = shortName(s.build);
  const focusWanted = o.features.length ? new Set(o.features) : null;
  const chapters = [];
  if (o.intro) chapters.push({ id: 'intro', title: name, scenes: [{ say: lineFor(`This is ${name}. ${s.step ? `This part covers ${s.step.text}` : summaryLine(s)}`, per), do: [{ op: 'card', title: name, sub: s.step ? s.step.text.slice(0, 80) : `Build ${s.build.id}` }, { op: 'wait', ms: 1500 }] }] });
  if (o.focus) chapters.push({ id: 'focus', title: 'What this covers', scenes: [{ say: lineFor(`Covered on request: ${o.focus}`, per), do: [{ op: 'card', title: 'What this covers', sub: o.focus.slice(0, 120) }] }] });
  const screens = s.screens.filter((x) => !focusWanted || focusWanted.has(`screen:${x.id}`) || ![...focusWanted].some((f) => f.startsWith('screen:')));
  const app = screens[0]?.app || s.folders.find((f) => f.app)?.app || 'console-web';
  for (const sc of screens.slice(0, 12)) {
    const help = s.help.filter((h) => (h.id.startsWith(sc.id) || h.label === sc.label) && h.text.length > 25);
    const scenes = [];
    if (sc.kind === 'settings') scenes.push({ say: lineFor(`Its settings live under Settings, Plugins, ${sc.label}.`, per), do: [{ op: 'settings', tab: 'plugins', sub: sc.id }, { op: 'wait', ms: 800 }, { op: 'hl', sel: 'main', label: sc.label }] });
    else if (sc.kind === 'dialog') scenes.push({ say: lineFor(`The ${sc.label} dialog.${help[0] ? ` ${help[0].text}` : ''}`, per), do: [{ op: 'dialog', id: sc.id }, { op: 'wait', ms: 1200 }, { op: 'hl', sel: '.fx-dialog', label: sc.label }] });
    else if (sc.url) scenes.push({ say: lineFor(`Open ${sc.label}.${help[0] ? ` ${help[0].text}` : ''}`, per), do: [{ op: 'open', url: sc.url }, { op: 'hl', sel: 'main', label: sc.label }] });
    else scenes.push({ say: lineFor(`Open ${sc.label}.${help[0] ? ` ${help[0].text}` : ''}`, per), do: [{ op: 'view', name: sc.id, label: sc.label }, { op: 'hl', sel: 'main', label: sc.label }] });
    for (const h of help.slice(1, 4)) scenes.push({ say: lineFor(`${h.label ? `${h.label}: ` : ''}${h.text}`, per), do: [{ op: 'scroll', dy: 300 }, { op: 'wait', ms: 600 }] });
    chapters.push({ id: `screen-${sc.id}`, title: sc.label.slice(0, 60), url: sc.url || '', scenes });
  }
  const steps = s.build.steps.filter((x) => x.done && (!s.step || x.id === s.step.id) && (!focusWanted || focusWanted.has(`step:${x.id}`) || ![...focusWanted].some((f) => f.startsWith('step:'))));
  if (steps.length) chapters.push({ id: 'built', title: 'What was built', scenes: steps.map((x) => ({ say: lineFor(x.text.endsWith('.') ? x.text : `${x.text}.`, per), do: [{ op: 'card', title: `Step ${x.id}`, sub: x.text.slice(0, 120) }, { op: 'wait', ms: 1200 }] })) });
  if (s.commands.length && (!focusWanted || focusWanted.has('commands'))) chapters.push({ id: 'commands', title: 'Commands', scenes: [{ say: lineFor(`Everything here also runs by voice in Molly, and from the API, M-C-P and the command line: ${s.commands.slice(0, 4).map((c) => c.title || c.id).join(', ')}.`, per), do: [{ op: 'card', title: 'Commands', sub: s.commands.slice(0, 4).map((c) => c.title || c.id).join(' · ') }] }] });
  if (o.outro) chapters.push({ id: 'outro', title: 'Wrap-up', scenes: [{ say: lineFor(`That's ${name}. Right-click any build to make docs or a video like this one.`, per), do: [{ op: 'card', title: name, sub: 'Made with Build docs' }, { op: 'wait', ms: 1500 }] }] });
  const script = normScript({ chapters }, o, { id: `build-${s.build.id}`.slice(0, 60), title: name, app, url: APP_URLS[app] ?? APP_URLS['console-web'] });
  return fitScript(script, o);
}

/** The AI's brief for a script: the source, the budget and the moves it may use. */
export function aiScriptPrompt(src, rawOpts = {}) {
  const s = normSource(src);
  const o = normVideoOptions(rawOpts);
  const b = budget(o.length, o.speed);
  const system = [
    'You plan narrated screen walkthrough videos of features in the AmberX AXF Dev Console and its apps, recorded by a headless browser.',
    `Answer with JSON only: {"chapters":[{"id":"kebab-id","title":"…","url":"optional https url","scenes":[{"say":"one spoken line","do":[{"op":"…", …}]}]}]}.`,
    `Moves ("op") and their fields: ${Object.entries(ACT_OPS).map(([k, v]) => `${k}(${v.join(', ')})`).join('; ')}. view = a console page by its view id; dialog = open a dialog by id; card = a full-screen title card; hl/click take CSS selectors; settings(tab, sub) opens a settings tab.`,
    `Only open urls on ${ALLOWED_ORIGINS.join(', ')}. Only show screens, dialogs and settings that are in the material. Never type secrets or click anything that deletes or sends.`,
    `Budget: about ${b.scenes} scenes and ${b.words} spoken words in total (${fmtLength(b.seconds)}). Lines are spoken aloud: plain words, spell out letters (M-C-P, A-P-I), under 400 characters each.`,
    o.intro ? 'Start with a chapter "intro" (a card + one line).' : 'No intro card.',
    o.outro ? 'End with a chapter "outro" (a card + one line).' : 'No outro card.',
  ].join('\n');
  const focusSteps = o.features.length ? `Cover these first: ${o.features.join(', ')}.` : '';
  const user = [
    o.focus ? `Brett wants this covered: ${o.focus}` : '', focusSteps,
    `Viewport: ${o.viewport}.`,
    'Material (JSON):',
    JSON.stringify({ build: s.build, step: s.step, origin: s.origin, screens: s.screens, commands: s.commands.slice(0, 30), settings: s.settings.slice(0, 40), menus: s.menus, help: s.help.slice(0, 40), report: s.report ? s.report.text.slice(0, 6000) : '' }),
  ].filter(Boolean).join('\n\n');
  return { system, messages: [{ role: 'user', content: user }], maxTokens: Math.min(8000, 800 + b.scenes * 120) };
}

/** A model's script answer → a fitted script, or null (use planScript). */
export function parseAiScript(text, src, rawOpts = {}) {
  const t = str(text, 200000);
  const m = /\{[\s\S]*\}/.exec(t);
  if (!m) return null;
  let raw;
  try { raw = JSON.parse(m[0]); } catch { return null; }
  const s = normSource(src);
  const o = normVideoOptions(rawOpts);
  const app = s.screens[0]?.app || s.folders.find((f) => f.app)?.app || 'console-web';
  const script = fitScript(normScript(raw, o, { id: `build-${s.build.id}`.slice(0, 60), title: shortName(s.build), app, url: APP_URLS[app] ?? APP_URLS['console-web'] }), o);
  return scriptErrors(script).length ? null : script;
}

/** Scene edits from the approval dialog: { '<chapter>-<n>': 'new line' } and removed scenes; the rest stays. */
export function editScript(script, edits = {}) {
  const s = obj(script);
  const lines = obj(obj(edits).lines);
  const drop = new Set(arr(obj(edits).remove));
  return {
    ...s,
    chapters: arr(s.chapters).map((c) => ({
      ...c,
      scenes: arr(c.scenes).map((sc, i) => ({ ...sc, say: lines[`${c.id}-${i}`] != null ? cleanSay(lines[`${c.id}-${i}`]) : sc.say })).filter((sc, i) => !drop.has(`${c.id}-${i}`) && sc.say.length >= 10),
    })).filter((c) => c.scenes.length),
  };
}

/** The transcript saved next to the video: chapter headings and every spoken line. */
export function transcript(script) {
  const s = obj(script);
  const L = [`# ${s.title ?? 'Walkthrough'} — transcript`, ''];
  for (const c of arr(s.chapters)) { L.push(`## ${c.title}`, ''); for (const sc of arr(c.scenes)) L.push(sc.say, ''); }
  return L.join('\n');
}

/** Feature picks for the video dialog (focus checkboxes): the build's done steps, its screens, its commands. */
export function featureChoices(src) {
  const s = normSource(src);
  return [
    ...s.build.steps.filter((x) => x.done).map((x) => ({ id: `step:${x.id}`, label: `${x.id} · ${x.text.slice(0, 90)}`, group: 'Steps' })),
    ...s.screens.map((x) => ({ id: `screen:${x.id}`, label: `${x.label}${x.kind !== 'view' ? ` (${x.kind})` : ''}`, group: 'Screens' })),
    ...(s.commands.length ? [{ id: 'commands', label: `Commands (${s.commands.length})`, group: 'Other' }] : []),
  ];
}

/** Several builds in one video: their chapters in order, one intro and one outro, fitted to the length. */
export function mergeScripts(scripts, rawOpts = {}, title = '') {
  const o = normVideoOptions(rawOpts);
  const list = arr(scripts).filter(Boolean);
  if (list.length === 1) return list[0];
  const names = list.map((s) => s.title).filter(Boolean);
  const chapters = [];
  const intro = list[0]?.chapters.find((c) => c.id === 'intro');
  if (intro && o.intro) chapters.push({ ...intro, title: (title || names.join(', ')).slice(0, 60), scenes: [{ say: cleanSay(`This walkthrough covers ${names.join(', ')}.`), do: [{ op: 'card', title: (title || names.join(' · ')).slice(0, 120), sub: `${names.length} builds` }, { op: 'wait', ms: 1500 }] }] });
  list.forEach((s, i) => { for (const c of s.chapters) if (c.id !== 'intro' && c.id !== 'outro') chapters.push({ ...c, id: `b${i + 1}-${c.id}`.slice(0, 40) }); });
  const outro = list.at(-1)?.chapters.find((c) => c.id === 'outro');
  if (outro && o.outro) chapters.push({ ...outro, scenes: [{ say: cleanSay(`That's ${names.join(', ')}. Right-click any build to make docs or a video like this one.`), do: [{ op: 'card', title: 'Wrap-up', sub: 'Made with Build docs' }] }] });
  return fitScript(normScript({ chapters }, o, { ...list[0], id: list[0].id, title: (title || names.join(', ')).slice(0, 120) }), o);
}
