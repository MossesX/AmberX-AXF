/**
 * build-todo-sync — build names, build categories and the to-do mirror of a build (build-todo-sync@1). Pure, IO-free.
 *
 * Brett, Nov 4 2026 (voice): "For every build from now on, like this plugin build, prompt me for a name which will be used
 * to reference it in the to-do manager. Then we're going to add a list in the to-do manager with all the steps that
 * Orchestrator broke it into. And then it will check off each one in real time as the orchestrator processes each step.
 * So the to-do list for every build has the same exact steps as items in the to-do list that the orchestrator broke
 * the build down into. The builds into categories: plugins, plugin extensions, add-ons, framework, app, feature,
 * module. Sync the build manager with the to-do manager and the real-time checklist."
 *
 * Two halves:
 *
 * 1. **Names and categories on every build record (builds@1).** Every build carries
 *      displayName   the short name Brett references it by (≤ MAX_NAME); suggested from the title, he confirms or edits
 *      category      one of CATEGORIES; suggested from what the build touches, he confirms
 *      area          the old free-text grouping ("Console > Terminal"); kept, never required
 *      nameReview    true while the name / category are a suggestion nobody confirmed (backfilled builds start true)
 *    `suggestDisplayName`, `suggestCategory` and `normCategory` are the rules; the store's normaliser fills the fields
 *    from them when a record lacks them, so older records never fail validation.
 *
 * 2. **The to-do mirror.** The builds store is the source of truth; the AmberX to-do manager (amberx-notes@1 lists and
 *    items, reached through control@1 `amberx.lists` / `amberx.items`) holds a synced view:
 *
 *      Builds                                  root list (ROOT_LIST)
 *        <Category>                            one list per category in use
 *          <displayName>                       one list per build; its items are the build's steps, in order
 *            1. <step title>                   kind todo; done = step done; tags carry model + state; url links back
 *        Done                                  lists of builds complete in the last `completedDays` days
 *        Archive                               lists of archived / deleted builds
 *
 *    `plan()` compares the store with a snapshot of those lists and items and answers the control@1 commands that make
 *    the snapshot match (idempotent: planning again on the applied result gives no commands), the links to keep
 *    (build id → list id, step uid → item id) and the **drift** it will not fix by itself: an item Brett ticked or
 *    unticked in the to-do manager. That is owner-only and confirmed before it changes the step (`asks`), so the plan
 *    leaves such an item alone until the ask is answered.
 *
 *    Commands reference lists that do not exist yet through `ref` / `$ref:` placeholders (an op with `ref` names the
 *    id its result carries; a later op's `$ref:<name>` is that id). `resolveOp` fills them in from the ids seen so far.
 *
 * 3. **Events.** Every store write may be announced to subscribers as a `storeEvent` frame; `parseEvent` reads one.
 */

export const SCHEMA = 'build-todo-sync@1';
export const CATEGORIES = ['Plugin', 'Plugin extension', 'Add-on', 'Framework', 'App', 'Feature', 'Module'];
export const DEFAULT_CATEGORY = 'Feature';
export const MAX_NAME = 48;
export const ROOT_LIST = 'Builds';
export const DONE_LIST = 'Done';
export const ARCHIVE_LIST = 'Archive';
export const DEFAULT_COMPLETED_DAYS = 7;
export const MIRROR_TAG = 'build';
export const STATE_TAGS = ['held', 'blocked', 'failed', 'rejected', 'skipped', 'handed'];
export const DRIFT_KINDS = ['ticked', 'unticked', 'fix-ticked', 'fix-unticked', 'stray', 'list-missing'];
export const EVENT_KIND = 'store-write';

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const words = (s) => str(s, 4000).toLowerCase().replace(/[^a-z0-9+.#/_-]+/g, ' ').trim();
const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ categories */

const CATEGORY_ALIASES = {
  plugin: 'Plugin', plugins: 'Plugin', 'console-plugin': 'Plugin',
  'plugin-extension': 'Plugin extension', 'plugin extension': 'Plugin extension', 'plugin-extensions': 'Plugin extension', 'plugin extensions': 'Plugin extension', extension: 'Plugin extension',
  'add-on': 'Add-on', addon: 'Add-on', 'add-ons': 'Add-on', addons: 'Add-on', 'add on': 'Add-on',
  framework: 'Framework', core: 'Framework', engine: 'Framework', kernel: 'Framework',
  app: 'App', apps: 'App', application: 'App',
  feature: 'Feature', features: 'Feature',
  module: 'Module', modules: 'Module', lib: 'Module', library: 'Module',
};

/** One of CATEGORIES (any case, dashes or plural accepted), else ''. */
export function normCategory(v) {
  const s = str(v, 60).trim();
  if (!s) return '';
  const hit = CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  if (hit) return hit;
  return CATEGORY_ALIASES[s.toLowerCase().replace(/\s+/g, ' ').replace(/_/g, '-')] ?? '';
}

/** Where a build's files point: 'plugins', 'framework', 'apps', 'libs' or ''. */
function fileHint(files) {
  const f = (Array.isArray(files) ? files : []).map((x) => str(x, 300));
  const has = (re) => f.some((x) => re.test(x));
  if (has(/apps\/[^/]+\/(src\/)?plugins\//)) return 'plugins';
  if (has(/framework\/(libs|android\/lib-)/)) return 'libs';
  if (has(/^framework\//)) return 'framework';
  if (has(/^apps\//)) return 'apps';
  return '';
}

/**
 * The category a build most likely is, from its title, detail, old free-text area and the files its steps name.
 *   → { category, why, confidence: 'high' | 'medium' | 'low' }
 * First the words Brett uses (title beats detail), then the files, then Feature.
 */
export function suggestCategory(b) {
  const o = b && typeof b === 'object' ? b : {};
  const title = words(o.title); const area = words(o.area);
  const detail = words([o.detail, ...((Array.isArray(o.steps) ? o.steps : []).map((s) => s?.text))].join(' '));
  const files = fileHint([...(Array.isArray(o.files) ? o.files : []), ...((Array.isArray(o.steps) ? o.steps : []).flatMap((s) => (Array.isArray(s?.files) ? s.files : [])))]);
  const rules = [
    [/\bplugin extensions?\b|\bextends? (the |an? )?[\w-]+ plugin\b|\bplugin add-?ons?\b/, 'Plugin extension', 'says plugin extension'],
    [/\badd-?ons?\b/, 'Add-on', 'says add-on'],
    [/\bplugins?\b/, 'Plugin', 'says plugin'],
    [/\bmodules?\b|\blib-[a-z]+\b|\blibrary\b|\blibs?\/|\baxf-[a-z]+\b/, 'Module', 'says module or library'],
    [/\bapps?\b|\bexpenses?\b|\bamberx app\b|\bmolly\b|\bgizmo\b|\bvoice vault\b|\bwalkthrough studio\b|\baxhub web\b|\bconsole app\b/, 'App', 'names an app'],
    [/\bframework\b|\bengines?\b|\bkernel\b|\bschemas?\b|\basset types?\b|\bcontracts?\b|@1\b|\bfixtures?\b|\bmigrations?\b|\btokens?\b/, 'Framework', 'framework words'],
  ];
  for (const [re, category, why] of rules) if (re.test(title)) return { category, why: `title ${why}`, confidence: 'high' };
  if (area) for (const [re, category, why] of rules) if (re.test(area)) return { category, why: `area ${why}`, confidence: 'medium' };
  if (files === 'plugins') return { category: 'Plugin', why: 'touches a plugins folder', confidence: 'medium' };
  if (files === 'libs') return { category: 'Module', why: 'touches a library', confidence: 'medium' };
  for (const [re, category, why] of rules) if (re.test(detail)) return { category, why: `detail ${why}`, confidence: 'medium' };
  if (files === 'framework') return { category: 'Framework', why: 'touches framework/', confidence: 'medium' };
  if (files === 'apps') return { category: 'App', why: 'touches apps/', confidence: 'low' };
  return { category: DEFAULT_CATEGORY, why: 'nothing says otherwise', confidence: 'low' };
}

/* ------------------------------------------------------------------ names */

const LEAD = /^\s*(?:urgent|fix|hotfix|build|rebuild|plugin|feature|refactor|land|wip)\s*[:\-–—]\s*/i;

/** Cut text at a word boundary to `max` characters, with an ellipsis when something was cut. */
export function shorten(text, max = MAX_NAME) {
  const s = str(text, 1000).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at >= Math.floor(max / 2) ? cut.slice(0, at) : cut).replace(/[\s,;:(\-–—]+$/, '')}…`;
}

/**
 * A short name for a build from its title: the lead-in before a colon, dash or bracket when it stands on its own, the
 * whole title otherwise, trimmed to MAX_NAME at a word boundary, first letter up. Never empty (falls back to the id).
 */
export function suggestDisplayName(title, { max = MAX_NAME, id = '' } = {}) {
  let s = str(title, 300).replace(/\s+/g, ' ').trim().replace(LEAD, '');
  s = s.replace(/^["'“”]+|["'“”]+$/g, '');
  const label = /^([A-Za-z][\w-]*):\s+(.+)$/.exec(s); // "Framework: menu engine…" → a one-word label, the rest is the name
  if (label) s = label[2];
  const head = /^(.{3,}?)\s*(?::\s|\s[-–—]\s|\s\()/.exec(s);
  if (head && head[1].split(' ').length >= 2 && head[1].length <= max) s = head[1];
  s = shorten(s, max).replace(/[.!]+$/, '');
  if (!s) s = str(id, max).replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Build';
}

/** The names and category of a build as they should be stored, filling what is missing and saying whether it needs review. */
export function naming(b) {
  const o = b && typeof b === 'object' ? b : {};
  const hadName = !!str(o.displayName, MAX_NAME).trim();
  const given = normCategory(o.category);
  const legacy = given ? '' : str(o.category, 60).trim(); // an old free-text category is the area
  const area = str(o.area, 60).trim() || legacy;
  const category = given || normCategory(o.buildCategory) || suggestCategory({ ...o, area }).category;
  const displayName = hadName ? str(o.displayName, MAX_NAME).trim() : suggestDisplayName(o.title, { id: o.id });
  const confirmed = o.nameReview === false && hadName && !!given;
  return { displayName, category, area, nameReview: !confirmed };
}

/* ------------------------------------------------------------------ Planned & fixes: the checklist a build carries */

export const FIX_KINDS = ['planned', 'fix', 'bug'];
export const MAX_FIXES = 200;

/**
 * One item of a build's "Planned & fixes" checklist (Brett, Nov 4 2026: "Every build will be able to attach a list to it
 * of planned things to do, and you can check off the fixes as they happen"). Lives on the build record (builds@1
 * `fixes[]`), mirrored to the build's Plan Studio plan and its to-do list.
 */
export function normFix(f, i = 0, now = nowIso()) {
  const o = f && typeof f === 'object' ? f : {};
  const done = o.done === true;
  return {
    id: str(o.id, 40) || `f${i + 1}`,
    uid: str(o.uid, 60) || `fx-${str(o.id, 40) || i + 1}-${hash32(`${str(o.text, 500)}|${str(o.at || now, 40)}`)}`,
    text: str(o.text, 500).trim(),
    kind: FIX_KINDS.includes(o.kind) ? o.kind : 'fix',
    done,
    doneAt: done ? str(o.doneAt, 40) || now : '',
    by: str(o.by, 120),
    at: str(o.at, 40) || now,
    note: str(o.note, 2000),
    link: str(o.link, 500),
    stepUid: str(o.stepUid, 60),
    pr: str(o.pr, 200),
    updatedAt: str(o.updatedAt, 40) || now,
  };
}
export const normFixes = (v, now = nowIso()) => (Array.isArray(v) ? v : []).slice(0, MAX_FIXES).map((f, i) => normFix(f, i, now)).filter((f) => f.text);
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
/** The next free fix id in a build (f1, f2, …). */
export function nextFixId(fixes) { const ids = new Set((fixes ?? []).map((f) => f.id)); let n = (fixes ?? []).length + 1; while (ids.has(`f${n}`)) n += 1; return `f${n}`; }
/** The fix with that id or uid, or null. */
export const findFix = (fixes, key) => (fixes ?? []).find((f) => f.uid === key || f.id === key) ?? null;
const FIX_LABEL = { planned: 'Planned', fix: 'Fix', bug: 'Bug' };

/** The to-do item a fix should be (after the steps, in the build's list). */
export function itemForFix(b, f, index, { linkBase = '' } = {}) {
  const facts = [`${FIX_LABEL[f.kind]} · added ${f.at.slice(0, 10)}${f.by ? ` by ${f.by}` : ''}`];
  if (f.done && f.doneAt) facts.push(`Done: ${f.doneAt}`);
  if (f.stepUid) facts.push(`Step: ${f.stepUid}`);
  if (f.pr) facts.push(`PR: ${f.pr}`);
  if (f.note) facts.push(`Note: ${f.note}`);
  return {
    kind: 'todo',
    title: `${FIX_LABEL[f.kind]}: ${f.text}`.slice(0, 160),
    text: [...facts, f.link ? `Link: ${f.link}` : '', `Build: ${b.id} · ${f.id}`].filter(Boolean).join('\n'),
    status: f.done ? 'done' : 'open',
    tags: [MIRROR_TAG, 'fixes', f.kind],
    priority: f.kind === 'bug' ? 2 : 0,
    order: 1000 + index,
    url: linkTo(linkBase, b.id, `fix:${f.uid}`),
  };
}

/* ------------------------------------------------------------------ the mirror: what a build looks like as a list */

export const listNameOf = (b) => str(b?.displayName, MAX_NAME).trim() || suggestDisplayName(b?.title, { id: b?.id });

const FINISHED = ['built', 'complete'];
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** Which group a build's list sits in: its category, DONE_LIST, ARCHIVE_LIST, or '' when it is not mirrored. */
export function placeOf(b, { now = nowIso(), completedDays = DEFAULT_COMPLETED_DAYS } = {}) {
  if (!b || b.kind === 'epic') return '';
  if (b.deleted || b.status === 'archived') return ARCHIVE_LIST;
  if (b.status === 'complete') {
    const at = b.mergedAt || b.builtAt || b.updatedAt;
    return at && daysBetween(at, now) <= completedDays ? DONE_LIST : '';
  }
  return normCategory(b.category) || naming(b).category;
}

/** Tags that say the state of a step inside its build (STATE_TAGS), besides the model. */
export function stateTags(b, s) {
  const tags = [];
  if (s.skip) tags.push('skipped');
  else if (!s.done) {
    if (b.status === 'waiting') tags.push('held');
    if (b.status === 'blocked') tags.push('blocked');
    if (b.status === 'failed') tags.push('failed');
    const denied = (b.upgradeRequests ?? []).some((r) => r.state === 'denied');
    if (denied && b.status !== 'waiting') tags.push('rejected');
  }
  if (str(s.assignee).trim()) tags.push('handed');
  return tags;
}

/** The link back to a build or step the plugin can turn into a console page (always https, the AmberX item rule). */
export function linkTo(linkBase, buildId, stepUid = '') {
  const base = str(linkBase, 300).replace(/\/+$/, '') || 'https://console.amberxai.com';
  return `${base}/#build-orchestrator/${encodeURIComponent(buildId)}${stepUid ? `/${encodeURIComponent(stepUid)}` : ''}`;
}
/** { build, step } out of a link made by linkTo, else null. */
export function parseLink(url) {
  const m = /#build-orchestrator\/([^/?#]+)(?:\/([^/?#]+))?/.exec(str(url, 2000));
  return m ? { build: decodeURIComponent(m[1]), step: m[2] ? decodeURIComponent(m[2]) : '' } : null;
}

/** The first non-empty line of a step's text, shortened for a title. */
export const stepTitle = (s, max = 120) => shorten(str(s?.title, 200).trim() || str(s?.text, 2000).split('\n').find((l) => l.trim()) || s?.id || 'step', max);

/** The to-do item a step should be (fields the mirror owns; the rest is the to-do manager's). */
export function itemFor(b, s, index, { linkBase = '', nextStepUid = '' } = {}) {
  const lines = [];
  const title = stepTitle(s);
  if (str(s.text).trim() && str(s.text).trim() !== title) lines.push(str(s.text, 2000).trim());
  const facts = [`Model: ${s.model || 'Opus'}`];
  if (str(s.thinking).trim()) facts.push(`Thinking: ${str(s.thinking, 20)}`);
  if (str(s.estimate).trim()) facts.push(`Estimate: ${str(s.estimate, 20)}`);
  if (str(s.phase).trim()) facts.push(`Phase: ${str(s.phase, 80)}`);
  if (str(s.group).trim()) facts.push(`Group: ${str(s.group, 80)}`);
  if (s.session === 'new') facts.push('Session: new');
  if (s.agent) facts.push('Runs as its own agent');
  if (str(s.assignee).trim()) facts.push(`Handed to: ${str(s.assignee, 80)}`);
  if (s.done && s.doneAt) facts.push(`Done: ${str(s.doneAt, 40)}`);
  if (str(s.note).trim()) facts.push(`Note: ${str(s.note, 1000)}`);
  lines.push(facts.join(' · '));
  lines.push(`Build: ${b.id} · step ${s.id}`);
  const open = !s.done && !s.skip;
  return {
    kind: 'todo',
    title: `${index + 1}. ${title}`.slice(0, 160),
    text: lines.join('\n'),
    status: s.done ? 'done' : open && nextStepUid && s.uid === nextStepUid && b.status === 'running' ? 'doing' : 'open',
    tags: [MIRROR_TAG, String(s.model || 'Opus').toLowerCase(), ...stateTags(b, s)],
    priority: 0,
    order: index,
    url: linkTo(linkBase, b.id, s.uid),
  };
}

/** The first open step of a build (what the orchestrator will do next), or ''. */
export const nextOpenUid = (b) => (b.steps ?? []).find((s) => !s.done && !s.skip)?.uid ?? '';

/* ------------------------------------------------------------------ plan: store ↔ snapshot */

const key = (parent, name) => `${parent ?? ''}/${str(name, 80).trim().toLowerCase()}`;
const emptyLinks = () => ({ $axf: SCHEMA, lists: {}, items: {}, updatedAt: '' });

/** Links in shape (an older or missing file is fine). */
export function normLinks(v) {
  const o = v && typeof v === 'object' ? v : {};
  const lists = {}; const items = {};
  for (const [k, id] of Object.entries(o.lists && typeof o.lists === 'object' ? o.lists : {})) if (str(id).trim()) lists[str(k, 200)] = str(id, 120);
  for (const [k, id] of Object.entries(o.items && typeof o.items === 'object' ? o.items : {})) if (str(id).trim()) items[str(k, 200)] = str(id, 120);
  return { ...emptyLinks(), lists, items, updatedAt: str(o.updatedAt, 40) };
}

/** Fields of a mirrored item that must equal the step's version; anything else belongs to the to-do manager. */
const MIRRORED = ['title', 'text', 'tags', 'order', 'url'];
const sameTags = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

/**
 * The commands that make the to-do manager match the builds store.
 *
 *   plan({ store, lists, items, links, asks, now, opts }) → { ops, links, drift, summary }
 *
 *   store   builds@1 (or anything with `builds`)
 *   lists   the AmberX lists as rows [{ id, name, parent, order }]            (control@1 amberx.lists list)
 *   items   the AmberX items as rows [{ id, list, title, text, status, tags, order, url, updatedAt, doneAt }]
 *   links   what the last plan linked (normLinks shape); ids seen in the snapshot win over stale links
 *   asks    open owner asks [{ build, step }]: items with one are left as Brett set them
 *   opts    { linkBase, completedDays, profiles (only these), statusNote: { title, text } | null }
 *
 *   ops     control@1 commands in order; an op may carry `ref` (name the id of its result) and `why`
 *   links   the links after the ops (refs still as `$ref:<name>` until resolved by the executor)
 *   drift   [{ kind: 'ticked' | 'unticked' | 'stray' | 'list-missing', build, step?, item?, listName?, at }]
 */
export function plan({ store, lists = [], items = [], links = null, asks = [], now = nowIso(), opts = {} } = {}) {
  const ops = []; const drift = [];
  const linkBase = str(opts.linkBase, 300);
  const completedDays = Number.isFinite(opts.completedDays) ? opts.completedDays : DEFAULT_COMPLETED_DAYS;
  const only = Array.isArray(opts.profiles) && opts.profiles.length ? new Set(opts.profiles) : null;
  const L = normLinks(links);
  const out = { ...emptyLinks(), updatedAt: now };
  const listById = new Map(lists.map((l) => [l.id, l]));
  const listByKey = new Map(lists.map((l) => [key(l.parent ?? null, l.name), l]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const askSet = new Set(asks.map((a) => `${a.build}/${a.step}`));
  const add = (op) => { ops.push(op); return op; };

  // a list that exists (by link, else by name under its parent) or an add op; → its id or $ref
  const ensureList = (linkKey, name, parent, why) => {
    const linked = L.lists[linkKey] && listById.get(L.lists[linkKey]);
    const found = linked ?? listByKey.get(key(parent, name));
    if (found) {
      out.lists[linkKey] = found.id;
      const patch = {};
      if (found.name !== name) patch.name = name;
      if ((found.parent ?? null) !== (parent ?? null)) patch.parent = parent;
      if (Object.keys(patch).length) add({ target: 'amberx.lists', op: 'set', path: found.id, value: patch, why: `${why}: ${Object.keys(patch).join(', ')}` });
      return found.id;
    }
    add({ target: 'amberx.lists', op: 'add', value: { name, parent }, ref: linkKey, why });
    out.lists[linkKey] = `$ref:${linkKey}`;
    return `$ref:${linkKey}`;
  };

  const root = ensureList('root', ROOT_LIST, null, 'the Builds list');
  const builds = (store?.builds ?? []).filter((b) => b && b.kind !== 'epic' && (!only || (b.profiles ?? []).some((p) => only.has(p))));
  const placed = builds.map((b) => ({ b, place: placeOf(b, { now, completedDays }) })).filter((x) => x.place);
  const groups = [...new Set(placed.map((x) => x.place))].sort((a, b) => (a === DONE_LIST || a === ARCHIVE_LIST ? 1 : 0) - (b === DONE_LIST || b === ARCHIVE_LIST ? 1 : 0) || a.localeCompare(b));
  for (const g of groups) ensureList(`group:${g}`, g, root, `the ${g} list`);

  const keep = new Set(); const keepItems = new Set();
  for (const { b, place } of placed) {
    const parent = out.lists[`group:${place}`];
    const lk = `build:${b.id}`;
    const wasLinked = !!(L.lists[lk] && listById.get(L.lists[lk]));
    if (L.lists[lk] && !wasLinked) drift.push({ kind: 'list-missing', build: b.id, listName: listNameOf(b), at: now });
    const listId = ensureList(lk, listNameOf(b), parent, `list for build ${b.id}`);
    keep.add(lk);
    const nextUid = nextOpenUid(b);
    const inList = items.filter((i) => i.list === listId);
    const usedItems = new Set();
    (b.steps ?? []).forEach((s, i) => {
      const ik = `${b.id}/${s.uid}`;
      const want = itemFor(b, s, i, { linkBase, nextStepUid: nextUid });
      const linked = L.items[ik] && itemById.get(L.items[ik]);
      const cur = linked ?? inList.find((x) => !usedItems.has(x.id) && (parseLink(x.url)?.step === s.uid)) ?? null;
      keepItems.add(ik);
      if (!cur) {
        add({ target: 'amberx.items', op: 'add', value: { ...want, list: listId, source: 'import', by: 'build-todo-sync', device: 'console' }, ref: `item:${ik}`, why: `step ${s.id} of ${b.id}` });
        out.items[ik] = `$ref:item:${ik}`;
        return;
      }
      usedItems.add(cur.id); out.items[ik] = cur.id;
      const patch = {};
      for (const f of MIRRORED) if (f === 'tags' ? !sameTags(cur.tags, want.tags) : (cur[f] ?? (f === 'order' ? 0 : '')) !== want[f]) patch[f] = want[f];
      if (cur.list !== listId) patch.list = listId;
      const curDone = cur.status === 'done';
      if (curDone !== (want.status === 'done')) {
        if (askSet.has(ik)) { /* Brett's tick waits for his answer */ }
        else if (str(cur.updatedAt) > str(s.updatedAt || b.updatedAt) && !s.skip) drift.push({ kind: curDone ? 'ticked' : 'unticked', build: b.id, step: s.uid, stepId: s.id, item: cur.id, at: str(cur.doneAt || cur.updatedAt, 40) || now });
        else patch.status = want.status;
      } else if (!curDone && cur.status !== want.status) patch.status = want.status;
      if (Object.keys(patch).length) add({ target: 'amberx.items', op: 'set', path: cur.id, value: patch, why: `step ${s.id} of ${b.id}: ${Object.keys(patch).join(', ')}` });
    });
    // Planned & fixes: after the steps; a tick here is Brett's own checklist, so it is applied (drift fix-ticked / fix-unticked), not asked
    (b.fixes ?? []).forEach((f, i) => {
      const ik = `${b.id}/fix:${f.uid}`;
      const want = itemForFix(b, f, i, { linkBase });
      const linked = L.items[ik] && itemById.get(L.items[ik]);
      const cur = linked ?? inList.find((x) => !usedItems.has(x.id) && (parseLink(x.url)?.step === `fix:${f.uid}`)) ?? null;
      keepItems.add(ik);
      if (!cur) { add({ target: 'amberx.items', op: 'add', value: { ...want, list: listId, source: 'import', by: 'build-todo-sync', device: 'console' }, ref: `item:${ik}`, why: `fix ${f.id} of ${b.id}` }); out.items[ik] = `$ref:item:${ik}`; return; }
      usedItems.add(cur.id); out.items[ik] = cur.id;
      const patch = {};
      for (const k of MIRRORED) if (k === 'tags' ? !sameTags(cur.tags, want.tags) : (cur[k] ?? (k === 'order' ? 0 : '')) !== want[k]) patch[k] = want[k];
      if (cur.list !== listId) patch.list = listId;
      const curDone = cur.status === 'done';
      if (curDone !== f.done) {
        if (str(cur.updatedAt) > str(f.updatedAt)) drift.push({ kind: curDone ? 'fix-ticked' : 'fix-unticked', build: b.id, fix: f.uid, fixId: f.id, item: cur.id, at: str(cur.doneAt || cur.updatedAt, 40) || now });
        else patch.status = want.status;
      }
      if (Object.keys(patch).length) add({ target: 'amberx.items', op: 'set', path: cur.id, value: patch, why: `fix ${f.id} of ${b.id}: ${Object.keys(patch).join(', ')}` });
    });
    for (const x of inList) if (!usedItems.has(x.id)) {
      const link = parseLink(x.url);
      if (link && link.build === b.id) add({ target: 'amberx.items', op: 'remove', path: x.id, confirm: true, why: `step gone from ${b.id}` });
      else drift.push({ kind: 'stray', build: b.id, item: x.id, title: str(x.title, 160), at: now });
    }
  }
  // lists linked before for builds no longer mirrored (aged out of Done, or gone): their items first, then the list
  for (const [lk, id] of Object.entries(L.lists)) {
    if (!lk.startsWith('build:') || keep.has(lk) || !listById.get(id)) continue;
    for (const x of items.filter((i) => i.list === id)) if (parseLink(x.url)) add({ target: 'amberx.items', op: 'remove', path: x.id, confirm: true, why: `${lk} left the mirror` });
    add({ target: 'amberx.lists', op: 'remove', path: id, confirm: true, why: `${lk} left the mirror` });
  }
  if (opts.statusNote && typeof opts.statusNote === 'object') keepItems.add('status-note');
  for (const [ik, id] of Object.entries(L.items)) if (!keepItems.has(ik) && itemById.get(id) && !ops.some((o) => o.op === 'remove' && o.path === id)) add({ target: 'amberx.items', op: 'remove', path: id, confirm: true, why: `${ik} left the mirror` });
  // the status note at the top of Builds: says who keeps these lists and when they were last synced
  if (opts.statusNote && typeof opts.statusNote === 'object') {
    const n = opts.statusNote; const cur = L.items['status-note'] && itemById.get(L.items['status-note']);
    const want = { kind: 'note', title: str(n.title, 160), text: str(n.text, 2000), pinned: true, tags: [MIRROR_TAG, 'sync'] };
    if (!cur) { add({ target: 'amberx.items', op: 'add', value: { ...want, list: root, source: 'import', by: 'build-todo-sync', device: 'console' }, ref: 'item:status-note', why: 'the sync note' }); out.items['status-note'] = '$ref:item:status-note'; }
    else { out.items['status-note'] = cur.id; const patch = {}; for (const f of ['title', 'text']) if (cur[f] !== want[f]) patch[f] = want[f]; if (cur.list !== root) patch.list = root; if (Object.keys(patch).length) add({ target: 'amberx.items', op: 'set', path: cur.id, value: patch, why: 'the sync note' }); }
  }
  const summary = { builds: placed.length, groups: groups.length, ops: ops.length, adds: ops.filter((o) => o.op === 'add').length, sets: ops.filter((o) => o.op === 'set').length, removes: ops.filter((o) => o.op === 'remove').length, drift: drift.length };
  return { ops, links: out, drift, summary };
}

/** An op with every `$ref:<name>` replaced by the id in `refs`; throws when one is still unknown. */
export function resolveOp(op, refs) {
  const fix = (v) => {
    if (typeof v === 'string' && v.startsWith('$ref:')) { const id = refs[v.slice(5)]; if (!id) throw new Error(`unresolved ${v}`); return id; }
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
    return v;
  };
  const { ref: _r, why: _w, ...rest } = op;
  return fix(rest);
}
/** Links with their `$ref:` placeholders filled from `refs` (unknown ones dropped, so the next plan re-creates). */
export function resolveLinks(links, refs) {
  const out = normLinks(links);
  for (const k of ['lists', 'items']) for (const [name, id] of Object.entries(out[k])) if (id.startsWith('$ref:')) { const r = refs[id.slice(5)]; if (r) out[k][name] = r; else delete out[k][name]; }
  return out;
}

/* ------------------------------------------------------------------ asks (owner-only ticks) */

/** One ask per drift that needs Brett: ticked / unticked. Stable id so a re-plan does not open it twice. */
export function asksFrom(drift, now = nowIso()) {
  return drift.filter((d) => d.kind === 'ticked' || d.kind === 'unticked').map((d) => ({
    id: `${d.build}/${d.step}/${d.kind}`, kind: d.kind, build: d.build, step: d.step, stepId: d.stepId ?? '', item: d.item, at: d.at || now, state: 'open',
    title: d.kind === 'ticked' ? `Mark step ${d.stepId || d.step} of ${d.build} done?` : `Reopen step ${d.stepId || d.step} of ${d.build}?`,
  }));
}
/** The open asks after a new plan: new ones added, ones whose drift is gone closed as `settled`. */
export function mergeAsks(open, fresh, now = nowIso()) {
  const seen = new Set(fresh.map((a) => a.id));
  const kept = (open ?? []).map((a) => (a.state === 'open' && !seen.has(a.id) ? { ...a, state: 'settled', closedAt: now } : a));
  const ids = new Set(kept.map((a) => a.id));
  return [...kept, ...fresh.filter((a) => !ids.has(a.id))];
}

/* ------------------------------------------------------------------ events */

/** The frame announced after a store write (what builds-store.mjs posts to subscribers). */
export function storeEvent({ rev, at = nowIso(), by = '', action = '', builds = [] } = {}) {
  return { $axf: SCHEMA, kind: EVENT_KIND, rev: Number.isInteger(rev) ? rev : 0, at: str(at, 40), by: str(by, 120), action: str(action, 80), builds: builds.map((b) => ({ id: str(b?.id, 80), op: str(b?.op, 20) })).filter((b) => b.id) };
}
/** A frame read back, or null when it is not one. */
export function parseEvent(v) {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!o || o.$axf !== SCHEMA || o.kind !== EVENT_KIND) return null;
  return storeEvent(o);
}
