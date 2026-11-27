/**
 * page-toolbar@1 check (core/engines/toolbar-rules.mjs, toolbar-migrate.mjs, toolbar-actions.ts): the shared cases
 * (spec/toolbar-actions-cases.ts) replay to exactly what spec/fixtures/toolbar-actions.json holds, every starter
 * toolbar migrates with no visible change, both validators agree on every fixture asset, scope + slot pick the right
 * asset, state gating / badges / toggles / args follow the page state, overflow plans honour priority and
 * never / always / keep, invocations route to the right dispatcher and confirm is asked, the API state is compact.
 *   npx -y tsx framework/spec/check-toolbar-actions.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS, FRAME, LANDER, TOOLBAR_FIXTURE_CASES, toolbarFixtureOutputs } from './toolbar-actions-cases';
import { invokeToolbarButton, resolvePageToolbar, type ResolvedToolbarButton } from '../core/engines/toolbar-actions';
import { migrateToolbar, toolbarMigrationErrors, toolbarSignature } from '../core/engines/toolbar-migrate.mjs';
import { isPageToolbar, toolbarErrors } from '../core/engines/toolbar-rules.mjs';
import { validateAsset } from '../core/validate';
import * as engine from '../cli/build-engine.mjs';

const root = new URL('../', import.meta.url).pathname;
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

const starters = readdirSync(join(root, 'assets/toolbar')).map((f) => JSON.parse(readFileSync(join(root, 'assets/toolbar', f), 'utf8')));
const fx = JSON.parse(readFileSync(join(root, 'spec/fixtures/toolbar-actions.json'), 'utf8'));

/* ---- the contract: the shared cases replay to the golden file ---- */
const now = JSON.parse(JSON.stringify(toolbarFixtureOutputs(TOOLBAR_FIXTURE_CASES, starters)));
for (const section of Object.keys(fx)) eq(now[section], fx[section], `fixture section "${section}" matches the engine (regenerate with npx -y tsx framework/spec/gen-fixtures.mts after an engine change)`);
eq(Object.keys(now).sort(), Object.keys(fx).sort(), 'no fixture section appeared or vanished');

/* ---- migration: every starter keeps its look, and is valid under both validators before and after ---- */
for (const a of starters) {
  const r = migrateToolbar(a);
  eq(toolbarSignature(a.data), toolbarSignature(r.data), `${a.id}: migration draws the same`);
  eq(toolbarMigrationErrors('toolbar', a.data), [], `${a.id}: migration is valid`);
  ok(!isPageToolbar(a.data) || 'scope' in a.data, `${a.id}: a starter is the old shape or says its scope`);
  eq(validateAsset(a).ok, true, `${a.id}: core validator accepts the original`);
  eq(engine.validateAsset(a).ok, true, `${a.id}: build engine accepts the original`);
  eq(validateAsset(r.asset).ok, true, `${a.id}: core validator accepts the migrated asset`);
  eq(engine.validateAsset(r.asset).errors, validateAsset(r.asset).errors, `${a.id}: both validators agree on the migrated asset`);
}
for (const a of ASSETS) {
  const env = { $axf: 'asset@1', type: 'toolbar', id: a.id, name: a.name ?? a.id, version: '1.0.0', data: a.data };
  eq(engine.validateAsset(env).errors, validateAsset(env).errors, `${a.id}: both validators agree`);
  eq(validateAsset(env).ok, true, `${a.id}: a fixture asset is valid`);
}
const bad = { ...LANDER.data, scope: 'page:x', groups: [{ id: 'g', items: [{ id: 'a', action: 'command:gate', enabledWhen: 'a b' }] }] };
eq(engine.validateAsset({ $axf: 'asset@1', type: 'toolbar', id: 'bad', name: 'Bad', version: '1', data: bad }).errors, validateAsset({ $axf: 'asset@1', type: 'toolbar', id: 'bad', name: 'Bad', version: '1', data: bad }).errors, 'both validators report the same errors');
ok(toolbarErrors('toolbar', bad).length >= 3, 'the bad asset is refused');

/* ---- resolve: gating, badges, toggles, args ---- */
const r = fx.resolve;
const running = r['lander running, everything fits'];
eq(running.id, 'gate.auto-lander', 'settings id = <view>.<slot>');
eq(running.address, 'toolbar:gate.auto-lander', 'toolbar address');
eq(running.stateKeys, ['paused', 'selection.id', 'status', 'waiting'], 'state keys read from the asset');
const btn = (t: typeof running, key: string) => t.buttons.find((b: { key: string }) => b.key === key);
eq(btn(running, 'lander/run').badge, '2', 'state badge shows the waiting count');
eq(btn(running, 'lander/run').enabled, true, 'run is enabled while not paused and something waits');
eq(btn(running, 'lander/retry').invocation, { kind: 'command', plugin: 'gate', command: 'lander-retry', input: { build: 'b1' } }, 'args filled from the page state');
eq(btn(running, 'lander/fix').invocation.input, { build: 'b1', mode: 'fix' }, 'literal args kept beside filled ones');
eq(btn(running, 'lander/pause').pressed, false, 'state toggle reads the page state');
eq(btn(running, 'rules/home').enabled, false, 'UAC disable greys the button');
ok(btn(running, 'rules/home').title.includes('requires dev.tools'), 'the title says why');
eq(btn(running, 'rules/home').badge, '3', 'counter badge');
eq(btn(running, 'rules/reset').confirm, 'Reset every rule to the defaults?', 'the confirm question');
eq(btn(running, 'rules/reset').destructive, true, 'destructive flag');
eq(btn(running, 'rules/settings').invocation, { kind: 'control', address: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=gate', verb: 'open', args: {} }, 'a control ref to a tab opens');
eq(btn(running, 'live/w1').origin, 'provider:windows', 'provider buttons carry their origin');
eq(btn(running, 'live/w2').enabled, false, 'a locked provider item is greyed');
eq(running.buttons.filter((b: { group: string }) => b.key.startsWith('live/')).length, 2, 'the provider separator is dropped');
eq(btn(running, 'rules/reset').priority, 10, 'item priority wins over the group default');
eq(btn(running, 'rules/settings').priority, 50, 'group priority is the default for its items');

const paused = r['lander paused, nothing selected'];
eq(btn(paused, 'lander/run').enabled, false, 'run disabled while paused');
eq(btn(paused, 'lander/run').reason, 'not available in this state', 'the reason names the state');
eq(btn(paused, 'lander/run').badge, null, 'a zero state badge is hidden');
eq(btn(paused, 'lander/retry').enabled, false, 'retry needs a selection');
eq(btn(paused, 'lander/pause').pressed, true, 'toggle pressed while paused');

const off = r['lander off: pause hidden'];
eq(off.buttons.some((b: { key: string }) => b.key === 'lander/pause'), false, 'visibleWhen hides the pause button');
eq(off.hidden, [{ key: 'lander/pause', reason: 'hidden by the page state' }], 'hidden buttons are listed with why');

const overridden = r['lander with user overrides and tap off'];
eq(overridden.look.variant, 'icons', 'chrome override changes the look');
eq(overridden.look.density, 'compact', 'density override');
eq(overridden.tapConfirm.enabled, false, 'tap-to-confirm off from the instance settings');
eq(running.tapConfirm.enabled, true, 'tap-to-confirm on by default');

const unwired = r['lander, pause handler not wired, host takes home'];
eq(btn(unwired, 'lander/pause').enabled, false, 'a handler nobody registered is disabled, not dropped');
ok(btn(unwired, 'lander/pause').reason.startsWith('not wired'), 'and says it is not wired');
eq(btn(unwired, 'rules/home'), undefined, 'a hook the host takes is left out');
const locked = r['lander, host locks reset'];
eq(btn(locked, 'rules/reset').reason, 'the host owns the rules', 'a host lock is the reason');
const trusting = r['lander, no registries: everything assumed wired'];
eq(trusting.buttons.every((b: { enabled: boolean }) => b.enabled), true, 'without registries every ref is assumed wired');

eq(r['plugin main toolbar'].id, 'ai.amberx.axf.console.builds-page', 'plugin scope settings id');
eq(r['frame toolbar (old shape) as the app toolbar'].id, 'app', 'the frame toolbar is instance app');
eq(r['frame toolbar lent to a page'].id, 'plan', 'an old-shape asset on a page takes the page id');
eq(btn(r['frame toolbar (old shape) as the app toolbar'], 'file/save').badge, '99+', 'big counters cap at 99+');
eq(btn(r['frame toolbar (old shape) as the app toolbar'], 'file/new').invocation, { kind: 'action', id: 'file.new', spec: 'file.new', args: {} }, 'a bare id is a console action');

/* ---- overflow ---- */
eq(fx.overflow['auto, fits'].more, ['settings'], 'everything fits: nothing in More except the always items');
eq(fx.overflow['auto, fits'].bar.includes('settings'), false, 'overflow always never sits on the bar…');
eq(r['lander running, everything fits'].more, ['settings'], '…even when everything fits');
eq(r['lander running, room for 3'].bar, ['run', 'retry', 'pause'], 'room for 3 keeps the never button and the highest priorities, bar order kept');
eq(r['lander running, room for 3'].more, ['fix', 'reset', 'settings', 'home', 'w1', 'w2'], 'lowest priority folds first (reset 10, home 50, fix 90), then at a tie provider buttons, then the end of the bar');
eq(fx.overflow['never, room for 1'].more, ['settings'], 'never folds only the always items');
eq(fx.overflow['always keep 2'].label, 'Actions', 'the More label');
eq(fx.overflow['always keep 2'].bar, ['run', 'retry', 'pause'], 'always keeps the never button plus the last `keep` to fold (retry and pause, the earliest at priority 100)');
eq(fx.overflow['always keep 0'].bar, ['run'], 'always keep 0 leaves only the never buttons');
ok(fx.overflow['auto keep 3, room for 1'].bar.length === 3, 'keep is a floor under fit');
eq(fx.overflow['default rule'].label, 'More', 'default label');

/* ---- pick ---- */
eq(fx.pick['view + slot'].asset, 'gate-auto-lander', 'view + slot picks the page asset');
eq(fx.pick['view main slot: none'].asset, null, 'a page with no main asset keeps its handwritten bar');
eq(fx.pick['plugin main'].asset, 'builds-main', 'plugin scope matches the plugin');
eq(fx.pick['plugin with its view too'].asset, 'builds-main', 'the view is tried first, then the plugin');
eq(fx.pick['user pick wins'].asset, 'editor-classic-copy', 'the user pick for the slot wins');
eq(fx.pick['user pick of an unknown asset falls back'].asset, 'gate-auto-lander', 'an unknown pick falls back to the scope match');
eq(fx.pick['case-insensitive view'].asset, 'gate-auto-lander', 'view ids match case-insensitively');
eq(fx.pick['unknown page'].asset, null, 'unknown page: nothing');
eq(fx.settingsIds['view:gate / -'], 'gate', 'main slot: the scope id alone');
eq(fx.settingsIds['view:gate / auto-lander'], 'gate.auto-lander', 'slot appended');
eq(fx.settingsIds['app / x'], 'app', 'the frame toolbar is always app');
eq(fx.settingsIds['view:PlanStudio2 / tree'], 'planstudio2.tree', 'ids are lower-cased');

/* ---- invocations ---- */
eq(fx.invocations['control:view:builds'].verb, 'open', 'a view address opens');
eq(fx.invocations['control:view:builds/button:refresh'].verb, 'press', 'a button address presses');
eq(fx.invocations['control:setting:axf.display.fontScale'].verb, 'press', 'a setting address presses');
eq(fx.invocations['swap:layout:next'], { kind: 'action', id: 'swap:layout:next', spec: 'swap:layout:next:b1', args: { build: 'b1' } }, 'args append to an action spec');
eq(fx.invocations['action:plan.focus'].spec, 'plan.focus:b1', 'action: prefix is stripped from the spec');

/* ---- invoke: refusals, confirm, dispatch ---- */
{
  const t = resolvePageToolbar(LANDER, { view: 'gate', slot: 'auto-lander' }, { paused: false, waiting: 1, selection: { id: 'b1' }, status: 'running' }, { get: () => undefined, handlers: ['gate.pause'], gate: (req) => (req === 'dev.tools' ? 'disable' : 'allow') });
  const b = (id: string) => t.groups.flatMap((g) => g.buttons).find((x) => x.id === id) as ResolvedToolbarButton;
  const calls: unknown[] = [];
  const d = {
    action: (spec: string) => { calls.push(['action', spec]); return 'a'; },
    command: (p: string, c: string, i: unknown) => { calls.push(['command', p, c, i]); return { ok: true }; },
    control: (a: string, v: string) => { calls.push(['control', a, v]); return null; },
    handler: (id: string) => { calls.push(['handler', id]); },
  };
  eq((await invokeToolbarButton(b('retry'), d)).ok, true, 'a command button runs its command');
  eq(calls.at(-1), ['command', 'gate', 'lander-retry', { build: 'b1' }], 'with the filled input');
  eq((await invokeToolbarButton(b('pause'), d)).ok, true, 'a handler button runs the page handler');
  eq(calls.at(-1), ['handler', 'gate.pause'], 'by id');
  eq((await invokeToolbarButton(b('settings'), d)).ok, true, 'a control button runs through console-control');
  eq(calls.at(-1), ['control', 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=gate', 'open'], 'with the open verb');
  const home = await invokeToolbarButton(b('home'), d);
  eq(home.ok === false && home.code, 'disabled', 'a disabled button is refused');
  const before = calls.length;
  const reset = await invokeToolbarButton(b('reset'), d);
  eq(reset.ok === false && reset.code, 'confirmation_required', 'a confirm button without a confirmer asks first');
  eq(calls.length, before, 'and runs nothing');
  const declined = await invokeToolbarButton(b('reset'), { ...d, confirm: () => false });
  eq(declined.ok === false && declined.code, 'declined', 'a declined confirm runs nothing');
  const yes = await invokeToolbarButton(b('reset'), { ...d, confirm: async () => true });
  eq(yes.ok, true, 'a confirmed press runs');
  eq(calls.at(-1), ['command', 'gate', 'rules-reset', {}], 'the destructive command');
  const noDispatcher = await invokeToolbarButton(b('pause'), { action: d.action });
  eq(noDispatcher.ok === false && noDispatcher.code, 'unsupported', 'a host without the dispatcher answers unsupported');
  const failing = await invokeToolbarButton(b('retry'), { command: () => { throw new Error('boom'); } });
  eq(failing.ok === false && failing.code === 'failed' && failing.message, 'boom', 'a throwing dispatcher is a failed outcome, never a throw');
  // the API: a destructive button with no question still asks
  const t2 = resolvePageToolbar({ ...FRAME, data: { ...FRAME.data, groups: [{ id: 'g', items: [{ id: 'nuke', icon: 'trash', label: 'Nuke', action: 'file.delete', destructive: true }] }] } }, {}, {}, { get: () => undefined });
  const nuke = t2.buttons[0]!;
  eq((await invokeToolbarButton(nuke, d)).ok, true, 'in the UI a destructive button without confirm runs at once (the tone warns)');
  const api = await invokeToolbarButton(nuke, d, { api: true });
  eq(api.ok === false && api.code, 'confirmation_required', 'through the API a destructive press needs confirm');
  eq((await invokeToolbarButton(nuke, { ...d, confirm: () => true }, { api: true })).ok, true, 'and runs once confirmed');
  const hidden = resolvePageToolbar(LANDER, { view: 'gate', slot: 'auto-lander' }, { status: 'off' }, { get: () => undefined });
  const pause = hidden.groups.flatMap((g) => g.buttons).find((x) => x.id === 'pause')!;
  eq((await invokeToolbarButton(pause, d)).ok === false && (await invokeToolbarButton(pause, d) as { code: string }).code, 'hidden', 'a hidden button is refused');
}

/* ---- API state ---- */
const st = running.state;
eq(st.address, 'toolbar:gate.auto-lander', 'state carries the address');
eq(st.scope, 'view:gate', 'scope as text');
eq(st.buttons.find((b: { id: string }) => b.id === 'settings').inMore, true, 'state says which buttons are in More');
eq(st.buttons.find((b: { id: string }) => b.id === 'reset').confirm, true, 'confirm is a flag in the state, the question stays in the UI');
ok(st.buttons.every((b: { address: string }) => b.address.startsWith('toolbar:gate.auto-lander/button:')), 'every button has its address');

/* ---- starters resolve as actions ---- */
ok(Object.values(fx.starters as Record<string, { resolvedAs: string[] }>).every((s) => s.resolvedAs.every((x) => x.includes('→action:'))), 'every starter button is a console action');
eq(fx.suggest.length, 4, 'suggestions are capped');
eq(fx.suggest[0].ref, 'command:gate/rules-reset', 'write commands come first');
eq(fx.suggest[0].confirm && fx.suggest[0].destructive, true, 'reset is destructive and asks');

console.log(`✓ page-toolbar@1: ${n} checks, ${TOOLBAR_FIXTURE_CASES.length} resolve cases, ${starters.length} starters migrate with the same look`);
