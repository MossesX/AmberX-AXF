/**
 * inherit@1 + app-style@1 (build app-style-override): the inherit / override rule, how a local look change is
 * filtered (auto-override, own values, palette), Save to axHub + Restore, and the console runner end to end on a
 * scratch look document. `npx -y tsx framework/spec/check-app-style.mts`
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { autoOverride, inheritNote, inheritValue, normalizeFlags, normalizeParts, partsOf, resolveInherited } from '../core/engines/inherit.mjs';
import {
  APP_STYLE_HISTORY_KEY, APP_STYLE_HISTORY_MAX, APP_STYLE_PACKAGE_OVERRIDES, appStyleKey, appStyleOf, appStyleView, appsFollowing, emptyLookChange,
  filterLookChange, heldKey, heldSlot, hubStyleValues, isStyleSource, normalizeAppStyle, restorePreviousChange, saveToHubChange, serializeAppStyle,
  styleHistory, withPartOverride,
} from '../core/engines/app-style.mjs';
import { bannerTokens, colorThemeVars, BANNER_TYPES, bannerToken } from '../core/engines/theme.ts';

let n = 0; let bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.error(`FAIL ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

/* ---- inherit@1 ---- */
const parts = normalizeParts([{ id: 'a', label: 'A', slots: ['s1', 'shared'], keys: ['k1'] }, { id: 'b', slots: ['s2', 'shared'], keys: [] }, { id: 'a' }, { id: 'Bad!' }]);
eq(parts.map((p) => p.id), ['a', 'b'], 'parts: duplicates and bad ids dropped');
eq(partsOf(parts, 'slot', 'shared'), ['a', 'b'], 'a value may belong to two parts');
eq(normalizeFlags({ a: true, b: 'yes', c: true }, parts), { a: true }, 'flags: only true, only known parts');
eq(inheritValue('x', 'y', false).value, 'x', 'inheriting shows the source');
eq(inheritValue('x', 'y', true).value, 'y', 'overriding shows the own value');
eq(inheritValue('x', undefined, true).value, 'x', 'overriding with no own value shows the source');
const r = resolveInherited(parts, { a: true }, { slots: { s1: 'S1', s2: 'S2' }, keys: { k1: 1 } }, { slots: { s1: 'O1', s2: 'O2' }, keys: { k1: 2 } });
eq(r.values, { slots: { s1: 'O1', s2: 'S2' }, keys: { k1: 2 } }, 'resolve: part a own, part b source');
ok(r.rows.find((x) => x.name === 's1').differs, 'resolve: row says it differs');
eq(autoOverride(parts, {}, [{ kind: 'slot', name: 's2' }]).switched, ['b'], 'an edit switches its part on');
eq(autoOverride(parts, {}, [{ kind: 'slot', name: 's2' }], { isSource: true }).switched, [], 'the source never overrides itself');
ok(inheritNote({ from: 'own', source: 'Hub Night' }, 'axHub').includes('Overriding axHub (axHub: Hub Night)'), 'note: overriding with the source value');
eq(inheritNote({ from: 'source' }, 'axHub'), 'Inherited from axHub', 'note: inherited');

/* ---- app-style@1 ---- */
ok(isStyleSource('axhub-web') && !isStyleSource('molly'), 'axHub web is the style source');
eq(normalizeAppStyle({ design: true, colors: 'x', own: { slots: { 'style-theme': 'glass-orbit', layout: 'x', 'color-theme': 'Bad Id' }, keys: { 'axf.tokens.style': { '*': { radius: 4 } }, 'axf.other': 1 } } }),
  { $axf: 'app-style@1', design: true, own: { slots: { 'style-theme': 'glass-orbit' }, keys: { 'axf.tokens.style': { '*': { radius: 4 } } } } }, 'normalize drops unknown slots, keys and bad ids');
const designOn = normalizeAppStyle({ design: true });
ok(heldSlot(designOn, 'style-theme') && heldSlot(designOn, 'design-package') && !heldSlot(designOn, 'color-theme'), 'design holds the style theme and the package, not the colours');
ok(heldKey(designOn, APP_STYLE_PACKAGE_OVERRIDES) && !heldKey({}, APP_STYLE_PACKAGE_OVERRIDES), 'the package overrides are held while any part overrides');
eq(serializeAppStyle({}), null, 'nothing overriding = the key is cleared');

// filter: an inheriting app edits its colour theme → colours override, nothing of it reaches axHub
let f = filterLookChange({ slots: { 'color-theme': 'neon-tide', layout: 'focus-top' }, palette: { bg: '#000' } }, {}, {});
eq(f.switched, ['colors'], 'editing the colour theme switches colours on');
eq(f.change, { slots: { layout: 'focus-top' } }, 'the colour theme and palette stay here; the layout still goes to axHub');
eq(f.style.own.slots['color-theme'], 'neon-tide', 'the pick is recorded as the app\'s own');
f = filterLookChange({ slots: { 'color-theme': 'neon-tide' } }, {}, { isSource: true });
eq([f.switched, f.change.slots], [[], { 'color-theme': 'neon-tide' }], 'in axHub itself the pick is axHub\'s look');
f = filterLookChange({ settings: { 'axf.tokens.style': { '*': { radius: 2 } }, 'axf.banners.x': 1 } }, {}, {});
eq([f.switched, f.change.settings], [['design'], { 'axf.banners.x': 1 }], 'a style token edit switches design on; other look settings pass');
f = filterLookChange({ settings: { 'axf.tokens.style': null } }, { design: true, own: { keys: { 'axf.tokens.style': { '*': { radius: 2 } } } } }, {});
eq(f.style.own.keys, {}, 'clearing a held token set clears the own value');
f = filterLookChange({ settings: { [APP_STYLE_PACKAGE_OVERRIDES]: { 'style-theme': 'x' } } }, { colors: true }, {});
ok(emptyLookChange(f.change), 'the package overrides stay local while a part overrides');
f = filterLookChange({ slots: { 'design-package': 'hub-default' } }, {}, {});
eq(f.switched.sort(), ['colors', 'design'], 'picking a design package overrides both parts');

// own values on/off
const on = withPartOverride({}, 'design', true, { slots: { 'style-theme': 'glass-orbit', 'color-theme': 'neon-tide', 'design-package': 'hub-default' }, keys: { 'axf.tokens.style': { '*': { radius: 3 } } } });
eq(on.own, { slots: { 'style-theme': 'glass-orbit', 'design-package': 'hub-default' }, keys: { 'axf.tokens.style': { '*': { radius: 3 } } } }, 'switching design on keeps what the app shows now as its own');
eq(withPartOverride(on, 'design', false), { $axf: 'app-style@1', own: { slots: {}, keys: {} } }, 'switching it off forgets the own values');

// save to axHub + restore
const doc = { $axf: 'appearance@1', slots: { 'style-theme': 'soft-studio', 'color-theme': 'hub-night', 'design-package': 'hub-default' }, settings: { 'axf.tokens.theme': { '*': { accent: '#f00' } }, [appStyleKey('molly')]: { design: true } } };
const s = saveToHubChange(doc, ['colors'], { slots: { 'color-theme': 'neon-tide' }, keys: {} }, { appId: 'axf-console', by: 'brett', at: '2026-11-04T00:00:00Z' });
eq(s.change.slots, { 'color-theme': 'neon-tide' }, 'save writes the colour theme');
eq(s.change.settings[APP_STYLE_PACKAGE_OVERRIDES], { 'color-theme': 'neon-tide' }, '…also as the package override, so the loaded package doesn\'t beat it');
eq(s.change.settings['axf.tokens.theme'], null, '…and the app\'s colour tokens (none = cleared)');
eq(styleHistory({ settings: { [APP_STYLE_HISTORY_KEY]: s.change.settings[APP_STYLE_HISTORY_KEY] } })[0].slots, { 'color-theme': 'hub-night' }, 'the previous colour theme is in the history');
const after = { ...doc, slots: { ...doc.slots, ...s.change.slots }, settings: { ...doc.settings, ...s.change.settings } };
const back = restorePreviousChange(after);
eq(back.change.slots, { 'color-theme': 'hub-night' }, 'restore brings the previous colour theme back');
eq(back.change.settings['axf.tokens.theme'], { '*': { accent: '#f00' } }, '…and its tokens');
eq(back.change.settings[APP_STYLE_HISTORY_KEY], null, '…and drops the entry');
eq(restorePreviousChange(doc), null, 'nothing to restore = null');
let hd = doc;
for (let i = 0; i < APP_STYLE_HISTORY_MAX + 3; i++) { const c = saveToHubChange(hd, ['design'], { slots: { 'style-theme': `s-${i}` } }, { at: `t${i}` }); hd = { ...hd, settings: { ...hd.settings, ...c.change.settings } }; }
eq(styleHistory(hd).length, APP_STYLE_HISTORY_MAX, 'the history keeps the newest five');
let threw = false; try { saveToHubChange(doc, [], {}); } catch { threw = true; }
ok(threw, 'saving nothing is refused');
eq(appsFollowing(doc, ['design']).map((a) => a.id), ['axf-console', 'axhub-web', 'amberx-droid', 'walkthrough-studio'], 'Molly overrides design, so a design save leaves it alone');
const view = appStyleView(doc, 'molly', hubStyleValues(doc), null);
ok(view.parts[0].overriding && !view.parts[1].overriding, 'view: molly overrides design, inherits colours');
eq(appStyleOf(doc, 'axf-console').design, undefined, 'an app without a key inherits');

/* ---- banner tokens ---- */
const hub = JSON.parse(readFileSync(new URL('../assets/color-theme/hub-night.json', import.meta.url), 'utf8')).data;
const vars = colorThemeVars(hub);
for (const t of BANNER_TYPES) ok(vars[`--fx-banner-${t}`], `hub-night compiles --fx-banner-${t}`);
eq(bannerTokens({ info: '#1', success: '#2', warning: '#3', danger: '#4', accent: '#5', muted: '#6' })[bannerToken('error')], '#4', 'a theme without banner tokens gets them from the status colours');
const seen = new Set(['info', 'success', 'warning', 'error', 'build', 'merge', 'ai'].map((t) => vars[`--fx-banner-${t}`]));
eq(seen.size, 7, 'hub-night: the seven coloured banner types are all different');

/* ---- the console runner on a scratch document ---- */
const dir = mkdtempSync(join(tmpdir(), 'app-style-'));
const file = join(dir, 'appearance.json');
const runner = fileURLToPath(new URL('../../apps/console-web/plugins/app-style/appstyle.mjs', import.meta.url));
const run = (args, env = {}) => { try { return JSON.parse(execFileSync('node', [runner, ...args, '--json'], { env: { ...process.env, AXF_APPEARANCE_FILE: file, AXF_APP_STYLE_DATA_DIR: dir, AXF_APPROVER: '', ...env }, encoding: 'utf8' }).trim().split('\n').pop()); } catch (e) { return JSON.parse(String(e.stdout).trim().split('\n').pop()); } };
try {
  run(['reload', '--app', 'molly']);
  let g = run(['get']);
  ok(g.ok && g.apps.length >= 4, 'runner get lists the apps');
  let o = run(['override', '--app', 'molly', '--part', 'colors', '--on', '--theme', 'neon-tide']);
  ok(o.ok && o.parts.find((p) => p.id === 'colors').overriding, 'runner override on');
  eq(o.parts.find((p) => p.id === 'colors').values.find((v) => v.name === 'color-theme').own, 'neon-tide', 'runner override records the theme');
  ok(run(['override', '--app', 'molly', '--part', 'colors', '--on', '--theme', 'nope']).code === 'not_found', 'runner refuses an unknown theme');
  ok(run(['override', '--app', 'axhub-web', '--part', 'design', '--on']).code === 'invalid', 'runner: axHub never overrides itself');
  ok(run(['save', '--app', 'molly', '--parts', 'colors']).code === 'denied', 'runner: save without Brett is denied');
  const sv = run(['save', '--app', 'molly', '--parts', 'colors'], { AXF_APPROVER: 'Brett' });
  ok(sv.ok && JSON.parse(readFileSync(file, 'utf8')).slots['color-theme'] === 'neon-tide', 'runner: Brett saves molly\'s colours to axHub');
  ok(!sv.apps.find((a) => a.app === 'molly').parts.find((p) => p.id === 'colors').overriding, 'runner: the saved part follows axHub again');
  ok(run(['restore']).code === 'denied', 'runner: restore without Brett is denied');
  ok(run(['restore'], { AXF_APPROVER: 'Brett' }).ok && !JSON.parse(readFileSync(file, 'utf8')).slots?.['color-theme'], 'runner: restore takes the save back');
  run(['override', '--app', 'molly', '--part', 'design', '--on']);
  run(['reload', '--app', 'molly', '--reset']);
  ok(!JSON.parse(readFileSync(file, 'utf8')).settings?.[appStyleKey('molly')], 'runner: reload --reset drops the app\'s overrides');
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`${n - bad}/${n} app-style checks passed`);
if (bad) process.exit(1);
