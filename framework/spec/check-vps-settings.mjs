#!/usr/bin/env node
/**
 * vps-settings@1 checks: settings defaults, coercion and who changed them; the orchestrator-only rule in
 * framework/cli/dispatch-gate.mjs (on refuses and logs, off allows and logs "allowed-off", a dispatched build passes and
 * logs nothing); the refused-jobs log and its trim; one phone notice per build per notifyEveryMin; and the CLIs
 * (dispatch-gate check --launcher, vps-settings set/get/refused/clear-refused, agent-slots swarm enqueue).
 *   node framework/spec/check-vps-settings.mjs
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'axf-vpsset-'));
const env = { ...process.env, AXF_VPS_SETTINGS_DIR: join(tmp, 'vps'), AXF_DISPATCH_DIR: join(tmp, 'dispatch'), AXF_NOTIFY_INBOX: join(tmp, 'inbox'), AXF_SLOTS_DIR: join(tmp, 'slots') };
Object.assign(process.env, env);
const V = await import('../cli/vps-settings.mjs');
const G = await import('../cli/dispatch-gate.mjs');

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const reset = () => { rmSync(join(tmp, 'vps'), { recursive: true, force: true }); rmSync(join(tmp, 'inbox'), { recursive: true, force: true }); };

// settings
reset();
eq(V.load().values, { orchestratorOnly: true, notifyRefused: true, notifyEveryMin: 10, refusedLogMax: 500 }, 'defaults: rule on, notices on');
eq(V.coerce('orchestratorOnly', 'off'), [true, false], 'off → false');
eq(V.coerce('orchestratorOnly', 'maybe')[0], false, 'bad bool refused');
eq(V.coerce('notifyEveryMin', '9999')[0], false, 'out of range refused');
eq(V.coerce('nope', 1)[0], false, 'unknown key refused');
let threw = ''; try { V.save({ orchestratorOnly: 'maybe' }); } catch (e) { threw = e.message; }
ok(threw.includes('on or off'), 'save throws on a bad value');
eq(V.load().values.orchestratorOnly, true, 'nothing saved after a bad value');
const saved = V.save({ orchestratorOnly: false }, { by: 'brett' });
eq(saved.values.orchestratorOnly, false, 'saved off');
eq(saved.settings.find((s) => s.key === 'orchestratorOnly').changed.by, 'brett', 'who changed it is kept');
eq(V.normalize({ values: { orchestratorOnly: 'garbage', refusedLogMax: 7 } }), V.DEFAULTS, 'bad stored values fall back to defaults');

// the gate under the rule
const b = { id: 'feat-x', title: 'Feat X', status: 'queued', steps: [] };
const store = { builds: [b] };
reset();
let v = G.check({ build: 'feat-x', store });
eq([v.ok, !!v.ruleOff], [false, false], 'rule on: no token → refused');
V.save({ orchestratorOnly: false });
v = G.check({ build: 'feat-x', store });
eq([v.ok, !!v.ruleOff], [true, true], 'rule off: no token → allowed (ruleOff)');
ok(v.why.startsWith('allowed: the orchestrator-only rule is off'), 'rule off says why');
eq(G.check({ build: 'feat-x', store, rule: { orchestratorOnly: true } }).ok, false, 'explicit rule wins over the file');
eq(G.ruled({ ok: true, build: '', why: 'x' }, { orchestratorOnly: true }).ok, true, 'a pass stays a pass');

// enforce: log + notice
reset();
const sent = [];
const notify = (row) => { sent.push(row.build); return 'sent'; };
const t0 = Date.parse('2026-11-10T10:00:00Z');
v = G.enforce({ build: 'feat-x', store, launcher: 'claude-headless', notify, now: t0 });
eq(v.ok, false, 'enforce refuses');
let rows = V.readRefused();
eq([rows.length, rows[0].outcome, rows[0].build, rows[0].launcher, rows[0].notified], [1, 'refused', 'feat-x', 'claude-headless', 'sent'], 'refusal logged with a notice');
G.enforce({ build: 'feat-x', store, notify, now: t0 + 60e3 });
eq(sent.length, 1, 'second refusal within notifyEveryMin: no second notice');
eq(V.readRefused().length, 2, '… but it is logged');
G.enforce({ build: 'feat-x', store, notify, now: t0 + 11 * 60e3 });
eq(sent.length, 2, 'after notifyEveryMin: a new notice');
V.save({ notifyRefused: false });
G.enforce({ build: 'feat-x', store, notify, now: t0 + 30 * 60e3 });
eq(sent.length, 2, 'notices off: none sent');
V.save({ notifyRefused: true, orchestratorOnly: false });
G.enforce({ build: 'feat-x', store, notify, now: t0 + 60 * 60e3 });
rows = V.readRefused();
eq([rows[0].outcome, rows[0].notified], ['allowed-off', ''], 'rule off: logged as allowed-off, no notice');
V.save({ orchestratorOnly: true });
G.enforce({ name: 'walkthrough-1', store, notify });
eq(V.readRefused().length, 5, 'a non-build session is neither refused nor logged');
const token = G.issue('feat-x', { account: 'a', model: 'opus' });
v = G.enforce({ build: 'feat-x', store, token, notify });
eq([v.ok, V.readRefused().length], [true, 5], 'a dispatched build passes and logs nothing');
eq(V.wantsNotice([], { outcome: 'refused', build: 'y', name: '' }, { ...V.DEFAULTS, notifyEveryMin: 0 }), true, 'notifyEveryMin 0: always');

// the real phone notice file (hub-notification@1)
reset();
V.logRefusal({ outcome: 'refused', build: 'feat-y', why: 'refused: test' });
const inboxFiles = (() => { try { const y = readdirSync(join(tmp, 'inbox', 'inbox')); return y.flatMap((yy) => readdirSync(join(tmp, 'inbox', 'inbox', yy)).flatMap((m) => readdirSync(join(tmp, 'inbox', 'inbox', yy, m)))); } catch { return []; } })();
eq(inboxFiles.length, 1, 'notice written to the axHub inbox');
ok(inboxFiles[0]?.startsWith('vps-refused-'), 'notice id names the VPS refusal');

// log trim + clear
reset();
V.save({ refusedLogMax: 50, notifyRefused: false });
for (let i = 0; i < 120; i++) V.logRefusal({ outcome: 'refused', build: `b${i}`, why: 'x'.repeat(300) });
rows = V.readRefused({ limit: 1000 });
ok(rows.length <= 60 && rows.length >= 50, `log trimmed near refusedLogMax (${rows.length})`);
eq(rows[0].build, 'b119', 'newest first');
V.clearRefused({ by: 'brett' });
rows = V.readRefused();
eq([rows.length, rows[0].outcome, rows[0].by], [1, 'cleared', 'brett'], 'clear leaves one line saying who');

// CLIs
reset();
const run = (file, args, extra = {}) => spawnSync('node', [join(ROOT, file), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
let r = run('framework/cli/vps-settings.mjs', ['set', 'orchestratorOnly=off', '--by', 'cli-test', '--json']);
eq([r.status, JSON.parse(r.stdout).values.orchestratorOnly], [0, false], 'CLI set');
r = run('framework/cli/vps-settings.mjs', ['set', 'orchestratorOnly=perhaps']);
eq(r.status, 2, 'CLI set bad value → exit 2');
r = run('framework/cli/vps-settings.mjs', ['get', '--json']);
eq(JSON.parse(r.stdout).settings.find((s) => s.key === 'orchestratorOnly').changed.by, 'cli-test', 'CLI get shows who changed it');
run('framework/cli/vps-settings.mjs', ['set', 'orchestratorOnly=on', 'notifyRefused=off']);
r = run('framework/cli/dispatch-gate.mjs', ['check', '--name', 'build-made-up', '--launcher', 'test-launcher']);
eq(r.status, 3, 'gate CLI refuses a build-* session without a token');
r = run('framework/cli/vps-settings.mjs', ['refused', '--json']);
const last = JSON.parse(r.stdout).refused[0];
eq([last.outcome, last.name, last.launcher], ['refused', 'build-made-up', 'test-launcher'], 'CLI refusal is in the log with its launcher');
r = run('framework/cli/agent-slots.mjs', ['enqueue', '--name', 'build-swarm-y', '--kind', 'swarm', '--json']);
eq(r.status, 3, 'agent-slots refuses a swarm job named build-* without a token');
eq(JSON.parse(run('framework/cli/vps-settings.mjs', ['refused', '--json']).stdout).refused[0].launcher, 'agent-slots', 'agent-slots refusal logged');
run('framework/cli/vps-settings.mjs', ['set', 'orchestratorOnly=off']);
r = run('framework/cli/dispatch-gate.mjs', ['check', '--name', 'build-made-up']);
ok(r.status === 0 && r.stdout.includes('rule is off'), 'gate CLI with the rule off: starts, says so');
r = run('framework/cli/vps-settings.mjs', ['clear-refused', '--json']);
eq(JSON.parse(r.stdout).cleared, true, 'CLI clear-refused');

rmSync(tmp, { recursive: true, force: true });
console.log(`vps-settings: ${n - failed}/${n} passed`);
if (failed) process.exit(1);
