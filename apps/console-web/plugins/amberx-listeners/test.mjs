#!/usr/bin/env node
/**
 * Self-test for the AmberX listeners core (listener@1 on the console side): devices read from the hub table's chunks
 * (stale marked, junk dropped, policies filled from the settings document), policies read and written as
 * hub-settings@1 (strings for numbers, every phone's lib-hubsync reads them back), restart requests, the CLI's JSON.
 *
 *   node apps/console-web/plugins/amberx-listeners/test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projects = mkdtempSync(join(tmpdir(), 'axf-amberx-listeners-'));
process.env.AXF_AMBERX_LISTENERS_PROJECTS = projects;
const core = await import('./core.mjs');
const { devices, policies, setPolicy, requestRestart, normalizePolicy, stateLabel, deviceSummary, registry, policyKey, restartKey } = core;

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.log(`FAIL ${what}`); } };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

// the registry is the framework's
const reg = registry();
ok(reg.listeners.length >= 12 && reg.listeners.some((l) => l.id === 'talk') && reg.defaults.retries === 6, 'registry.json: the framework list, defaults');

// nothing on the hub yet
const empty = devices();
ok(empty.ok && empty.live && empty.count === 0 && empty.devices.length === 0, 'no devices before a phone publishes');
const p0 = policies();
ok(p0.ok && p0.policies.talk.retries === 6 && p0.policies.talk.sound === false && p0.policies['veto-alarm'].sound === true && !p0.updatedAt, 'policies default when the document is missing (the alarm has its sound on)');
ok(p0.policies.monitor.fields.join() === 'on,retries' && p0.policies.oneshot.fields.join() === 'pauseOnCall,pauseForOtherApps,sound,retries', 'fields per listener follow the registry\'s without');

// a phone publishes (lib-hubstore table chunks)
const dir = join(projects, 'amberx-axf', '_data', 'listeners', 'devices');
mkdirSync(dir, { recursive: true });
const now = Date.now();
const doc = (device, at, extra = {}) => ({ $axf: 'listener-state@1', device, name: `Phone ${device}`, app: 'amberx-droid', at, side: 'native', micOff: false, micHolder: 'talk',
  listeners: [{ id: 'talk', state: 'on', detail: 'Listening', holdsMic: true, policy: { on: true } }, { id: 'handsfree', state: 'yielded', detail: 'other-app' }, { id: 'speak', state: 'error', detail: 'the recognizer is busy', lastError: 'the recognizer is busy', lastErrorAt: at - 1000, attempts: 7 }, { id: 'weird', state: 'on' }], ...extra });
writeFileSync(join(dir, 'head.json'), JSON.stringify({ $axf: 'hub-table@1', table: 'devices', chunks: 2, count: 3, updatedAt: new Date(now).toISOString() }));
writeFileSync(join(dir, 'rows-0.json'), JSON.stringify({ a: doc('a', now - 1000), junk: { nope: true } }));
writeFileSync(join(dir, 'rows-1.json'), JSON.stringify({ b: doc('b', now - 11 * 60_000), c: { $axf: 'listener-state@1', device: 'c' } }));
const d = devices(now);
ok(d.count === 2 && d.devices[0].device === 'a' && d.devices[1].device === 'b', 'two devices, newest first; junk and a half document dropped');
ok(d.devices[0].stale === false && d.devices[1].stale === true, 'a device silent for over 10 minutes is stale');
ok(d.devices[0].summary === '2 listening · 1 paused · 1 stopped on errors · mic: Gizmo talk mode', `summary: "${d.devices[0].summary}"`);
const rows = d.devices[0].listeners;
ok(rows.find((l) => l.id === 'handsfree').stateLabel === 'Paused: another app is using the microphone', 'a yielded row says why');
ok(rows.find((l) => l.id === 'speak').stateLabel === 'Stopped: the recognizer is busy' && rows.find((l) => l.id === 'speak').attempts === 7, 'an error row says the reason and the retries');
ok(rows.find((l) => l.id === 'weird').label === 'weird' && rows.find((l) => l.id === 'weird').policy.retries === 6, 'an unknown listener id still gets a row with default policy');
ok(rows.find((l) => l.id === 'talk').policy.on === true && rows.find((l) => l.id === 'talk').fields.length === 5, 'rows carry the hub\'s policy and the fields to show');

// set a policy: written as hub-settings@1, strings for retries (the settings registry's choice shape)
const r1 = setPolicy('handsfree', { pauseOnCall: false, retries: '3' }, 'test');
ok(r1.ok && r1.policy.pauseOnCall === false && r1.policy.retries === 3 && r1.live, 'setPolicy answers the policy as it stands');
const file = JSON.parse(readFileSync(join(projects, '_shared', '_data', 'settings', 'apps', 'amberx-droid.json'), 'utf8'));
ok(file.$axf === 'hub-settings@1' && file.values[policyKey('handsfree', 'pauseOnCall')] === false && file.values[policyKey('handsfree', 'retries')] === '3' && file.updatedBy === 'test' && /^\d{4}-/.test(file.updatedAt), 'the hub document: hub-settings@1, booleans as booleans, retries as a string, updatedBy/At');
ok(policies().policies.handsfree.pauseOnCall === false && policies().policies.handsfree.retries === 3, 'policies reads it back');
ok(devices(now).devices[0].listeners.find((l) => l.id === 'handsfree').policy.retries === 3, 'device rows show the new policy');
// other keys in the document are kept
const before = JSON.parse(readFileSync(join(projects, '_shared', '_data', 'settings', 'apps', 'amberx-droid.json'), 'utf8'));
before.values['amberx.voice.handsFree'] = true;
writeFileSync(join(projects, '_shared', '_data', 'settings', 'apps', 'amberx-droid.json'), JSON.stringify(before));
setPolicy('talk', { sound: true }, 'test');
const after = JSON.parse(readFileSync(join(projects, '_shared', '_data', 'settings', 'apps', 'amberx-droid.json'), 'utf8'));
ok(after.values['amberx.voice.handsFree'] === true && after.values[policyKey('talk', 'sound')] === true && after.values[policyKey('handsfree', 'retries')] === '3', 'a write keeps every other key (last save wins per key)');
// clamps and refusals
ok(setPolicy('talk', { retries: -9, backoffMs: 50, maxBackoffMs: 1 }).policy.retries === -1 && policies().policies.talk.backoffMs === 100 && policies().policies.talk.maxBackoffMs === 100, 'clamps: retries floor -1, backoff floor 100 ms, max never below backoff');
ok(throwsCode(() => setPolicy('Talk!', { on: true }), 'invalid'), 'a bad id is refused');
ok(throwsCode(() => setPolicy('talk', { bogus: 1 }), 'invalid'), 'an unknown field is refused');
ok(throwsCode(() => setPolicy('talk', null), 'invalid'), 'no patch is refused');
ok(normalizePolicy({ retries: 'x' }).retries === 6 && normalizePolicy(null, 'veto-alarm').sound === true, 'normalizePolicy mirrors core.ts');
ok(stateLabel({ state: 'off', policy: { on: false } }) === 'Not allowed' && stateLabel({ state: 'error', detail: 'x' }) === 'Stopped: x', 'stateLabel mirrors core.ts');
ok(deviceSummary({ listeners: [], micHolder: null, micOff: true }) === 'Mic off · nothing listening', 'deviceSummary mirrors core.ts');

// restart requests
const rr = requestRestart('handsfree', 'test');
ok(rr.ok && /^\d{4}-/.test(rr.restartAskedAt) && policies().policies.handsfree.restartAskedAt === rr.restartAskedAt, 'restart: the synced key is set to now');
ok(JSON.parse(readFileSync(join(projects, '_shared', '_data', 'settings', 'apps', 'amberx-droid.json'), 'utf8')).values[restartKey('handsfree')] === rr.restartAskedAt, 'restart key in the document');
ok(throwsCode(() => requestRestart('oneshot'), 'invalid') && throwsCode(() => requestRestart('dictation'), 'invalid'), 'only a native listener with its own switch can be restarted');

// the CLI speaks JSON
const cli = (...a) => JSON.parse(execFileSync('node', [new URL('./listeners.mjs', import.meta.url).pathname, ...a, '--json'], { env: { ...process.env }, encoding: 'utf8' }).trim().split('\n').pop());
ok(cli('devices').count === 2 && cli('policies').policies.handsfree.retries === 3 && cli('registry').listeners.length >= 12, 'CLI: devices, policies, registry');
ok(cli('set', 'speak', 'on=false', '--by', 'cli').policy.on === false && cli('policies').policies.speak.on === false, 'CLI: set on=false');
ok(cli('restart', 'speak').ok === true, 'CLI: restart');
const bad = (() => { try { execFileSync('node', [new URL('./listeners.mjs', import.meta.url).pathname, 'set', 'speak', 'nope=1', '--json'], { env: { ...process.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return null; } catch (e) { return { status: e.status, out: String(e.stdout) }; } })();
ok(bad && bad.status === 1 && JSON.parse(bad.out.trim().split('\n').pop()).code === 'invalid', 'CLI: a bad field exits 1 with {ok:false, code:invalid}');

// not mounted: still answers, says not live
process.env.AXF_AMBERX_LISTENERS_PROJECTS = join(projects, 'nowhere');
ok(devices().live === false && devices().count === 0 && policies().live === false, 'without the hub mount: empty and not live, never a throw');

console.log(failed ? `✗ amberx-listeners core — ${failed}/${n} failed` : `✓ amberx-listeners core — ${n} checks`);
process.exit(failed ? 1 : 0);
