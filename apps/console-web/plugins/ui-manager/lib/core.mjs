/**
 * The UI Manager's operations: one set of functions the CLI (ui-manager.mjs), the server part (REST, and through it the
 * plugin-commands@1 MCP tools and `axf ui-manager …`) and the tests share, so every transport answers the same way.
 * Every answer is plain JSON; an error is { error, code } with the control@1 wire codes (not_found, validation, invalid).
 */
import { readFileSync } from 'node:fs';
import * as R from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { buildCatalog, pluginManifests } from './catalog.mjs';
import * as Q from './query.mjs';
import { readChanges, readOverrides, readSelection, saveOverrides, saveSelection, undoEntry, VIEWS } from './store.mjs';
import * as S from './say.mjs';

export class UiManagerError extends Error { constructor(code, message) { super(message); this.code = code; } }

let cache = null;
/** The catalog and every element (framework slots + plugin manifests), rebuilt at most once a second. */
export function world({ fresh = false, targets = null } = {}) {
  if (fresh || !cache || Date.now() - cache.at > 1000) {
    const catalog = buildCatalog();
    const elements = [...R.frameworkElements(catalog), ...pluginManifests().flatMap((m) => R.elementsFromManifest(m, catalog.types))];
    cache = { at: Date.now(), catalog, elements };
  }
  // live console targets (passed in, or named by a saved override) resolve on the server too: `target:<address>` is enough
  const named = Object.keys(readOverrides().elements ?? {}).filter((id) => id.startsWith('target:')).map(targetOf);
  const extra = R.elementsFromTargets([...(targets ? (Array.isArray(targets) ? targets : targets.targets ?? []) : []), ...named], cache.catalog.types)
    .filter((t, i, all) => !cache.elements.some((e) => e.id === t.id) && all.findIndex((x) => x.id === t.id) === i);
  return { catalog: cache.catalog, elements: [...cache.elements, ...extra] };
}

/**
 * A console-control target from its element id alone (`target:view:builds/button:save` → kind button): every live
 * element the floating window shows can be read, set and reset through the API without the window being open.
 */
export function targetOf(id) {
  const address = String(id).replace(/^target:/, '');
  const last = address.split('/').pop() ?? '';
  const kind = last.includes(':') ? last.slice(0, last.indexOf(':')) : 'element';
  const name = last.includes(':') ? last.slice(last.indexOf(':') + 1) : last;
  return { address, kind, label: name.replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase()) };
}

export function element(id, w = world()) {
  if (String(id).startsWith('target:') && !R.resolveElement(id, w.elements)) w = { ...w, elements: [...w.elements, ...R.elementsFromTargets([targetOf(id)], w.catalog.types)] };
  const e = R.resolveElement(id, w.elements) ?? w.elements.find((x) => x.label.toLowerCase() === String(id).toLowerCase() || x.id.endsWith(`:${id}`));
  if (!e) throw new UiManagerError('not_found', `no element ${id}; try: ${R.filterElements(w.elements, String(id).split(/[:/]/).pop()).slice(0, 5).map((x) => x.id).join(', ') || 'ui-manager elements'}`);
  return e;
}

/**
 * Search, sort and multi-filter (lib/query.mjs): q, kinds, categories, plugins, overriddenOnly, onScreenOnly (with
 * visible), sort, desc; limit / offset page it. facets = every filter value with its count over the whole list.
 */
export function listElements({ visible = [], limit = 0, offset = 0, ...query } = {}, w = world()) {
  const over = readOverrides();
  const counted = w.elements.map((e) => ({ ...e, overrides: R.overrideCount(over, e.id) }));
  const list = Q.queryElements(counted, query, visible);
  const p = Q.page(list, { limit, offset });
  return { ...p, query: Q.normalizeQuery(query), facets: Q.facets(counted), tree: R.elementTree(list, visible).map((c) => ({ id: c.id, label: c.label, icon: c.icon, live: !!c.live, count: c.items.length })) };
}

export function tree({ visible = [], ...query } = {}, w = world()) {
  const over = readOverrides();
  return { categories: Q.queryTree(w.elements.map((e) => ({ ...e, overrides: R.overrideCount(over, e.id) })), query, visible) };
}

/** The expanding row; propQuery (q, groups, changedOnly, sort, desc) searches / filters / sorts the properties. */
export function rows(id, propQuery = {}, w = world()) {
  const e = element(id, w);
  const all = R.propertyRows(e, readOverrides(), w.catalog);
  const list = Q.queryProps(all, propQuery);
  return { element: e, items: list, total: all.length, overrides: all.filter((r) => r.overridden).length };
}

export function choices(id, propId, w = world()) {
  const e = element(id, w);
  const p = R.propsOf(e, w.catalog).find((x) => x.id === propId || x.label.toLowerCase() === String(propId).toLowerCase());
  if (!p) throw new UiManagerError('not_found', `${e.id} has no property ${propId}; it has: ${R.propsOf(e, w.catalog).map((x) => x.id).join(', ')}`);
  return { element: e.id, prop: p, options: p.options, free: false };
}

/** Set one property to one of its choices and save (one change-log entry). Rejects anything outside the list. */
export function set(id, propId, value, { by = 'brett', reason = '' } = {}, w = world()) {
  const e = element(id, w);
  const c = choices(e.id, propId, w);
  const r = R.withOverride(readOverrides(), e, c.prop, value, { by });
  if (r.error) throw new UiManagerError('validation', r.error);
  const saved = saveOverrides(r.doc, { by, note: reason });
  return { changed: !!saved.entry, element: e.id, prop: c.prop.id, value: r.value, entry: saved.entry, row: R.propertyRows(e, saved.doc, w.catalog).find((x) => x.id === c.prop.id) };
}

export function reset(id = '', propId = '', { by = 'brett', reason = '' } = {}, w = world()) {
  const e = id ? element(id, w) : null;
  if (e && propId) choices(e.id, propId, w);
  const doc = R.withoutOverride(readOverrides(), e ? e.id : '', propId);
  const saved = saveOverrides(doc, { by, note: reason || `reset ${e ? e.id : 'everything'}${propId ? ` ${propId}` : ''}` });
  return { changed: !!saved.entry, element: e?.id ?? '', prop: propId, entry: saved.entry, remaining: R.overrideCount(saved.doc) };
}

/** The live-preview plan for a pending document (or the saved one): CSS on tokens only, asset swaps, asset patches. */
export function preview(pending = null, w = world()) {
  const doc = pending ? coerce(R.normalizeOverrides(pending), w) : readOverrides();
  return { ...R.previewPlan(w.elements, doc, w.catalog), summary: R.summarize(R.diffOverrides(readOverrides(), doc), w.elements, w.catalog), errors: R.overridesErrors(doc, w.elements, w.catalog) };
}

/** Every value of a pending document written as its choice ('accent' → '@accent', '80 %' → 80); what no choice accepts is left as sent. */
function coerce(doc, w) {
  for (const [id, props] of Object.entries(doc.elements)) {
    const e = R.resolveElement(id, w.elements);
    if (!e) continue;
    const all = R.propsOf(e, w.catalog);
    for (const [pid, v] of Object.entries(props)) { const p = all.find((x) => x.id === pid); const r = p ? R.validateValue(p, v) : null; if (r?.ok) props[pid] = r.value; }
  }
  return doc;
}

/** Apply a whole pending document (the floating window's Apply): one entry listing every change. */
export function apply(pending, { by = 'brett', reason = '' } = {}, w = world()) {
  const doc = R.normalizeOverrides(pending);
  const errors = R.overridesErrors(doc, w.elements, w.catalog);
  if (errors.length) throw new UiManagerError('validation', errors.join('; '));
  for (const [id, props] of Object.entries(doc.elements)) {
    const all = R.propsOf(element(id, w), w.catalog);
    for (const [pid, v] of Object.entries(props)) props[pid] = R.validateValue(all.find((x) => x.id === pid), v).value;
  }
  const summary = R.summarize(R.diffOverrides(readOverrides(), doc), w.elements, w.catalog);
  const saved = saveOverrides(doc, { by, note: reason });
  return { changed: !!saved.entry, entry: saved.entry, summary };
}

export const changes = ({ limit = 50 } = {}) => ({ items: readChanges({ limit }), total: readChanges({ limit: 2000 }).length });
export function undo(changeId, { by = 'brett' } = {}) {
  const r = undoEntry(changeId, { by });
  if (r.error) throw new UiManagerError('not_found', r.error);
  return { changed: true, entry: r.entry, remaining: R.overrideCount(r.doc) };
}
export const overrides = () => readOverrides();
/** Every problem in a pending document (empty = valid), without saving anything. */
export const validate = (pending, w = world()) => { const errors = R.overridesErrors(pending, w.elements, w.catalog); return { ok: !errors.length, errors }; };
export const schemas = () => R.uiManagerSchemas();
export const catalogInfo = (w = world()) => ({ types: Object.keys(w.catalog.types).length, assets: Object.fromEntries(Object.entries(w.catalog.assets).map(([t, a]) => [t, a.length])), active: w.catalog.active, skin: w.catalog.skin, tokenSets: Object.fromEntries(Object.entries(w.catalog.paths).map(([t, p]) => [t, p.length])) });

/** The console's live target snapshot (console-control-targets@1) from a file, for "On screen now" without the UI. */
export function targetsFromFile(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }

/* ================================================================== selection, view and what a person says */

/** The window's state that lives outside the browser: the selected element and the view (row / panel / grid). */
export function state(w = world()) {
  const sel = readSelection();
  let element = null;
  try { element = sel.element ? element_(sel.element, w) : null; } catch { /* the element went away */ }
  return { ...sel, label: element?.label ?? '', views: VIEWS, overrides: R.overrideCount(readOverrides()) };
}
const element_ = (id, w) => element(id, w);

/** Select an element by id, label or words ("main toolbar"); the open window follows (web/bridge.ts). */
export function select(what, { by = 'brett' } = {}, w = world()) {
  const e = resolveWords(what, w);
  saveSelection({ element: e.id }, { by });
  return { selected: e.id, label: e.label, kind: e.kind, category: e.category };
}

export function setView(view, { by = 'brett' } = {}) {
  const v = S.VIEW_WORDS[String(view).toLowerCase()] ?? '';
  if (!v) throw new UiManagerError('validation', `view ${view}: use ${VIEWS.join(', ')}`);
  return { view: saveSelection({ view: v }, { by }).view };
}

function resolveWords(what, w) {
  try { return element(what, w); } catch { /* not an id or a label: rank by words */ }
  const hit = S.rankElements(w.elements, what)[0];
  if (!hit) throw new UiManagerError('not_found', `no element matches "${what}"; try: ${R.filterElements(w.elements, String(what).split(/\s+/).pop()).slice(0, 5).map((x) => x.label).join(', ') || 'ui-manager elements'}`);
  return hit;
}

/**
 * Run what a person says, step by step: select, set (its / of <element>), reset, view. Every set is the same validated
 * set as the window's (a value outside the property's choices is refused with the valid values). Stops at the first
 * step that fails and says which; earlier steps stay done.
 */
export function say(text, { by = 'brett', reason = '' } = {}, w = world()) {
  const steps = S.parseSay(text);
  if (!steps.length) throw new UiManagerError('invalid', 'say what? e.g. "select the main toolbar, set its transparency to 80"');
  let current = readSelection().element;
  const done = [];
  for (const st of steps) {
    try {
      if (st.op === 'unknown') throw new UiManagerError('invalid', `"${st.text}": say select <element>, set <property> to <value>, reset <element>, or row / panel / grid view`);
      if (st.op === 'view') { done.push({ op: 'view', ...setView(st.view, { by }) }); continue; }
      const target = st.what ? resolveWords(st.what, w) : current ? element(current, w) : null;
      if (!target) throw new UiManagerError('invalid', 'which element? say "select <element>" first');
      current = target.id;
      if (st.op === 'select') { done.push({ op: 'select', ...select(target.id, { by }, w) }); continue; }
      const props = R.propsOf(target, w.catalog);
      if (st.op === 'reset') {
        const p = st.prop ? S.rankProps(props, st.prop)[0] : null;
        if (st.prop && !p) throw new UiManagerError('not_found', `${target.label} has no property "${st.prop}"; it has: ${props.map((x) => x.label).join(', ')}`);
        done.push({ op: 'reset', ...reset(target.id, p?.id ?? '', { by, reason: reason || text }, w) });
        continue;
      }
      const p = S.rankProps(props, st.prop)[0];
      if (!p) throw new UiManagerError('not_found', `${target.label} has no property "${st.prop}"; it has: ${props.map((x) => x.label).join(', ')}`);
      const r = set(target.id, p.id, S.pickValue(p, st.value), { by, reason: reason || text }, w);
      saveSelection({ element: target.id }, { by });
      done.push({ op: 'set', element: r.element, label: target.label, prop: r.prop, propLabel: p.label, value: r.value, changed: r.changed });
    } catch (e) {
      if (e instanceof UiManagerError) throw new UiManagerError(e.code, `step ${done.length + 1} of ${steps.length}: ${e.message}${done.length ? ` (done before it: ${done.map((d) => d.op).join(', ')})` : ''}`);
      throw e;
    }
  }
  return { steps: done, selected: current, said: text };
}
