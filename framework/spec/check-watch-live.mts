/*
 * Watch live (watch-live@1): the page-side helper (framework/core/watch-live.ts), the runtime's asset hot swap, the
 * CLI's registry / targets / focus (framework/cli/watch-live.mjs) and the Vite plugin's pure parts.
 *
 *   npx -y tsx framework/spec/check-watch-live.mts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxfRuntime } from '../core/runtime';
import { applyAssetChanges, findFocusTarget, readFocusParams, watchLiveRuntime, withFocusParams, WATCH_LIVE_CONTRACT } from '../core/watch-live';
// @ts-expect-error — plain .mjs without types
import * as cli from '../cli/watch-live.mjs';
// @ts-expect-error — plain .mjs without types
import * as vite from '../cli/watch-live-vite.mjs';
// @ts-expect-error — plain .mjs without types
import { assetChange } from '../cli/dev-server.mjs';

let checks = 0;
const ok = (v: unknown, what: string) => { assert.ok(v, what); checks++; };
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(a, b, what); checks++; };

/* ---------- 1. focus parameters ---------- */
eq(readFocusParams('?axfFocus=.fx-toolbar&axfNote=new%20button'), { selector: '.fx-toolbar', note: 'new button' }, 'focus params');
eq(readFocusParams('?x=1'), null, 'no focus');
eq(readFocusParams('axfFocus=%23main'), { selector: '#main' }, 'no leading ?');
eq(withFocusParams('/preview/s/a/?axfKey=k', { selector: '[data-x="1"]', note: 'n' }), '/preview/s/a/?axfKey=k&axfFocus=%5Bdata-x%3D%221%22%5D&axfNote=n', 'focus added, key kept');
eq(withFocusParams('/preview/s/a/#/settings', { selector: '.x' }), '/preview/s/a/?axfFocus=.x#/settings', 'hash route kept after the query');
eq(withFocusParams('/p/', null), '/p/', 'no focus, same url');
eq(readFocusParams(withFocusParams('/p/?a=b', { selector: '.a > .b', note: 'x y' }).split('/p/')[1]!), { selector: '.a > .b', note: 'x y' }, 'round trip');
const fakeRoot = { querySelector: (s: string) => { if (s === '((') throw new Error('bad'); return s === '.hit' ? ({ id: 'hit' } as unknown as Element) : null; } } as ParentNode;
eq(findFocusTarget(fakeRoot, '.hit'), { id: 'hit' }, 'finds');
eq(findFocusTarget(fakeRoot, '(('), null, 'bad selector finds nothing, no throw');
eq(findFocusTarget(fakeRoot, undefined), null, 'no selector');

/* ---------- 2. asset hot swap in the runtime (no reload, active choice kept) ---------- */
const root = new URL('..', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'wl', name: 'WL' }, defaults } as never, assets, storageKey: `axf-test:${Math.random()}` });
ok(watchLiveRuntime() === (rt as unknown), 'the runtime announces itself for the helper');
const active = rt.asset('color-theme');
const before = rt.compileStyles().vars;
const rev = rt.state.rev;
const edited = JSON.parse(JSON.stringify(active));
const tokenKey = 'accent';
ok(typeof edited.data.tokens?.accent === 'string', 'the active colour theme has an accent token to edit');
edited.data.tokens.accent = edited.data.tokens.accent.toLowerCase() === '#123456' ? '#654321' : '#123456';
const activeBefore = rt.state.active;
const res = applyAssetChanges(rt, [{ type: 'color-theme', id: active.id, action: 'changed', ok: true, raw: edited }]);
eq(res, { applied: 1, reload: false, errors: [] }, 'applied without a reload');
eq(rt.state.active['color-theme'], active.id, 'still the same active theme');
ok(rt.state.rev > rev, 'listeners told (recompile)');
ok(rt.state.active !== activeBefore, 'a fresh active map, so the provider re-applies the compiled tokens');
eq((rt.asset('color-theme').data as { tokens: Record<string, unknown> }).tokens[tokenKey], edited.data.tokens[tokenKey], 'the active theme now has the edit');
ok(JSON.stringify(rt.compileStyles().vars) !== JSON.stringify(before), 'compiled tokens changed');
const bad = applyAssetChanges(rt, [{ type: 'color-theme', id: active.id, action: 'changed', ok: false }]);
eq([bad.applied, bad.reload, bad.errors.length], [0, false, 1], 'an invalid edit keeps the last good version');
eq(applyAssetChanges(rt, [{ type: 'toolbar', id: 'x', action: 'removed', ok: true }]).reload, true, 'a removed asset reloads');
eq(applyAssetChanges(null, [{ type: 'toolbar', id: 'x', action: 'changed', ok: true, raw: {} }]).reload, true, 'no runtime on the page: reload');
const invalid = rt.hotReplaceAsset({ type: 'color-theme', id: active.id }, 'watch-live');
eq(invalid.ok, false, 'hotReplaceAsset validates');

/* ---------- 3. targets, registry, focus (CLI) ---------- */
eq(cli.CONTRACT, WATCH_LIVE_CONTRACT, 'one contract name');
eq(cli.touchedApps(['apps/console-web/plugins/build-manager/web/ui.tsx', 'framework/assets/toolbar/x.json', 'README.md']), ['console-web', 'framework'], 'touched apps');
eq(cli.touchedApps(['apps/console/app/src/main/assets/axf/assets/toolbar/t.json', 'apps/amberx-droid/android/app/x.java', 'apps/amberx-droid/src/App.tsx']), ['amberx-droid', 'console'], 'android shell + AmberX web layer (not its native folder)');
eq(cli.touchedApps(['framework/templates/react-ts/src/App.tsx', 'framework/boilerplates/notes/x.json']), ['framework'], 'templates + boilerplates render through the framework shell');
for (const app of ['console-web', 'axhub-web', 'amberx-droid', 'patches-web', 'walkthrough-studio', 'demo', 'framework', 'console', 'axhub-android', 'voicevault']) ok(cli.TARGETS.some((t: { app: string }) => t.app === app), `target ${app}`);
ok(cli.TARGETS.filter((t: { android?: boolean }) => t.android).every((t: { kind: string; assets?: unknown }) => t.kind === 'shell' && t.assets), 'android targets render their assets through the web shell');
eq(cli.guessSelector('apps/console-web/src/assets/toolbar/main.json'), '[class*="fx-toolbar"]', 'asset → its control');
eq(cli.guessSelector('apps/console-web/plugins/build-manager/web/ui.tsx'), '[class*="axp-build-manager"], [class*="build-manager"]', 'plugin → its classes');

const tmp = mkdtempSync(join(tmpdir(), 'axf-wl-'));
try {
  const dir = join(tmp, 'registry');
  cli.writeEntry(dir, { session: 'axf-one', worktree: '/w', branch: 'b', host: '127.0.0.1', apps: { demo: { status: 'ready', port: 1 } } });
  eq(cli.listEntries(dir).map((e: { session: string }) => e.session), ['axf-one'], 'registry lists a fresh entry');
  eq(cli.listEntries(dir, Date.now() + cli.STALE_MS + 1), [], 'stale entries are gone');
  writeFileSync(join(dir, 'broken.json'), '{');
  eq(cli.listEntries(dir).length, 1, 'broken files skipped');
  assert.throws(() => cli.writeEntry(dir, { session: '../x' }), /session name/); checks++;
  cli.removeEntry(dir, 'axf-one');
  eq(cli.listEntries(dir), [], 'removed');
  eq(cli.registryDir({ AXF_PREVIEW_REGISTRY: dir }), dir, 'registry dir from the environment');

  const wt = join(tmp, 'wt');
  mkdirSync(join(wt, 'apps', 'demo', 'src'), { recursive: true });
  mkdirSync(join(wt, 'apps', 'console-web', 'plugins', 'build-manager'), { recursive: true });
  writeFileSync(join(wt, 'apps', 'demo', 'src', 'App.tsx'), '');
  writeFileSync(join(wt, 'apps', 'console-web', 'plugins', 'build-manager', 'ui.tsx'), '');
  utimesSync(join(wt, 'apps', 'demo', 'src', 'App.tsx'), new Date(1_000_000), new Date(1_000_000));
  const auto = cli.autoFocus(wt, ['apps/demo/src/App.tsx', 'apps/console-web/plugins/build-manager/ui.tsx']);
  eq([auto.app, auto.auto, auto.note], ['console-web', true, 'editing apps/console-web/plugins/build-manager/ui.tsx'], 'auto focus = the most recently edited file');
  eq(cli.autoFocus(wt, ['apps/console-web/server/previews.py', 'apps/demo/README.md']), null, 'server code and docs are never auto-focused');
  const { focus, known } = cli.writeFocus(wt, { app: 'demo', route: '#/settings', selector: '.fx-btn', note: 'new button' });
  eq([focus.app, known], ['demo', true], 'axf focus writes the focus file');
  eq(cli.readFocusFile(wt).selector, '.fx-btn', 'focus file read back');
  eq(vite.readFocus(join(wt, cli.FOCUS_FILE), 'demo').note, 'new button', 'the preview of that app sees it');
  eq(vite.readFocus(join(wt, cli.FOCUS_FILE), 'axhub-web'), null, 'another app does not');
  ok(cli.writeFocus(wt, { app: 'nope' }).known === false, 'an unknown app is written but flagged');
  assert.throws(() => cli.writeFocus(wt, { app: '' }), /Usage/); checks++;

  /* ---------- 4. the Vite plugin's pure parts + dev-server reuse ---------- */
  const assetsDir = join(tmp, 'app', 'src', 'assets');
  mkdirSync(join(assetsDir, 'color-theme'), { recursive: true });
  const file = join(assetsDir, 'color-theme', `${active.id}.json`);
  writeFileSync(file, JSON.stringify(edited));
  ok(vite.isAssetFile(file, [assetsDir]), 'asset file recognised');
  ok(!vite.isAssetFile(join(tmp, 'app', 'src', 'App.tsx'), [assetsDir]), 'code is not an asset');
  ok(!vite.isAssetFile(join(tmp, 'app', 'src', 'assets-other', 'x.json'), [assetsDir]), 'a sibling folder with the same prefix is not');
  const change = assetChange(file, 'changed');
  eq([change.type, change.id, change.ok, change.raw.data.tokens[tokenKey]], ['color-theme', active.id, true, edited.data.tokens[tokenKey]], 'dev-server change record carries the asset');
  writeFileSync(file, '{ broken');
  eq(assetChange(file, 'changed').ok, false, 'broken JSON is not sent');
  eq(assetChange(file, 'removed'), { type: 'color-theme', id: active.id, action: 'removed', ok: true }, 'removed');
  const sent: unknown[] = [];
  writeFileSync(file, JSON.stringify(edited));
  const plugin = vite.axfWatchLive({ app: 'demo', worktree: wt, assetsDirs: [assetsDir] });
  eq(plugin.handleHotUpdate({ file, server: { ws: { send: (m: unknown) => sent.push(m) } } }), [], 'asset edits never reload the page');
  eq((sent[0] as { event: string }).event, 'axf:asset', 'sent as an axf:asset HMR event');
  eq(plugin.handleHotUpdate({ file: join(tmp, 'app', 'src', 'App.tsx'), server: { ws: { send: () => {} } } }), undefined, 'code goes through normal HMR');
  ok(plugin.transformIndexHtml.handler('<html><body></body></html>').includes(`src="${vite.CLIENT_ID}"`), 'the helper is injected into the page');
  ok(vite.clientSource({ assetsServer: true }).includes('installWatchLive({ base: import.meta.env.BASE_URL, hot: import.meta.hot, assetsServer: true })'), 'client boots the framework helper');
  const baked = join(wt, 'apps', 'demo', 'src', 'axf') + '/';
  eq(vite.liveFrameworkPath(`${baked}core/runtime.ts?v=1`, baked, root.replace(/\/$/, '')), `${root.replace(/\/$/, '')}/core/runtime.ts?v=1`, 'baked framework → live framework');
  eq(vite.liveFrameworkPath(`${baked}libs/x.ts`, baked, root), null, 'only core/react/ui/schemas');
  eq(vite.liveFrameworkPath('/elsewhere/core/runtime.ts', baked, root), null, 'other files untouched');
  const cfg = cli.wrapperConfig({ app: 'demo', appDir: '/w/apps/demo', base: '/preview/s/demo/', host: '127.0.0.1', port: 5, plugin: 'file:///x.mjs' });
  ok(cfg.includes('loadConfigFromFile') && cfg.includes('"base": "/preview/s/demo/"') && cfg.includes('strictPort: true'), 'wrapper config keeps the app config, sets the base and the port');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`✓ watch-live@1 — ${checks} checks (focus params, asset hot swap, registry, targets, focus file, Vite plugin)`);
