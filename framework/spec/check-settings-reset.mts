/**
 * settings-reset@1 (core/engines/settings-reset.ts, spec/PLUGIN-SETTINGS.md §4): replays spec/fixtures/settings-reset.json
 * (the Kotlin twin replays the same file) and holds every plan to the contract: a plugin's plan never names a console
 * key or another plugin's, the console's never names a plugin's, look keys are never settings rows, assets are cleared
 * only with the switch, the asset rows are the changed-assets table's rows, and the applied look keeps other owners'
 * scopes. `npx -y tsx framework/spec/check-settings-reset.mts`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_LOOK_SETTING_KEY, LOOK_KEY_PATTERNS, SETTINGS_RESET_ACTION, SETTINGS_RESET_CONTRACT, SETTINGS_RESET_INCLUDE_ASSETS_DEFAULT, SETTINGS_RESET_PLAN_ACTION, SETTINGS_RESET_TABLE_ROWS, applyResetToLook, changedAssets, changedAssetsIn, isLookKey, keyOwner, parseResetScope, planSettingsReset, resetRequestErrors, resetScopeKey, settingsToClear, type ResetPlan, type ResetState } from '../core/engines/settings-reset';

const root = new URL('..', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/settings-reset.json'), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };
const ok = (c: unknown, what: string) => { assert.ok(c, what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(SETTINGS_RESET_CONTRACT, f.contract, 'contract');
eq({ reset: SETTINGS_RESET_ACTION, plan: SETTINGS_RESET_PLAN_ACTION }, f.actions, 'actions');
eq(SETTINGS_RESET_INCLUDE_ASSETS_DEFAULT, f.includeAssetsDefault, 'switch default');
eq(SETTINGS_RESET_TABLE_ROWS, f.tableRows, 'table rows');
eq(LOOK_KEY_PATTERNS.map(String), f.lookKeyPatterns, 'look key patterns');
eq(APP_LOOK_SETTING_KEY, f.appLookKey, 'app look key');
for (const c of f.scopes) { const s = parseResetScope(c.input); eq(s, c.scope, `scope ${JSON.stringify(c.input)}`); eq(s ? resetScopeKey(s) : null, c.key, `scope key ${JSON.stringify(c.input)}`); }
const states: Record<string, ResetState> = Object.fromEntries(Object.entries(f.states as Record<string, ResetState>).map(([k, s]) => [k, { ...s, groups: f.groups, tabs: f.tabs }]));
// names in the fixture come from a lookup the full state carried; replay it
states.full.nameOf = (type, id) => ({ 'color-theme:midnight': 'Midnight', 'skin:amber-glass': 'Amber glass' } as Record<string, string>)[`${type}:${id}`];
for (const c of f.lookKeys) { eq(isLookKey(c.key), c.look, `look key ${c.key}`); eq(keyOwner(c.key, states.full), c.owner, `owner ${c.key}`); }
for (const [name, rows] of Object.entries(f.changed)) eq(changedAssets(states[name]), rows, `changed assets ${name}`);
for (const c of f.plans) eq(planSettingsReset(c.plan.scope, c.plan.includeAssets, states[c.state]), c.plan, `plan ${c.name}`);
const at = '2026-11-17T19:00:00Z';
eq(applyResetToLook(states.full.look!, planSettingsReset({ kind: 'console' }, true, states.full), at), f.applied.console, 'applied console');
eq(applyResetToLook(states.full.look!, planSettingsReset({ kind: 'plugin', id: 'molly-guide' }, true, states.full), at), f.applied.plugin, 'applied plugin');
eq(applyResetToLook(states.full.look!, planSettingsReset({ kind: 'console' }, false, states.full), at), f.applied.untouched, 'applied untouched');
for (const c of f.requestErrors) eq(resetRequestErrors(c.input), c.errors, `request ${JSON.stringify(c.input)}`);

/* ---------- 2. the contract, over every fixture plan ---------- */
const pluginIds = new Set<string>(f.tabs.map((t: { plugin?: string }) => t.plugin).filter(Boolean));
for (const c of f.plans as { name: string; state: string; plan: ResetPlan }[]) {
  const p = c.plan;
  const state = states[c.state];
  for (const r of p.settings) {
    ok(!isLookKey(r.key), `${c.name}: ${r.key} is a look key, never a settings row`);
    const owner = keyOwner(r.key, state);
    if (p.scope.kind === 'console') ok(owner === null, `${c.name}: console plan names a plugin's key ${r.key}`);
    else ok(owner === p.scope.id, `${c.name}: plugin plan names ${r.key} owned by ${owner ?? 'the console'}`);
  }
  for (const k of p.apply.clear) {
    ok(k !== APP_LOOK_SETTING_KEY, `${c.name}: the app-look document is never cleared`);
    if (!p.includeAssets) ok(!isLookKey(k), `${c.name}: look key ${k} cleared without the switch`);
    const owner = keyOwner(k, state);
    ok(p.scope.kind === 'console' ? owner === null : owner === p.scope.id, `${c.name}: clears ${k} outside its scope`);
  }
  for (const r of p.assets) ok(r.scope === resetScopeKey(p.scope), `${c.name}: asset row ${r.type} is in scope ${r.scope}`);
  eq(p.assets, changedAssetsIn(p.scope, state), `${c.name}: asset rows are the changed-assets table's rows`);
  if (!p.includeAssets) { eq(p.apply.look, null, `${c.name}: the look is untouched without the switch`); eq(p.apply.scopes, [], `${c.name}: no scope dropped without the switch`); }
  if (p.scope.kind === 'plugin') ok(p.apply.scopes.every((s) => s === `plugin:${p.scope.kind === 'plugin' ? p.scope.id : ''}`), `${c.name}: a plugin drops only its own scope`);
  else ok(p.apply.scopes.every((s) => !s.startsWith('plugin:')), `${c.name}: the console never drops a plugin's scope`);
  eq(p.empty, !p.apply.clear.length && !p.apply.look, `${c.name}: empty means nothing to do`);
  ok(p.summary.length > 0, `${c.name}: has a summary`);
  eq(p.settings.map((r) => r.key), [...p.settings.map((r) => r.key)].sort(), `${c.name}: settings rows sorted`);
}
// every plugin key in the full state is in exactly one plugin's plan and in no console plan
const consolePlan = planSettingsReset({ kind: 'console' }, true, states.full);
for (const id of pluginIds) {
  const plan = planSettingsReset({ kind: 'plugin', id }, true, states.full);
  for (const k of plan.apply.clear) ok(!consolePlan.apply.clear.includes(k), `console plan also clears ${id}'s ${k}`);
  for (const other of pluginIds) if (other !== id) for (const k of plan.apply.clear) ok(!planSettingsReset({ kind: 'plugin', id: other }, true, states.full).apply.clear.includes(k), `${other}'s plan also clears ${id}'s ${k}`);
}
// applied look: the console keeps every plugin scope, a plugin keeps everything but its own
const appliedConsole = f.applied.console;
ok(Object.keys(appliedConsole.scopes).every((k) => k.startsWith('plugin:')), 'console reset keeps only plugin scopes');
ok(Object.keys(appliedConsole.scopes).length === Object.keys(states.full.look!.scopes!).filter((k) => k.startsWith('plugin:')).length, 'console reset keeps every plugin scope');
eq(appliedConsole.own, {}, 'console reset: own picks back to the snapshot');
eq(appliedConsole.skin.use, false, 'console reset: skin off');
eq(appliedConsole.undo.action, SETTINGS_RESET_ACTION, 'console reset: one undo recorded');
const appliedPlugin = f.applied.plugin;
ok(!('plugin:molly-guide' in appliedPlugin.scopes), 'plugin reset drops its own scope');
eq(Object.keys(appliedPlugin.scopes).sort(), Object.keys(states.full.look!.scopes!).filter((k) => k !== 'plugin:molly-guide').sort(), 'plugin reset keeps every other scope');
eq(appliedPlugin.own, states.full.look!.own, 'plugin reset leaves the app picks alone');
eq(appliedPlugin.skin, states.full.look!.skin, 'plugin reset leaves the app skin alone');
eq(f.applied.untouched, states.full.look, 'settings-only plan leaves the look alone');
// the clean state has nothing to do
const cleanPlan = planSettingsReset({ kind: 'console' }, true, states.clean);
eq([cleanPlan.empty, cleanPlan.summary, cleanPlan.settings, cleanPlan.assets], [true, 'Nothing to reset', [], []], 'clean: nothing to reset');
eq(settingsToClear({ kind: 'console' }, states.clean), [], 'clean: no settings rows');

console.log(`check-settings-reset: ${checks} checks passed`);
