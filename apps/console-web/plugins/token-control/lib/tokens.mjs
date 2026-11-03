/**
 * Token targets of control@1 (tokens.*): list / get / set / reset over the axHub appearance document.
 *
 * Where: the hub's shared look, `/projects/_shared/_data/settings/appearance.json` where /projects is mounted (the
 * Dev Console container, the VPS), the same file every app reads through the hub's data server (APPEARANCE-SOURCE.md).
 * AXF_APPEARANCE_FILE points somewhere else (tests, local development); without /projects the plugin's data folder
 * keeps a local copy. A set never touches an asset: it writes an override into the look settings
 * (`axf.tokens.<set>`, engines/control-tokens.mjs), and every app applies it on its next read of the document.
 * `tokens.slots` writes the document's `slots` (the hot-swap), `tokens.look` / `tokens.custom` answer
 * not_implemented for writes: the Sliders and per-asset tokens were retired on Nov 1 2026 (designpackage.ts).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { controlPaths } from '../../../../../framework/core/engines/control-rules.mjs';
import { CONTROL_TOKEN_SLOTS, effectiveTokenOverrides, normalizeTokenOverrides, tokenValueIn, withTokenOverride, withoutTokenOverride } from '../../../../../framework/core/engines/control-tokens.mjs';
import { ROOT, DATA_DIR, ControlError } from './common.mjs';

const ASSETS = join(ROOT, 'framework', 'assets');
const APPEARANCE_MAX = 16 * 1024;
const OVERRIDES_KEY = 'axf.appearance.overrides';
const DESIGN_TYPE = 'design-package';
const DEFAULT_DESIGN = 'hub-default';

export function appearanceFile() {
  if (process.env.AXF_APPEARANCE_FILE) return process.env.AXF_APPEARANCE_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  if (existsSync(projects)) return join(projects, '_shared', '_data', 'settings', 'appearance.json');
  return join(DATA_DIR, 'appearance.json');
}

export function readAppearance() {
  const f = appearanceFile();
  try { const d = JSON.parse(readFileSync(f, 'utf8')); return d && typeof d === 'object' && d.$axf === 'appearance@1' ? d : { $axf: 'appearance@1' }; } catch { return { $axf: 'appearance@1' }; }
}

/** Write one change into the document: per key, last write wins; keys the change doesn't name are kept. */
export function writeAppearance(change, by) {
  const f = appearanceFile();
  const doc = readAppearance();
  if (change.slots) { doc.slots = { ...(doc.slots ?? {}) }; for (const [k, v] of Object.entries(change.slots)) { if (v === null) delete doc.slots[k]; else doc.slots[k] = v; } }
  if (change.settings) { doc.settings = { ...(doc.settings ?? {}) }; for (const [k, v] of Object.entries(change.settings)) { if (v === null || v === undefined) delete doc.settings[k]; else doc.settings[k] = v; } }
  doc.updatedBy = String(by || 'token-control').slice(0, 80);
  doc.updatedAt = new Date().toISOString();
  const text = JSON.stringify(doc, null, 2);
  if (text.length > APPEARANCE_MAX) throw new ControlError('validation', `the look document would be over ${APPEARANCE_MAX} bytes: reset some overrides first`);
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${text}\n`);
  renameSync(tmp, f);
  return doc;
}

const assetCache = new Map();
export function assetData(type, id) {
  const k = `${type}/${id}`;
  if (!assetCache.has(k)) { try { assetCache.set(k, JSON.parse(readFileSync(join(ASSETS, type, `${id}.json`), 'utf8')).data ?? null); } catch { assetCache.set(k, null); } }
  return assetCache.get(k);
}
export function assetIds(type) {
  try { return readdirSync(join(ASSETS, type)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { return []; }
}

/** The asset in force for a slot under this document (design package rules: APPEARANCE-SOURCE.md → precedence). */
export function activeAsset(doc, slot) {
  const pkgId = doc.slots?.[DESIGN_TYPE] || DEFAULT_DESIGN;
  const pkg = assetData(DESIGN_TYPE, pkgId) ?? {};
  if (slot === 'style-theme' || slot === 'color-theme') {
    const over = doc.settings?.[OVERRIDES_KEY]?.[slot];
    if (over && assetData(slot, over)) return over;
    if (pkg[slot] && assetData(slot, pkg[slot])) return pkg[slot];
  }
  const pick = doc.slots?.[slot] ?? pkg[slot] ?? pkg.extras?.slots?.[slot];
  if (pick && assetData(slot, pick)) return pick;
  return assetIds(slot)[0] ?? null;
}

function tokenRow(target, doc, p) {
  const spec = CONTROL_TOKEN_SLOTS[target];
  const asset = activeAsset(doc, spec.slot);
  const base = asset ? tokenValueIn(target, assetData(spec.slot, asset), p.id) : undefined;
  const over = effectiveTokenOverrides(doc.settings?.[spec.key], asset);
  const overridden = p.id in over;
  return { ...p, asset, base: base ?? p.default ?? null, value: overridden ? over[p.id] : base ?? p.default ?? null, overridden };
}

const SLOT_TYPES = () => {
  try { return Object.keys(JSON.parse(readFileSync(join(ROOT, 'framework', 'schemas', 'asset-types.json'), 'utf8')).types ?? {}).filter((t) => t !== 'uac-policy'); } catch { return []; }
};

export function runTokens(c) {
  const doc = readAppearance();
  if (c.target === 'tokens.look' || c.target === 'tokens.custom') {
    if (c.op === 'list') return { items: [], total: 0, note: `${c.target} is listed by a running app; the app-wide Sliders and per-asset tokens were retired on Nov 1 2026 (only selection is left in Settings → Appearance). Use tokens.theme / style / layout / typography / density / sizing.` };
    throw new ControlError('not_implemented', `${c.target} was retired on Nov 1 2026 (look sliders and per-asset tokens); set the same value through tokens.theme / style / layout / typography / density / sizing instead`);
  }
  if (c.target === 'tokens.slots') return runSlots(c, doc);
  const spec = CONTROL_TOKEN_SLOTS[c.target];
  const paths = controlPaths(c.target) ?? [];
  switch (c.op) {
    case 'list': { const items = paths.map((p) => tokenRow(c.target, doc, p)); return { items, total: items.length, asset: activeAsset(doc, spec.slot), slot: spec.slot }; }
    case 'get': { const p = paths.find((x) => x.id === c.path); return { item: tokenRow(c.target, doc, p), value: tokenRow(c.target, doc, p).value }; }
    case 'set': {
      let next;
      try { next = withTokenOverride(doc.settings?.[spec.key], c.path, c.value); } catch (e) { throw new ControlError('validation', e.message); }
      const after = writeAppearance({ settings: { [spec.key]: next } }, c.by);
      return { changed: true, item: tokenRow(c.target, after, paths.find((x) => x.id === c.path)), key: spec.key };
    }
    case 'reset': {
      const before = normalizeTokenOverrides(doc.settings?.[spec.key]);
      const next = withoutTokenOverride(before, c.path ?? null);
      const changed = JSON.stringify(before) !== JSON.stringify(next ?? {});
      if (changed) writeAppearance({ settings: { [spec.key]: next } }, c.by);
      return { changed, ...(c.path ? { item: tokenRow(c.target, readAppearance(), paths.find((x) => x.id === c.path)) } : { cleared: Object.keys(before['*'] ?? {}) }) };
    }
    default: throw new ControlError('invalid', `${c.target} does not take ${c.op}`);
  }
}

function runSlots(c, doc) {
  const types = SLOT_TYPES();
  const row = (slot) => ({ id: slot, kind: 'asset-id', value: activeAsset(doc, slot), picked: doc.slots?.[slot] ?? null, options: assetIds(slot) });
  switch (c.op) {
    case 'list': { const items = types.filter((s) => assetIds(s).length).map(row); return { items, total: items.length }; }
    case 'get': { if (!types.includes(c.path)) throw new ControlError('not_found', `no slot ${c.path}`); return { item: row(c.path), value: activeAsset(doc, c.path) }; }
    case 'set': {
      if (!types.includes(c.path)) throw new ControlError('not_found', `no slot ${c.path}`);
      if (typeof c.value !== 'string' || !assetIds(c.path).includes(c.value)) throw new ControlError('validation', `${c.path} has no asset ${String(c.value)} (it has ${assetIds(c.path).join(', ')})`);
      const change = { slots: { [c.path]: c.value } };
      // picking a style or colour theme under a design package records the override (designpackage.ts overrideAfterPick)
      if ((c.path === 'style-theme' || c.path === 'color-theme') && doc.slots?.[DESIGN_TYPE]) change.settings = { [OVERRIDES_KEY]: { ...(doc.settings?.[OVERRIDES_KEY] ?? {}), [c.path]: c.value } };
      if (c.path === DESIGN_TYPE) change.settings = { [OVERRIDES_KEY]: null };
      const after = writeAppearance(change, c.by);
      return { changed: true, item: { id: c.path, kind: 'asset-id', value: activeAsset(after, c.path), picked: c.value, options: assetIds(c.path) } };
    }
    case 'reset': {
      // never the whole look in one go: name the slot (Settings → Appearance → Restore default does that, with a prompt)
      if (!c.path) throw new ControlError('validation', 'reset tokens.slots needs a slot (path): the whole look is reset from Settings → Appearance');
      const slots = [c.path];
      const change = { slots: Object.fromEntries(slots.map((s) => [s, null])) };
      if (c.path === 'style-theme' || c.path === 'color-theme') {
        const o = { ...(doc.settings?.[OVERRIDES_KEY] ?? {}) };
        delete o[c.path];
        change.settings = { [OVERRIDES_KEY]: Object.keys(o).length ? o : null };
      }
      writeAppearance(change, c.by);
      return { changed: slots.length > 0, cleared: slots };
    }
    default: throw new ControlError('invalid', `tokens.slots does not take ${c.op}`);
  }
}
