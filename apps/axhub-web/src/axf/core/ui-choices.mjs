/**
 * UI Review choices (ui-choices@1, Brett Nov 2026: "Make UI Review have a separate tab under each one for anything that
 * requires a choice. You need to be able to select multiple with priorities." … "make every choice, even the ones I
 * don't pick, an asset" … "for everything sent through it, I need a minimum of three choices.").
 *
 * Pure (no IO). An item's `choices`: the options a build made for one UI, each a predicted look (its pictures are the
 * item's shots named `opt-<option id>--…`) and a real asset of `assetType`, kept whether it is picked or not.
 *
 *   { $axf: 'ui-choices@1', set, assetType, owner, multi, options: [{ id, label, notes?, asset? }], chosen: [ids], decidedAt?, decidedBy? }
 *
 * `chosen` is in priority order. One pick = build that one. Several (only where the asset type can hold several views)
 * = build each as a selectable view, the first is the default. Used by the UI Review plugin (its server mirrors
 * `normChoices` / `choose`; this file is the reference) and its CLI. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const CHOICES_TAG = 'ui-choices@1';
/** The floor of the rule: the "default number of choices" setting can raise it, never lower it. */
export const MIN_OPTIONS = 3;
/** Asset types where one UI can offer several selectable views (an open list). The rest are single pick. */
export const MULTI_VIEW_TYPES = ['layout', 'dock-layout', 'xlayout', 'nav-menu', 'nav-style', 'app-menu', 'toolbar', 'tab-group', 'banner', 'card', 'interface'];
export const OPTION_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const SHOT_PREFIX = 'opt-';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
export const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export const multiViewType = (type) => MULTI_VIEW_TYPES.includes(type);
/** The setting's value, never under the floor. */
export const minOptions = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.max(MIN_OPTIONS, Math.min(n, 12)) : MIN_OPTIONS; };

/** A clean ui-choices@1 from what a build sent, or from storage. `set` names the choice set (assets are filed by it). */
export function normChoices(raw, { set = '' } = {}) {
  const o = isObj(raw) ? raw : {};
  const assetType = str(o.assetType, 40);
  const options = (Array.isArray(o.options) ? o.options : []).filter(isObj).slice(0, 12).map((x, i) => {
    const id = slug(x.id ?? x.label) || `option-${i + 1}`;
    const asset = str(x.asset, 120);
    return { id, label: str(x.label, 120) || `Option ${i + 1}`, ...(str(x.notes, 600) ? { notes: str(x.notes, 600) } : {}), ...(asset ? { asset } : {}) };
  });
  const ids = options.map((x) => x.id);
  const chosen = (Array.isArray(o.chosen) ? o.chosen : []).filter((x, i, a) => ids.includes(x) && a.indexOf(x) === i);
  return {
    $axf: CHOICES_TAG, set: slug(o.set || set), assetType, owner: str(o.owner, 60), multi: multiViewType(assetType), options, chosen,
    ...(str(o.decidedAt, 40) ? { decidedAt: str(o.decidedAt, 40), decidedBy: str(o.decidedBy, 60) } : {}),
  };
}

/** What is wrong with a set, in words a build can act on ([] = fine). */
export function choicesProblems(c, min = MIN_OPTIONS) {
  const out = [];
  if (!c.assetType) out.push('choices.assetType: which asset type the options are');
  if (!c.owner) out.push('choices.owner: the plugin whose assets folder keeps them');
  if (c.options.length < minOptions(min)) out.push(`choices.options: ${c.options.length} sent, at least ${minOptions(min)} are needed`);
  if (new Set(c.options.map((x) => x.id)).size !== c.options.length) out.push('choices.options: option ids must differ');
  return out;
}

/**
 * The intake rule: everything a build sends ships its options. `''` = fine, else the refusal. Predicted items and
 * manual uploads aren't a build's submission; a build with a reason says so in `singleOption`, shown on the item.
 */
export function submissionGap(fields, min = MIN_OPTIONS) {
  const f = isObj(fields) ? fields : {};
  if (f.prediction) return '';
  if (f.choices) return choicesProblems(normChoices(f.choices), min).join('; ');
  const by = str(isObj(f.submittedBy) ? f.submittedBy.id ?? f.submittedBy.type : f.submittedBy, 80);
  const fromBuild = f.source === 'headless' || f.source === 'agent' || by.startsWith('build:') || by.startsWith('agent:');
  if (!fromBuild || str(f.singleOption, 300)) return '';
  return `a build ships at least ${minOptions(min)} options: send choices (review.mjs --choices <file>), or singleOption with the reason there is only one`;
}

/** Brett's pick, in priority order. → { choices } or { error }. Several only where the type can hold several views. */
export function choose(c, ids, { by = 'brett', at = new Date().toISOString() } = {}) {
  const want = (Array.isArray(ids) ? ids : []).filter((x, i, a) => typeof x === 'string' && a.indexOf(x) === i);
  if (!want.length) return { error: 'pick at least one option' };
  const unknown = want.filter((x) => !c.options.some((o) => o.id === x));
  if (unknown.length) return { error: `no such option: ${unknown.join(', ')}` };
  if (want.length > 1 && !c.multi) return { error: `a ${c.assetType} has one view: pick one option` };
  return { choices: { ...c, chosen: want, decidedAt: at, decidedBy: by } };
}

/** The first pick is the default view. */
export const defaultOption = (c) => c?.chosen?.[0] ?? '';
/** A shot's option id from its file name (`opt-<id>--name.png`), '' for an item-level shot. */
export function optionOfShot(src) {
  const name = String(src ?? '').split('/').pop() ?? '';
  const m = /^(?:\d+-)?opt-([a-z0-9][a-z0-9-]*?)--/.exec(name);
  return m ? m[1] : '';
}
export const optionShots = (shots, id) => (shots ?? []).filter((s) => optionOfShot(s.src) === id);

/** Move one id within the priority order (the Choices tab's up / down). */
export function movePick(order, id, by) {
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const optionAssetId = (set, optionId) => `${slug(set)}-${slug(optionId)}`.slice(0, 80);
/** Every option as a real asset@1, tagged with its set: picked or not, it stays in the library. */
export function optionAsset(c, option, data = {}, { name = '', author = 'UI Review choices' } = {}) {
  return {
    $axf: 'asset@1', type: c.assetType, id: optionAssetId(c.set, option.id), name: `${name || c.set}: ${option.label}`.slice(0, 120), version: '0.1.0', author,
    description: option.notes || `Option "${option.label}" of choice set ${c.set}.`, tags: ['ui-choice', `choice-set:${c.set}`, `choice-option:${option.id}`],
    data: isObj(data) ? data : {},
  };
}
/** Where an option asset is kept, relative to the plugins folder (the data folder's copy uses the same path). */
export const optionAssetPath = (c, option) => `${c.owner}/assets/${c.assetType}/${optionAssetId(c.set, option.id)}.json`;
