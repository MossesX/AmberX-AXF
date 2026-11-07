/**
 * check-listeners — the shared listeners library (framework/libs/listeners, listener@1; build gizmo-rebuild-fable,
 * Nov 6 2026): the rules replay cases.json (the same file AmberX's Android ListenerRules reads), the policy keys and
 * defaults hold, restarts back off and give up, restarts are silent, yielding follows the policy, one mic owner, the
 * device document (listener-state@1) merges, and both apps bake the current copy.
 *
 *   npx -y tsx framework/spec/check-listeners.mts
 */
import { readFileSync } from 'node:fs';
import * as lib from '../libs/listeners/core.ts';

let ok = 0;
const check = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

console.log('listeners (listener@1)');

// ---- baked copies
for (const app of ['console-web', 'amberx-droid']) {
  for (const f of ['core.ts', 'index.ts', 'library.json', 'cases.json', 'registry.json']) check(src(`../../apps/${app}/src/axf/libs/listeners/${f}`) === src(`../libs/listeners/${f}`), `${app} bakes the current ${f}`);
}

// ---- the shared cases (Java reads the same file)
type Cases = {
  defaults: Record<string, number | boolean>;
  restartDelay: { attempt: number; policy: Partial<lib.ListenerPolicy>; want: number | null }[];
  afterEnd: { attempts: number; ranMs: number; policy: Partial<lib.ListenerPolicy>; fatal?: boolean; want: lib.EndPlan }[];
  startSound: { policy: Partial<lib.ListenerPolicy>; reason: lib.StartReason; want: boolean }[];
  yieldReason: { scene: lib.MicScene; policy: Partial<lib.ListenerPolicy>; want: string | null }[];
  mayResume: { reason: string; freeSince: number; now: number; want: boolean }[];
  micWinner: { asking: string[]; want: string | null }[];
  yieldLabel: { reason: string | null; want: string }[];
};
const cases = JSON.parse(src('../libs/listeners/cases.json')) as Cases;
check(cases.defaults.retries === lib.POLICY_DEFAULTS.retries && cases.defaults.backoffMs === lib.POLICY_DEFAULTS.backoffMs && cases.defaults.maxBackoffMs === lib.POLICY_DEFAULTS.maxBackoffMs
  && cases.defaults.cooldownMs === lib.POLICY_DEFAULTS.cooldownMs && cases.defaults.sound === lib.POLICY_DEFAULTS.sound && cases.defaults.quickEndMs === lib.QUICK_END_MS && cases.defaults.restartMs === lib.RESTART_MS, 'cases.json defaults = the library defaults');
for (const c of cases.restartDelay) check(lib.restartDelay(c.attempt, c.policy) === c.want, `restartDelay(${c.attempt}, ${JSON.stringify(c.policy)}) = ${c.want}`);
for (const c of cases.afterEnd) check(same(lib.afterEnd(c.attempts, c.ranMs, c.policy, { fatal: c.fatal }), c.want), `afterEnd(${c.attempts}, ${c.ranMs}ms${c.fatal ? ', fatal' : ''}) = ${JSON.stringify(c.want)}`);
for (const c of cases.startSound) check(lib.startSound(c.policy, c.reason) === c.want, `startSound(${JSON.stringify(c.policy)}, ${c.reason}) = ${c.want}`);
for (const c of cases.yieldReason) check(lib.yieldReason(c.scene, c.policy) === c.want, `yieldReason(${JSON.stringify(c.scene)}, ${JSON.stringify(c.policy)}) = ${c.want}`);
for (const c of cases.mayResume) check(lib.mayResume(c.reason, c.freeSince, c.now) === c.want, `mayResume(${c.reason}, ${c.freeSince}, ${c.now}) = ${c.want}`);
for (const c of cases.micWinner) check(lib.micWinner(c.asking) === c.want, `micWinner(${JSON.stringify(c.asking)}) = ${c.want}`);
for (const c of cases.yieldLabel) check(lib.yieldLabel(c.reason) === c.want, `yieldLabel(${c.reason}) = "${c.want}"`);

// ---- registry
check(lib.LISTENERS.length >= 12 && new Set(lib.LISTENERS.map((l) => l.id)).size === lib.LISTENERS.length, 'the registry lists every listener once');
check(lib.LISTENERS.every((l) => /^[a-z][a-z0-9-]*$/.test(l.id) && l.label && l.about !== undefined), 'listener ids are kebab-case, every one has a label');
check(lib.listenerDef('nope').label === 'nope' && lib.listenerDef('nope').side === 'page', 'an unknown id still gets a row (label = id)');
check(lib.MIC_PRIORITY[0] === 'talk' && lib.MIC_PRIORITY.includes('handsfree') && lib.MIC_PRIORITY.includes('recorder-mic'), 'mic priority: talk mode first');
check(lib.LISTENERS.filter((l) => l.kind === 'mic').every((l) => lib.MIC_PRIORITY.includes(l.id)), 'every mic listener has a place in the priority list');

// ---- policy
const keys = lib.policyKeys('talk');
check(keys.on === 'amberx.listeners.talk.on' && keys.retries === 'amberx.listeners.talk.retries', 'policy keys: amberx.listeners.<id>.<field>');
check(same(lib.parsePolicyKey('amberx.listeners.talk.pauseOnCall'), { id: 'talk', field: 'pauseOnCall' }) && lib.parsePolicyKey('amberx.listeners.talk.bogus') === null && lib.parsePolicyKey('companion.model') === null, 'parsePolicyKey');
check(same(lib.normalizePolicy(null), lib.POLICY_DEFAULTS), 'normalizePolicy(null) = defaults');
check(lib.normalizePolicy(null, 'veto-alarm').sound === true && lib.normalizePolicy(null, 'talk').sound === false, 'per-listener defaults (the alarm has its sound on)');
const p = lib.normalizePolicy({ retries: '10', backoffMs: 50, maxBackoffMs: 1, on: 'false', cooldownMs: -5 });
check(p.retries === 10 && p.backoffMs === 100 && p.maxBackoffMs === 100 && p.on === false && p.cooldownMs === 0, 'normalizePolicy coerces strings and clamps (backoff floor 100 ms, max never below backoff)');
check(lib.normalizePolicy({ retries: -7 }).retries === -1 && lib.normalizePolicy({ retries: 'x' }).retries === 6, 'retries: -1 is the floor, junk = default');
const get = (k: string) => ({ 'amberx.listeners.handsfree.sound': true, 'amberx.listeners.handsfree.retries': 3 } as Record<string, unknown>)[k];
check(lib.policyFrom(get, 'handsfree').sound === true && lib.policyFrom(get, 'handsfree').retries === 3 && lib.policyFrom(get, 'handsfree').pauseOnCall === true, 'policyFrom reads the settings keys, fills the rest');
check(Object.keys(lib.policiesFrom(get)).length === lib.LISTENERS.length, 'policiesFrom covers every known listener');
check(!lib.policyFieldsFor('monitor').includes('pauseOnCall') && !lib.policyFieldsFor('oneshot').includes('on') && lib.policyFieldsFor('talk').length === 5, 'policyFieldsFor leaves out what a listener has not got');
const ps = lib.policySettings('talk');
check(ps.length === 5 && ps.every((s) => s.key.startsWith('amberx.listeners.talk.')) && ps.find((s) => s.kind === 'choice')?.options?.length === lib.RETRY_CHOICES.length && ps.find((s) => s.kind === 'choice')?.default === '6', 'policySettings: declared settings for the registry (synced through axHub), choice values as strings');
check(lib.normalizePolicy({ retries: '-1' }).retries === -1 && lib.policyFrom((k) => (k === 'amberx.listeners.talk.retries' ? '3' : undefined), 'talk').retries === 3, 'a choice saved as a string reads back as the number');
check(same(lib.policyPatch('talk', { on: false, retries: 3 }), { 'amberx.listeners.talk.on': false, 'amberx.listeners.talk.retries': '3' }), 'policyPatch: the settings keys the console writes');
check(lib.RETRY_CHOICES.some((c) => c.value === -1) && lib.RETRY_CHOICES.some((c) => c.value === 0), 'retry choices offer never and keep trying');

// ---- restarts beyond the cases
check(lib.restartDelay(31, { retries: -1 }) === 30_000 && lib.restartDelay(100, { retries: -1, maxBackoffMs: 5000 }) === 5000, 'huge attempt counts stay at the cap (no overflow)');
check(lib.isQuickEnd(1499) && !lib.isQuickEnd(1500) && lib.isQuickEnd(2999, 3000), 'isQuickEnd with the default and a custom threshold');

// ---- yield
check(lib.resumeAfterMs('call') === 3000 && lib.resumeAfterMs(null) === 0 && lib.resumeAfterMs('weird') === 3000, 'resumeAfterMs per reason');

// ---- state rows
const info = lib.normalizeInfo({ id: 'talk', state: 'yielded', detail: 'call', since: 5, attempts: 2, holdsMic: true });
check(info.label === 'Gizmo talk mode' && info.kind === 'mic' && info.side === 'native' && info.policy.retries === 6 && info.lastError === null, 'normalizeInfo fills label, kind, side, policy');
check(lib.stateLabel(info) === 'Paused: a call is using the microphone' && lib.stateTone('yielded') === 'warning', 'stateLabel for a yielded listener names the reason');
check(lib.stateLabel({ state: 'off', detail: '', policy: lib.normalizePolicy({ on: false }) }) === 'Not allowed' && lib.stateLabel({ state: 'error', detail: 'recognizer busy', policy: lib.POLICY_DEFAULTS }) === 'Stopped: recognizer busy', 'stateLabel: off vs not allowed, error with its reason');
check(lib.normalizeInfo({ id: 'x', state: 'bogus' as lib.ListenerState }).state === 'off' && lib.normalizeInfo({ id: 'x', lastError: 'e'.repeat(400) }).lastError!.length === 300, 'normalizeInfo: bad state = off, errors capped');

// ---- the device document
const doc = lib.deviceDoc({ device: 'd1', name: 'Phone', app: 'amberx-droid', at: 1000, side: 'native', micOff: false, micHolder: 'talk', listeners: [{ id: 'zzz', state: 'on' }, { id: 'talk', state: 'on', holdsMic: true }, { id: 'handsfree', state: 'yielded', detail: 'other-app' }] });
check(doc.$axf === 'listener-state@1' && doc.listeners.map((l) => l.id).join() === 'handsfree,talk,zzz', 'deviceDoc: registry order, unknown ids last');
check(lib.deviceSummary(doc) === '2 listening · 1 paused · mic: Gizmo talk mode', `deviceSummary: "${lib.deviceSummary(doc)}"`);
check(lib.deviceSummary({ listeners: [], micHolder: null, micOff: true }) === 'Mic off · nothing listening', 'deviceSummary with Mic off and nothing on');
const merged = lib.mergeDevices([doc, { ...doc, device: 'd2', at: 2000 }, { junk: true }, { $axf: 'listener-state@1', device: 'd3' }], 1000 + lib.DEVICE_STALE_MS + 1);
check(merged.length === 2 && merged[0]!.device === 'd2' && merged[0]!.stale === false && merged[1]!.stale === true, 'mergeDevices: newest first, stale marked, junk dropped');
check(lib.HUB.project === 'amberx-axf' && lib.HUB.folder === 'listeners' && lib.HUB.table === 'devices', 'the hub table: amberx-axf/_data/listeners/devices');

console.log(`\n✓ ${ok} checks passed`);
