// node apps/console-web/src/native/nativeRules.test.mjs — the console side of the Android console app (apps/console-droid)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_ACTIONS, SAFE_TOKENS, UPDATE_VERBS, THEME_TOKENS, DEEP_LINK_EVENT, inPageLink, isAddress, startView, nativeCall, openTarget, overlayConfig, pageHandlesInsets, parseAnswer, themeTokens,
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

// console-open-no-reload (Nov 23 2026): a link for a console that is already loaded opens in the page, no reload
t('a console link opens in the running page; anything else is the shell\'s to load', () => {
  const here = 'https://console.amberxai.com/?x=1#top';
  assert.equal(inPageLink('https://console.amberxai.com/?axf-cmd=cq-1a2b-3c&axf-open=view:axhub-apps', here), 'https://console.amberxai.com/?axf-cmd=cq-1a2b-3c&axf-open=view:axhub-apps');
  assert.equal(inPageLink('https://console.amberxai.com/', here), 'https://console.amberxai.com/');
  assert.equal(inPageLink('https://axhub.amberxai.com/auth/admin/approvals', here), '', 'another site');
  assert.equal(inPageLink('https://console.amberxai.com/docs/x', here), '', 'another path');
  assert.equal(inPageLink('https://console.amberxai.com/?axf-cmd=search&q=plan', here), '', 'the search palette link is loaded');
  assert.equal(inPageLink('https://console.amberxai.com/?axf-refresh=abc', here), '', 'a hard refresh is a load');
  assert.equal(inPageLink('::', 'nope'), '');
  assert.equal(DEEP_LINK_EVENT, 'axf-deep-link');
});

t('the screen a deep link starts on', () => {
  assert.equal(startView(openTarget('https://console.amberxai.com/?axf-open=view:axhub-apps')), 'axhub-apps');
  assert.equal(startView(openTarget('https://console.amberxai.com/?axf-open=view:settings/tab:settings.tabs=plugins')), 'settings');
  assert.equal(startView(openTarget('https://console.amberxai.com/?axf-open=approvals.view')), '');
  assert.equal(startView(openTarget('https://console.amberxai.com/?axf-open=button:save')), '');
  assert.equal(startView(null), '');
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


const R = await import('./nativeRules.mjs');
t('an unseen "no" from confirm() is told apart from a person\'s answer', () => {
  const java = (f) => readFileSync(join(ROOT, 'apps/console-droid/app/src/main/java/ai/amberx/consoleapp', f), 'utf8');
  assert.equal(R.dialogUnseen(false, 1), true); assert.equal(R.dialogUnseen(null, 0.2), true);
  assert.equal(R.dialogUnseen(false, 900), false, 'a person took their time: a real no');
  assert.equal(R.dialogUnseen(true, 1), false); assert.equal(R.dialogUnseen('typed', 1), false);
  assert.equal(R.hasDialogs({ features: ['overlay', 'dialogs'] }), true);
  assert.equal(R.hasDialogs({ features: ['overlay'] }), false); assert.equal(R.hasDialogs({ ok: false }), false);
  assert.ok(java('NativeBridge.java').includes('DialogRules.FEATURE') && java('DialogRules.java').includes(`FEATURE = "${R.DIALOG_FEATURE}"`), 'the shell announces the same feature name');
  const a = R.dialogAlert('0.1.0');
  assert.equal(a.key, R.DIALOG_ALERT_KEY); assert.equal(a.severity, 'warning'); assert.match(a.title, /0\.2\.0/); assert.match(a.body, /AXF Console 0\.1\.0/);
  assert.ok(readFileSync(join(ROOT, 'apps/console-droid/app/build.gradle'), 'utf8').includes(`versionName "${R.DIALOG_MIN_APP}"`), 'the app version that first has dialogs');
  for (const m of ['onJsAlert', 'onJsConfirm', 'onJsPrompt']) assert.ok(java('WebHost.java').includes(`public boolean ${m}(`), `WebHost answers ${m}`);
});

t('a card the overlay popped opens that call; anything else the first one waiting', () => {
  const id = 'dfe44a5d-15ab-47bf-8128-9843d37cd6ec';
  assert.equal(R.approvalsOpenSpec({ target: 'approvals.view', id }), `approvals.view:${id}`);
  assert.equal(R.approvalsOpenSpec({ target: 'approvals.view' }), 'approvals.view');
  assert.equal(R.approvalsOpenSpec(null), 'approvals.view');
  assert.equal(R.approvalsOpenSpec({ id: 'x:settings.open' }), 'approvals.view', 'only an approval id rides along');
  const java = (f) => readFileSync(join(ROOT, 'apps/console-droid/app/src/main/java/ai/amberx/consoleapp', f), 'utf8');
  assert.ok(java('OverlayContract.java').includes('"{\\"target\\":" + quote(APPROVALS_TARGET)'), 'the shell sends {target, id}');
});

console.log(`native rules: ${n} checks passed`);
