#!/usr/bin/env node
/**
 * VPS Configuration self-test: the gate-rules core against its fixtures, the store and lander adapters against a temp
 * lander data folder (config.json, merge-queue.json, land.json, a fake land.mjs that records what it was asked), the
 * History log, the ops (rules, reset confirm, check, settings), and CLI-vs-API parity (what the REST routes and so the
 * MCP tools run): the same input gives the same record.
 *   node apps/console-web/plugins/gate/test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const NOW = '2026-11-15T12:00:00.000Z';
let n = 0;
const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

// ------------------------------------------------------------------ a temp lander + gate data folder

const TMP = mkdtempSync(join(tmpdir(), 'axf-gate-test-'));
const LAND = join(TMP, 'lander'); const GATE = join(TMP, 'gate'); const CALLS = join(TMP, 'calls.jsonl');
mkdirSync(LAND, { recursive: true });
const json = (f, v) => writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`);
function seed() {
  rmSync(GATE, { recursive: true, force: true }); rmSync(CALLS, { force: true });
  json(join(LAND, 'config.json'), { $axf: 'push-banner-config@1', repos: ['o/r'], autoLand: false, autoMerge: false, landWaitUi: true, mergeQueue: true, queueMode: 'stack' });
  json(join(LAND, 'merge-queue.json'), {
    $axf: 'merge-queue@1', at: NOW,
    items: [
      { pr: 701, title: 'Skins', build: 'skins', branch: 'claude/skins', head: 'a1', state: 'testing', ci: 'running', startedAt: '2026-11-15T11:50:00.000Z' },
      { pr: 702, title: 'Help gate', build: 'help-gate', branch: 'claude/help-gate', head: 'b2', state: 'waiting', why: 'its screenshots are waiting in UI Review.' },
    ],
    waiting: [{ pr: 704, title: 'Dock sizes', build: 'dock', branch: 'claude/dock', head: 'd4', state: 'kicked', why: 'PR 704 conflicts with main in code (framework/ui/axf.css). Merge main in and fix them.' }],
    merged: [{ pr: 690, title: 'Earlier', at: '2026-11-15T10:00:00.000Z' }],
  });
  json(join(LAND, 'land.json'), { $axf: 'land@1', items: [{ id: 'notes', pr: 710, title: 'Notes', branch: 'claude/notes', head: 'n1', state: 'ready', ci: 'success' }, { id: 'red', pr: 711, title: 'Red', branch: 'claude/red', head: 'r1', state: 'blocked', ci: 'failure', failing: ['android / check-theme'], reason: { kind: 'ci', text: 'red: CI is red.' } }] });
}
const FAKE = join(TMP, 'fake-land.mjs');
writeFileSync(FAKE, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(CALLS)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log(JSON.stringify({ ok: true }));\n`);
const calls = () => { try { return readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const ENV = { AXF_GATE_DIR: GATE, AXF_GATE_LANDER_DIR: LAND, AXF_GATE_LANDER_CLI: FAKE, AXF_GATE_NOW: NOW };
Object.assign(process.env, ENV);

const { createStore } = await import('./gate-store.mjs');
const { createLander, MODE_FLAGS } = await import('./lander.mjs');
const H = await import('./history.mjs');
const { createGate, parseCli, OPS } = await import('./gate.mjs');
const cfg = () => JSON.parse(readFileSync(join(LAND, 'config.json'), 'utf8'));

try {
  // ---------------------------------------------------------------- core
  t('gate-rules core passes its fixtures', () => { const r = spawnSync(process.execPath, [join(ROOT, 'framework/spec/check-gate-rules.mjs')], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr || r.stdout); });

  // ---------------------------------------------------------------- store
  seed();
  const s = createStore();
  t('rules are migrated from the lander config on read, and a read writes nothing', () => {
    const set = s.readRules();
    assert.equal(set.$axf, 'gate-rule-set@1'); assert.equal(set.rules.length, 9); assert.ok(set.migratedFrom.keys.includes('mergeQueue'));
    assert.equal(set.rules.find((r) => r.id === 'merge-queue-only').settings.mode, 'stack');
    assert.throws(() => readFileSync(join(GATE, 'rules.json')));
  });
  t('writing the rules bumps rev and mirrors UI Review into the lander config', () => {
    const set = s.readRules(); const ui = set.rules.find((r) => r.id === 'ui-review'); ui.enabled = false;
    const saved = s.writeRules(set, { by: 'test' });
    assert.equal(saved.rev, 2); assert.equal(cfg().landWaitUi, false); assert.deepEqual(cfg().repos, ['o/r'], 'other keys stay');
  });
  t('confirm tokens are one-time and bound to the op and key', () => {
    const tok = s.issueConfirm('x', '1');
    assert.equal(s.takeConfirm('x', '2', tok), false); assert.equal(s.takeConfirm('x', '1', tok), true); assert.equal(s.takeConfirm('x', '1', tok), false);
  });
  t('runs come from the queue merges (and land-runs.jsonl when there is one)', () => { const r = s.runs(); assert.equal(r.length, 1); assert.equal(r[0].result, 'landed'); assert.deepEqual(r[0].merged, [690]); });

  // ---------------------------------------------------------------- lander
  seed();
  const st2 = createStore(); const L = createLander(st2);
  t('mode: on while the config has the queue on and auto-land off; status reads the queue', () => {
    assert.equal(L.mode().mergeQueue, true);
    const x = L.status(); assert.equal(x.status, 'running'); assert.equal(x.landing.pr, 701); assert.equal(x.counts.waiting, 2); assert.equal(x.mode, 'stack');
  });
  t('waiting PRs carry the rule that holds them and the gate verdict', () => {
    const w = L.waiting().items;
    assert.deepEqual(w.map((x) => x.pr), [702, 704]); assert.equal(w[0].rule, 'ui-review'); assert.equal(w[1].rule, 'clash'); assert.equal(w[1].state, 'kicked');
    assert.equal(w[1].gate.pass, false);
    assert.deepEqual(L.waiting({ rule: 'clash' }).items.map((x) => x.pr), [704]);
  });
  t('Merge queue off: the auto-lander lands one at a time, at once, logged', () => {
    const x = L.setMode(false, { by: 'test', reason: 'r' });
    assert.equal(x.mergeQueue, false); assert.equal(x.mode, 'serial');
    for (const [k, v] of Object.entries(MODE_FLAGS.off)) assert.equal(cfg()[k], v, k);
    assert.deepEqual(L.waiting().items.map((w) => [w.pr, w.state]), [[710, 'waiting'], [711, 'held']], 'the line is the finished builds: ready ones wait their turn, blocked ones are held');
    const h = H.read(st2, { kind: 'lander' }).items; assert.equal(h[0].action, 'mode'); assert.deepEqual(h[0].after, { mergeQueue: false });
  });
  t('Merge queue on: stacked queue, one-at-a-time lander off', () => { L.setMode(true, { by: 'test' }); for (const [k, v] of Object.entries(MODE_FLAGS.on)) assert.equal(cfg()[k], v, k); });
  t('pause switches the lander off and keeps the mode; resume restores it', () => {
    const p = L.pause({ why: 'hand landing', by: 'test' });
    assert.equal(p.status, 'paused'); assert.equal(p.pause.why, 'hand landing'); assert.equal(cfg().mergeQueue, false); assert.equal(cfg().autoLand, false);
    L.setMode(false, { by: 'test' }); assert.equal(cfg().autoLand, false, 'a flip while paused waits for resume');
    const r = L.resume({ by: 'test' }); assert.equal(r.paused, false); assert.equal(cfg().autoLand, true); assert.equal(cfg().mergeQueue, false);
    L.setMode(true, { by: 'test' });
  });
  t('land now asks first, then moves the PR to the head of the queue (never a merge)', () => {
    const first = L.landNow({ pr: 702 }); assert.equal(first.code, 'confirmation_required');
    assert.throws(() => L.landNow({ pr: 702, confirm: 'nope' }), /confirm token/);
    const ok = L.landNow({ pr: 702, confirm: first.confirm, by: 'test' }); assert.deepEqual(ok, { ok: true, pr: 702, position: 0, via: 'merge-queue' });
    assert.deepEqual(calls().pop(), ['queue', 'move', '702', '0', '--json']);
    const notQueued = L.landNow({ pr: 704 }); L.landNow({ pr: 704, confirm: notQueued.confirm });
    assert.deepEqual(calls().slice(-2).map((c) => c.slice(0, 2)), [['queue', 'add'], ['queue', 'move']]);
  });
  t('land now one at a time: the build of that PR lands next', () => {
    L.setMode(false, { by: 'test' });
    const f = L.landNow({ pr: 710 }); L.landNow({ pr: 710, confirm: f.confirm });
    assert.deepEqual(calls().pop(), ['now', 'notes', '--json']);
    const g = L.landNow({ pr: 999 }); assert.throws(() => L.landNow({ pr: 999, confirm: g.confirm }), /not a finished build/);
  });

  // ---------------------------------------------------------------- history
  seed();
  const st3 = createStore();
  t('history appends and filters by kind, pr, rule, since and limit, newest first', () => {
    H.record(st3, { kind: 'rule', action: 'toggle', id: 'theme', by: 'a', reason: { title: 't', description: 'd' } });
    H.record(st3, { kind: 'lander', action: 'land-now', pr: 702, by: 'b' });
    H.record(st3, { kind: 'lander', action: 'pause', by: 'c' });
    assert.deepEqual(H.read(st3).items.map((e) => e.action), ['pause', 'land-now', 'toggle']);
    assert.equal(H.read(st3, { kind: 'rule' }).items.length, 1); assert.equal(H.read(st3, { pr: 'pr702'.slice(2) }).items[0].by, 'b');
    assert.equal(H.read(st3, { rule: 'theme' }).items[0].reason.title, 't'); assert.equal(H.read(st3, { since: '2026-11-16' }).items.length, 0); assert.equal(H.read(st3, { limit: 1 }).items.length, 1);
  });
  t('history keeps at most its size (oldest dropped in one rewrite)', () => {
    st3.writeSettings({ historySize: 50 });
    for (let i = 0; i < 70; i++) H.record(st3, { kind: 'lander', action: 'pause', by: `x${i}` });
    const all = st3.readHistory(); assert.ok(all.length <= 60 && all.length >= 50); assert.equal(all[all.length - 1].by, 'x69');
  });

  // ---------------------------------------------------------------- ops
  seed();
  const g = createGate();
  t('rules ops: list, get, set, toggle, errors in words', () => {
    assert.equal(g.run('rules_list', { enabled: 'true' }).rules.length, 9);
    assert.equal(g.run('rules_get', { id: 'clash' }).default.id, 'clash');
    const set = g.run('rules_set', { id: 'theme', severity: 'warn', settings: { check: 'x.mjs' }, by: 'test' });
    assert.equal(set.rule.severity, 'warn'); assert.equal(set.before.severity, 'block'); assert.equal(set.rule.settings.check, 'x.mjs');
    assert.equal(g.run('rules_toggle', { id: 'theme', enabled: false }).rule.enabled, false);
    assert.equal(g.run('rules_set', { id: 'theme', severity: 'loud' }).code, 'invalid');
    assert.equal(g.run('rules_get', { id: 'nope' }).code, 'not_found');
    assert.equal(g.run('nope').code, 'invalid');
  });
  t('reset is two-step and puts the defaults back', () => {
    const a = g.run('rules_reset', { id: 'theme' }); assert.equal(a.code, 'confirmation_required'); assert.deepEqual(a.affects, ['theme']);
    const b = g.run('rules_reset', { id: 'theme', confirm: a.confirm }); assert.equal(b.ok, true);
    const theme = b.rules.rules.find((r) => r.id === 'theme'); assert.equal(theme.enabled, true); assert.equal(theme.severity, 'block');
    assert.equal(H.read(g.store, { rule: 'theme' }).items[0].action, 'reset');
  });
  t('check_pr: from the lander\'s facts, by pr or branch; unknown PRs wait', () => {
    const v = g.run('check_pr', { pr: 704 }); assert.equal(v.pass, false); assert.equal(v.blockedBy, 'clash');
    const byBranch = g.run('check_pr', { branch: 'claude/help-gate' }); assert.equal(byBranch.pr, 702); assert.equal(byBranch.held, true); assert.ok(byBranch.reasons.some((x) => x.startsWith('ui-review:')));
    const u = g.run('check_pr', { pr: 5 }); assert.equal(u.known, false); assert.equal(u.pass, false);
    assert.equal(g.run('check_pr', { snapshot: { number: 9, ci: 'success' } }).pass, true);
  });
  t('settings: defaults, validation, saved', () => {
    assert.deepEqual(g.run('settings_get').settings, { refreshSec: 30, historySize: 2000, defaultTab: 'rules' });
    assert.equal(g.run('settings_set', { settings: { refreshSec: 2 } }).code, 'invalid');
    assert.equal(g.run('settings_set', { refreshSec: '60' }).settings.refreshSec, 60);
  });

  // ---------------------------------------------------------------- CLI vs API (REST / MCP) parity
  seed();
  const node = (args, input) => spawnSync(process.execPath, [join(HERE, 'gate.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...ENV }, input: input === undefined ? undefined : JSON.stringify(input) });
  const api = (op, input = {}) => JSON.parse(node(['api', op], input).stdout.trim().split('\n').pop());
  const cli = (args) => { const r = node([...args, '--json']); return JSON.parse(r.stdout); };
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'confirm' ? '<token>' : v)));
  const same = (args, op) => {
    const p = parseCli(args); assert.equal(p.op, op, `${args.join(' ')} → ${op}`);
    seed(); const a = strip(cli(args)); seed(); const b = strip(api(op, p.input));
    assert.deepEqual(a, b, `axf gate ${args.join(' ')} == ${op}`);
  };
  t('every op is reachable from the CLI', () => {
    const reached = new Set([['rules', 'list'], ['rules', 'get', 'x'], ['rules', 'set', 'x', 'severity', 'warn'], ['rules', 'on', 'x'], ['rules', 'reset'], ['check', '1'], ['history'], ['lander', 'status'], ['lander', 'waiting'], ['lander', 'runs'], ['lander', 'mode'], ['lander', 'land-now', '1'], ['lander', 'pause'], ['lander', 'resume'], ['settings'], ['settings', 'set', 'refreshSec', '60'],
      ['build-rules', 'list'], ['build-rules', 'get', 'x'], ['build-rules', 'add', 'x', '--title', 't'], ['build-rules', 'edit', 'x', 'title', 't'], ['build-rules', 'on', 'x'], ['build-rules', 'delete', 'x'], ['build-rules', 'history'], ['build-rules', 'runs'], ['build-rules', 'run', 'b', '--phase', 'after'], ['build-rules', 'brief', 'b']].map((a) => parseCli(a).op));
    assert.deepEqual([...reached].sort(), [...OPS].sort());
  });
  t('CLI and API give the same record for the same input', () => {
    same(['rules', 'list'], 'rules_list');
    same(['rules', 'get', 'ci-green'], 'rules_get');
    same(['rules', 'set', 'theme', 'severity', 'warn', '--by', 'parity'], 'rules_set');
    same(['rules', 'off', 'ui-review', '--by', 'parity'], 'rules_toggle');
    same(['rules', 'set', 'clash', 'settings.fileFix', 'false', '--by', 'parity'], 'rules_set');
    same(['rules', 'reset', 'theme'], 'rules_reset');
    same(['check', '704'], 'check_pr');
    same(['history', '--kind', 'lander'], 'history');
    same(['lander', 'status'], 'lander_status');
    same(['lander', 'waiting', '--rule', 'clash'], 'lander_waiting');
    same(['lander', 'runs', '--limit', '5'], 'lander_runs');
    same(['lander', 'mode', 'off', '--by', 'parity'], 'lander_mode');
    same(['lander', 'land-now', '702'], 'lander_land_now');
    same(['lander', 'pause', '--why', 'parity', '--by', 'parity'], 'lander_pause');
    same(['settings'], 'settings_get');
    same(['settings', 'set', 'defaultTab', 'history'], 'settings_set');
  });
  t('build cap: the three numbers side by side, the note when they disagree, ranges, owner-only keys', async () => {
    const C = await import('./build-cap.mjs');
    assert.deepEqual(C.capNote({ hardCap: 4, stepsInParallel: 6 }), { effective: 4, note: 'Steps in parallel is 6 but the hard cap is 4: only 4 run at once.' });
    assert.equal(C.capNote({ hardCap: 4, stepsInParallel: 4 }).note, '');
    assert.equal(C.capNote({ hardCap: 4, stepsInParallel: 2 }).effective, 2);
    assert.deepEqual(C.capNote({ hardCap: null, stepsInParallel: undefined }), { effective: null, note: '' });
    const c = C.buildCap({ max: 4, live: 1, free: 3, emergency: { max: 2, live: 0 }, limit: { maxBuilds: 4, emergencySlots: 2, setBy: 'brett', setAt: '2026-11-18T00:00:00Z' } }, { stepsInParallel: 6 });
    assert.equal(c.$axf, 'build-cap@1'); assert.equal(c.hardCap, 4); assert.equal(c.emergencySlots, 2); assert.equal(c.stepsInParallel, 6); assert.equal(c.effective, 4); assert.equal(c.setBy, 'brett');
    assert.deepEqual(c.ownerOnly, ['maxBuilds', 'emergencySlots']);
    assert.equal(C.checkValue('stepsInParallel', '3'), 3);
    assert.throws(() => C.checkValue('stepsInParallel', 13), /1 to 12/); assert.throws(() => C.checkValue('stepsInParallel', '2.5'), /whole number/); assert.throws(() => C.checkValue('nope', 1), /unknown setting/);
    assert.match(C.line(c), /hard cap 4 .* emergency slots 2 .* steps in parallel 6\nSteps in parallel is 6/);
    // the CLI never writes an owner-only key, and says who can
    const r = spawnSync(process.execPath, [join(HERE, 'build-cap.mjs'), 'set', 'maxBuilds', '9', '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).code, 'forbidden');
  });
  t('passes have one home: the Passes tab is here, Token control keeps only the banner, the axHub pass pages keep their addresses', () => {
    const web = (f) => readFileSync(join(HERE, 'web', f), 'utf8');
    const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
    assert.match(web('api.ts'), /TABS = \['rules', 'build-rules', 'auto-lander', 'build-cap', 'passes', 'history'\]/);
    for (const v of ['view:gate', 'view:vps-configuration', 'view:axhub-passes', 'view:axhub-go-pass', 'action:axhub-passes.open', 'action:axhub-go-pass.open']) assert.ok(manifest.provides.includes(v), `provides ${v}`);
    const state = web('passesState.ts');
    for (const a of ['vps.passes.open', 'vps.passes.status', 'vps.passes.grant', 'vps.passes.revoke', 'vps.passes.max', 'axhub-passes.open', 'axhub-go-pass.open']) assert.ok(state.includes(`'${a}'`), `action ${a}`);
    for (const k of ['maxMinutes', 'timeZone']) assert.ok(state.includes(`setting:vps.passes.${k}`), `target ${k}`);
    const tab = web('PassesTab.tsx');
    for (const id of ['vps-pass-start', 'vps-pass-settings-save', 'vps-pass-approve-', 'vps-pass-deny-', 'vps-pass-undo-', 'vps-pass-revoke-']) assert.ok(tab.includes(id), `button ${id}`);
    assert.match(tab, /clampMinutes\(minutes, longest\)/, 'a new pass is held to the longest-pass setting');
    const tc = (f) => readFileSync(join(HERE, '../token-control/web', f), 'utf8'); // axf-plugin:token-control
    assert.ok(!/PassesTab|PassSettings/.test(tc('index.tsx') + tc('pass.tsx')), 'Token control no longer draws the passes');
    assert.ok(tc('index.tsx').includes('PassBanner') && tc('index.tsx').includes("vps.passes.open:veto"), 'Token control keeps the banner and links here');
    assert.ok(web('index.tsx').includes("'vps.open'") === false && readFileSync(join(HERE, 'web/actions.ts'), 'utf8').includes("'vps.open'") && readFileSync(join(HERE, 'web/actions.ts'), 'utf8').includes("'gate.open'"), 'vps.open is the new address, gate.open still works');
  });
  t('the CLI exits 3 when a press needs a confirm, 2 on a usage error', () => {
    seed(); assert.equal(node(['rules', 'reset']).status, 3); assert.equal(node(['rules', 'frobnicate']).status, 2);
  });
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`✓ gate — ${n} checks`);
