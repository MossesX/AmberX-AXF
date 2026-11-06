/**
 * Screen layouts (screen-layouts@1): the pure engine (core/engines/screen-layouts.mjs) against its fixture, and the
 * runtime side (core/runtime.ts): declared layouts, the `screen-layouts` live list with one check mark, the actions
 * (pick, show / hide the toolbar, a plugin's own copy, back to shared), the screen-title and layout-toolbar context
 * items, the shared `layout-switcher` toolbar asset, and `installLibraries` declaring a view's layouts.
 * Run: npx -y tsx framework/spec/check-screen-layouts.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import * as cs from '../core/engines/chrome-settings-rules.mjs';
import * as sl from '../core/engines/screen-layouts.mjs';
import { AxfRuntime } from '../core/runtime';
import { validateAsset } from '../core/validate';
import { resolveChecked } from '../core/engines/appmenu';
import { installLibraries } from '../react/library';

const root = new URL('../', import.meta.url).pathname;
let n = 0; const failures: string[] = [];
const ok = (c: unknown, what: string) => { if (c) n += 1; else failures.push(what); };
const eq = (a: unknown, b: unknown, what: string) => { try { deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); n += 1; } catch { failures.push(`${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); } };

const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/screen-layouts.json'), 'utf8'));

/* ---------- engine = fixture ---------- */
eq({ schema: sl.SCREEN_LAYOUTS_SCHEMA, toolbar: sl.LAYOUT_SWITCHER_TOOLBAR, qualified: sl.LAYOUT_SWITCHER_QUALIFIED, provider: sl.SCREEN_LAYOUTS_PROVIDER, min: sl.MIN_LAYOUTS, max: sl.MAX_LAYOUTS, keys: sl.SCREEN_LAYOUT_KEYS, actions: sl.SCREEN_LAYOUT_ACTIONS, ctx: sl.SCREEN_LAYOUT_CTX, starters: sl.STARTER_LAYOUTS, starterDefault: sl.STARTER_DEFAULT, overrides: sl.TOOLBAR_OVERRIDES }, f.spec, 'spec constants');
ok(sl.MIN_LAYOUTS === 3, 'three layouts per screen');
for (const [k, m] of Object.entries<any>(f.manifests)) {
  const c = f.contract[k];
  eq(sl.checkScreens(m, { enforceCount: true, views: ['home'] }), c.strict, `contract ${k} strict`);
  eq(sl.checkScreens(m, { enforceCount: true, views: ['home'], grandfathered: ['home'] }), c.grandfathered, `contract ${k} grandfathered`);
  eq(sl.checkScreens(m, { enforceCount: false }), c.lenient, `contract ${k} lenient`);
  eq(sl.normalizeScreens(m.screens), c.normalized, `normalize ${k}`);
}
ok(f.contract['ok-three'].strict.length === 0 && f.contract['two-layouts'].strict.length === 1 && f.contract['two-layouts'].grandfathered.length === 0 && f.contract['none-declared'].strict.length === 1 && f.contract['none-declared'].grandfathered.length === 0, 'count rule only for new screens');
ok(f.contract['bad-default'].lenient.length === 1 && f.contract['dup-id'].lenient.length === 1 && f.contract['not-an-object'].lenient.length === 1, 'shape rules hold for every plugin');
const three = f.manifests['ok-three'].screens.home;
eq({ 'no-save': sl.resolveScreenLayout(three, null), 'saved-valid': sl.resolveScreenLayout(three, 'compact'), 'saved-unknown': sl.resolveScreenLayout(three, 'nope'), 'no-default-field': sl.resolveScreenLayout({ layouts: three.layouts }, ''), 'bad-default': sl.resolveScreenLayout({ layouts: three.layouts, default: 'zzz' }, ''), 'no-screen': sl.resolveScreenLayout(null, 'compact') }, f.resolution, 'resolution');
const settings = (v: Record<string, unknown>) => (k: string) => v[k] ?? null;
eq({
  'default-hidden': sl.layoutToolbarShown(settings({}), 'home', three),
  'app-wide-on': sl.layoutToolbarShown(settings({ [sl.SCREEN_LAYOUT_KEYS.toolbarDefault]: true }), 'home', three),
  'screen-show': sl.layoutToolbarShown(settings({ [sl.screenToolbarKey('home')]: 'show' }), 'home', three),
  'screen-hide-beats-app': sl.layoutToolbarShown(settings({ [sl.SCREEN_LAYOUT_KEYS.toolbarDefault]: true, [sl.screenToolbarKey('home')]: 'hide' }), 'home', three),
  'no-layouts-never': sl.layoutToolbarShown(settings({ [sl.SCREEN_LAYOUT_KEYS.toolbarDefault]: true, [sl.screenToolbarKey('home')]: 'show' }), 'home', null),
}, f.toolbar, 'toolbar visibility');
ok(f.toolbar['default-hidden'] === false, 'hidden by default');
eq({ rows: sl.layoutMenuItems('home', three, 'standard'), 'rows-none': sl.layoutMenuItems('home', null, ''), 'title-hidden': sl.screenTitleMenu('home', three, false), 'title-shown': sl.screenTitleMenu('home', three, true), 'title-none': sl.screenTitleMenu('home', null, false), 'toolbar-shared': sl.layoutToolbarMenu('home', 'a.b.ok', false), 'toolbar-copy': sl.layoutToolbarMenu('home', 'a.b.ok', true) }, f.menus, 'menus');
ok(f.menus['title-hidden'].some((i: any) => i.label === 'Show layout toolbar') && f.menus['title-shown'].some((i: any) => i.label === 'Hide layout toolbar'), 'title menu toggles the toolbar');
ok(f.menus['toolbar-shared'][0].label === 'Give this plugin its own copy' && f.menus['toolbar-copy'][0].label === 'Go back to the shared toolbar', 'toolbar menu: own copy / back to shared');
const shared = { id: sl.LAYOUT_SWITCHER_TOOLBAR, name: 'Layout switcher', data: { variant: 'icons-labels', align: 'start', showSearch: false, groups: [{ id: 'layouts', provider: 'screen-layouts', items: [] }] } };
eq({
  'copy-id': sl.copyAssetId('ai.amberx.axf.console.example'), 'copy-id-long': sl.copyAssetId('x'.repeat(80)), 'copy-id-empty': sl.copyAssetId(''),
  'parse-fresh': sl.parseToolbarCopy(JSON.stringify(sl.newToolbarCopy('a.b.ok')), 'a.b.ok'), 'parse-edited': sl.parseToolbarCopy({ id: 'ls-a-b-ok', data: { variant: 'icons' } }, 'a.b.ok'), 'parse-bad': sl.parseToolbarCopy('{nope', 'a.b.ok'), 'parse-bad-id': sl.parseToolbarCopy({ id: 'Bad Id!', data: {} }, 'a.b.ok'),
  'resolve-shared': sl.resolveLayoutToolbar(shared, null), 'resolve-fresh-copy': sl.resolveLayoutToolbar(shared, sl.newToolbarCopy('a.b.ok')), 'resolve-edited-copy': sl.resolveLayoutToolbar(shared, { id: 'ls-a-b-ok', data: { variant: 'icons' } }), 'resolve-no-shared': sl.resolveLayoutToolbar(null, sl.newToolbarCopy('a.b.ok')),
}, f.copies, 'copies');
ok(/^[a-z0-9][a-z0-9-]{1,47}$/.test(f.copies['copy-id-long']) && f.copies['resolve-fresh-copy'].data.variant === 'icons-labels' && f.copies['resolve-fresh-copy'].edited === false && f.copies['resolve-edited-copy'].data.variant === 'icons' && f.copies['resolve-edited-copy'].edited === true, 'a copy inherits until edited');
eq({ three: sl.reviewLayoutChoices({ home: three }, 'home'), none: sl.reviewLayoutChoices({ home: three }, 'other'), empty: sl.reviewLayoutChoices({}, 'home'), 'of-manifests': sl.screensOfManifests([f.manifests['ok-three'], f.manifests['none-declared'], { id: 'a.b.second', screens: { home: { layouts: three.layouts.slice().reverse() } } }]) }, f.review, 'UI Review choices');
ok(f.review.three.options.length === 3 && f.review.three.options.filter((o: any) => o.default).length === 1 && f.review.none.disabled && f.review.none.reason === 'no layout variants', 'review: only the three, default marked; disabled without');
eq({
  literal: sl.viewIdsInSource("export const plugin = { views: { home: { title: 'Home', render: () => null }, 'my-page': { title: 'X', render: () => null } }, nav: { items: [] } };"),
  'const-same-file': sl.viewIdsInSource("const VIEW = 'thing';\nexport const plugin = { views: { [VIEW]: { title: 'T', render: () => null } } };"),
  'const-imported': sl.viewIdsInSource("import { VIEW, OTHER as O } from './keys';\nexport const plugin = { views: { [VIEW]: { title: 'T', render: () => null }, [O]: { title: 'O', render: () => null } } };", (p) => (p === './keys' ? "export const VIEW = 'thing';\nexport const OTHER = 'other';" : null)),
  unresolved: sl.viewIdsInSource("export const plugin = { views: { [VIEW]: { title: 'T', render: () => null } } };"),
  nested: sl.viewIdsInSource("views: { a: { title: 'A', render: () => <X views={{ z: 1 }} /> , keywords: ['x', 'y'] }, b: { title: 'B', render: () => null } }"),
  none: sl.viewIdsInSource('export const plugin = { label: "x" };'),
}, f.sources, 'view ids from source');
for (const [k, v] of Object.entries<any>(f.grandfather.cases)) { const [folder, view] = k.split('/'); eq(sl.grandfathered(k === 'none' ? null : f.grandfather.baseline, folder!, view ?? 'home'), v, `grandfather ${k}`); }

/* ---------- the shared toolbar asset ---------- */
{
  const a = JSON.parse(readFileSync(join(root, 'assets/toolbar', `${sl.LAYOUT_SWITCHER_TOOLBAR}.json`), 'utf8'));
  ok(validateAsset(a).ok, 'toolbar/layout-switcher validates');
  ok(a.data.groups.some((g: any) => g.provider === sl.SCREEN_LAYOUTS_PROVIDER), 'its buttons come from the screen-layouts live list');
  ok(a.roll === false, 'never picked by a randomize roll');
}

/* ---------- check mark equality binding ---------- */
{
  const env = { counter: () => 0, setting: (k: string) => (k === 'a' ? 'yes' : undefined), hidden: () => false };
  ok(resolveChecked('setting:a=yes', env) === true && resolveChecked('setting:a=no', env) === false && resolveChecked('setting:missing=', env) === true, 'setting:<key>=<value> compares');
  const am = JSON.parse(readFileSync(join(root, 'spec/fixtures/app-menu.json'), 'utf8'));
  ok(am.checked['setting:a=yes']?.resolved === true && am.checked['setting:a=no']?.resolved === false, 'app-menu fixture carries the equality cases');
}

/* ---------- runtime ---------- */
{
  const read = (t: string) => readdirSync(join(root, 'assets', t)).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(readFileSync(join(root, 'assets', t, x), 'utf8')));
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:screen-layouts' });
  ok(rt.appMenuProviderIds().includes(sl.SCREEN_LAYOUTS_PROVIDER), 'screen-layouts is a built-in live list');
  ok((await rt.loadToolbarProvider(sl.SCREEN_LAYOUTS_PROVIDER, 8)).length === 0, 'empty on a screen without layouts');
  ok(rt.screenLayouts('home') === null && rt.screenLayout('home') === '' && rt.layoutToolbarShown('home') === false, 'nothing declared: no layout, no toolbar');

  // a library declares a view's layouts through installLibraries
  const lib = { id: 'a.b.ok', label: 'Ok', version: '1', views: { home: { title: 'Home', render: () => null, layouts: three.layouts, defaultLayout: 'standard' }, plain: { title: 'Plain', render: () => null } } };
  installLibraries(rt, [lib as never]);
  eq(rt.screenLayouts('home'), { layouts: three.layouts, default: 'standard' }, 'installLibraries declares the view\'s layouts');
  ok(rt.screenLayouts('plain') === null, 'a view without layouts declares none');
  ok(rt.screenLayoutOwner('home') === 'a.b.ok', 'the owner is the library');
  rt.navigate('home');
  ok(rt.screenLayout('home') === 'standard', 'starts on the default');
  const rows = await rt.loadToolbarProvider(sl.SCREEN_LAYOUTS_PROVIDER, 8);
  eq(rows.map((r) => [r.id, r.label, r.action, r.check]), [['layout:compact', 'Compact', 'screen.layout:compact:home', false], ['layout:standard', 'Standard', 'screen.layout:standard:home', true], ['layout:spacious', 'Spacious', 'screen.layout:spacious:home', false]], 'live list: three buttons, one check mark on the default');
  rt.dispatch('screen.layout:compact');
  ok(rt.screenLayout('home') === 'compact' && rt.settings.get(sl.screenLayoutKey('home')) === 'compact', 'pick (current screen) is remembered');
  ok((await rt.loadToolbarProvider(sl.SCREEN_LAYOUTS_PROVIDER, 8)).map((r) => r.check).join() === 'true,false,false', 'the check mark follows the pick');
  rt.dispatch('screen.layout:nope');
  ok(rt.screenLayout('home') === 'compact', 'an unknown layout is ignored');
  rt.dispatch('screen.layout:standard:home');
  ok(rt.screenLayout('home') === 'standard' && rt.settings.get(sl.screenLayoutKey('home')) === null, 'back to the default clears the setting');

  ok(rt.layoutToolbarShown('home') === false, 'layout toolbar hidden by default');
  const title = rt.contextExtras.get(sl.SCREEN_LAYOUT_CTX.title)!('screen-title', 'home');
  ok(title.some((i) => i.label === 'Show layout toolbar') && title.filter((i) => i.action?.startsWith('screen.layout:')).length === 3, 'screen title right-click: the layouts + Show layout toolbar');
  rt.dispatch('screen.layout-toolbar:show:home');
  ok(rt.layoutToolbarShown('home') === true, 'Show layout toolbar shows it');
  ok(rt.contextExtras.get(sl.SCREEN_LAYOUT_CTX.title)!('screen-title', 'home').some((i) => i.label === 'Hide layout toolbar'), 'then the title offers Hide');
  rt.dispatch('screen.layout-toolbar:toggle');
  ok(rt.layoutToolbarShown('home') === false, 'toggle hides it (current screen)');
  rt.setLayoutToolbarShown('home', null); // back to inherit
  rt.setLayoutToolbarDefault(true);
  ok(rt.layoutToolbarShown('home') === true && rt.layoutToolbarShown('plain') === false, 'app-wide switch shows it on screens with layouts only');
  rt.dispatch('screen.layout-toolbar:hide:home');
  ok(rt.layoutToolbarShown('home') === false, 'a screen\'s own Hide beats the app-wide switch');
  rt.dispatch('screen.layout-toolbar:inherit:home'); rt.setLayoutToolbarDefault(false);
  ok(rt.layoutToolbarShown('home') === false, 'inherit + app-wide off = hidden');

  // the shared toolbar and a plugin's copy
  const sharedTb = rt.resolveLayoutToolbar('a.b.ok');
  ok(!!sharedTb && sharedTb.shared && sharedTb.id === sl.LAYOUT_SWITCHER_TOOLBAR, 'a plugin draws the shared layout-switcher asset');
  const tbMenu = rt.contextExtras.get(sl.SCREEN_LAYOUT_CTX.toolbar)!('layout-toolbar', 'a.b.ok');
  ok(tbMenu[0]?.label === 'Give this plugin its own copy', 'toolbar right-click offers its own copy');
  rt.dispatch('screen.layout-toolbar.copy:a.b.ok');
  const copyTb = rt.resolveLayoutToolbar('a.b.ok');
  ok(!!copyTb && !copyTb.shared && copyTb.id === sl.copyAssetId('a.b.ok') && copyTb.inherits === sl.LAYOUT_SWITCHER_TOOLBAR && copyTb.edited === false && JSON.stringify(copyTb.data) === JSON.stringify(sharedTb!.data), 'the copy inherits the shared toolbar until edited');
  ok(rt.contextExtras.get(sl.SCREEN_LAYOUT_CTX.toolbar)!('layout-toolbar', 'a.b.ok')[0]?.label === 'Go back to the shared toolbar', 'then offers going back');
  rt.setLayoutToolbarCopy('a.b.ok', { id: sl.copyAssetId('a.b.ok'), data: { variant: 'icons' } });
  ok(rt.resolveLayoutToolbar('a.b.ok')!.edited === true && rt.resolveLayoutToolbar('a.b.ok')!.data.variant === 'icons', 'an edited copy keeps its own values over the shared ones');
  rt.dispatch('screen.layout-toolbar.shared:a.b.ok');
  ok(rt.resolveLayoutToolbar('a.b.ok')!.shared === true && rt.layoutToolbarCopy('a.b.ok') === null, 'back to the shared toolbar');
  // chrome-settings@1: the toolbar's right-click Settings… reach the switcher; a setting on the shared toolbar reaches
  // every plugin, one on a copy only that plugin, and going back to shared drops the copy's edits
  const sharedKey = cs.CHROME_INSTANCE_KEY('toolbar', sl.LAYOUT_SWITCHER_TOOLBAR);
  ok(cs.chromeTypeOfTarget(sl.SCREEN_LAYOUT_CTX.toolbar) === 'toolbar', 'the layout toolbar is a toolbar to the chrome block');
  ok(rt.layoutToolbarInstance('a.b.ok') === sl.LAYOUT_SWITCHER_TOOLBAR, 'no copy: its settings are the shared toolbar');
  rt.settings.set(sharedKey, { variant: 'labels' });
  ok(rt.resolveLayoutToolbar('a.b.ok')!.data.variant === 'labels' && rt.resolveLayoutToolbar('a.b.other')!.data.variant === 'labels', 'a shared setting reaches every plugin');
  rt.setLayoutToolbarCopy('a.b.ok', sl.newToolbarCopy('a.b.ok'));
  ok(rt.resolveLayoutToolbar('a.b.ok')!.data.variant === 'labels' && rt.resolveLayoutToolbar('a.b.ok')!.edited === false, 'an unedited copy follows the shared settings');
  const copyKey = cs.CHROME_INSTANCE_KEY('toolbar', rt.layoutToolbarInstance('a.b.ok'));
  ok(rt.layoutToolbarInstance('a.b.ok') === sl.copyAssetId('a.b.ok'), 'with a copy: its settings are the copy');
  rt.settings.set(copyKey, { variant: 'icons' });
  ok(rt.resolveLayoutToolbar('a.b.ok')!.data.variant === 'icons' && rt.resolveLayoutToolbar('a.b.ok')!.edited === true, 'a copy setting wins on that plugin and marks it edited');
  ok(rt.resolveLayoutToolbar('a.b.other')!.data.variant === 'labels', 'a copy setting stays on that plugin');
  rt.setLayoutToolbarCopy('a.b.ok', null);
  ok(rt.settings.get(copyKey) === undefined || rt.settings.get(copyKey) === null, 'back to shared drops the copy edits');
  rt.settings.clear(sharedKey);
  eq(rt.screensWithLayouts().map((s) => s.view), ['home'], 'screensWithLayouts lists declared screens');
  rt.undeclareScreenLayouts('a.b.ok');
  ok(rt.screenLayouts('home') === null, 'undeclare drops the module\'s screens');
}

if (failures.length) { for (const x of failures) console.error(`✗ ${x}`); console.error(`check-screen-layouts: ${failures.length} of ${n + failures.length} checks failed`); process.exit(1); }
console.log(`check-screen-layouts: ${n} checks passed`);
