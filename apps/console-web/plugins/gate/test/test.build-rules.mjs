#!/usr/bin/env node
/**
 * Build rules in the Gate plugin (build-rules@1): REST / MCP / CLI parity, the home-card fixer on a plugin without a
 * card, the gate blocking then fixing, and the dispatcher's brief carrying the store's session rules (never a VPS rule).
 * Everything runs on temp folders: a temp store (AXF_BUILD_RULES_DIR), a temp gate data folder and a temp repo root.
 *   node apps/console-web/plugins/gate/test/test.build-rules.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, '..');
const ROOT = resolve(PLUGIN, '../../../..');
const TMP = mkdtempSync(join(tmpdir(), 'axf-build-rules-test-'));
const STORE = join(TMP, 'store'); const GATE = join(TMP, 'gate');
process.env.AXF_BUILD_RULES_DIR = STORE; process.env.AXF_GATE_DIR = GATE; process.env.AXF_GATE_LANDER_DIR = join(TMP, 'lander'); process.env.AXF_GATE_LANDER_CLI = '';
mkdirSync(join(TMP, 'lander'), { recursive: true });

const BR = await import('../../../../../framework/core/build-rules.mjs');
const { createGate, parseCli } = await import('../gate.mjs');
const runner = await import('../build-rules-runner.mjs');
const homeCard = await import('../fixers/home-card.mjs');
const lander = await import('../../../../../deploy/lander/lander-core.mjs');

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const reset = () => { rmSync(STORE, { recursive: true, force: true }); rmSync(GATE, { recursive: true, force: true }); };
// times differ run to run: compare records without them
const TIME_KEYS = new Set(['at', 'createdAt', 'updatedAt', 'confirm', 'path']);
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (TIME_KEYS.has(k) ? '<x>' : v)));

// ------------------------------------------------------------------ REST / MCP / CLI parity

const node = (args, input) => spawnSync(process.execPath, [join(PLUGIN, 'gate.mjs'), ...args], { encoding: 'utf8', env: process.env, input: input === undefined ? undefined : JSON.stringify(input) });
const api = (op, input = {}) => JSON.parse(node(['api', op], input).stdout.trim().split('\n').pop());
const cli = (args) => JSON.parse(node([...args, '--json']).stdout);
const same = (args, op) => {
  const p = parseCli(args); assert.equal(p.op, op, `${args.join(' ')} → ${op}`);
  reset(); const a = strip(cli(args)); reset(); const b = strip(api(op, p.input));
  assert.deepEqual(a, b, `axf gate ${args.join(' ')} == ${op}`);
};

t('CLI and REST (and so MCP) give the same record for the same input', () => {
  same(['build-rules', 'list', '--doer', 'vps'], 'build_rules_list');
  same(['build-rules', 'get', 'home-card'], 'build_rules_get');
  same(['build-rules', 'off', 'home-card', '--by', 'parity'], 'build_rules_toggle');
  same(['build-rules', 'edit', 'home-card', 'note', 'Brett', 'owns', 'it', '--by', 'parity'], 'build_rules_edit');
  same(['build-rules', 'add', 'parity-rule', '--title', 'T', '--text', 'Do T', '--doer', 'session', '--kind', 'judgement', '--phase', 'dispatch', '--by', 'parity'], 'build_rules_add');
  same(['build-rules', 'delete', 'home-card'], 'build_rules_delete');
  same(['build-rules', 'brief', 'b1', '--title', 'a settings screen'], 'build_rules_brief');
});

t('every REST route is an MCP tool (plugin-commands item) and every op a CLI word', () => {
  const py = readFileSync(join(PLUGIN, 'server/routes.py'), 'utf8');
  const routes = [...py.matchAll(/@router\.(get|post|put|delete)\("(\/build-rules[^"]*)"/g)].map((m) => `${m[1].toUpperCase()} ${m[2].replace(/\{[^}]+\}/g, '{}')}`).sort();
  const items = JSON.parse(readFileSync(join(PLUGIN, 'plugin.json'), 'utf8')).commands.items.filter((c) => c.id.startsWith('build-rules-'));
  assert.deepEqual(items.map((c) => c.route.replace(/\{[^}]+\}/g, '{}')).sort(), routes);
  assert.ok(items.every((c) => c.tool === `gate_${c.id.replace(/-/g, '_')}`), 'tools are gate_build_rules_*');
  assert.ok(items.find((c) => c.id === 'build-rules-delete').confirm, 'delete is two-step');
});

t('delete is two-step: the first call answers a token, a wrong token is refused, the right one removes it, History keeps it', () => {
  reset();
  const g = createGate();
  const first = g.run('build_rules_delete', { id: 'home-card' });
  assert.equal(first.code, 'confirmation_required');
  assert.equal(g.run('build_rules_delete', { id: 'home-card', confirm: 'nope' }).code, 'invalid');
  const done = g.run('build_rules_delete', { id: 'home-card', confirm: first.confirm });
  assert.equal(done.removed, 'home-card');
  assert.equal(g.run('build_rules_get', { id: 'home-card' }).code, 'not_found');
  assert.ok(BR.history({ dir: STORE, id: 'home-card' }).some((h) => h.action === 'remove' && h.before?.id === 'home-card'));
});

// ------------------------------------------------------------------ the home-card fixer

/** A temp repo root with one plugin that has a read command and no home card. */
function fakeRoot() {
  const root = join(TMP, `root-${n}-${Math.random().toString(36).slice(2, 7)}`);
  const dir = join(root, 'apps/console-web/plugins/demo-plugin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ $axf: 'plugin@1', id: 'ai.test.demo', name: 'Demo plugin', description: 'A demo plugin for the tests. It lists things.', provides: ['view:demo-plugin'], commands: { $axf: 'plugin-commands@1', auto: true, items: [{ id: 'things-list', route: 'GET /things', title: 'Things: list', readOnly: true }] } }));
  return { root, dir };
}

t('home-card: a plugin without a card fails the check, a dry run writes nothing, the fix writes a valid card@1, a second fix changes nothing', () => {
  const { root, dir } = fakeRoot();
  const ctx = { root, plugins: ['demo-plugin'] };
  assert.equal(homeCard.check(ctx).ok, false);
  const dry = homeCard.fix(ctx, { dryRun: true });
  assert.deepEqual(dry.planned, ['apps/console-web/plugins/demo-plugin/assets/card/home.json']);
  assert.equal(existsSync(join(dir, 'assets/card/home.json')), false);
  const fix = homeCard.fix(ctx);
  assert.equal(fix.changed.length, 1);
  const card = JSON.parse(readFileSync(join(dir, 'assets/card/home.json'), 'utf8'));
  assert.equal(card.type, 'card'); assert.ok(card.tags.includes('home'));
  assert.deepEqual(card.data.source, { kind: 'command', plugin: 'demo-plugin', command: 'things-list' });
  assert.equal(homeCard.check(ctx).ok, true);
  assert.deepEqual(homeCard.fix(ctx).changed, [], 'idempotent');
});

// ------------------------------------------------------------------ the gate: block, fix, re-check, History

const rule = (id, extra) => ({ id, title: id, text: `rule ${id}`, doer: 'vps', kind: 'mechanical', phase: 'gate', enabled: true, ...extra });

t('the gate runs the home-card rule, fixes it, re-checks it and logs it; an unfixable rule blocks', async () => {
  reset();
  const { root } = fakeRoot();
  const store = { rules: [rule('home-card', { check: 'store:home-card', autofix: 'home-card' }), rule('always-red', { check: 'node -e process.exitCode=3' })] };
  const out = await runner.runPhase('b1', 'gate', { store, dir: STORE, ctx: { root, cwd: root, direct: true, build: { id: 'b1', plugins: ['demo-plugin'] } } });
  const by = Object.fromEntries(out.runs.map((r) => [r.id, r]));
  assert.equal(by['home-card'].result, 'fixed');
  assert.equal(by['always-red'].result, 'fail');
  assert.equal(out.ok, false, 'a failing rule blocks');
  const runs = runner.readRuns({ dir: STORE, build: 'b1' });
  assert.deepEqual(runs.map((r) => r.id).sort(), ['always-red', 'home-card']);
  const gateHist = readFileSync(join(GATE, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(gateHist.some((h) => h.kind === 'build-rule' && h.id === 'home-card' && h.action === 'fixed'), 'gate History has the fix');
  // the gate verdict for that build is blocked by the build rules, and the lander answers it with a fix
  const g = createGate();
  const v = g.run('check_pr', { snapshot: { number: 9, head: 'h', ci: 'success' }, build: 'b1', rulesDir: STORE });
  assert.equal(v.pass, false); assert.deepEqual(v.buildRules.failing, ['always-red']);
  assert.equal(lander.failure({ id: 'b1' }, 'rules', { failing: v.buildRules.failing }).failure.retry, 'fix', 'the lander answers failing rules with a fix session');
  // the second run: the card is there, so home-card passes without a fix
  const again = await runner.runPhase('b1', 'gate', { store, dir: STORE, rules: ['home-card'], ctx: { root, cwd: root, build: { id: 'b1', plugins: ['demo-plugin'] } } });
  assert.equal(again.runs[0].result, 'pass');
});

t('before / after take only VPS rules; a dry run fixes nothing and writes no history', async () => {
  reset();
  const { root, dir } = fakeRoot();
  const store = { rules: [rule('home-card', { phase: 'after', check: 'store:home-card', autofix: 'home-card' }), { ...rule('s-rule', { phase: 'after' }), doer: 'session', kind: 'judgement' }] };
  const out = await runner.runPhase('b2', 'after', { store, dir: STORE, dryRun: true, ctx: { root, build: { id: 'b2', plugins: ['demo-plugin'] } } });
  assert.deepEqual(out.runs.map((r) => r.id), ['home-card']);
  assert.deepEqual(out.runs[0].fix.planned, ['apps/console-web/plugins/demo-plugin/assets/card/home.json']);
  assert.equal(existsSync(join(dir, 'assets/card/home.json')), false);
  assert.deepEqual(runner.readRuns({ dir: STORE }), []);
});

t('command checks never run at launch: a before / after command rule runs at the gate (the lander\'s CI step)', async () => {
  const store = { rules: [
    rule('one-builds-store', { phase: 'before', check: 'node framework/cli/builds-store.mjs verify' }),
    rule('home-card', { phase: 'before', check: 'store:home-card', autofix: 'home-card' }),
    rule('end-check', { phase: 'after', check: 'node -e 0' }),
    rule('gate-own', { check: 'node -e 0' }),
  ] };
  assert.deepEqual(runner.rulesFor(store, 'before').map((r) => r.id), ['home-card'], 'launch keeps its fixers only');
  assert.deepEqual(runner.rulesFor(store, 'after').map((r) => r.id), []);
  assert.deepEqual(runner.rulesFor(store, 'gate').map((r) => r.id).sort(), ['end-check', 'gate-own', 'one-builds-store']);
  assert.ok(runner.deferredToGate(store.rules[0]) && !runner.deferredToGate(store.rules[1]));
});

// ------------------------------------------------------------------ the dispatcher's brief

t('the server fills in a new rule and drops a fixer nobody would run', () => {
  reset();
  const g = createGate();
  const bare = g.run('build_rules_add', { rule: { id: 'bare-rule', title: 'Bare', text: 'Bare.' }, by: 'test' });
  assert.equal(bare.ok, true, bare.message); assert.equal(bare.rule.doer, 'session'); assert.equal(bare.rule.phase, 'dispatch'); assert.equal(bare.rule.briefBlock, 'rules');
  const withFixer = g.run('build_rules_add', { rule: { id: 'fixer-rule', title: 'F', text: 'F.', doer: 'session', kind: 'judgement', phase: 'dispatch', autofix: 'home-card' }, by: 'test' });
  assert.equal(withFixer.ok, true, withFixer.message); assert.equal(withFixer.rule.autofix, '');
  const vps = g.run('build_rules_add', { rule: { id: 'vps-rule', title: 'V', text: 'V.', doer: 'vps', kind: 'mechanical', phase: 'after', autofix: 'home-card' }, by: 'test' });
  assert.equal(vps.rule.autofix, 'home-card');
  assert.equal(g.run('build_rules_edit', { id: 'vps-rule', patch: { doer: 'session', phase: 'dispatch' }, by: 'test' }).rule.autofix, '');
});

t("the dispatcher's brief carries the store's session rules and never a VPS rule", async () => {
  reset();
  const g = createGate();
  assert.equal(g.run('build_rules_add', { rule: { id: 'brief-probe', title: 'Probe', text: 'PROBE: say the magic word in the PR.', doer: 'session', kind: 'judgement', phase: 'dispatch', briefBlock: 'rules' }, by: 'test' }).ok, true);
  const P = await import('../../build-orchestrator/pipeline.mjs'); // axf-not-plugin:build-orchestrator (test only)
  const OC = await import('../../build-orchestrator/web/orchestrator-core.mjs'); // axf-not-plugin:build-orchestrator (test only)
  const b = OC.normalizeState({ builds: [{ id: 'probe-build', title: 'A settings screen for probes', status: 'queued', steps: [{ id: 's1', text: 'do it', model: 'Opus', estimate: '10 min' }] }] }).builds[0];
  const brief = P.briefFor(b, OC.DEFAULT_RULES, { account: 'a', model: 'Opus' });
  assert.match(brief, /PROBE: say the magic word in the PR\./);
  assert.match(brief, /^Look: UI code/m); assert.match(brief, /^API: Everything comes with an API/m);
  const home = BR.load({ dir: STORE }).store.rules.find((r) => r.id === 'home-card');
  assert.ok(!brief.includes(home.text), 'the VPS rule never reaches the brief');
});

try {
  for (const [name, fn] of tests) { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`✓ gate build rules — ${n} checks`);
