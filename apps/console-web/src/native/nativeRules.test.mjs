// node apps/console-web/src/native/nativeRules.test.mjs — the console side of the Android console app (apps/console-droid)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_ACTIONS, SAFE_TOKENS, UPDATE_VERBS, THEME_TOKENS, isAddress, nativeCall, openTarget, overlayConfig, pageHandlesInsets, parseAnswer, themeTokens,
} from './nativeRules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('deep link: address, action, none, absent', () => {
  const a = openTarget('https://console.amberxai.com/?axf-open=view%3Abuilds&x=1');
  assert.deepEqual(a, { target: 'view:builds', kind: 'address', rest: 'https://console.amberxai.com/?x=1' });
  const b = openTarget('https://console.amberxai.com/?axf-open=approvals.view');
  assert.equal(b.kind, 'action');
  assert.equal(b.rest, 'https://console.amberxai.com/');
  assert.equal(openTarget('https://console.amberxai.com/?axf-open=').kind, 'none');
  assert.equal(openTarget('https://console.amberxai.com/'), null);
  assert.equal(openTarget('not a url'), null);
});

t('address vs action id', () => {
  assert.equal(isAddress('view:builds'), true);
  assert.equal(isAddress('settings:plugins/tab:approvals-banner'), true);
  assert.equal(isAddress('approvals.view'), false);
  assert.equal(isAddress('settings.set:key:value'), false);
  assert.equal(isAddress(':x'), false);
});

t('overlay settings: only the ones set', () => {
  const vals = { 'approvals-banner.overlay.on': true, 'approvals-banner.overlay.top': 40 };
  assert.deepEqual(overlayConfig((k) => vals[k]), { on: true, top: 40 });
  assert.deepEqual(overlayConfig(() => undefined), {});
});

t('theme tokens and safe-area detection', () => {
  const css = { '--fx-surface': ' #101418 ', '--fx-accent': '#f5a524' }; // theme-ok: test data
  assert.deepEqual(themeTokens((k) => css[k] ?? ''), { '--fx-surface': '#101418', '--fx-accent': '#f5a524' }); // theme-ok: test data
  assert.equal(pageHandlesInsets(() => '0px'), true);
  assert.equal(pageHandlesInsets((k) => (k === '--fx-safe-top' ? '' : '0px')), false);
});

t('host answers parse, never throw', () => {
  assert.deepEqual(parseAnswer('{"ok":true,"x":1}'), { ok: true, x: 1 });
  assert.equal(parseAnswer('nope').ok, false);
  assert.equal(parseAnswer(undefined).ok, false);
});

t('native.* actions → host calls', () => {
  assert.deepEqual(nativeCall('native.overlay', ['expand']), { call: 'overlay', args: ['expand'] });
  assert.ok('error' in nativeCall('native.overlay', ['fly']));
  assert.deepEqual(nativeCall('native.permission', ['mic']), { call: 'requestPermission', args: ['mic'] });
  assert.ok('error' in nativeCall('native.permission', ['camera']));
  const no = nativeCall('native.notify', ['Build done', 'PR #12', 'merged']);
  assert.equal(no.call, 'notify');
  assert.deepEqual(JSON.parse(no.args[0]), { id: 'console-Build done', title: 'Build done', text: 'PR #12:merged' });
  assert.ok('error' in nativeCall('native.notify', []));
  // the url keeps its colons; "where" comes after the last "|"
  assert.deepEqual(nativeCall('native.open', ['https', '//console.amberxai.com/x|overlay']), { call: 'openUrl', args: ['https://console.amberxai.com/x', 'overlay'] });
  assert.deepEqual(nativeCall('native.open', ['https', '//console.amberxai.com/']), { call: 'openUrl', args: ['https://console.amberxai.com/', 'app'] });
  assert.ok('error' in nativeCall('native.open', ['https', '//x|moon']));
  assert.deepEqual(nativeCall('native.wake', []), { call: 'wake', args: [] });
  assert.deepEqual(nativeCall('native.recorder', ['start']), { call: 'recorder', args: ['start'] });
  assert.deepEqual(nativeCall('native.state', []), { call: 'state', args: [] });
  assert.deepEqual(nativeCall('native.update', ['reload']), { call: 'update', args: ['reload'] });
  assert.deepEqual(nativeCall('native.update', []), { call: 'update', args: ['check'] });
  assert.ok('error' in nativeCall('native.update', ['install']));
  assert.ok('error' in nativeCall('native.nothing', []));
  for (const a of NATIVE_ACTIONS) assert.ok(a.id.startsWith('native.') && a.label);
});

t('tokens match the Java shell and the framework CSS', () => {
  const java = (f) => readFileSync(join(ROOT, 'apps/console-droid/app/src/main/java/ai/amberx/consoleapp', f), 'utf8');
  for (const v of UPDATE_VERBS) assert.ok(java('UpdateRules.java').includes(`"${v}"`), `UpdateRules has ${v}`);
  for (const tok of SAFE_TOKENS) assert.ok(java('InsetsCss.java').includes(`"${tok}"`), `InsetsCss has ${tok}`);
  for (const tok of THEME_TOKENS) assert.ok(java('ShellTheme.java').includes(`"${tok}"`), `ShellTheme has ${tok}`);
  const css = readFileSync(join(ROOT, 'framework/ui/axf.css'), 'utf8');
  for (const tok of SAFE_TOKENS) assert.ok(css.includes(`${tok}: env(`), `axf.css declares ${tok}`);
  // nothing reads the platform insets directly any more: everything goes through the tokens the shell can set
  assert.equal((css.match(/env\(safe-area-inset-/g) ?? []).length, 4);
  for (const tok of THEME_TOKENS) assert.ok(css.includes(`${tok}:`), `axf.css declares ${tok}`);
  // the bridge methods the console calls exist on the Java side
  const bridge = java('NativeBridge.java');
  for (const m of ['info', 'permissions', 'requestPermission', 'notify', 'cancelNotification', 'openUrl', 'wake', 'overlay', 'overlayState', 'overlayConfigure', 'overlayApprovals', 'theme', 'insets', 'insetsHandled', 'update']) {
    assert.match(bridge, new RegExp(`@JavascriptInterface public String ${m}\\(`), `NativeBridge.${m}`);
  }
});

console.log(`native rules: ${n} checks passed`);
