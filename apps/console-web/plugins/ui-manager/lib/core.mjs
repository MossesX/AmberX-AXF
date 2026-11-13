/**
 * The UI Manager's operations: one set of functions the CLI (ui-manager.mjs), the server part (REST, and through it the
 * plugin-commands@1 MCP tools and `axf ui-manager …`) and the tests share, so every transport answers the same way.
 * Every answer is plain JSON; an error is { error, code } with the control@1 wire codes (not_found, validation, invalid).
 */
import { readFileSync } from 'node:fs';
import * as R from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { buildCatalog, pluginManifests } from './catalog.mjs';
import { readChanges, readOverrides, saveOverrides, undoEntry } from './store.mjs';

export class UiManagerError extends Error { constructor(code, message) { super(message); this.code = code; } }

let cache = null;
/** The catalog and every element (framework slots + plugin manifests), rebuilt at most once a second. */
export function world({ fresh = false, targets = null } = {}) {
  if (fresh || !cache || Date.now() - cache.at > 1000) {
    const catalog = buildCatalog();
    const elements = [...R.frameworkElements(catalog), ...pluginManifests().flatMap((m) => R.elementsFromManifest(m, catalog.types))];
    cache = { at: Date.now(), catalog, elements };
  }
  const extra = targets ? R.elementsFromTargets(targets, cache.catalog.types).filter((t) => !cache.elements.some((e) => e.id === t.id)) : [];
  return { catalog: cache.catalog, elements: [...cache.elements, ...extra] };
}

export function element(id, w = world()) {
  const e = R.resolveElement(id, w.elements) ?? w.elements.find((x) => x.label.toLowerCase() === String(id).toLowerCase() || x.id.endsWith(`:${id}`));
  if (!e) throw new UiManagerError('not_found', `no element ${id}; try: ${R.filterElements(w.elements, String(id).split(/[:/]/).pop()).slice(0, 5).map((x) => x.id).join(', ') || 'ui-manager elements'}`);
  return e;
}

export function listElements({ q = '', category = '', visible = [] } = {}, w = world()) {
  let list = R.filterElements(w.elements, q);
  if (category) list = list.filter((e) => e.category === category);
  const over = readOverrides();
  return { items: list.map((e) => ({ ...e, overrides: R.overrideCount(over, e.id) })), total: list.length, tree: R.elementTree(list, visible).map((c) => ({ id: c.id, label: c.label, icon: c.icon, live: !!c.live, count: c.items.length })) };
}

export function tree({ visible = [] } = {}, w = world()) { return { categories: R.elementTree(w.elements, visible) }; }

export function rows(id, w = world()) {
  const e = element(id, w);
  const list = R.propertyRows(e, readOverrides(), w.catalog);
  return { element: e, items: list, total: list.length, overrides: list.filter((r) => r.overridden).length };
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
  const doc = pending ? R.normalizeOverrides(pending) : readOverrides();
  return { ...R.previewPlan(w.elements, doc, w.catalog), summary: R.summarize(R.diffOverrides(readOverrides(), doc), w.elements, w.catalog) };
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
