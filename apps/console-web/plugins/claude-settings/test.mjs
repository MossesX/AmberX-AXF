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

console.log(failed ? `✗ claude-settings core — ${failed}/${n} failed` : `✓ claude-settings core — ${n} checks`);
process.exit(failed ? 1 : 0);
