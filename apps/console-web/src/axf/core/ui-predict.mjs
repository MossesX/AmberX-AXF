/**
 * Predicted looks (ui-prediction@1, Brett Nov 3 2026: "UI Review must show PREDICTED pictures — what a build will
 * probably look like — BEFORE it's built, so I can approve the look before an agent spends money").
 *
 * Pure (no IO). From a build (title, detail, steps) and the files it has touched so far, this works out:
 *   - whether it touches UI at all (`touchesUi`);
 *   - which screens it touches (`screensFor`, an open registry of known screens + the plugins its files sit in);
 *   - a mockup spec per screen (`mockupSpec`, ui-mockup@1): blocks the mockup page renders with the framework's own
 *     controls under the current theme (settings rows, actions, badges, toolbar, list, card, dialog);
 *   - the capture plan for framework/cli/rebuild-shots.mjs (`capturePlan`): the current screen ("before", from the
 *     checkout the capture runs in, i.e. main) and the mockup ("predicted"), phone + desktop;
 *   - the look gate (`lookVerdict`): with "Wait for my look approval before UI builds start" on, a UI build waits
 *     until its predicted look is approved; a rejected look holds it.
 * The spec is made by rules, not a model: no tokens are spent (cost recorded as $0, model "rules"). An LLM pass can be
 * added later through `mockupSpec(build, { refine })` without changing the format.
 *
 * Used by framework/cli/ui-predict.mjs, the UI Review plugin (server mirrors the item fields; the page renders
 * ui-mockup@1) and its tests. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const PREDICTION_TAG = 'ui-prediction@1';
export const MOCKUP_TAG = 'ui-mockup@1';
export const MOCKUP_PARAM = 'ui-mockup';
/** prediction.state: the after-shots are the mockup ("predicted") or the build's real screens ("real"). */
export const STATES = ['predicted', 'real'];
/** prediction.look.status: Brett's decision on the predicted look. */
export const LOOK_STATUSES = ['waiting', 'approved', 'changes', 'rejected'];
export const ROLES = ['before', 'predicted', 'real'];
export const COST_RULES = Object.freeze({ usd: 0, model: 'rules', tokens: 0 });
const MAX_SCREENS = 3;
const MAX_BLOCKS = 8;

const str = (v, n = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'screen';
const textOf = (b) => [b?.title, b?.detail, ...(b?.steps ?? []).map((s) => s?.text ?? s?.title ?? '')].map((x) => str(x, 8000)).join('\n');

/* ------------------------------------------------------------------ does it touch UI? */

const UI_WORDS = /\b(ui|screens?|pages?|views?|buttons?|dialogs?|popups?|pop-ups?|menus?|toolbars?|banners?|cards?|badges?|settings? (?:interface|tab|page|screen)|grids?|tabs?|panels?|icons?|layouts?|themes?|look|chips?|toggles?|switch(?:es)?|avatars?|pictures?|screenshots?|thumbnails?|sliders?|tiles?|gallery|modal)\b/i;
const UI_FILE = /(^|\/)(web|src|ui|react)\/|\.(tsx|jsx|css|scss|html)$|\/res\/layout\//;

/** Does this build change anything visible? Its words or the files it touched say so. */
export function touchesUi(build, files = []) {
  if ((files ?? []).some((f) => UI_FILE.test(String(f)) && !/(^|\/)(test|spec|__tests__)[./]/.test(String(f)))) return true;
  return UI_WORDS.test(textOf(build));
}

/* ------------------------------------------------------------------ which screens */

/**
 * Known screens (open: callers add their own through opts.screens). `search` is what the console's global search
 * (Ctrl+K) types to reach the screen for the "before" shot; empty = no live capture for that app yet.
 */
export const SCREENS = [
  { id: 'ui-review', app: 'console-web', title: 'UI Review', search: 'UI Review', words: /\bui review\b|\bpredicted\b|\bscreenshots tab\b/i },
  { id: 'settings', app: 'console-web', title: 'Settings', search: 'Settings', words: /\bsettings?\b|\bpreferences?\b/i },
  { id: 'home', app: 'console-web', title: 'Home', search: 'Home', words: /\bhome\b|\bhome cards?\b/i },
  { id: 'breakroom', app: 'console-web', title: 'Breakroom', search: 'Breakroom', words: /\bbreakroom\b|\bcrew\b|\bagents? (?:grid|cards?|avatars?)\b/i },
  { id: 'orchestrator', app: 'console-web', title: 'Build orchestrator', search: 'Build orchestrator', words: /\borchestrator\b|\bbuild manager\b|\bbuilds? page\b|\bpending builds?\b/i },
  { id: 'toolbars', app: 'console-web', title: 'Toolbars', search: 'Toolbars', words: /\btoolbars?\b/i },
  { id: 'menus', app: 'console-web', title: 'Menus', search: 'Menus', words: /\b(?:context |app |smart )?menus?\b/i },
  { id: 'banner', app: 'console-web', title: 'Banner', search: '', words: /\bbanners?\b|\bbadges?\b/i },
  { id: 'terminal', app: 'console-web', title: 'Terminal', search: 'Terminal', words: /\bterminal\b|\bheadless tabs?\b/i },
  { id: 'axhub-web', app: 'axhub-web', title: 'axHub', search: '', words: /\baxhub (?:web|page|app)\b/i },
  { id: 'amberx', app: 'amberx-droid', title: 'AmberX app', search: '', words: /\bamberx (?:app|android)\b|\bamberx-droid\b/i },
];

/**
 * The screens a build touches, most likely first (at most 3). opts.plugins = { <folder>: <view title> } turns
 * console plugin files into screens; opts.screens adds to / overrides the registry.
 */
export function screensFor(build, files = [], opts = {}) {
  const reg = [...(opts.screens ?? []), ...SCREENS];
  const text = textOf(build);
  const scored = new Map();
  const add = (s, n) => { const cur = scored.get(s.id); scored.set(s.id, { ...s, score: (cur?.score ?? 0) + n }); };
  for (const s of reg) { const m = text.match(new RegExp(s.words.source, 'gi')); if (m) add(s, m.length + (s.words.test(str(build?.title)) ? 3 : 0)); }
  for (const f of files ?? []) {
    const m = /^apps\/console-web\/plugins\/([a-z0-9-]+)\/web\//.exec(String(f));
    const title = m && opts.plugins?.[m[1]];
    if (title) add({ id: `plugin-${m[1]}`, app: 'console-web', title, search: title, words: /$^/ }, 2);
    if (/^apps\/axhub-web\//.test(String(f))) add(reg.find((s) => s.id === 'axhub-web') ?? SCREENS[9], 2);
    if (/^apps\/amberx-droid\//.test(String(f))) add(reg.find((s) => s.id === 'amberx') ?? SCREENS[10], 2);
  }
  const ranked = [...scored.values()].sort((a, b) => b.score - a.score);
  // a passing mention doesn't make a screen: the rest must score at least a third of the top one
  const out = ranked.filter((s, i) => i === 0 || s.score >= Math.max(2, ranked[0].score / 3)).slice(0, MAX_SCREENS);
  if (!out.length) out.push({ id: slug(build?.title ?? 'screen'), app: 'console-web', title: str(build?.title, 60) || 'New screen', search: '', score: 0 });
  return out.map(({ words, score, ...s }) => s);
}

/* ------------------------------------------------------------------ mockup blocks */

const NOT_UI = /\b(tests?|report|threads|pr\b|cli\b|rest\b|mcp\b|migrations?|server|api\b|commits?|store|journal|backfill|fixtures?)\b/i;
/** Steps that lead with one of these are plumbing (tests, docs, CLI, backfills…), never a block on the mockup. */
const LEAD_NOT_UI = /^(?:s\d+[a-z]?\s+)?(?:tests?|reports?|backfill|commands?|cli|rest|mcp|migrat\w*|schemas?|server|api|docs?|readme|inventory|check|ci|harvest|wire|store|fixtures?|contract|engine|kotlin|android twin)\b/i;
const KINDS = [
  { type: 'settings', re: /\bsettings?\b|\bdefault (?:on|off)\b/i },
  { type: 'dialog', re: /\bdialog\b|\bpop-?ups?\b|\bconfirm(?:ation)?\b|\bmodal\b/i },
  { type: 'toolbar', re: /\btoolbars?\b|\bmenus?\b|\btabs?\b|\btoggle\b|\bswitch\b/i },
  { type: 'chips', re: /\bbadges?\b|\bchips?\b|\btags?\b|\bstatus\b/i },
  { type: 'actions', re: /\bbuttons?\b|\bapprove\b|\breject\b|\bask changes\b|\btap\b|\bclick\b/i },
  { type: 'list', re: /\bgrid\b|\blist\b|\btable\b|\brows?\b|\bqueue\b/i },
  { type: 'card', re: /\bcards?\b|\bbanners?\b|\btiles?\b|\bpanels?\b|\bpicture\b|\bshots?\b/i },
];

/** 'quoted labels' and "Approve look / Ask changes / Reject" runs from a step's text. */
export function labelsOf(text) {
  const t = String(text ?? '');
  const out = [];
  for (const m of t.matchAll(/['‘"“]([^'’"”]{2,70})['’"”]/g)) out.push(m[1].trim());
  for (const m of t.matchAll(/([A-Z][\w']*(?: [\w']+){0,3}(?:\s?\/\s?[A-Z]?[\w']*(?: [\w']+){0,3}){1,5})/g)) {
    if (m[1].includes('/')) out.push(...m[1].split(/\s?\/\s?/).map((x) => x.trim()).filter((x) => x.length > 1 && !/^(REST|MCP|CLI)$/.test(x)));
  }
  return [...new Set(out)].slice(0, 6);
}

/** The step's text without its "s3 " prefix, cut at the first clause (a short, readable line). */
function headline(t) {
  const body = String(t ?? '').replace(/^s\d+[a-z]?\s+/i, '');
  const parts = body.split(/[:;(]| - | — /).map((x) => x.trim()).filter(Boolean);
  // "Setting: Wait for my look approval …" → the part after a one- or two-word lead
  const lead = /^\S+(?: \S+)?$/.test(parts[0] ?? '') && parts.length > 1 && /:/.test(body.split(/[;(]/)[0]) ? parts[1] : parts[0];
  return str(lead ?? body, 70);
}
const detailOf = (t) => str(String(t ?? '').replace(/^s\d+[a-z]?\s+/i, ''), 220);

/** One step → one mockup block, or null when the step changes nothing visible. */
export function blockFor(step) {
  const t = String(step?.text ?? step?.title ?? '');
  const kind = KINDS.find((k) => k.re.test(t));
  if (!kind || LEAD_NOT_UI.test(t.trim()) || (NOT_UI.test(t) && !UI_WORDS.test(t))) return null;
  const labels = labelsOf(t);
  const title = headline(t);
  switch (kind.type) {
    case 'settings': return { type: 'settings', title: 'Settings', rows: (labels.length ? labels : [title]).slice(0, 3).map((l) => ({ label: l, on: /\bdefault on\b/i.test(t), hint: str(detailOf(t).replace(l, '').replace(/^[\s:'"‘’“”-]+/, ''), 160) })) };
    case 'dialog': return { type: 'dialog', title: labels[0] ?? title, text: detailOf(t), actions: labels.length > 1 ? labels.slice(1, 4) : ['OK', 'Cancel'] };
    case 'toolbar': return { type: 'toolbar', title, items: labels.length ? labels : title.split(/,| and /).map((x) => str(x, 24)).filter(Boolean).slice(0, 5) };
    case 'chips': return { type: 'chips', title, items: labels.length ? labels : [title] };
    case 'actions': return { type: 'actions', title, items: labels.length ? labels : ['Open', 'Save'] };
    case 'list': return { type: 'list', title, columns: ['Name', 'Status', 'Updated'] };
    default: return { type: 'card', title, text: detailOf(t), items: labels };
  }
}

/** Steps that belong on a screen: the ones naming it (or, for the first screen, every step naming no other screen). */
function stepsFor(screen, i, screens, steps) {
  const re = SCREENS.find((s) => s.id === screen.id)?.words;
  const others = screens.filter((s) => s !== screen).map((s) => SCREENS.find((x) => x.id === s.id)?.words).filter(Boolean);
  return steps.filter((st) => { const t = String(st?.text ?? ''); return (re && re.test(t)) || (i === 0 && !others.some((o) => o.test(t))); });
}

/** Every settings block of a screen becomes one settings section (where the first one was), rows de-duplicated. */
function mergeSettings(blocks) {
  const first = blocks.findIndex((b) => b.type === 'settings');
  if (first < 0) return blocks;
  const rows = [...new Map(blocks.filter((b) => b.type === 'settings').flatMap((b) => b.rows).map((r) => [r.label.toLowerCase(), r])).values()].slice(0, 6);
  return blocks.flatMap((b, i) => (b.type !== 'settings' ? [b] : i === first ? [{ ...b, rows }] : []));
}

/**
 * ui-mockup@1 for a build: { $axf, build, title, screens: [{ id, app, title, search, blocks }], demo, files, cost, at }.
 * opts: files (touched so far), plugins (folder → view title), screens (extra registry), demo ({ rows }), at.
 */
export function mockupSpec(build, opts = {}) {
  const files = [...new Set((opts.files ?? []).map(String))].sort();
  const steps = (build?.steps ?? []).filter((s) => !s?.skip);
  const screens = screensFor(build, files, opts).map((s, i, all) => {
    const blocks = mergeSettings(stepsFor(s, i, all, steps).map(blockFor).filter(Boolean)).slice(0, MAX_BLOCKS);
    if (!blocks.length) blocks.push({ type: 'card', title: str(build?.title, 70) || s.title, text: str(build?.detail, 220), items: [] });
    return { ...s, blocks };
  });
  const rows = (opts.demo?.rows ?? []).slice(0, 6).map((r) => ({ name: str(r.name, 60), status: str(r.status, 20), updated: str(r.updated, 30) }));
  return {
    $axf: MOCKUP_TAG, build: str(build?.id, 120), title: str(build?.title, 200), screens,
    demo: { rows: rows.length ? rows : [{ name: 'Example one', status: 'running', updated: 'now' }, { name: 'Example two', status: 'waiting', updated: '5 min ago' }, { name: 'Example three', status: 'done', updated: '1 h ago' }] },
    files: files.length, cost: { ...COST_RULES }, at: opts.at ?? new Date().toISOString(),
  };
}

/** A stable hash of what the mockup shows (not when it was made): same hash = no new pictures needed. */
export function specHash(spec) {
  const { at, cost, ...rest } = spec ?? {};
  const s = JSON.stringify(rest);
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ------------------------------------------------------------------ URL encoding (the mockup page reads it) */

const b64 = typeof Buffer !== 'undefined'
  ? { enc: (s) => Buffer.from(s, 'utf8').toString('base64'), dec: (s) => Buffer.from(s, 'base64').toString('utf8') }
  : { enc: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))), dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))) };

/** One screen of a spec as a URL-safe string (?ui-mockup=…). */
export function encodeScreen(spec, screenId) {
  const sc = spec.screens.find((s) => s.id === screenId) ?? spec.screens[0];
  const one = { $axf: MOCKUP_TAG, build: spec.build, title: spec.title, screens: [sc], demo: spec.demo };
  return b64.enc(JSON.stringify(one)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The other way; null when it isn't a ui-mockup@1. */
export function decodeScreen(param) {
  try {
    const s = String(param ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(b64.dec(s + '='.repeat((4 - (s.length % 4)) % 4)));
    return o && o.$axf === MOCKUP_TAG && Array.isArray(o.screens) && o.screens.length ? o : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ capture plan (rebuild-shots.mjs shots file) */

/**
 * rebuild-shots entries: per screen a "before-<id>" (the current screen, reached with the console's search; only
 * when the screen has a `search`) and a "predicted-<id>" (the mockup page). File names carry the role.
 */
export function capturePlan(spec, { viewports = ['phone', 'desktop'], before = true, role = 'predicted' } = {}) {
  const out = [];
  for (const s of spec.screens) {
    if ((before || role === 'real') && s.search && s.app === 'console-web') out.push({ name: `${role === 'real' ? 'real' : 'before'}-${s.id}`, steps: [{ search: s.search, wait: 7000 }], settle: 6000, viewports });
    if (role === 'predicted') out.push({ name: `predicted-${s.id}`, path: `/?${MOCKUP_PARAM}=${encodeScreen(spec, s.id)}`, settle: 7000, viewports });
  }
  return out;
}

/** The role of a picture from its file name: before-…, predicted-…, real-… (anything else counts as real). */
export const roleOf = (src) => { const n = String(src ?? '').split('/').pop() ?? ''; const m = /^(?:\d+-)?(before|predicted|real)-/.exec(n); return m ? m[1] : 'real'; };

/* ------------------------------------------------------------------ the item's prediction block */

/** A fresh prediction block for a UI Review item (stored as `prediction` on ui-review-item@1). */
export function newPrediction(spec, { at = new Date().toISOString(), cost = spec?.cost ?? COST_RULES } = {}) {
  return { $axf: PREDICTION_TAG, build: spec.build, state: 'predicted', hash: specHash(spec), screens: spec.screens.map((s) => ({ id: s.id, app: s.app, title: s.title })), cost: { ...COST_RULES, ...cost }, look: { status: 'waiting' }, refreshes: 0, predictedAt: at, refreshedAt: at, addenda: [] };
}

/** Problems with a prediction block ([] when fine). The schema validator calls this for `prediction`. */
export function predictionErrors(p) {
  if (p === undefined || p === null) return [];
  if (typeof p !== 'object' || Array.isArray(p)) return ['prediction must be an object'];
  const e = [];
  if (p.$axf !== PREDICTION_TAG) e.push(`prediction.$axf must be "${PREDICTION_TAG}"`);
  if (!str(p.build)) e.push('prediction.build is missing — the build this look is for');
  if (!STATES.includes(p.state)) e.push(`prediction.state must be one of ${STATES.join(', ')}`);
  if (p.look !== undefined && !LOOK_STATUSES.includes(p.look?.status)) e.push(`prediction.look.status must be one of ${LOOK_STATUSES.join(', ')}`);
  return e;
}

/** Decision verbs → look status. */
export const LOOK_DECISIONS = { approve: 'approved', changes: 'changes', reject: 'rejected', reopen: 'waiting' };

/** Brett's look decision on a prediction block (returns a new block). A 'changes' comment becomes an addendum. */
export function decideLook(p, decision, { comment = '', by = 'brett', at = new Date().toISOString() } = {}) {
  const status = LOOK_DECISIONS[decision] ?? (LOOK_STATUSES.includes(decision) ? decision : null);
  if (!status) throw new Error(`unknown look decision "${decision}"`);
  const c = str(comment, 2000);
  const addenda = [...(p?.addenda ?? [])];
  if (status === 'changes' && c) addenda.push({ at, by, text: c, sent: false });
  return { ...p, look: { status, by, at, ...(c ? { comment: c } : {}) }, addenda };
}

/* ------------------------------------------------------------------ the look gate */

/**
 * May this build start? settings.waitForLook (default off). item = the build's prediction item (working or stored
 * shape: anything with `prediction`), or null when none was made yet.
 * Returns { go, wait, reason, look }: go = start now; wait = queue and check again (look not approved yet); neither =
 * held (rejected).
 */
export function lookVerdict({ settings = {}, touches = false, item = null } = {}) {
  const look = item?.prediction?.look?.status ?? (item ? 'waiting' : 'none');
  if (look === 'rejected') return { go: false, wait: false, look, reason: 'Brett rejected the predicted look in UI Review: the build is held and does not start.' };
  if (!settings.waitForLook) return { go: true, wait: false, look, reason: 'look approval is not required (setting off)' };
  if (!touches) return { go: true, wait: false, look, reason: 'the build changes nothing visible' };
  if (look === 'approved') return { go: true, wait: false, look, reason: 'the predicted look is approved' };
  if (look === 'changes') return { go: true, wait: false, look, reason: 'changes asked on the look: they ride along as an addendum' };
  return { go: false, wait: true, look, reason: look === 'none' ? 'waiting for the predicted look to be made and approved in UI Review' : 'waiting for Brett to approve the predicted look in UI Review' };
}

/** The addendum lines for a build's brief (Ask changes comments on its predicted look). */
export function addendumText(item) {
  const a = item?.prediction?.addenda ?? [];
  if (!a.length) return '';
  return ['Look changes Brett asked for in UI Review (apply them to the UI you build):', ...a.map((x) => `- ${str(x.text, 2000)}`)].join('\n');
}

/** Swap in the real after-shots: state real, item back to waiting for the real approval, the look decision kept. */
export function toReal(p, { at = new Date().toISOString() } = {}) {
  return { ...p, state: 'real', realAt: at };
}
