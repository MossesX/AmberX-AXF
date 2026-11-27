#!/usr/bin/env node
/**
 * settings-sources@1 checks: the registry is sound, the tree passes, and the CI check (framework/cli/check-settings-sources.mjs)
 * fails on each thing it is there to stop: an alias registered or stored again, two settings with one wording, a key
 * name in two stores, a screen that keeps its own copy or brings back a retired wording.
 *   node framework/spec/check-settings-sources.mjs
 */
import { audit, wordKey } from '../cli/settings-audit.mjs';
import { check, loadRegistry, probe, screenSources } from '../cli/check-settings-sources.mjs';

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const rules = (f) => f.map((x) => x.rule);

const reg = loadRegistry(); const a = audit();
ok(reg.$axf === 'settings-sources@1' && reg.sources.length >= 4 && reg.files.length >= 2, 'the registry loads: the framework\'s file and the parts plugins ship');
ok(reg.sources.every((s) => s.id && s.label && s.store?.file && s.store?.key && s.meaning && s.edit?.length && s.read?.length), 'every source says where it is stored and how it is read and set without the UI');
ok(reg.sources.every((s) => (s.aliases ?? []).every((al) => al.key && al.store && al.module && al.migration)), 'every alias names its old store and its migration');
const real = check(reg, a, screenSources());
ok(real.length === 0, `the tree passes: ${JSON.stringify(real.slice(0, 3))}`);
ok(probe().length === 0, 'the engines never store an alias (probed in a scratch store)');
ok(a.counts.registry > 30 && a.counts.storeKeys > 200 && a.stores.some((s) => s.file === 'framework/cli/build-limit.mjs' && s.keys.includes('maxBuilds')), 'the audit finds the registry and the module stores');
ok(wordKey('Max parallel builds') === wordKey('Parallel builds (max)') && wordKey('Builds at once') !== wordKey('Sessions per account'), 'wording is compared by its content words');

const clone = (x) => JSON.parse(JSON.stringify(x));
// an alias comes back as a registered setting
{ const b = clone(a); b.registry.push({ key: 'builds.maxParallel', label: 'Parallel builds', file: 'registry.json' }); ok(rules(check(reg, b)).includes('registered-twice'), 'a retired alias registered again fails'); }
// a new key under the wording of a merged setting, or under a retired wording
{ const b = clone(a); b.registry.push({ key: 'builds.cap', label: 'Builds at once', file: 'registry.json' }); ok(rules(check(reg, b)).includes('registered-twice'), 'a second key with the one wording fails'); }
{ const b = clone(a); b.framework.push({ key: 'axf.agents.max', label: 'Max running agents', file: 'x.tsx' }); ok(rules(check(reg, b)).includes('registered-twice'), 'a retired wording on a new key fails'); }
// two registered settings with the same label
{ const b = clone(a); b.sameWords.push({ words: 'x', items: [{ key: 'a.one', label: 'Night starts', file: 'r' }, { key: 'b.two', label: 'Night starts', file: 'r' }] }); ok(rules(check(reg, b)).includes('registered-twice'), 'two keys with one label fail'); }
// a key name in two stores that nobody explained
{ const b = clone(a); b.sameName.push({ key: 'dailyCapUsd', stores: ['plugin:one', 'plugin:two'] }); ok(rules(check(reg, b)).includes('same-name'), 'a key name in two stores fails until it is an alias or explained'); }
{ const b = clone(a); b.sameName = [{ key: 'maxHeavy', stores: [reg.sameName.oneStore[0].stores[0], reg.sameName.oneStore[0].stores[1]] }, { key: 'enabled', stores: ['x', 'y'] }]; ok(!rules(check(reg, b)).includes('same-name'), 'one store in two files and listed different settings pass'); }
// an alias back in a server allow-list
{ const b = clone(a); b.stores.push({ file: 'apps/console-web/server/caps.py', decl: 'SETTING_KEYS', keys: ['maxAgents', 'maxHeavy'] }); ok(rules(check(reg, b)).includes('alias-stored'), 'an alias back in an allow-list fails'); }
// a screen keeps its own copy / a retired wording
ok(rules(check(reg, a, { 'x/Cap.tsx': "consoleApi.writeLocal('maxBuilds', String(v));" })).includes('screen-copy'), 'a screen persisting the key itself fails');
ok(rules(check(reg, a, { 'x/Cap.tsx': "localStorage.setItem('agent-cap.parallelPerAccount', v)" })).includes('screen-copy'), 'a screen persisting an alias fails');
ok(rules(check(reg, a, { 'x/Cap.tsx': '<NumberSetting label="Max running agents" />' })).includes('wording'), 'a retired wording on a screen fails');
ok(rules(check(reg, a, { 'x/Cap.tsx': "const title = `Agent slots · VPS limit ${n}`;" })).includes('wording'), 'the old counter wording fails');
ok(check(reg, a, { 'x/Cap.tsx': "// was: Max running agents\nconst t = 'VPS build limits'; localStorage.setItem('agent-cap.open', '1');" }).length === 0, 'comments, other wording and unrelated local state pass');
// the registry contradicting itself
{ const r = clone(reg); r.sources.push({ ...clone(r.sources[0]), id: 'again', label: 'Builds at once' }); ok(rules(check(r, a)).includes('registry'), 'two sources with one label fail'); }

console.log(`settings-sources: ${n - failed}/${n} checks passed`);
if (failed) process.exit(1);
