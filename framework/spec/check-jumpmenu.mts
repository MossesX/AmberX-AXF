/**
 * jump-menu@1 (core/engines/jumpmenu.ts, jumpmenu-rules.mjs): replays spec/fixtures/jump-menu.json through the reference
 * engine (the Kotlin twin is deferred, spec/PORTING.md), checks every starter validates with no engine errors, the TS and
 * build-engine validators agree, control@1 `tokens.jump` lists every field and takes per-page paths, the registry entry
 * (optional, shared, not hideable), the default slot, the schema, and the React plumbing (context items, dialog).
 *   npx -y tsx framework/spec/check-jumpmenu.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JUMP_COLLAPSED_KEY, JUMP_FIELDS, JUMP_FIELD_IDS, JUMP_FIELD_LEVELS, JUMP_MENU_FRAME, jumpAxis, jumpCollapsed, jumpConfig, jumpFieldSource, jumpItems, jumpMenuErrors, jumpMenuOutput, jumpMenuPath, jumpMoreSplit, jumpSpy, jumpStep, normalizeJumpMenu, parseJumpCollapsed, withJumpCollapsed } from '../core/engines/jumpmenu';
import { jumpFieldErrors, jumpMenuTokens, jumpMenuSchemaProperties } from '../core/engines/jumpmenu-rules.mjs';
import { controlPaths, controlPathKnown, controlValueErrors, CONTROL_TARGETS, CONTROL_TARGET_IDS } from '../core/engines/control-rules.mjs';
import { CONTROL_TOKEN_SLOTS, effectiveTokenOverrides, withTokenOverride } from '../core/engines/control-tokens.mjs';
import { isAppearanceSetting } from '../core/engines/designpackage';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { hideable } from '../core/engines/hide';
// @ts-expect-error plain .mjs (the build engine's own validator)
import { validateAsset as engineValidate } from '../cli/build-engine.mjs';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/jump-menu.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

/* ---- registry ---- */
eq(f.contract, JUMP_MENU_FRAME, 'contract'); eq(f.fields, JUMP_FIELDS, 'fields');
ok((ASSET_TYPES as readonly string[]).includes('jump-menu') && (OPTIONAL_TYPES as readonly string[]).includes('jump-menu'), 'jump-menu is an optional asset type');
ok(spec.types['jump-menu']?.optional === true && spec.types['jump-menu']?.shared !== false && spec.types['jump-menu']?.hideable === false, 'asset-types.json: optional, shared (every app ships the starters), not a hideable chrome slot');
eq(Object.keys(spec.types['jump-menu'].enums), ['location', 'display', 'variant', 'size', 'density', 'overflow'], 'asset-types.json enums = the registry\'s enum fields');
for (const [k, opts] of Object.entries(spec.types['jump-menu'].enums)) eq(opts, JUMP_FIELDS[k]!.options, `asset-types.json enum ${k} matches the registry`);
ok(JUMP_FIELD_IDS.every((id) => spec.types['jump-menu'].optional_fields[id]), 'every field is documented in asset-types.json');
ok(JUMP_FIELD_IDS.every((id) => ['simple', 'basic', 'developer'].includes(JUMP_FIELD_LEVELS[id]!)), 'every field has a settings level');
eq(defaults['jump-menu'], 'classic-chips', 'defaults.json names the starter');
ok(existsSync(join(root, 'schemas/json/jump-menu.schema.json')), 'JSON schema generated');
const schema = JSON.parse(readFileSync(join(root, 'schemas/json/jump-menu.schema.json'), 'utf8'));
const props = jumpMenuSchemaProperties();
ok(JUMP_FIELD_IDS.every((id) => JSON.stringify(schema.properties.data.properties[id]) === JSON.stringify(props[id])), 'the generated schema carries every field with its default and range');
ok(!hideable('jump-menu'), 'the hide engine never offers Hidden for it (it is per page, not chrome)');

/* ---- starters ---- */
const starterIds = Object.keys(f.starters);
eq(starterIds.sort(), ['bottom-tabs', 'classic-chips', 'floating-pill', 'icon-rail', 'left-rail', 'numbered-outline'], 'six starters');
for (const [id, s] of Object.entries(f.starters) as [string, { normalized: unknown; valid: { ok: boolean }; output: unknown; reduced: unknown; folded: unknown }][]) {
  const a = JSON.parse(readFileSync(join(root, 'assets/jump-menu', `${id}.json`), 'utf8'));
  eq(normalizeJumpMenu(a.data), s.normalized, `${id} normalized`); eq(jumpMenuErrors(a.data), [], `${id} has no errors`); eq(validateAsset(a), s.valid, `${id} validates`);
  ok(s.valid.ok, `${id} is valid`);
  eq(jumpMenuOutput(a.data), s.output, `${id} output`); eq(jumpMenuOutput(a.data, { reducedMotion: true }), s.reduced, `${id} reduced motion`); eq(jumpMenuOutput(a.data, { collapsed: true }), s.folded, `${id} folded`);
  eq(engineValidate(a).errors, [], `${id} build engine agrees`);
}
ok(new Set(starterIds.map((id) => JSON.stringify(f.starters[id].normalized))).size === starterIds.length, 'the starters are distinct');
ok(new Set(starterIds.map((id) => f.starters[id].normalized.location)).size === 5, 'the starters cover every location');
ok(f.starters['floating-pill'].folded.attrs['data-fx-jump-collapsed'] === 'on' && f.starters['classic-chips'].folded.attrs['data-fx-jump-collapsed'] === 'off', 'only a collapsible menu folds');
ok(f.starters['classic-chips'].reduced.attrs['data-fx-jump-smooth'] === 'off' && f.starters['classic-chips'].output.attrs['data-fx-jump-smooth'] === 'on', 'reduced motion turns smooth scrolling off');
ok(!JSON.stringify(Object.values(f.starters).map((s) => (s as { output: unknown }).output)).match(/#[0-9a-f]{3,8}\b|\d+px/i), 'output is theme tokens only, never literal colours or px');

/* ---- normalize, errors, field errors ---- */
for (const n of f.normalize) eq(normalizeJumpMenu(n.raw), n.out, `normalize ${n.name}`);
for (const e of f.errors) eq(jumpMenuErrors(e.raw), e.errors, `errors ${e.name}`);
ok(f.errors.find((e: { name: string }) => e.name === 'bad values').errors.length >= 10, 'bad values are named one by one');
ok(f.normalize.find((n: { name: string }) => n.name === 'collapsed without collapsible').out.collapsed === false, 'collapsed needs collapsible');
eq(f.normalize.find((n: { name: string }) => n.name === 'strings coerced').out.offset, 3, 'a numeric string rounds');
eq(f.normalize.find((n: { name: string }) => n.name === 'sections cleaned').out.sections, [{ id: 'basics', label: 'Basics', icon: 'edit' }, { id: 'steps', label: 'steps' }, { id: 'x', label: 'y' }], 'sections: trimmed, label falls back to the id, duplicates and bad icons dropped');
for (const e of f.fieldErrors) eq(jumpFieldErrors(e.path, e.value), e.errors, `field ${e.path}=${e.value}`);
eq(jumpMenuPath('menu.plan-studio.plan.display'), { menu: 'plan-studio.plan', field: 'display' }, 'per-page path splits on the last dot');
eq(jumpMenuPath('menu.plan-studio.plan.asset'), { menu: 'plan-studio.plan', field: 'asset' }, 'per-page asset path');
ok(jumpMenuPath('menu.x') === null && jumpMenuPath('menu.x.nope') === null && jumpMenuPath('display') === null, 'bad per-page paths are null');

/* ---- config: asset < app-wide < per page ---- */
eq(jumpConfig(JSON.parse(readFileSync(join(root, 'assets/jump-menu/classic-chips.json'), 'utf8')).data, f.config.overrides, 'plan-studio.plan'), f.config.plan, 'config for plan-studio.plan');
eq(f.config.plan.config.location, 'left', 'app-wide override applies to a page without its own');
eq(f.config.plan.config.display, 'numbered', 'the page\'s own override wins');
eq(f.config.plan.asset, 'icon-rail', 'the page picked its asset');
eq(f.config.plan.config.offset, 12, 'a per-page number is clamped');
eq(f.config.other.config.location, 'floating', 'another page\'s own location');
eq(f.config.other.asset, null, 'another page keeps the app\'s asset');
eq(f.config.none.config.display, 'icons-text', 'no page: only app-wide overrides');
eq(f.config.bare.config, normalizeJumpMenu({}), 'nothing: the defaults');
eq(jumpFieldSource(f.config.overrides, 'plan-studio.plan', 'display'), 'menu', 'source: this page');
eq(jumpFieldSource(f.config.overrides, 'plan-studio.plan', 'location'), 'app', 'source: app-wide');
eq(jumpFieldSource(f.config.overrides, 'plan-studio.plan', 'sticky'), 'asset', 'source: the asset');

/* ---- items, spy, more, step, folded ---- */
for (const [d, items] of Object.entries(f.items)) eq(jumpItems(f.config.plan.config.sections.length ? f.config.plan.config.sections : [{ id: 'basics', label: 'Basics', icon: 'edit' }, { id: 'steps', label: 'Steps', icon: 'list' }, { id: 'lists', label: 'Requirements' }, { id: 'notes', label: 'Notes', icon: 'file' }], d as never), items, `items ${d}`);
ok(f.items.icons[2].showText && f.items.icons[2].text === '3', 'icons only: a section without an icon shows its number');
ok(f.items.numbered[0].text === '1. Basics' && f.items.numbered[0].showIcon === false, 'numbered: "1. Basics", no icon');
ok(f.items.text.every((i: { showIcon: boolean }) => !i.showIcon), 'text only: no icons');
for (const c of f.spy.cases) eq(jumpSpy(f.spy.positions, c.scrollTop, c.viewport, c.scrollMax, c.offset), c.active, `spy at ${c.scrollTop}`);
eq(f.spy.cases.map((c: { active: string }) => c.active), ['basics', 'steps', 'steps', 'lists', 'notes', 'notes', 'lists'], 'spy: first before the first, the reading line picks, the end lights the last');
eq(f.spy.empty, null, 'spy: no sections');
for (const m of f.more) eq(jumpMoreSplit(m.widths, m.room, m.more, m.gap), m.out, `more ${m.room}`);
eq(f.more.map((m: { out: unknown }) => m.out), [{ shown: 4, more: false }, { shown: 2, more: true }, { shown: 1, more: true }, { shown: 0, more: false }, { shown: 1, more: true }], 'more: all fit, some fold, at least one always shows');
for (const s of f.step) eq(jumpStep(['basics', 'steps', 'lists', 'notes'], s.current, s.dir), s.out, `step ${s.current} ${s.dir}`);
eq(f.step.map((s: { out: unknown }) => s.out), ['lists', 'basics', 'notes', 'basics', 'notes', 'basics', 'notes'], 'step wraps, Home / End');
eq(f.collapsed.parsed, [{ a: true, b: false }, { a: true }, {}, {}], 'folded map parsed and cleaned');
eq(f.collapsed.with, [{ a: true, b: true }, { b: true }, { x: false }], 'folded map set / dropped');
eq(JUMP_COLLAPSED_KEY, 'axf.jumpmenu.collapsed', 'folded key'); ok(!isAppearanceSetting(JUMP_COLLAPSED_KEY), 'folded state is per device, never shared through the look');
ok(jumpCollapsed({ collapsible: true, collapsed: true }) && !jumpCollapsed({ collapsible: false, collapsed: true }) && !jumpCollapsed({ collapsible: true, collapsed: true }, { collapsed: false }), 'folded: the device beats the asset, never without collapsible');
eq([jumpAxis('top'), jumpAxis('left'), jumpAxis('right'), jumpAxis('bottom'), jumpAxis('floating')], ['row', 'column', 'column', 'row', 'row'], 'axis per location');

/* ---- control@1 tokens.jump: one registry, every field listed, per-page paths by shape, values checked by the same rules ---- */
ok(CONTROL_TARGETS['tokens.jump']?.asset === 'jump-menu' && CONTROL_TOKEN_SLOTS['tokens.jump'].key === 'axf.tokens.jump', 'control@1 tokens.jump → jump-menu, key axf.tokens.jump');
eq(CONTROL_TARGET_IDS[CONTROL_TARGET_IDS.length - 1], 'tokens.jump', 'tokens.jump is appended last (append-only registry)');
eq((controlPaths('tokens.jump') ?? []).map((p: { id: string }) => p.id), JUMP_FIELD_IDS, 'tokens.jump lists every field');
eq(jumpMenuTokens().map((t) => t.kind), JUMP_FIELD_IDS.map((id) => (JUMP_FIELDS[id]!.kind === 'number' ? 'number' : JUMP_FIELDS[id]!.kind === 'boolean' ? 'boolean' : 'enum')), 'token kinds');
eq(controlValueErrors('tokens.jump', 'location', 'floating'), [], 'set location floating'); ok(controlValueErrors('tokens.jump', 'location', 'middle').length === 1, 'refuses an unknown location');
ok(controlPathKnown('tokens.jump', 'menu.plan-studio.plan.location') === true && controlPathKnown('tokens.jump', 'menu.plan-studio.plan.asset') === true && controlPathKnown('tokens.jump', 'menu.plan-studio.plan.nope') === false, 'per-page paths are known by shape');
eq(controlValueErrors('tokens.jump', 'menu.plan-studio.plan.display', 'icons'), [], 'set a page\'s display'); ok(controlValueErrors('tokens.jump', 'menu.plan-studio.plan.asset', 'Not Ok').length === 1, 'refuses a bad asset id');
ok(controlValueErrors('tokens.jump', 'nope', 1).length === 1, 'refuses an unknown field');
ok(isAppearanceSetting(CONTROL_TOKEN_SLOTS['tokens.jump'].key), 'the overrides ride the axHub look');
const doc = withTokenOverride(withTokenOverride(undefined, 'location', 'left'), 'menu.plan-studio.plan.display', 'icons');
eq(effectiveTokenOverrides(doc, 'classic-chips'), { location: 'left', 'menu.plan-studio.plan.display': 'icons' }, 'the override document carries per-page paths as plain keys');

/* ---- React plumbing (source-level: the component file is TSX, checked by the console typecheck + build) ---- */
const tsx = readFileSync(join(root, 'react/components/JumpMenu.tsx'), 'utf8');
ok(tsx.includes("JUMP_CTX_TARGET = 'jump-menu'") && tsx.includes('data-fx-ctx-target') && tsx.includes("'Jump menu settings'") && tsx.includes("'Change jump menu'") && tsx.includes("label: 'Move'"), 'right-click: Jump menu settings / Change jump menu / Move');
ok(tsx.includes("JUMP_SETTINGS_DIALOG = 'jump-menu-settings'") && tsx.includes('SETTINGS_LEVELS') && tsx.includes('jumpMenuDialog'), 'settings dialog with the level bar');
ok(/role="navigation"|<nav /.test(tsx) && !tsx.includes('role="toolbar"') || tsx.includes('data-axf-tap-confirm="off"'), 'the menu is navigation, not a toolbar (single tap jumps)');
ok(readFileSync(join(root, 'react/AppShell.tsx'), 'utf8').includes('...jumpMenuDialog'), 'AppShell registers the dialog');
ok(readFileSync(join(root, 'react/index.ts'), 'utf8').includes("from './components/JumpMenu'"), 'react index exports it');
const css = readFileSync(join(root, 'ui/axf.css'), 'utf8');
ok(css.includes('.fx-jump__item') && css.includes('.fx-jump--chips') && css.includes('.fx-jump--underline') && css.includes('.fx-jump--rail') && css.includes('.fx-jump--pill'), 'axf.css styles every variant');
ok(!/\.fx-jump[^\n]*#[0-9a-f]{3,8}\b/i.test(css), 'jump CSS has no literal colours');
ok(readFileSync(join(root, '../apps/console-web/plugins/plan-studio/web/editor.tsx'), 'utf8').includes('<JumpMenu id="plan-studio.plan"'), 'Plan Studio\'s plan editor is the first consumer');

console.log(`✓ jump-menu@1 — ${checks} checks`);
