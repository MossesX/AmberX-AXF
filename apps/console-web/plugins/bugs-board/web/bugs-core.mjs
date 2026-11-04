/**
 * Bugs board core (bugs@1 / bug@1): pure functions shared by the CLI (bugs.mjs), the console server (through the CLI)
 * and the board UI. No I/O here.
 *
 *   bug@1     one confirmed bug: title, details, status (confirmed | in-build | fixed | wontfix), severity, app, area,
 *             tags, files, who reported it and when, Brett's verbatim words, the build it is part of, the PR that
 *             fixed it, its place on the board (order) and a short history.
 *   bugs@1    the file next to the builds store (_claude/builds/bugs.json): settings + bugs. Deleted bugs stay as
 *             tombstones so a newer-wins merge (per bug, by updatedAt) never brings one back.
 *
 * Builds are passed in as a context ({ id, title, status, live, steps, done, files, text, agent, queuePos, pr, … },
 * made by bugs.mjs from the builds store, agent-slots and the crew). The optimizer and the handoff rules only read it.
 */

export const STATUSES = ['confirmed', 'in-build', 'fixed', 'wontfix'];
export const SEVERITIES = ['low', 'normal', 'high', 'urgent'];
export const OPEN = new Set(['confirmed', 'in-build']);
/** Build states a bug may be moved into: queued or in progress. Never a built, merging, finished or archived one. */
export const TARGET_STATES = new Set(['pending', 'waiting', 'queued', 'running', 'blocked']);
export const DEFAULT_SETTINGS = {
  autoOptimize: false, // re-run the optimizer on new bugs and when the queue changes (Brett's switch, default off)
  maxPerBuild: 3, // never more than this many open bugs on one build
  minScore: 2, // the optimizer's match threshold
  askAi: false, // the 'Ask AI' button for unclear matches (costs tokens)
  chat: true, // post handoffs in the crew group chat
  tone: 'street', // street | clean
  whenBounced: 'reroute', // reroute (Boss finds the next best build) | ask (Brett picks)
  bouncesBeforeAsk: 3, // after this many bounces in a row, ask Brett
  scope: 'profile', // the optimizer looks at: profile (the active build profile's builds) | all
  freshDays: 21, // the optimizer skips builds nobody touched for this many days (dragging still works)
};
const SETTING_KINDS = { autoOptimize: 'bool', maxPerBuild: [1, 20], minScore: [1, 50], askAi: 'bool', chat: 'bool', tone: ['street', 'clean'], whenBounced: ['reroute', 'ask'], bouncesBeforeAsk: [1, 10], scope: ['profile', 'all'], freshDays: [1, 365] };

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v, max = 40, len = 200) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, len).trim()).filter(Boolean))].slice(0, max) : []);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function slug(s) { return str(s, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'bug'; }
export function newId(title, at, taken = new Set()) {
  const base = `b-${slug(title).slice(0, 32).replace(/-+$/, '')}`;
  let id = base; let n = 2;
  while (taken.has(id)) { id = `${base}-${n}`; n += 1; }
  return id;
}

export function normBug(b = {}, i = 0) {
  return {
    $axf: 'bug@1',
    id: str(b.id, 80) || `b-${i + 1}`,
    title: str(b.title, 200).trim(),
    details: str(b.details, 4000),
    status: STATUSES.includes(b.status) ? b.status : 'confirmed',
    severity: SEVERITIES.includes(b.severity) ? b.severity : 'normal',
    app: str(b.app, 60),
    area: str(b.area, 120),
    tags: list(b.tags, 20, 40),
    files: list(b.files, 40, 300),
    reportedBy: str(b.reportedBy, 80) || 'brett',
    reportedAt: str(b.reportedAt, 40),
    said: str(b.said, 4000),
    build: str(b.build, 80),
    profile: str(b.profile, 40),
    fixedPr: str(b.fixedPr, 300),
    order: num(b.order, i),
    needsBrett: b.needsBrett === true,
    candidates: list(b.candidates, 8, 80),
    bounces: Math.max(0, Math.round(num(b.bounces, 0))),
    history: (Array.isArray(b.history) ? b.history : []).slice(-30).map((h) => ({ at: str(h?.at, 40), by: str(h?.by, 80), what: str(h?.what, 300) })),
    createdAt: str(b.createdAt, 40),
    updatedAt: str(b.updatedAt, 40),
    deleted: b.deleted === true,
  };
}

export function normSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, kind] of Object.entries(SETTING_KINDS)) {
    if (!(k in (s ?? {}))) continue;
    const v = s[k];
    if (kind === 'bool') out[k] = v === true || v === 'true' || v === 'on';
    else if (typeof kind[0] === 'number') out[k] = Math.min(kind[1], Math.max(kind[0], Math.round(num(v, out[k]))));
    else if (kind.includes(v)) out[k] = v;
  }
  return out;
}

export function emptyFile() { return { $axf: 'bugs@1', rev: 0, updatedAt: '', settings: { ...DEFAULT_SETTINGS }, settingsAt: '', bugs: [], undo: [] }; }
export function normFile(f = {}) {
  return {
    $axf: 'bugs@1', rev: Math.max(0, Math.round(num(f?.rev, 0))), updatedAt: str(f?.updatedAt, 40),
    settings: normSettings(f?.settings), settingsAt: str(f?.settingsAt, 40),
    bugs: (Array.isArray(f?.bugs) ? f.bugs : []).map(normBug),
    undo: (Array.isArray(f?.undo) ? f.undo : []).slice(-10).map((u) => ({ at: str(u?.at, 40), by: str(u?.by, 80), what: str(u?.what, 200), moves: (Array.isArray(u?.moves) ? u.moves : []).map((m) => ({ bug: str(m?.bug, 80), from: str(m?.from, 80), to: str(m?.to, 80) })) })),
  };
}
export const fileText = (f) => `${JSON.stringify(normFile(f), null, 1)}\n`;

/** Problems with a bugs@1 file, as { path, message }. Empty = valid. */
export function validate(f) {
  const errs = [];
  if (f?.$axf !== 'bugs@1') errs.push({ path: '$axf', message: 'must be "bugs@1"' });
  const ids = new Set();
  (f?.bugs ?? []).forEach((b, i) => {
    if (!b?.id) errs.push({ path: `bugs[${i}].id`, message: 'is required' });
    else if (ids.has(b.id)) errs.push({ path: `bugs[${i}].id`, message: `duplicate id ${b.id}` });
    ids.add(b?.id);
    if (!b?.deleted && !str(b?.title).trim()) errs.push({ path: `bugs[${i}].title`, message: 'is required' });
    if (b?.status && !STATUSES.includes(b.status)) errs.push({ path: `bugs[${i}].status`, message: `unknown status ${b.status}` });
  });
  return errs;
}

/** Newer-wins merge of two bugs@1 files (per bug by updatedAt; settings by settingsAt). Order of ids is kept. */
export function mergeFiles(a, b) {
  const A = normFile(a); const B = normFile(b);
  const by = new Map(A.bugs.map((x) => [x.id, x]));
  for (const x of B.bugs) { const o = by.get(x.id); if (!o || (x.updatedAt || '') > (o.updatedAt || '')) by.set(x.id, x); }
  const newer = (B.settingsAt || '') > (A.settingsAt || '');
  const undo = [...A.undo, ...B.undo.filter((u) => !A.undo.some((v) => v.at === u.at && v.what === u.what))].sort((x, y) => (x.at < y.at ? -1 : 1)).slice(-10);
  return normFile({ rev: Math.max(A.rev, B.rev), updatedAt: [A.updatedAt, B.updatedAt].sort().pop(), settings: newer ? B.settings : A.settings, settingsAt: newer ? B.settingsAt : A.settingsAt, bugs: [...by.values()], undo });
}

export const live = (f) => normFile(f).bugs.filter((b) => !b.deleted);
export const openBugs = (f) => live(f).filter((b) => OPEN.has(b.status));
export const sorted = (bugs) => [...bugs].sort((x, y) => x.order - y.order || (x.createdAt < y.createdAt ? -1 : 1));

/** Can a bug go into this build? (queued or running, not built/merging/finished, not hidden) */
export function isTarget(build) {
  if (!build || build.hidden) return false;
  if (!TARGET_STATES.has(build.live || build.status)) return false;
  return true;
}

// ------------------------------------------------------------------ changes

/**
 * Apply one change to the file. Returns { file, log, moved: [{bug, from, to}], bug }. `at` and `by` stamp the change.
 * Moves are recorded so the CLI can do their side effects (brief addendum, build step, chat handoff).
 *   add {bug}               a new confirmed bug (unassigned unless bug.build)
 *   update {id, patch}      title, details, severity, app, area, tags, files, said, status, fixedPr
 *   move {id, build}        into a build ('' = unassigned); status follows (in-build / confirmed)
 *   reorder {ids}           the board order, top first (ids not named keep their place after)
 *   reorder {id, before}    one bug just above another ('' = to the bottom)
 *   fix {id, pr}            fixed, with the PR
 *   remove {id}             tombstone
 *   settings {values}
 *   apply-moves {moves, what}  a batch of moves (the optimizer's), one undo entry
 *   undo {}                 reverse the last batch
 */
export function apply(file, c, { at = new Date().toISOString(), by = 'brett', builds = [] } = {}) {
  const f = normFile(file); const log = []; const moved = [];
  const find = (id) => { const b = f.bugs.find((x) => x.id === id && !x.deleted); if (!b) throw new Error(`no bug ${id}`); return b; };
  const stamp = (b, what) => { b.updatedAt = at; b.history.push({ at, by, what }); if (b.history.length > 30) b.history.splice(0, b.history.length - 30); };
  const buildOf = (id) => builds.find((x) => x.id === id);
  const move = (b, to) => {
    const from = b.build;
    if (from === to) return;
    if (to) {
      const t = buildOf(to);
      if (builds.length && !t) throw new Error(`no build ${to}`);
      if (t && !isTarget(t)) throw new Error(`${to} is ${t.live || t.status}: bugs only go into queued or running builds`);
      if (t?.profile) b.profile = t.profile;
    }
    b.build = to; b.needsBrett = false; b.candidates = [];
    if (OPEN.has(b.status)) b.status = to ? 'in-build' : 'confirmed';
    stamp(b, to ? `moved to ${to}${from ? ` from ${from}` : ''}` : `taken off ${from}`);
    moved.push({ bug: b.id, from, to }); log.push(`${b.id}: ${from || 'unassigned'} → ${to || 'unassigned'}`);
  };
  switch (c?.action) {
    case 'add': {
      const raw = c.bug ?? {};
      if (!str(raw.title).trim()) throw new Error('a bug needs a title');
      const id = str(raw.id, 80) || newId(raw.title, at, new Set(f.bugs.map((x) => x.id)));
      if (f.bugs.some((x) => x.id === id)) throw new Error(`${id} is already on the board`);
      const top = Math.min(0, ...f.bugs.map((x) => x.order));
      const b = normBug({ ...raw, id, build: '', status: raw.status === 'wontfix' || raw.status === 'fixed' ? raw.status : 'confirmed', reportedAt: raw.reportedAt || at, reportedBy: raw.reportedBy || by, createdAt: at, updatedAt: at, order: Number.isFinite(raw.order) ? raw.order : top - 1 });
      b.history = [{ at, by, what: 'added' }];
      f.bugs.push(b); log.push(`added ${id}`);
      if (raw.build) move(b, str(raw.build, 80));
      return done(f, log, moved, b, at);
    }
    case 'update': {
      const b = find(c.id); const p = c.patch ?? {};
      for (const k of ['title', 'details', 'app', 'area', 'said', 'fixedPr']) if (typeof p[k] === 'string') b[k] = str(p[k], k === 'details' || k === 'said' ? 4000 : 200);
      if (!b.title.trim()) throw new Error('a bug needs a title');
      if (SEVERITIES.includes(p.severity)) b.severity = p.severity;
      if (Array.isArray(p.tags)) b.tags = list(p.tags, 20, 40);
      if (Array.isArray(p.files)) b.files = list(p.files, 40, 300);
      if (STATUSES.includes(p.status)) b.status = p.status === 'confirmed' && b.build ? 'in-build' : p.status;
      stamp(b, `edited ${Object.keys(p).join(', ')}`); log.push(`updated ${b.id}`);
      return done(f, log, moved, b, at);
    }
    case 'move': { const b = find(c.id); move(b, str(c.build, 80)); return done(f, log, moved, b, at); }
    case 'reorder': {
      const live = sorted(f.bugs.filter((x) => !x.deleted));
      let ids;
      if (Array.isArray(c.ids)) { const named = c.ids.filter((id) => live.some((x) => x.id === id)); ids = [...named, ...live.map((x) => x.id).filter((id) => !named.includes(id))]; }
      else { const b = find(c.id); ids = live.map((x) => x.id).filter((id) => id !== b.id); const i = c.before ? ids.indexOf(c.before) : -1; ids.splice(i < 0 ? ids.length : i, 0, b.id); }
      ids.forEach((id, i) => { const b = f.bugs.find((x) => x.id === id); if (b.order !== i) { b.order = i; b.updatedAt = at; } });
      log.push('reordered'); return done(f, log, moved, null, at);
    }
    case 'fix': {
      const b = find(c.id); b.status = 'fixed'; if (c.pr) b.fixedPr = str(c.pr, 300); b.needsBrett = false;
      stamp(b, `fixed${b.fixedPr ? ` in ${b.fixedPr}` : ''}`); log.push(`${b.id} fixed`); return done(f, log, moved, b, at);
    }
    case 'remove': { const b = find(c.id); b.deleted = true; stamp(b, 'removed'); log.push(`removed ${b.id}`); return done(f, log, moved, b, at); }
    case 'settings': { f.settings = normSettings({ ...f.settings, ...(c.values ?? {}) }); f.settingsAt = at; log.push('settings saved'); return done(f, log, moved, null, at); }
    case 'ask-brett': { // a bounce chain that ran out: Brett picks (candidates = the next best builds)
      const b = find(c.id); b.needsBrett = true; b.candidates = list(c.candidates, 8, 80); stamp(b, c.why ? `needs Brett: ${str(c.why, 200)}` : 'needs Brett'); log.push(`${b.id} needs Brett`); return done(f, log, moved, b, at);
    }
    case 'bounce': { const b = find(c.id); b.bounces = c.reset ? 0 : b.bounces + 1; b.updatedAt = at; return done(f, log, moved, b, at); }
    case 'apply-moves': {
      const batch = [];
      for (const m of Array.isArray(c.moves) ? c.moves : []) { const b = f.bugs.find((x) => x.id === m.bug && !x.deleted); if (!b || b.build === (m.to ?? '')) continue; const from = b.build; move(b, str(m.to, 80)); batch.push({ bug: b.id, from, to: b.build }); }
      if (batch.length) f.undo.push({ at, by, what: str(c.what, 200) || `${batch.length} move(s)`, moves: batch });
      if (f.undo.length > 10) f.undo.splice(0, f.undo.length - 10);
      return done(f, log, moved, null, at);
    }
    case 'undo': {
      const u = f.undo.pop(); if (!u) throw new Error('nothing to undo');
      for (const m of [...u.moves].reverse()) { const b = f.bugs.find((x) => x.id === m.bug && !x.deleted); if (b && b.build === m.to) { b.build = m.from; if (OPEN.has(b.status)) b.status = m.from ? 'in-build' : 'confirmed'; stamp(b, `undo: back to ${m.from || 'unassigned'}`); moved.push({ bug: b.id, from: m.to, to: m.from }); } }
      log.push(`undid ${u.what}`); return done(f, log, moved, null, at);
    }
    default: throw new Error(`unknown action ${c?.action}`);
  }
}
function done(f, log, moved, bug, at) { f.rev += 1; f.updatedAt = at; return { file: f, log, moved, bug }; }

// ------------------------------------------------------------------ the optimizer (zero tokens)

const STOP = new Set('the a an and or of to in on at for from with by is are be it its this that when not no do does dont don t doesnt isnt wont all one some new old any every get gets got has have make made into out up off so as if then than them they their what which who how why our your my me we you i s brett app apps settings setting shared needs need console build builds plugin plugins step steps fix fixed bug bugs work wrong right still now nov oct'.split(' '));
export function words(text) { return new Set(String(text ?? '').toLowerCase().replace(/[^a-z0-9/._-]+/g, ' ').split(/[\s/._-]+/).filter((w) => w.length > 2 && !STOP.has(w))); }

/**
 * How well a bug fits a build: words shared with the build's title/brief/steps (1 each, title words 2), its app
 * (3) and area/tag words (2 each) found in the build, files the build already touches (4 each, a folder match 2).
 * Returns { score, why: [reasons] }.
 */
export function score(bug, build) {
  const why = []; let s = 0;
  const btext = words(`${build.title} ${build.id.replace(/-/g, ' ')} ${build.text ?? ''}`);
  const tWords = words(`${build.title} ${build.id.replace(/-/g, ' ')}`);
  const mine = words(`${bug.title} ${bug.details}`);
  const shared = [...mine].filter((w) => btext.has(w));
  for (const w of shared) s += tWords.has(w) ? 2 : 1;
  if (shared.length) why.push(`words: ${shared.slice(0, 6).join(', ')}`);
  const appW = words(bug.app);
  if (appW.size && [...appW].every((w) => btext.has(w))) { s += 3; why.push(`app ${bug.app}`); }
  const tags = [...words(`${bug.area} ${bug.tags.join(' ')}`)].filter((w) => btext.has(w));
  if (tags.length) { s += 2 * tags.length; why.push(`area: ${tags.join(', ')}`); }
  const files = build.files ?? [];
  for (const f of bug.files) {
    if (files.includes(f)) { s += 4; why.push(`touches ${f}`); continue; }
    const dir = f.replace(/\/[^/]*$/, '/');
    if (dir.length > 1 && files.some((x) => x.startsWith(dir))) { s += 2; why.push(`same folder ${dir}`); }
  }
  if (build.live === 'running') s += 0.5; // prefer work already in progress on a tie
  return { score: s, why };
}

/** Load per build (open bugs on it now). */
export const loadOf = (bugs) => { const m = new Map(); for (const b of bugs) if (b.build && OPEN.has(b.status) && !b.deleted) m.set(b.build, (m.get(b.build) ?? 0) + 1); return m; };

/** Room on a build for one more bug? Also used by the handoff rules. */
export function hasRoom(build, bugs, settings) { return (loadOf(bugs).get(build.id) ?? 0) < normSettings(settings).maxPerBuild; }

/** Best targets for one bug: [{ build, score, why }], best first, only builds with room (except `keep`). */
export function rank(bug, builds, bugs, settings, { exclude = [], profile = '', now = Date.now() } = {}) {
  const st = normSettings(settings);
  const load = loadOf(bugs.filter((x) => x.id !== bug.id));
  const inScope = (b) => st.scope === 'all' || !profile || !b.profile || b.profile === profile || (b.profiles ?? []).includes(profile);
  const fresh = (b) => b.live === 'running' || b.live === 'queued' || !b.updatedAt || now - Date.parse(b.updatedAt) < st.freshDays * 864e5;
  return builds.filter((b) => isTarget(b) && !exclude.includes(b.id) && (load.get(b.id) ?? 0) < st.maxPerBuild && !b.finishing && inScope(b) && fresh(b))
    .map((b) => ({ build: b.id, ...score(bug, b) })).filter((r) => r.score >= st.minScore)
    .sort((x, y) => y.score - x.score || (x.build < y.build ? -1 : 1));
}

/**
 * The optimizer: proposed moves for every open unassigned bug (and `all: true` = also re-home bugs whose build can't
 * take them any more). Greedy by severity then board order, respecting the per-build cap as it goes.
 * Returns [{ bug, from, to, score, why }] and `unclear` = bugs with no match above the threshold.
 */
export function optimize(file, builds, { all = false, profile = '', now = Date.now() } = {}) {
  const f = normFile(file); const st = f.settings;
  const bugs = live(f).map((b) => ({ ...b }));
  const sev = (b) => SEVERITIES.length - SEVERITIES.indexOf(b.severity);
  const todo = sorted(bugs.filter((b) => b.status === 'confirmed' && !b.build || (all && OPEN.has(b.status) && b.build && !isTarget(builds.find((x) => x.id === b.build)))))
    .sort((x, y) => sev(y) - sev(x) || x.order - y.order);
  const moves = []; const unclear = [];
  for (const b of todo) {
    const best = rank(b, builds, bugs, st, { profile: b.profile || profile, now })[0];
    if (!best) { unclear.push(b.id); continue; }
    moves.push({ bug: b.id, title: b.title, from: b.build, to: best.build, score: best.score, why: best.why });
    const ref = bugs.find((x) => x.id === b.id); ref.build = best.build; ref.status = 'in-build';
  }
  return { moves, unclear };
}

// ------------------------------------------------------------------ handoffs (Addendum 1: the group chat)

/**
 * Will the agent on `build` take this bug? Zero tokens: accept when the build has room, isn't in its last step
 * (final merge / CI) or built, and the agent can work and isn't broke. Returns { ok, why }.
 */
export function decide(build, bugs, settings, agent) {
  if (!build) return { ok: false, why: 'no such build' };
  if (!isTarget(build)) return { ok: false, why: `${build.id} is ${build.live || build.status}` };
  if (build.finishing) return { ok: false, why: 'finishing (last step, merge or CI)' };
  if (!hasRoom(build, bugs, settings)) return { ok: false, why: `full (${normSettings(settings).maxPerBuild} bugs)` };
  if (agent && agent.works === false) return { ok: false, why: `${agent.name} is ${agent.statusLabel || 'off'}` };
  if (agent && agent.broke) return { ok: false, why: `${agent.name} is over budget` };
  return { ok: true, why: 'has room' };
}

const LINES = {
  street: {
    send: ['Yo @{to}, sending you "{bug}", it\'s in your lane.', '@{to} heads up kid, "{bug}" is yours now.', 'Ay @{to}, tossin\' "{bug}" your way. Wicked fit for {build}.', '@{to}, catch: "{bug}". Bang it out with {build}.'],
    accept: ['Aight, I got it.', 'Say less, I\'m on it.', 'Bet. Throwin\' it on the pile.', 'Wicked easy, I got you.', 'Yeah yeah, gimme it.'],
    bounce: ['Yo I don\'t have time for that shit right now, send it to somebody else.', 'No suh, I\'m slammed. Find somebody else.', 'Not happenin\', kid. I\'m {why}.', 'Pass. I\'m {why}, hit someone else up.'],
    reroute: ['Yo @{to}, can you handle "{bug}", G?', '@{to}, you free? "{bug}" needs a home.', '@{to} you\'re up: "{bug}". Fits {build}.'],
    yes: ['Yeah, I got you, dog.', 'Bet, send it.', 'Say less.', 'Aight, I\'ll eat it.'],
    park: ['Parkin\' "{bug}" on {build}. Nobody\'s on it yet, it rides along when it runs.', '"{bug}" goes on {build}, wicked fit. It\'ll get picked up with the build.'],
    forced: ['Aight, boss\'s call. I got it.', 'Fine, Brett says so. I\'m on it.', 'Say less, boss.'],
    stuck: ['Nobody\'s takin\' "{bug}". Boss, it\'s on you: back to Unassigned.', '"{bug}" got bounced all over. Parked it, Brett\'s call.'],
  },
  clean: {
    send: ['@{to}, sending you "{bug}": it fits {build}.', '@{to}, "{bug}" is now on {build}.'],
    accept: ['Got it.', 'Taking it.', 'On it.'],
    bounce: ['Can\'t take it right now ({why}). Please send it to someone else.', 'No room here ({why}).'],
    reroute: ['@{to}, can you take "{bug}"? It fits {build}.', '@{to}, "{bug}" needs a home: {build}?'],
    yes: ['Yes, I\'ll take it.', 'Sure, send it over.'],
    park: ['"{bug}" is now on {build} (no agent on it yet).'],
    forced: ['Brett moved it here: taking it.'],
    stuck: ['No build could take "{bug}". Back to Unassigned for Brett.'],
  },
};
/** A varied template line (pick = a stable number so tests and replays match). */
export function line(kind, tone, vars, pick = 0) {
  const set = (LINES[tone] ?? LINES.street)[kind] ?? [''];
  const t = set[Math.abs(Math.round(pick)) % set.length];
  return t.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
/** A small stable hash for picking lines. */
export const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * The handoff conversation for one move, and where the bug ends up. Pure: `agentOf(buildId)` gives the agent on a build
 * ({ id, name, works, broke } or null), `candidates(exclude)` the next best builds. Returns
 * { lines: [{ from, kind, text }], to, accepted, needsBrett, tried: [buildIds], why }.
 *   - sender: the agent on the source build, else Boss (Brett, Amber or the optimizer moved it).
 *   - receiver answers by `decide`; a bounce goes to the next best build (whenBounced: reroute) until one accepts or
 *     `bouncesBeforeAsk` is reached; then (or with whenBounced: ask) the bug waits for Brett with the candidates.
 */
export function handoff({ bug, from = '', to, builds, bugs, settings, agentOf, candidates, at = '', force = false }) {
  const st = normSettings(settings); const tone = st.tone;
  const b = (id) => builds.find((x) => x.id === id);
  const sender = (from && agentOf(from)?.id) || 'boss';
  const lines = []; const tried = []; let target = to; let n = 0; let why = '';
  const vars = (agent, buildId) => ({ to: agent?.name ?? 'crew', bug: bug.title, build: b(buildId)?.title || buildId, why });
  const seed = hash(`${bug.id}${at}`);
  if (force && to) { // Brett dragged it there: his call stands, the agent just acknowledges
    const agent = agentOf(to);
    if (!agent) { lines.push({ from: sender, kind: 'handoff', text: line('park', tone, vars(null, to), seed) }); return { lines, to, accepted: true, needsBrett: false, tried: [to], why: 'Brett moved it' }; }
    lines.push({ from: sender, kind: 'handoff', text: line('send', tone, vars(agent, to), seed) });
    lines.push({ from: agent.id, kind: 'handoff', text: line('forced', tone, vars(agent, to), seed + 1) });
    return { lines, to, accepted: true, needsBrett: false, tried: [to], why: 'Brett moved it' };
  }
  while (target) {
    tried.push(target);
    const agent = agentOf(target);
    const d = decide(b(target), bugs.filter((x) => x.id !== bug.id), st, agent);
    why = d.why;
    if (!agent && d.ok) { lines.push({ from: n === 0 ? sender : 'boss', kind: 'handoff', text: line('park', tone, vars(null, target), seed + n) }); return { lines, to: target, accepted: true, needsBrett: false, tried, why }; }
    lines.push({ from: n === 0 ? sender : 'boss', kind: 'handoff', text: line(n === 0 ? 'send' : 'reroute', tone, vars(agent, target), seed + n) });
    if (d.ok) { lines.push({ from: agent?.id || 'boss', kind: 'handoff', text: line(n === 0 ? 'accept' : 'yes', tone, vars(agent, target), seed + n + 1) }); return { lines, to: target, accepted: true, needsBrett: false, tried, why }; }
    lines.push(agent ? { from: agent.id, kind: 'handoff', text: line('bounce', tone, vars(agent, target), seed + n + 1) } : { from: 'boss', kind: 'handoff', text: `${b(target)?.title || target} can't take it: ${why}.` });
    n += 1;
    if (st.whenBounced === 'ask' || n >= st.bouncesBeforeAsk) break;
    target = (candidates(tried)[0] ?? null)?.build ?? '';
  }
  const left = candidates(tried).map((c) => c.build).slice(0, 5);
  lines.push({ from: 'boss', kind: 'handoff', text: line('stuck', tone, vars(null, ''), seed) });
  return { lines, to: '', accepted: false, needsBrett: true, tried, candidates: left, why };
}

// ------------------------------------------------------------------ board view

/** Groups for the board: one per build with bugs (in board order of their first bug), then Unassigned, Fixed, Won't fix. */
export function groups(file, builds = [], { status = 'open', app = '', profile = '' } = {}) {
  const all = sorted(live(file)).filter((b) => (status === 'all' || (status === 'open' ? OPEN.has(b.status) : b.status === status)) && (!app || b.app === app) && (!profile || !b.profile || b.profile === profile));
  const out = new Map();
  for (const b of all) {
    const key = b.status === 'fixed' ? '~fixed' : b.status === 'wontfix' ? '~wontfix' : b.build || '~unassigned';
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(b);
  }
  const label = (k) => (k === '~unassigned' ? 'Unassigned' : k === '~fixed' ? 'Fixed' : k === '~wontfix' ? "Won't fix" : builds.find((x) => x.id === k)?.title || k);
  const rankKey = (k) => (k === '~unassigned' ? 1 : k === '~fixed' ? 2 : k === '~wontfix' ? 3 : 0);
  return [...out.entries()].sort((x, y) => rankKey(x[0]) - rankKey(y[0])).map(([key, items]) => ({ key, build: key.startsWith('~') ? '' : key, label: label(key), items }));
}

/** The build chip text for a bug: running (agent, step x/y), queued (position), paused, built (PR), merged. */
export function chip(build) {
  if (!build) return { tone: 'muted', text: 'Unassigned' };
  const steps = build.steps ? ` · step ${Math.min(build.done + 1, build.steps)}/${build.steps}` : '';
  switch (build.live || build.status) {
    case 'running': return { tone: 'accent', text: `Running${build.agentName ? ` · ${build.agentName}` : ''}${steps}` };
    case 'queued': return { tone: 'warning', text: `Queued${build.queuePos ? ` · #${build.queuePos} in line` : ''}` };
    case 'waiting': case 'blocked': return { tone: 'warning', text: `${build.live === 'blocked' || build.status === 'blocked' ? 'Blocked' : 'Paused'}${steps}` };
    case 'built': return { tone: 'info', text: `Built · awaiting merge${build.pr ? ` ${build.pr}` : ''}` };
    case 'complete': case 'merged': return { tone: 'success', text: `Merged${build.pr ? ` ${build.pr}` : ''}` };
    case 'pending': return { tone: 'muted', text: `Pending${steps}` };
    default: return { tone: 'muted', text: build.live || build.status || '?' };
  }
}
