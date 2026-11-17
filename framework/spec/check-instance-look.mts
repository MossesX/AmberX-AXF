#!/usr/bin/env -S npx -y tsx
/**
 * instance-look@1 (build own-look-per-grid-and-tab-group, Nov 16 2026): one grid's or one tab row's own look.
 *   - the fixture (spec/fixtures/instance-look.json) replays exactly: skin only, partial / full override, app then
 *     instance, reset, skin swap under an override, raw values refused, legacy migration
 *   - the rules: an empty record resolves to the skin; a swap keeps the overridden keys and lets the rest follow; reset
 *     drops only the instance key; every refusal names a raw px / colour for what it is; no accepted value compiles to
 *     anything but var() / calc() / 0 / 999px / transparent; every binding names a component-tokens@1 family token
 *     (or one of the three the CSS wiring adds); the two kind lists agree; the JSON Schema enumerates every value.
 *   npx -y tsx framework/spec/check-instance-look.mts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/engines/instance-look';
import { componentTokenDefaults } from '../core/engines/component-tokens.mjs';
import { CHROME_LOOK_KINDS, CHROME_INSTANCE_PICK_SUFFIXES } from '../core/engines/chrome-settings-rules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
let n = 0; const bad: string[] = [];
const eq = (a: unknown, b: unknown, msg: string) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${msg}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`); };
const ok = (c: unknown, msg: string) => { n++; if (!c) bad.push(msg); };

const f = read('spec/fixtures/instance-look.json');
const spec = read('schemas/asset-types.json');
const ct = L.colourTokensOf(spec);
type Kind = L.InstanceLookKind;

eq(f.contract, L.INSTANCE_LOOK_CONTRACT, 'contract');
eq(f.kinds, L.INSTANCE_LOOK_KINDS, 'kinds');
eq(L.INSTANCE_LOOK_KINDS, CHROME_LOOK_KINDS, 'the look kinds are the chrome-settings look kinds');
ok(CHROME_INSTANCE_PICK_SUFFIXES.includes('.look'), '.look is a pick suffix (never an asset with edits)');
eq(f.keys, L.INSTANCE_LOOK_KEYS, 'the ten keys');
eq(f.keys.map((k: { key: string }) => k.key), ['rowBg', 'rowAltBg', 'textSize', 'spacing', 'borderW', 'borderColor', 'radius', 'hoverBg', 'selectedBg', 'selectedFg'], 'key order is the contract');
eq(f.bindings, L.INSTANCE_LOOK_BINDINGS, 'bindings');
eq(f.colourTokens, ct, 'colour tokens come from the registry');

/* ---- value grammar ---- */
for (const [key, table] of Object.entries(f.values as Record<string, Record<string, string | null>>)) {
  for (const [raw, want] of Object.entries(table)) eq(L.instanceLookValue(key, raw, ct), want, `value ${key} ← ${JSON.stringify(raw)}`);
}
const SAFE = /^(var\(--fx-[a-z0-9-]+\)|calc\(var\(--fx-border-w\) \* [23]\)|0|999px|transparent)$/;
for (const [key, table] of Object.entries(f.values as Record<string, Record<string, string | null>>)) {
  for (const v of Object.values(table)) if (v !== null) ok(SAFE.test(v), `${key}: compiled value ${v} is a token ref, a step or a fixed shape`);
}
for (const raw of ['12px', '0.5em', '1rem', '50%', '7', '#fff', '#ff8800aa', 'rgb(1 2 3)', 'hsl(1 2% 3%)', 'color-mix(in srgb, red, blue)', 'red', 'var(--fx-accent)', 'calc(1px + 1px)', 'accent;}body{display:none']) {
  for (const k of L.INSTANCE_LOOK_KEY_IDS) ok(L.instanceLookValue(k, raw, ct) === null, `${k} refuses ${raw}`);
}
ok(L.instanceLookValue('selectedFg', 'transparent', ct) === null, 'a foreground is never transparent');
eq(L.instanceLookValue('rowBg', 'accent-soft', ct), 'var(--fx-accent-soft)', 'kebab token name accepted');
eq(L.instanceLookStored('rowBg', 'accent-soft', ct), 'accentSoft', 'stored form is the canonical camel name');

/* ---- bindings name family tokens ---- */
const familyVars = new Set(Object.keys(componentTokenDefaults()));
const ADDED_WITH_CSS = new Set(['--fx-grid-font-size', '--fx-tab-font-size', '--fx-grid-border-w']);
for (const [kind, map] of Object.entries(L.INSTANCE_LOOK_BINDINGS)) {
  eq(Object.keys(map), L.INSTANCE_LOOK_KEY_IDS, `${kind}: a binding row for every key`);
  for (const [key, vars] of Object.entries(map)) for (const v of vars) ok(familyVars.has(v) || ADDED_WITH_CSS.has(v), `${kind}.${key} binds ${v}, a component-tokens@1 family token`);
}

/* ---- fixture replay ---- */
const C = f.cases as Record<string, { kind: Kind; layers: L.InstanceLookLayers; result: L.ResolvedInstanceLook }>;
for (const [name, c] of Object.entries(C)) eq(L.resolveInstanceLook(c.kind, c.layers, ct), c.result, `case ${name}`);
eq(C['skin-only-grid'].result.look, C['empty-equals-skin-grid'].result.look, 'an empty record = the skin (grid)');
eq(C['skin-only-tabs'].result.look, C['empty-equals-skin-tabs'].result.look, 'an empty record = the skin (tab group)');
ok(Object.values(C['skin-only-grid'].result.source).every((s) => s === 'skin'), 'skin only: every key from the skin');
ok(C['skin-only-grid'].result.followsSkin && C['empty-equals-skin-grid'].result.followsSkin, 'skin only follows the skin');
ok(!C['partial-override'].result.followsSkin, 'a partial override no longer follows the skin');
eq(C['partial-override'].result.source.hoverBg, 'instance', 'partial: the instance decides hoverBg');
eq(C['partial-override'].result.source.rowAltBg, 'skin', 'partial: the skin still decides rowAltBg');
eq(Object.keys(C['full-override'].result.look), L.INSTANCE_LOOK_KEY_IDS, 'full override: every key set');
ok(Object.values(C['full-override'].result.source).every((s) => s === 'instance'), 'full override: every key from the instance');
eq(Object.keys(C['full-override'].result.vars).length, 10, 'full override: ten --fx-inst-* variables');
eq(C['app-then-instance'].result.source, { rowAltBg: 'skin', spacing: 'app', radius: 'instance', hoverBg: 'skin', selectedFg: 'skin' }, 'child over parent: instance over app over skin');
eq(C['nothing'].result, { kind: 'tab-group', look: {}, source: {}, vars: {}, bind: {}, empty: true, followsSkin: true }, 'no skin, no record: nothing is emitted');
// skin swap under an override: the overridden keys stay, the rest follow the new skin
const swapA = C['swap-before'].result, swapB = C['swap-after'].result;
eq(swapA.look.hoverBg, swapB.look.hoverBg, 'swap keeps the overridden hoverBg');
eq(swapA.source.hoverBg, 'instance', 'swap: hoverBg stays the instance\'s');
ok(swapA.look.radius !== swapB.look.radius && swapB.source.radius === 'skin', 'swap: radius follows the new skin');
ok(swapA.look.rowAltBg !== undefined && swapB.look.rowAltBg === undefined, 'swap: a key the new skin does not set is gone');
for (const c of Object.values(C)) for (const [v, css] of Object.entries(c.result.vars)) { ok(v.startsWith('--fx-inst-'), `${v} is an --fx-inst-* variable`); ok(SAFE.test(css), `${v} compiles to a token ref or step`); }
for (const c of Object.values(C)) for (const [fam, ref] of Object.entries(c.result.bind)) ok(ref.startsWith('var(--fx-inst-') && Object.keys(c.result.vars).includes(ref.slice(4, -1)), `${fam} binds to an emitted --fx-inst-* variable`);

/* ---- skin layer from a style theme ---- */
for (const [name, c] of Object.entries(f.fromFamilies as Record<string, { kind: Kind; styleTheme: never; look: L.InstanceLook }>)) eq(L.lookFromFamilies(c.kind, c.styleTheme, ct), c.look, `fromFamilies ${name}`);
ok(!('borderColor' in f.fromFamilies['skin-a-grid'].look), 'a raw colour in the skin\'s family map is not a look value');

/* ---- settings: write, read, reset, list ---- */
const S = f.settings;
eq(L.instanceLookSettingsKey('grid', 'ui-review.items'), S.keys.instance, 'instance key');
eq(L.kindLookSettingsKey('tab-group'), S.keys.kind, 'kind key');
eq(S.parsed, Object.fromEntries(S.parseKeys.map((k: string) => [k, L.parseInstanceLookSettingsKey(k)])), 'parse keys');
eq(L.writeInstanceLook(S.before, 'grid', 'ui-review.items', S.record, ct), S.written, 'write');
eq(L.readInstanceLook(S.written, 'grid', 'ui-review.items', ct), S.read, 'read');
eq(L.resetInstanceLook(S.written, 'grid', 'ui-review.items'), S.reset, 'reset drops the instance record only');
ok(!(S.keys.instance in S.reset) && 'axf.chrome.grid.look' in S.reset && 'axf.tokens.instances' in S.reset, 'reset leaves the app record and the legacy token values');
eq(L.writeInstanceLook(S.written, 'grid', 'ui-review.items', {}, ct), S.reset, 'writing an empty record = reset');
eq(L.instanceLookList(S.written, ct), S.list, 'list');
eq(L.resolveFromSettings(S.written, 'grid', 'ui-review.items', f.fromFamilies['skin-a-grid'].styleTheme, ct), S.resolved, 'resolve from settings');

/* ---- refusals ---- */
const R = f.refused;
eq(L.instanceLookRecordErrors(R.record, ct, 'look'), R.errors, 'record errors');
ok(R.errors.some((e: string) => e.includes('a raw size is never a look value')) && R.errors.some((e: string) => e.includes('a raw colour is never a look value')), 'refusals name raw px and raw colours');
eq(L.normalizeInstanceLook(R.record, ct), R.normalized, 'normalize drops every refused value and keeps the good ones');
for (const [key, value] of Object.entries(R.set as Record<string, string>)) {
  let msg = ''; try { L.setInstanceLookKey(R.normalized, key, value, ct); } catch (e) { msg = (e as Error).message; }
  eq(msg, R.setErrors[key], `set ${key}=${value} throws the rules' message`);
}
eq(L.setInstanceLookKey(R.normalized, 'radius', 'pill', ct), { ...R.normalized, radius: 'pill' }, 'a good set lands');
eq(L.setInstanceLookKey(R.normalized, 'hoverBg', null, ct), Object.fromEntries(Object.entries(R.normalized).filter(([k]) => k !== 'hoverBg')), 'set null drops the key');
eq(L.instanceLookErrors('instance-look', { kind: 'grid', look: R.record }, ct).length, R.errors.length, 'the asset validator reports the same refusals');
eq(L.instanceLookErrors('button', { look: R.record }, ct), [], 'other types are not touched');

/* ---- migration ---- */
const M = f.migration;
eq(L.migrateLegacyInstanceLooks(M.before, ct), M.result, 'legacy migration');
eq(L.migrateLegacyInstanceLooks(M.result.settings, ct), { settings: M.result.settings, moved: [], kept: M.result.kept, changed: false }, 'migration is idempotent');
ok(M.result.kept.some((k: { value: string }) => k.value === '#ff0000'), 'a raw colour stays a token value (nothing lost)');
ok(M.result.kept.some((k: { token: string }) => k.token === 'hoverBg'), 'a key the record already has leaves the legacy value in place');

/* ---- JSON Schema: every look key an enum ---- */
const schema = read('schemas/json/instance-look.schema.json');
const look = schema.properties.data.properties.look;
eq(Object.keys(look.properties), L.INSTANCE_LOOK_KEY_IDS, 'schema lists the ten keys');
ok(look.additionalProperties === false, 'schema refuses unknown keys');
for (const [k, p] of Object.entries(look.properties as Record<string, { enum?: string[] }>)) ok(Array.isArray(p.enum) && p.enum.length > 0 && !p.enum.some((v) => /^-?\d*\.?\d+(px|em|rem|%)?$|^#|\(/.test(v)), `schema ${k} is an enum with no raw value`);
eq(schema.properties.data.properties.kind.enum, L.INSTANCE_LOOK_KINDS, 'schema kinds');

/* ---- phase 2: skin swap restyles, reset returns to the skin (through the settings store the components read) ---- */
{
  const skinA = { grid: { rowBg: 'var(--fx-surface)', hoverBg: 'var(--fx-surface2)', radius: 'radius.sm' }, tabs: { activeBg: 'var(--fx-accent-soft)', gap: 'dens-gap-sm' } };
  const skinB = { grid: { rowBg: 'var(--fx-surface3)', hoverBg: 'var(--fx-accent-soft)', radius: 'radius.lg' }, tabs: { activeBg: 'var(--fx-accent)', gap: 'dens-gap-lg' } };
  const id = 'builds.rows';
  let saved: Record<string, unknown> = { 'axf.display.fontScale': 1 };
  saved = L.writeInstanceLook(saved, 'grid', id, L.setInstanceLookKey({}, 'rowBg', 'accentSoft', ct), ct);
  const a = L.resolveFromSettings(saved, 'grid', id, skinA, ct);
  const b = L.resolveFromSettings(saved, 'grid', id, skinB, ct);
  eq(a.vars['--fx-inst-row-bg'], 'var(--fx-accent-soft)', 'the own key wins over skin A');
  eq(b.vars['--fx-inst-row-bg'], 'var(--fx-accent-soft)', 'the own key stays under skin B');
  eq([a.vars['--fx-inst-hover-bg'], b.vars['--fx-inst-hover-bg']], ['var(--fx-surface2)', 'var(--fx-accent-soft)'], 'a key the grid did not set restyles with the skin swap');
  eq([a.vars['--fx-inst-radius'], b.vars['--fx-inst-radius']], ['var(--fx-radius-sm)', 'var(--fx-radius-lg)'], 'radius follows the skin swap');
  eq([a.source.rowBg, a.source.hoverBg], ['instance', 'skin'], 'source per key');
  ok(!a.followsSkin, 'an own key = not following the skin');
  const reset = L.resetInstanceLook(saved, 'grid', id);
  eq(reset, { 'axf.display.fontScale': 1 }, 'reset drops only the instance record');
  const back = L.resolveFromSettings(reset, 'grid', id, skinA, ct);
  eq(back, L.resolveInstanceLook('grid', { skin: L.lookFromFamilies('grid', skinA, ct) }, ct), 'after reset the grid resolves to exactly the skin layer');
  ok(back.followsSkin && back.source.rowBg === 'skin', 'after reset every key comes from the skin');
  const tabs = L.resolveFromSettings(L.writeInstanceLook({}, 'tab-group', 'settings.main', { spacing: 'xl' }, ct), 'tab-group', 'settings.main', skinB, ct);
  eq([tabs.bind['--fx-tab-gap'], tabs.vars['--fx-inst-spacing'], tabs.vars['--fx-inst-selected-bg']], ['var(--fx-inst-spacing)', 'var(--fx-dens-gap-xl)', 'var(--fx-accent)'], 'a tab row: own spacing bound to --fx-tab-gap, selected from skin B');
  const empty = L.resolveFromSettings({}, 'tab-group', 'x', null, ct);
  ok(empty.empty && !Object.keys(L.instanceLookStyle(empty)).length, 'no skin values and no record: nothing on the root (the :root defaults stand)');
}

/* ---- phase 2: the CSS reads --fx-inst-* only under a data-fx-inst gate, never with a fallback ---- */
{
  const files = { 'ui/axf.css': readFileSync(join(root, 'ui/axf.css'), 'utf8'), 'libs/datagrid/datagrid.css': readFileSync(join(root, 'libs/datagrid/datagrid.css'), 'utf8') };
  for (const [file, css] of Object.entries(files)) {
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!rule[2].includes('--fx-inst-')) continue;
      const sel = rule[1].trim().split('\n').pop()!.trim();
      ok(/\[data-fx-inst~='[a-zA-Z]+'\]/.test(sel), `${file}: ${sel} reads --fx-inst-* under a data-fx-inst gate`);
      for (const m of rule[2].matchAll(/var\((--fx-inst-[a-z-]+)([^)]*)\)/g)) ok(m[2].trim() === '', `${file}: ${m[1]} has no var() fallback`);
      for (const m of sel.matchAll(/data-fx-inst~='([a-zA-Z]+)'/g)) ok(L.INSTANCE_LOOK_KEY_IDS.includes(m[1] as L.InstanceLookKeyId), `${file}: gate ${m[1]} is a look key`);
    }
  }
  for (const v of ['--fx-grid-font-size', '--fx-tab-font-size', '--fx-grid-border-w']) ok(v in componentTokenDefaults(), `${v} is a component-tokens@1 family token now`);
  ok(files['libs/datagrid/datagrid.css'].includes('font-size: var(--fx-grid-font-size)') && !/border-bottom: var\(--fx-border-w\) solid var\(--fx-grid-/.test(files['libs/datagrid/datagrid.css']), 'the grid reads its font size and line width from its family tokens');
  ok(!/--axf-grid-cols[^;]*--fx-inst-/.test(readFileSync(join(root, 'libs/datagrid/index.tsx'), 'utf8')), 'the look never touches the column template (fixed cell widths)');
}

/* ---- phase 2: CLI round-trip on a scratch look document (framework/cli/instance-look.mjs = axf look) ---- */
{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'axf-look-cli-'));
  mkdirSync(join(dir, 'looks'));
  const file = join(dir, 'looks', 'axf-console.json');
  writeFileSync(file, JSON.stringify({ $axf: 'app-look@1', app: 'axf-console', default: { slots: {}, settings: {} }, own: { settings: {} } }));
  const env = { ...process.env, AXF_APPEARANCE_FILE: join(dir, 'appearance.json'), AXF_LOOKS_DIR: join(dir, 'looks') };
  const cli = (...args: string[]) => { const r = spawnSync('node', [join(root, 'cli/instance-look.mjs'), ...args, '--json'], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
  const doc = () => JSON.parse(readFileSync(file, 'utf8'));
  let r = cli('set', 'grid', 'ui-review.items', 'rowBg=surface2', 'textSize=sm', 'radius=pill');
  eq([r.code, r.out?.look], [0, { rowBg: 'surface2', textSize: 'sm', radius: 'pill' }], 'cli set');
  eq(doc().own.settings['axf.chrome.grid.ui-review.items.look'], { rowBg: 'surface2', textSize: 'sm', radius: 'pill' }, 'cli writes the same settings key the dialog writes');
  r = cli('set', 'grid', 'ui-review.items', 'radius=4px');
  ok(r.code === 2 && /raw/.test(r.err), `cli refuses a raw px (exit 2, says why): ${r.err}`);
  r = cli('set', 'grid', 'ui-review.items', 'rowBg=#123456');
  ok(r.code === 2 && doc().own.settings['axf.chrome.grid.ui-review.items.look'].rowBg === 'surface2', 'cli refuses a raw colour and writes nothing');
  r = cli('list');
  eq(r.out?.map((x: { kind: string; id: string }) => `${x.kind}:${x.id}`), ['grid:ui-review.items'], 'cli list');
  r = cli('reset', 'grid', 'ui-review.items');
  ok(r.code === 0 && r.out?.changed && r.out?.followsSkin && !('axf.chrome.grid.ui-review.items.look' in doc().own.settings), 'cli reset = back to the skin');
  r = cli('undo', 'grid', 'ui-review.items');
  eq(r.out?.look, { rowBg: 'surface2', textSize: 'sm', radius: 'pill' }, 'cli undo puts the record back');
  ok(cli('undo', 'grid', 'ui-review.items').code === 1, 'one undo only');
  r = cli('get', 'tab-group', 'settings.main');
  ok(r.code === 0 && r.out?.followsSkin === true, 'cli get of a row nobody set follows the skin');
  ok(cli('get', 'table', 'x').code === 2, 'cli refuses an unknown kind');
}

if (bad.length) { console.error(`check-instance-look: ${bad.length} of ${n} checks failed`); for (const b of bad) console.error(`  ✗ ${b}`); process.exit(1); }
console.log(`✓ instance-look@1: ${n} checks passed`);
