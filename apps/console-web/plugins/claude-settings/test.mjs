#!/usr/bin/env node
/**
 * Self-test for the Claude settings core (claude-settings@1): open registry, owner-only rules (a Claude session can
 * never change one, whatever it hands over), No wait ↔ pass decisions, the night window.
 *
 *   node apps/console-web/plugins/claude-settings/test.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'axf-claude-settings-'));
process.env.AXF_CLAUDE_SETTINGS_FILE = join(dir, 'settings.json');
process.env.AXF_CLAUDE_SETTINGS_DATA = dir;
const core = await import('./core.mjs');
const { loadRegistry, setSettings, systemOff, view, noWaitTick, passChange, passFor, inWindow, valid } = core;

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.log(`FAIL ${what}`); } };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
const CLEAN = {}; // an environment with no Claude-session markers (the console server's)
const SESSION = { CLAUDECODE: '1' };
const BRETT = { via: 'console', name: 'brett' };

// registry
const reg = loadRegistry();
ok(reg.settings.length >= 25 && reg.groups.length >= 7, 'registry has the groups and settings');
for (const k of ['noWait.enabled', 'noWait.includeIrreversible', 'noWait.duration', 'builds.launchWithoutAsking', 'builds.uiReviewGate', 'builds.defaultModel']) ok(reg.settings.find((s) => s.key === k)?.owner === true, `${k} is owner-only`);
ok(reg.settings.find((s) => s.key === 'builds.alwaysNamedAgent')?.locked === true, 'named agent is locked on');
{ const f = reg.settings.find((s) => s.key === 'builds.fableUpgradeApproval'); ok(f?.owner === true && f.default === false && f.kind === 'toggle', 'Fable upgrades need my approval: owner-only toggle, off by default (Brett, Nov 4 2026)'); }
ok(reg.settings.find((s) => s.key === 'followAmber.enabled')?.shared === 'Follow Amber', 'Follow Amber is the shared switch');
const more = loadRegistry({ extra: [{ groups: [{ id: 'x', label: 'Extra' }], settings: [{ key: 'x.flag', group: 'x', label: 'Flag', kind: 'toggle', default: false }, { key: 'bad', kind: 'toggle', default: 'no' }] }] });
ok(more.settings.some((s) => s.key === 'x.flag') && !more.settings.some((s) => s.key === 'bad'), 'open registry: a data entry adds a setting, an invalid one is dropped');
ok(valid({ kind: 'time' }, '23:00') && !valid({ kind: 'time' }, '24:00'), 'time values checked');

// defaults
const v0 = view();
ok(v0.values['noWait.enabled'] === false && v0.values['noWait.includeIrreversible'] === false, 'No wait and Include irreversible default off');
ok(v0.settings.every((s) => typeof s.description === 'string' && s.description.length > 10), 'every setting has a plain description');

// owner-only enforcement
ok(throwsCode(() => setSettings({ 'noWait.enabled': true }, { owner: null, env: CLEAN }), 'denied'), 'no owner → No wait refused');
ok(throwsCode(() => setSettings({ 'noWait.enabled': true }, { owner: BRETT, env: SESSION }), 'denied'), 'an owner handed over inside a Claude session → refused');
ok(throwsCode(() => setSettings({ 'noWait.enabled': true }, { owner: { via: 'axhub', name: 'brett' }, env: CLEAN }), 'denied'), 'only console / local count as owner');
ok(throwsCode(() => setSettings({ 'noWait.enabled': true }, { owner: { via: 'session', name: 'brett' }, env: CLEAN }), 'denied'), 'a made-up via is not an owner');
ok(view().values['noWait.enabled'] === false, 'still off after every refusal');
ok(throwsCode(() => setSettings({ 'builds.alwaysNamedAgent': false }, { owner: BRETT, env: CLEAN }), 'denied'), 'locked: not even the owner');
ok(throwsCode(() => setSettings({ 'builds.budgetDailyUsd': 500 }, { owner: null, env: CLEAN }), 'denied'), 'a session cannot raise a budget cap');
ok(setSettings({ 'builds.budgetDailyUsd': 20 }, { owner: null, env: CLEAN }).changed.length === 1, 'a session may lower a budget cap');
ok(setSettings({ 'builds.budgetDailyUsd': 80 }, { owner: BRETT, env: CLEAN }).changed[0].to === 80, 'Brett raises it');
ok(throwsCode(() => setSettings({ 'talking.length': 'huge' }, { env: CLEAN }), 'invalid'), 'a bad choice is refused');
ok(throwsCode(() => setSettings({ 'talking.length': 'detailed', 'noWait.enabled': true }, { env: CLEAN }), 'denied') && view().values['talking.length'] === 'short', 'a patch with one refused key changes nothing');
const s1 = setSettings({ 'talking.length': 'detailed', 'talking.tone': '3' }, { by: 'janitor-joey', env: CLEAN });
ok(s1.changed.length === 2 && view().values['talking.tone'] === 3, 'non-owner settings change (typed strings coerced)');
ok(view().settings.find((s) => s.key === 'talking.length').changed.by === 'janitor-joey', 'who changed it is recorded');
const on = setSettings({ 'noWait.enabled': true }, { owner: BRETT, env: CLEAN });
ok(on.changed[0].to === true && passChange(on.changed, on.view.values) === 'grant', "Brett's click turns No wait on → grant the pass");
ok(JSON.parse(readFileSync(process.env.AXF_CLAUDE_SETTINGS_FILE, 'utf8')).changed['noWait.enabled'].via === 'console', 'stored with how it was approved');
const irr = setSettings({ 'noWait.includeIrreversible': true }, { owner: BRETT, env: CLEAN });
ok(passChange(irr.changed, irr.view.values) === 'grant' && passFor(irr.view.values).include_irreversible === true, 'Include irreversible while on → re-grant with it');
ok(throwsCode(() => setSettings({ 'noWait.enabled': false }, { owner: null, env: CLEAN }), 'denied'), 'a session cannot switch it off either (owner-only both ways)');
ok(systemOff('noWait.enabled', 'night').changed.length === 1 && view().values['noWait.enabled'] === false, 'the server clock can switch it off');
ok(throwsCode(() => systemOff('noWait.duration', 'x'), 'invalid'), 'system-off only takes toggles');
const off = setSettings({ 'noWait.enabled': true }, { owner: BRETT, env: CLEAN });
const off2 = setSettings({ 'noWait.enabled': false }, { owner: BRETT, env: CLEAN });
ok(off.changed.length === 1 && passChange(off2.changed, off2.view.values) === 'revoke', 'off → revoke the pass');
ok(passChange([{ key: 'noWait.duration' }], { 'noWait.enabled': false }) === null, 'duration change while off → nothing');

// passes per duration
ok(passFor({ 'noWait.duration': '1h' }).minutes === 60 && passFor({ 'noWait.duration': '4h' }).minutes === 240 && passFor({ 'noWait.duration': 'untilOff' }).minutes === 240, 'durations → pass minutes (max 240)');

// the clock
const base = { 'noWait.enabled': true, 'noWait.autoOffAtNight': false, 'noWait.nightStart': '23:00', 'noWait.nightEnd': '07:00', 'noWait.duration': '1h', 'noWait.includeIrreversible': false };
const noon = new Date('2026-11-03T17:00:00Z'); // 12:00 in New York
const night = new Date('2026-11-04T05:00:00Z'); // 00:00 in New York
ok(noWaitTick({ ...base, 'noWait.enabled': false }, null, noon).action === 'none', 'off → nothing');
ok(noWaitTick(base, { active: true, remainingMs: 3e6 }, noon).action === 'none', 'on with a pass → nothing');
ok(noWaitTick(base, { active: false, ended: 'expired' }, noon).action === 'off', '1 h pass expired → off');
ok(noWaitTick(base, { active: false, ended: 'revoked' }, noon).why.includes('revoked'), 'revoked from the banner → off');
const until = { ...base, 'noWait.duration': 'untilOff' };
ok(noWaitTick(until, { active: true, remainingMs: 10 * 60e3 }, noon).action === 'renew', 'until off: renew before it ends');
ok(noWaitTick(until, { active: true, remainingMs: 3 * 3600e3 }, noon).action === 'none', 'until off: no renewal while plenty is left');
ok(noWaitTick(until, { active: false, ended: 'expired' }, noon).action === 'renew', 'until off: an expired pass is renewed');
ok(noWaitTick(until, { active: false, ended: 'revoked' }, noon).action === 'off', 'until off: a revoked pass switches it off');
const nightOn = { ...base, 'noWait.autoOffAtNight': true };
const t = noWaitTick(nightOn, { active: true, remainingMs: 3e6 }, night);
ok(t.action === 'off' && t.revoke === true, 'night → off and revoke');
ok(noWaitTick(nightOn, { active: true, remainingMs: 3e6 }, noon).action === 'none', 'daytime → stays on');
ok(inWindow(night, '23:00', '07:00') && !inWindow(noon, '23:00', '07:00') && inWindow(noon, '11:00', '13:00') && !inWindow(noon, '12:00', '12:00'), 'night window wraps midnight');

// tabs: every group lands in a tab, a new group is never lost
const { tabsFor, normView, viewProblem, matches, deviceOk, LABEL_DISPLAY, displayLabel } = await import('./web/view-core.mjs');
const tv = tabsFor(reg.groups, reg.tabs, reg.settings);
ok(tv[0].id === 'approvals' && tv[0].always, 'Approvals & veto is the first tab');
ok(tv.flatMap((x) => x.groups).length === reg.groups.length && tv.reduce((a, x) => a + x.count, 0) === reg.settings.length, 'every group and every setting is in exactly one tab');
const tvx = tabsFor([...reg.groups, { id: 'new', label: 'New' }], reg.tabs, [...reg.settings, { group: 'new' }]);
ok(tvx.at(-1).id === 'other' && tvx.at(-1).count === 1, 'a group no tab lists shows under Other');
ok(tabsFor(reg.groups, reg.tabs, []).map((x) => x.id).join() === 'approvals', 'an empty tab is dropped, Approvals & veto stays');

// views, per device
ok(normView({ mode: 'x', position: 'left', labels: 'icons' }).mode === 'tabbed' && normView({ position: 'left' }).position === 'left', 'view values normalised');
ok(viewProblem({ position: 'middle' }).includes('position') && viewProblem({ foo: 1 }).includes('foo') && viewProblem({ mode: 'classic', tab: 'builds' }) === '', 'bad view values named');
ok(displayLabel(LABEL_DISPLAY.words) === 'words' && displayLabel(LABEL_DISPLAY.icons) === 'icons' && displayLabel(LABEL_DISPLAY.both) === 'both', 'labels map onto tab-group display and back');
ok(deviceOk('d-1.a') && !deviceOk('') && !deviceOk('../x') && !deviceOk('__proto__/'), 'device ids checked');
ok(matches({ label: 'Tone level', key: 'talking.tone', description: '' }, 'TONE') && !matches({ label: 'a', key: 'b', description: 'c' }, 'zz'), 'find matches label, key, description');
ok(core.getView('phone').saved === false, 'an unsaved device gets the default');
core.setView('phone', { position: 'left', labels: 'icons' }, { by: 't', name: 'S26' });
core.setView('desk', { mode: 'classic' }, { by: 't' });
ok(core.getView('phone').position === 'left' && core.getView('desk').position === 'top' && core.getView('desk').mode === 'classic', 'each device keeps its own view');
ok(core.getView('phone').name === 'S26' && core.setView('phone', { labels: 'words' }).name === 'S26', 'the device name stays');
ok(throwsCode(() => core.setView('phone', { mode: 'x' }), 'invalid') && throwsCode(() => core.setView('bad id', { mode: 'classic' }), 'invalid') && throwsCode(() => core.getView('__proto__/x'), 'invalid'), 'bad views refused');
ok(core.getView('constructor').saved === false, 'a device called constructor is just a device');

// policy table
const P = await import('./web/policy-core.mjs');
const rules = reg.policyDefaults;
const T = { services: [
  { namespace: 'vps', type: 'ssh', enabled: true, defaultPolicy: 'deny', tools: [
    { name: 'run', annotations: { destructive: true }, explicit: 'veto', policy: 'veto' }, { name: 'logs', annotations: { readOnly: true }, explicit: 'veto', policy: 'veto' },
    { name: 'check', annotations: { readOnly: true }, explicit: 'allow', policy: 'allow' }, { name: 'build_land', explicit: 'allow', policy: 'allow' }, { name: 'newtool', policy: 'deny' }] },
  { namespace: 'github', type: 'rest', enabled: true, defaultPolicy: 'allow', policyPreset: 'recommended', tools: [
    { name: 'repos/get', annotations: { readOnly: true }, policy: 'allow' }, { name: 'pulls/create', policy: 'veto' }, { name: 'repos/delete', annotations: { destructive: true }, policy: 'confirm' }] },
  { namespace: 'axhub', type: 'builtin', enabled: true, defaultPolicy: 'allow', tools: [{ name: 'pass_grant', annotations: { ownerGrant: true }, policy: 'confirm' }, { name: 'switch_account', policy: 'allow' }] },
  { namespace: 'amberx', type: 'device', enabled: true, defaultPolicy: 'confirm', tools: [{ name: 'recorder_start', annotations: { explicitApproval: true }, policy: 'confirm' }, { name: 'deny_me', explicit: 'deny', policy: 'deny' }] },
  { namespace: 'off', type: 'rest', enabled: false, defaultPolicy: 'allow', tools: [{ name: 'x', policy: 'deny' }] },
] };
const plan = P.planDefaults(T, rules);
const planned = (id) => plan.find((c) => `${c.service}.${c.tool}` === id);
ok(!planned('vps.run'), 'vps.run stays held (destructive keeps the hub rule, and it is on the veto already)');
ok(planned('vps.logs')?.to === 'allow', 'a read stops holding');
ok(!planned('vps.newtool'), 'a denied shell tool stays denied: the plan never loosens the SSH default-deny');
ok(!planned('vps.build_land'), 'fixed build tools already let through stay through (axHub decision 110)');
ok(P.defaultFor(T.services[0], { name: 'other', policy: 'confirm' }, rules).decision === 'veto', 'any other shell tool holds: it may write to the VPS');
ok(planned('github.pulls/create')?.to === 'allow', 'a non-VPS write stops holding');
ok(!planned('github.repos/delete') && !planned('axhub.pass_grant') && !planned('amberx.recorder_start') && !planned('amberx.deny_me') && !planned('off.x'), 'destructive, owner grants, explicit approvals, denied and switched-off tools are left alone');
ok(planned('axhub.switch_account')?.to === 'veto', 'an account switch holds');
ok(P.planDefaults({ services: [{ namespace: 's', type: 'rest', enabled: true, defaultPolicy: 'deny', tools: [{ name: 'w', policy: 'deny' }] }] }, rules).length === 0, 'a service denied by default is not opened up');
ok(P.onHoldList('x', 'y', { holdMatch: ['('] }) === '', 'a bad pattern holds nothing and does not throw');
ok(P.groupDecision(T.services[1]) === 'mixed' && P.groupDecision({ tools: [{ policy: 'veto' }] }) === 'veto', 'a service shows one decision or Mixed');
ok(P.groupChanges(T.services[1], 'veto').length === 3, 'a group change covers each tool');
ok(P.counts(T).veto === 3, 'counts');
ok(P.changesProblem([]) && P.changesProblem([{ service: 'a', tool: 'b', policy: 'maybe' }]) && P.changesProblem([{ service: 'a', tool: 'b', vetoSeconds: 5 }]) && !P.changesProblem([{ service: 'a', tool: 'b', policy: null, vetoSeconds: 60 }]), 'changes checked (decision, hold 10-1800)');
{
  const seen = [];
  const fake = (status, body) => async (url, init) => { seen.push({ url, init }); return { status, ok: status < 300, json: async () => body }; };
  const r = await P.putPolicy('https://hub', [{ service: 'a', tool: 'b', policy: 'veto' }], 'why', { fetch: fake(200, { rev: 2 }) });
  ok(r.ok && seen[0].url === 'https://hub/auth/api/policy' && seen[0].init.method === 'PUT' && seen[0].init.credentials === 'include' && !seen[0].init.headers.Authorization, 'a write goes on the session cookie, never a token');
  ok((await P.putPolicy('https://hub', [{ service: 'a', tool: 'b' }], 'w', { fetch: fake(404, {}) })).code === 'not_available', 'no policy API yet: said plainly');
  ok((await P.putPolicy('https://hub', [{ service: 'a', tool: 'b' }], 'w', { fetch: fake(401, {}) })).code === 'unauthenticated', 'not signed in: said plainly');
  ok((await P.putPolicy('https://hub', [], 'w', { fetch: fake(200, {}) })).ok === false, 'an empty change list never reaches the hub');
  ok((await P.putPolicy('https://hub', [{ service: 'a', tool: 'b' }], 'w', { fetch: async () => { throw new Error('x'); } })).ok === false, 'a dead hub is an answer, not a crash');
}
{
  const env = { AXHUB_TOKEN: 'tok', AXHUB_URL: 'https://hub.test/mcp' };
  let auth = ''; let url = '';
  const r = await core.readPolicy({ env, fetch: async (u, i) => { url = u; auth = i.headers.Authorization; return { status: 200, ok: true, json: async () => T }; } });
  ok(r.available && url === 'https://hub.test/auth/api/policy' && auth === 'Bearer tok', 'the live table is read with the hub token, /mcp dropped from the address');
  ok(!(await core.readPolicy({ env, fetch: async () => ({ status: 404, ok: false }) })).available, 'no route on the hub: not available, no stale copy');
  ok(!(await core.readPolicy({ env, fetch: async () => { throw new Error('down'); } })).available, 'hub down: not available');
  ok(!(await core.readPolicy({ env: { HOME: '/nonexistent' } })).available, 'no token: not available');
}

console.log(failed ? `✗ claude-settings core — ${failed}/${n} failed` : `✓ claude-settings core — ${n} checks`);
process.exit(failed ? 1 : 0);
