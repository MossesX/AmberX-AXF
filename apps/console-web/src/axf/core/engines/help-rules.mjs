/**
 * help rules — help@1 and Help mode (Brett, Nov 1 2026: "the system is getting deep… when it's on, the app teaches
 * me how to use it, with tooltips everywhere. Off = no tooltips, no clutter").
 *
 * A help@1 asset is a pack of plain-English help entries plus short screen intros. Unlike a slot type, every help
 * asset an app has is in force at once (framework pack, app packs, each plugin's own `help.json`); later packs override
 * earlier ones, a written entry always beats a draft. Pure, no DOM: the TS engine (help.ts), the React Help layer, the
 * build engine's validator and the coverage CLI (framework/cli/help-coverage.mjs) all use this one file, so the two
 * validators are one function and a help id means the same thing everywhere.
 *
 * Help ids (auto, stable): a control is named by what it does before what it says.
 *   explicit       data-help="<id>"                 (a component or plugin names it outright)
 *   action:<spec>  the action it dispatches          (menu items, toolbar buttons; `action:x:param`, then `action:x`)
 *   view:<id>      the screen it opens               (nav items, screens)
 *   banner:<id>    a banner;  menu:<id> a top-level application menu
 *   column:<slug>  a grid column header
 *   <slug>         its label, lower-case, counts and punctuation dropped ("Approve now (3)" → approve-now)
 * A screen may override any of them with `<screen>/<id>`. The canonical id (what coverage counts and "No help yet"
 * shows) is the first non-screen-scoped one; lookups try the screen override first, then the canonical id, then the
 * label slug, so a menu item with an action still finds the help written for its label.
 */

export const HELP_FRAME = 'help@1';
/** Settings keys (device scope: localStorage per app, never pushed to the shared look). */
export const HELP_MODE_KEY = 'axf.help.mode';
export const HELP_INTROS_KEY = 'axf.help.intros';
export const HELP_SEEN_KEY = 'axf.help.seen';
/** Actions every app gets (the runtime registers them; voice routers and shortcuts call them). */
export const HELP_ACTIONS = { mode: 'help.mode', resetIntros: 'help.intros.reset', explain: 'help.explain' };
/** Keyboard shortcuts for the switch (F1 is the conventional help key; Ctrl+Shift+H where F1 is taken by the browser). */
export const HELP_SHORTCUTS = ['f1', 'ctrl+shift+h'];
/** Spoken commands that turn Help mode on / off (voice routers match these after their own cleaning). */
export const HELP_VOICE = { on: ['help mode on', 'turn on help mode', 'switch on help mode', 'show me the tooltips'], off: ['help mode off', 'turn off help mode', 'switch off help mode', 'hide the tooltips'] };

export const HELP_LIMITS = { id: 160, title: 80, text: 600, more: 2000, tryIt: 240, entries: 4000, intros: 400, steps: 6, say: 400, related: 12 };
export const HELP_KINDS = ['button', 'menu-item', 'toggle', 'slider', 'tab', 'column', 'banner', 'card', 'field', 'link', 'nav', 'screen', 'menu', 'control'];

const ID = /^[a-z0-9][a-z0-9._:/@+-]{0,159}$/;
const ACTION = /^[a-z][a-z0-9._-]*(:[^\s<>"'`]{0,160})?$/;
const BAD_SCHEME = /^\s*(javascript|data|vbscript|file):/i;
/** An intro step's `do` is an action spec, never a script or a link. */
const okDo = (v) => typeof v === 'string' && ACTION.test(v) && !/^(javascript|data|vbscript|file|https?):/i.test(v);

/**
 * A label as a stable id piece: lower-case words joined by `-`; counts ("(3)", "12 new", "3/5"), ellipses, emoji and
 * punctuation dropped, so a button keeps its id while its count changes. Empty when nothing is left.
 */
export function slugLabel(label) {
  if (typeof label !== 'string') return '';
  return label
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\(\s*[\d.,/%+\s]*(new|left|waiting|open|done)?\s*\)/g, ' ')
    .replace(/\b\d+([.,/]\d+)*\s*(new|left|waiting|open|done|%)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/**
 * What a control is, as help ids. `desc` = { help?, action?, view?, banner?, menu?, column?, label?, screen? }.
 * Returns { id: canonical id or null, lookup: ids to try in order }.
 */
export function helpTarget(desc) {
  const d = desc && typeof desc === 'object' ? desc : {};
  const screen = typeof d.screen === 'string' && ID.test(d.screen) ? d.screen : '';
  const own = [];
  const push = (v) => { if (typeof v === 'string' && v && ID.test(v) && !own.includes(v)) own.push(v); };
  if (typeof d.help === 'string') push(d.help.trim());
  // `nav:<view>` is opening a screen: it is named by the screen, like a nav item
  const nav = typeof d.action === 'string' ? /^nav:([^:]+)$/.exec(d.action) : null;
  if (nav) push(`view:${nav[1]}`);
  else if (typeof d.action === 'string' && d.action) {
    push(`action:${d.action}`);
    const base = d.action.split(':')[0];
    if (base !== d.action) push(`action:${base}`);
  }
  if (typeof d.view === 'string' && d.view) push(`view:${d.view}`);
  if (typeof d.banner === 'string' && d.banner) push(`banner:${d.banner}`);
  if (typeof d.menu === 'string' && d.menu) push(`menu:${d.menu}`);
  const slug = slugLabel(d.label);
  if (slug) push(d.column ? `column:${slug}` : slug);
  const id = own[0] ?? null;
  const lookup = [];
  for (const v of own) {
    if (screen) lookup.push(`${screen}/${v}`);
    lookup.push(v);
  }
  return { id, lookup: [...new Set(lookup)] };
}

/** Shorthand: the canonical id only. */
export const helpIdFor = (desc) => helpTarget(desc).id;

function cleanLink(v) {
  if (typeof v === 'string') return v.trim() && !BAD_SCHEME.test(v) ? { label: 'Read more', href: v.trim().slice(0, 400) } : null;
  if (v && typeof v === 'object' && typeof v.href === 'string' && v.href.trim() && !BAD_SCHEME.test(v.href)) {
    return { label: String(v.label ?? 'Read more').trim().slice(0, 80) || 'Read more', href: v.href.trim().slice(0, 400) };
  }
  return null;
}

/** One entry, cleaned (null when it can't be used). */
export function normalizeHelpEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const target = String(raw.target ?? raw.id ?? '').trim();
  const title = String(raw.title ?? '').trim().slice(0, HELP_LIMITS.title);
  const text = String(raw.text ?? '').trim().slice(0, HELP_LIMITS.text);
  if (!ID.test(target) || !title || !text) return null;
  const e = { id: ID.test(String(raw.id ?? '')) ? String(raw.id) : target, target, title, text };
  if (typeof raw.more === 'string' && raw.more.trim()) e.more = raw.more.trim().slice(0, HELP_LIMITS.more);
  if (typeof raw.tryIt === 'string' && raw.tryIt.trim()) e.tryIt = raw.tryIt.trim().slice(0, HELP_LIMITS.tryIt);
  const link = cleanLink(raw.link);
  if (link) e.link = link;
  if (Array.isArray(raw.related)) {
    const rel = raw.related.filter((r) => typeof r === 'string' && ID.test(r)).slice(0, HELP_LIMITS.related);
    if (rel.length) e.related = rel;
  }
  if (typeof raw.kind === 'string' && HELP_KINDS.includes(raw.kind)) e.kind = raw.kind;
  if (raw.draft === true) e.draft = true;
  return e;
}

/** One screen intro, cleaned: 1–6 steps of walkthrough@1 shape ({ say, target, do }) plus an optional title. */
export function normalizeHelpIntro(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.screen !== 'string' || !ID.test(raw.screen) || !Array.isArray(raw.steps)) return null;
  const steps = [];
  for (const s of raw.steps.slice(0, HELP_LIMITS.steps)) {
    if (!s || typeof s !== 'object') continue;
    const say = String(s.say ?? '').trim().slice(0, HELP_LIMITS.say);
    if (!say) continue;
    const step = { say, target: typeof s.target === 'string' && !/[<>{}`]/.test(s.target) ? s.target.trim().slice(0, 200) : '', do: okDo(s.do) ? s.do : '' };
    if (typeof s.title === 'string' && s.title.trim()) step.title = s.title.trim().slice(0, HELP_LIMITS.title);
    steps.push(step);
  }
  if (!steps.length) return null;
  return { screen: raw.screen, title: String(raw.title ?? '').trim().slice(0, HELP_LIMITS.title) || 'This screen', steps };
}

/** A whole pack, cleaned: unusable entries and intros are dropped (the validator reports them). */
export function normalizeHelpPack(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const entries = (Array.isArray(d.entries) ? d.entries : []).slice(0, HELP_LIMITS.entries).map(normalizeHelpEntry).filter(Boolean);
  const intros = (Array.isArray(d.intros) ? d.intros : []).slice(0, HELP_LIMITS.intros).map(normalizeHelpIntro).filter(Boolean);
  return { scope: typeof d.scope === 'string' ? d.scope.slice(0, 80) : '', entries, intros };
}

/** Validation for the asset validators (TS core/validate.ts and cli/build-engine.mjs): [] for other types. */
export function helpErrors(type, raw) {
  if (type !== 'help') return [];
  const errs = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['help: data must be an object'];
  if (raw.entries !== undefined && !Array.isArray(raw.entries)) errs.push('help: entries must be an array');
  if (raw.intros !== undefined && !Array.isArray(raw.intros)) errs.push('help: intros must be an array');
  if (raw.scope !== undefined && typeof raw.scope !== 'string') errs.push('help: scope must be a string');
  const seen = new Set();
  (Array.isArray(raw.entries) ? raw.entries : []).forEach((e, i) => {
    const at = `help: entries[${i}]`;
    if (!e || typeof e !== 'object') return void errs.push(`${at} must be an object`);
    const target = e.target ?? e.id;
    if (typeof target !== 'string' || !ID.test(target)) errs.push(`${at}.target must be a help id (lower-case letters, digits and . _ : / @ + -)`);
    else if (seen.has(target)) errs.push(`${at}.target "${target}" appears twice in this pack`);
    else seen.add(target);
    if (e.id !== undefined && (typeof e.id !== 'string' || !ID.test(e.id))) errs.push(`${at}.id must be a help id`);
    if (typeof e.title !== 'string' || !e.title.trim()) errs.push(`${at}.title is required`);
    else if (e.title.length > HELP_LIMITS.title) errs.push(`${at}.title is longer than ${HELP_LIMITS.title}`);
    if (typeof e.text !== 'string' || !e.text.trim()) errs.push(`${at}.text is required`);
    else if (e.text.length > HELP_LIMITS.text) errs.push(`${at}.text is longer than ${HELP_LIMITS.text} (put the rest in "more")`);
    if (e.more !== undefined && typeof e.more !== 'string') errs.push(`${at}.more must be a string`);
    if (e.tryIt !== undefined && (typeof e.tryIt !== 'string' || e.tryIt.length > HELP_LIMITS.tryIt)) errs.push(`${at}.tryIt must be a string up to ${HELP_LIMITS.tryIt}`);
    if (e.link !== undefined && !cleanLink(e.link)) errs.push(`${at}.link must be a path, an https URL or { label, href }`);
    if (e.related !== undefined && (!Array.isArray(e.related) || e.related.some((r) => typeof r !== 'string' || !ID.test(r)))) errs.push(`${at}.related must be a list of help ids`);
    if (e.kind !== undefined && !HELP_KINDS.includes(e.kind)) errs.push(`${at}.kind must be one of ${HELP_KINDS.join(', ')}`);
    if (e.draft !== undefined && typeof e.draft !== 'boolean') errs.push(`${at}.draft must be true or false`);
  });
  const screens = new Set();
  (Array.isArray(raw.intros) ? raw.intros : []).forEach((n, i) => {
    const at = `help: intros[${i}]`;
    if (!n || typeof n !== 'object') return void errs.push(`${at} must be an object`);
    if (typeof n.screen !== 'string' || !ID.test(n.screen)) errs.push(`${at}.screen must be a screen (view) id`);
    else if (screens.has(n.screen)) errs.push(`${at}.screen "${n.screen}" has two intros in this pack`);
    else screens.add(n.screen);
    if (!Array.isArray(n.steps) || !n.steps.length) errs.push(`${at}.steps needs 1–${HELP_LIMITS.steps} steps`);
    else {
      if (n.steps.length > HELP_LIMITS.steps) errs.push(`${at}.steps has more than ${HELP_LIMITS.steps} steps`);
      n.steps.forEach((s, j) => {
        if (!s || typeof s.say !== 'string' || !s.say.trim()) errs.push(`${at}.steps[${j}].say is required`);
        if (s && s.do !== undefined && s.do !== '' && !okDo(s.do)) errs.push(`${at}.steps[${j}].do must be an action spec`);
      });
    }
  });
  return errs;
}

/**
 * Every pack in force as one index. `packs` = [{ id, data }] in load order (framework, app, plugins…): a later pack
 * overrides an earlier one, except that a draft never replaces a written entry.
 */
export function buildHelpIndex(packs) {
  const byTarget = new Map();
  const intros = new Map();
  for (const p of Array.isArray(packs) ? packs : []) {
    const pack = normalizeHelpPack(p?.data ?? p);
    const from = String(p?.id ?? pack.scope ?? '');
    for (const e of pack.entries) {
      const had = byTarget.get(e.target);
      if (had && !had.draft && e.draft) continue;
      byTarget.set(e.target, { ...e, pack: from });
    }
    for (const n of pack.intros) intros.set(n.screen, { ...n, pack: from });
  }
  return { byTarget, intros };
}

/** The entry for a control (first lookup id that has one), or null. */
export function resolveHelp(index, lookup) {
  for (const id of Array.isArray(lookup) ? lookup : []) {
    const e = index?.byTarget?.get(id);
    if (e) return e;
  }
  return null;
}

/** The intro for a screen, or null. */
export const introFor = (index, screen) => index?.intros?.get(screen) ?? null;

/** Seen screens (setting value) as a list. */
export function parseSeen(v) {
  if (Array.isArray(v)) return v.filter((s) => typeof s === 'string');
  if (typeof v === 'string' && v) return v.split(',').filter(Boolean);
  return [];
}

/** The list after a screen's intro was shown (newest last, capped). */
export function markSeen(v, screen) {
  const list = parseSeen(v).filter((s) => s !== screen);
  list.push(screen);
  return list.slice(-500);
}

/** The intro to show on arriving at `screen`, or null: Help mode on, intros on, not seen yet, one exists. */
export function introToShow({ mode, intros = true, seen, screen, index }) {
  if (!mode || intros === false || !screen) return null;
  if (parseSeen(seen).includes(screen)) return null;
  return introFor(index, screen);
}

/** A screen intro as walkthrough@1 (Molly guide plays it; Walkthrough Studio's `highlight` cues read the same targets). */
export function introToWalkthrough(intro, app = 'app') {
  return { $axf: 'walkthrough@1', id: `intro-${intro.screen}`.replace(/[^a-z0-9-]+/g, '-').slice(0, 60), title: intro.title, app, steps: intro.steps.map((s) => ({ say: s.say, do: s.do ?? '', target: s.target ?? '' })) };
}

/**
 * Coverage of a control list against an index. `controls` = [{ id, lookup, kind?, label?, file? }]; ids are counted
 * once. Returns totals, covered (written + draft), the percent (1 decimal) and the missing controls.
 */
export function helpCoverage(controls, index) {
  const byId = new Map();
  for (const c of Array.isArray(controls) ? controls : []) if (c?.id && !byId.has(c.id)) byId.set(c.id, c);
  let written = 0;
  let drafts = 0;
  const missing = [];
  for (const c of byId.values()) {
    const e = resolveHelp(index, c.lookup?.length ? c.lookup : [c.id]);
    if (!e) missing.push(c);
    else if (e.draft) drafts += 1;
    else written += 1;
  }
  const total = byId.size;
  const covered = written + drafts;
  return { total, covered, written, drafts, missing, percent: total ? Math.floor((covered / total) * 1000) / 10 : 100 };
}

/** The ratchet: errors when coverage fell below the recorded numbers (per app: percent and covered count). */
export function ratchetErrors(current, baseline) {
  const errs = [];
  for (const [app, base] of Object.entries(baseline ?? {})) {
    const now = current?.[app];
    if (!now) { errs.push(`${app}: no coverage measured (was ${base.percent}%)`); continue; }
    if (now.percent < base.percent) errs.push(`${app}: help coverage fell to ${now.percent}% (ratchet ${base.percent}%): add help for the new controls (node framework/cli/help-coverage.mjs --draft ${app})`);
    if (now.covered < base.covered) errs.push(`${app}: ${now.covered} controls have help, the ratchet says ${base.covered}: help entries were removed`);
    if ((now.written ?? 0) < (base.written ?? 0)) errs.push(`${app}: ${now.written} written entries, the ratchet says ${base.written}: written help was turned back into drafts or removed`);
  }
  return errs;
}

/**
 * The DOM controls Help mode names (React Help layer + the coverage scanner's idea of "a control"). Inputs can't carry
 * a badge, so a switch / checkbox / slider is named on its wrapping label or control box.
 */
export const HELP_CONTROL_SELECTOR = [
  'button', 'a[href]', '[role="button"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="tab"]',
  '[role="columnheader"]', 'th', 'summary', 'select', '.fx-switchrow', '.fx-checkrow', '.fx-slider', '.fx-field', '[data-help]',
  '[data-fx-banner-id]', '.fx-card[data-help]', '.fx-container__head',
].join(', ');
