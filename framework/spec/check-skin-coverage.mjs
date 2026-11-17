#!/usr/bin/env node
/**
 * skin-coverage@1: every asset type registered in schemas/asset-types.json has skin coverage (Brett, Nov 7 2026: "add
 * a CI check that fails if a registered asset type has no skin coverage"). Plain node, no build step: the same engine
 * the runtime, the build engine and the skins CLI use (core/engines/skin-coverage.mjs) is run over the registry and
 * the style targets (schemas/customize.json), and the check fails on
 *   - a widget or attachable type with no style target (a skin couldn't style its copies on banners and toolbars),
 *   - a type excluded from appearance slots with no `skin: { by: … }` declaration on its registry entry,
 *   - a declaration outside the kinds list, a `none` without a why, a `reference` without a via,
 *   - a declaration naming a `via` that is neither `iconPack` nor a registered type,
 *   - a style target naming a type that isn't registered (a stale target would hide a gap),
 *   - the scope chain not ending in the hub default skin (plugin → ui → app → global → default), or a chrome-settings@1
 *     kind (what a skin's `chrome` block names) that a skin can't pick as a slot,
 * and prints the coverage table so a reviewer sees how each type is reached.
 *
 * `--complete <skin>` (build flagship-professional-skin-covering-2, Nov 17 2026: a flagship skin covers everything)
 * also fails when that skin, with its `extends` chain folded in, leaves anything empty: a registered `slot` type it
 * does not pick (the four themes through layoutTheme / colorTheme / styleTheme / behaviorTheme, the rest through
 * `assets`), a `parts` type with no style parts, a `reference` it does not name (iconPack, or the slot its via names),
 * either tone of `colorThemes`, or any skin-slots@1 slot (motion, behavior, hooks, grid, dialog, settings) that is
 * empty or misses a kind (motion per MOTION_KINDS, hooks per HOOK_KINDS, settings per SETTINGS_CHROME_KEYS, every grid
 * field, the tap-confirm arm time). Bundles and `none` types are not a skin's to fill. The skin is looked up in
 * framework/assets/skin, then in every plugin's assets/skin.
 *
 *   node framework/spec/check-skin-coverage.mjs [--json] [--quiet] [--complete <skin>[,<skin>…]]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERAGE_KINDS, SKIN_SCOPE_DEFAULT, SKIN_SCOPE_KINDS, coverageSummary, coverageTable, declarationErrors, partsTypes, skinScopeChain } from '../core/engines/skin-coverage.mjs';
import { SKIN_NEVER, normalizeSkinChrome, skinChromeErrors } from '../core/engines/skin-rules.mjs';
import { CHROME_TYPES } from '../core/engines/chrome-settings-rules.mjs';
import { GRID_FIELDS, HOOK_KINDS, MOTION_KINDS, SETTINGS_CHROME_KEYS, SKIN_SLOT_KEYS, normalizeSkinSlots } from '../core/engines/skin-slots.mjs';
import { existsSync, readdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const json = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet') || json;

const spec = readJson(join(ROOT, 'schemas/asset-types.json')).types;
const customize = readJson(join(ROOT, 'schemas/customize.json'));
const targets = customize.targets ?? {};

const rows = coverageTable(spec, targets, SKIN_NEVER);
const problems = [];
for (const r of rows) if (r.by === 'uncovered') problems.push(`${r.type}: ${r.why}`);
for (const [type, t] of Object.entries(spec)) {
  for (const e of declarationErrors(type, t)) if (!problems.some((p) => p.startsWith(`${type}:`))) problems.push(e);
  const via = t?.skin?.via;
  if (t?.skin?.by === 'reference' && via && via !== 'iconPack' && !spec[via]) problems.push(`${type}: skin.via "${via}" is neither iconPack nor a registered type`);
}
for (const type of Object.keys(targets)) if (!spec[type]) problems.push(`customize target "${type}" is not a registered asset type`);
// the kinds list is the contract (docs, the UI's legend and the CLI print it)
if (JSON.stringify(COVERAGE_KINDS) !== JSON.stringify(['slot', 'parts', 'reference', 'bundle', 'none'])) problems.push('COVERAGE_KINDS changed: update spec/APPEARANCE-SOURCE.md and the Appearance panel legend');
// the scope chain is the contract too (build console-look-becomes-default-axhub-skin): the hub default skin is its root
if (JSON.stringify(SKIN_SCOPE_KINDS) !== JSON.stringify(['default', 'global', 'app', 'ui', 'plugin'])) problems.push('SKIN_SCOPE_KINDS changed: update spec/APPEARANCE-SOURCE.md (resolve order) and the Skins screen');
if (JSON.stringify(skinScopeChain({ app: 'x', ui: 'home', plugin: 'notes' })) !== JSON.stringify(['plugin:notes', 'ui:home', 'app', 'global', SKIN_SCOPE_DEFAULT])) problems.push('skinScopeChain must run plugin → ui → app → global → default');
// a skin's chrome block names chrome-settings@1 kinds: every one must be a registered type a skin reaches as a slot (never an unreachable type)
for (const kind of CHROME_TYPES) {
  const row = rows.find((r) => r.type === kind);
  if (!row) problems.push(`chrome kind "${kind}" (skin chrome block) is not a registered asset type`);
  else if (row.by !== 'slot') problems.push(`chrome kind "${kind}" (skin chrome block) is covered by ${row.by}, not as a slot: a skin could set its settings but not pick its asset`);
}
const chromeOk = Object.keys(normalizeSkinChrome({ toolbar: { interface: 'chrome-toolbar' }, nope: { interface: 'x' } }));
if (JSON.stringify(chromeOk) !== JSON.stringify(['toolbar'])) problems.push('normalizeSkinChrome must keep chrome-settings@1 kinds only');
if (!skinChromeErrors({ nope: {} }).length) problems.push('skinChromeErrors must refuse a kind outside chrome-settings@1');

// --complete <skin>: every slot of that skin is filled
const completeAt = process.argv.indexOf('--complete');
const completeId = completeAt > 0 ? process.argv[completeAt + 1] : '';
const completeList = [];
if (completeAt > 0) {
  if (!completeId || completeId.startsWith('--')) problems.push('--complete needs a skin id (several: a,b,c)');
  else for (const id of completeId.split(',').map((x) => x.trim()).filter(Boolean)) {
    const c = completeness(id);
    completeList.push(c);
    for (const g of c.gaps) problems.push(`skin "${id}": ${g}`);
  }
}

/** Where a skin asset lives: framework/assets/skin, then every plugin's assets/skin. */
function findSkin(id) {
  const dirs = [join(ROOT, 'assets/skin')];
  const plugins = join(ROOT, '../apps/console-web/plugins');
  if (existsSync(plugins)) for (const p of readdirSync(plugins)) dirs.push(join(plugins, p, 'assets/skin'));
  for (const d of dirs) { const f = join(d, `${id}.json`); if (existsSync(f)) return readJson(f); }
  return null;
}

/** A skin's data with its `extends` chain folded in (the child wins; objects merge one key at a time; depth ≤ 4). */
function foldedSkin(id, seen = []) {
  const asset = findSkin(id);
  if (!asset) return null;
  const data = asset.data ?? {};
  if (!data.extends || seen.length >= 4 || seen.includes(id)) return data;
  const parent = foldedSkin(data.extends, [...seen, id]);
  return parent ? merge(parent, data) : data;
}
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v;
  return out;
}

function completeness(id) {
  const data = foldedSkin(id);
  if (!data) return { id, filled: 0, total: 0, gaps: ['not found in framework/assets/skin or any plugin assets/skin'] };
  const themes = { layout: 'layoutTheme', 'color-theme': 'colorTheme', 'style-theme': 'styleTheme', 'behavior-theme': 'behaviorTheme' };
  const assets = data.assets ?? {};
  const parts = data.parts ?? {};
  const has = (v) => typeof v === 'string' ? v.trim() !== '' : v && typeof v === 'object' ? Object.keys(v).length > 0 : v !== undefined;
  const checks = [];
  const need = (label, ok) => checks.push({ label, ok: !!ok });
  for (const r of rows) {
    if (r.by === 'slot') need(`slot ${r.type} (${themes[r.type] ?? `assets.${r.type}`})`, has(themes[r.type] ? data[themes[r.type]] : assets[r.type]));
    if (r.by === 'parts' || r.also.includes('parts')) need(`parts.${r.type}`, has(parts[r.type]));
    if (r.by === 'reference') need(`reference ${r.type} (via ${r.via})`, r.via === 'iconPack' ? has(data.iconPack) : has(assets[r.via]));
  }
  for (const tone of ['light', 'dark']) need(`colorThemes.${tone}`, has(data.colorThemes?.[tone]));
  const slots = normalizeSkinSlots(data);
  for (const k of SKIN_SLOT_KEYS) need(`slot ${k} (skin-slots@1)`, has(slots[k]));
  for (const k of MOTION_KINDS) need(`motion.chrome.${k}`, has(slots.motion?.chrome?.[k]));
  for (const k of ['speed', 'easing', 'reduced']) need(`motion.${k}`, has(slots.motion?.[k]));
  for (const k of HOOK_KINDS) need(`hooks.${k}`, has(slots.hooks?.[k]));
  for (const k of SETTINGS_CHROME_KEYS) need(`settings.${k}`, has(slots.settings?.[k]));
  for (const k of GRID_FIELDS) need(`grid.${k}`, has(slots.grid?.[k]));
  need('behavior.tapConfirm.armMs', has(slots.behavior?.tapConfirm?.armMs));
  for (const k of CHROME_TYPES) need(`behavior.tapConfirm.${k}`, has(slots.behavior?.tapConfirm?.[k]));
  return { id, filled: checks.filter((c) => c.ok).length, total: checks.length, gaps: checks.filter((c) => !c.ok).map((c) => `${c.label} is empty`) };
}

const summary = coverageSummary(rows);
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, summary, problems, rows, partsTypes: partsTypes(spec, targets), ...(completeList.length ? { complete: completeList } : {}) }));
} else {
  if (!quiet) {
    const w = Math.max(...rows.map((r) => r.type.length));
    for (const r of rows) console.log(`  ${r.type.padEnd(w)}  ${r.by.padEnd(10)}${r.also.length ? `+${r.also.join('+')}` : '          '}  ${r.elements.length ? r.elements.join('/') : '-'}${r.declared ? '  (declared)' : ''}${r.via ? `  via ${r.via}` : ''}`);
  }
  console.log(`check-skin-coverage: ${summary.total} types · slot ${summary.slot} · parts ${summary.parts} · reference ${summary.reference} · bundle ${summary.bundle} · none ${summary.none} · uncovered ${summary.uncovered}`);
  for (const c of completeList) console.log(`check-skin-coverage --complete ${c.id}: ${c.filled} / ${c.total} filled`);
  for (const p of problems) console.error(`  ✗ ${p}`);
}
if (problems.length) { console.error(`check-skin-coverage: ${problems.length} problem(s). A skin gap: pick an asset or fill the slot on that skin. Otherwise: give the type a style target in schemas/customize.json (widgets) or a "skin": { "by": … } declaration on its asset-types.json entry.`); process.exit(1); }
