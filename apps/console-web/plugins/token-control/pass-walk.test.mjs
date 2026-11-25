#!/usr/bin/env node
/**
 * CI check (build approval-pass-covers-every-call, s10): an active `covers: all` pass covers every call.
 *
 * Walks every tool this repo registers and the policy each one gets (CONTROL.md → Recommended axHub policy,
 * AXHUB-PASS.md §2): the console MCP tools (mcp_server.py), the control@1 tools and every target × write op, every
 * plugin command, and the two calls the build names (`vps.run` on the veto countdown, `console_terminal_sessions_stop`
 * on a straight approval). For each veto, confirm and always-approve call it asks every decision point a call passes
 * here, and fails when one would still hold it:
 *
 *   - `passCoveringCall` / `coveringCall` (what axHub asks before a countdown, an approval or a notice),
 *   - `passCovering` / `coveringPass` (the control@1 runner: veto and the confirm token),
 *   - `plan` in plugin-commands (the console's own `confirmation_required`).
 *
 * It runs against three covers-all passes: one granted through the real store at the console's longest length, a
 * 24-hour one as the hub sends it, and a record stored before the `covers` field. The contract's decision table
 * (framework/schemas/axhub-pass.json `x-decision`) must say the same: run, no countdown, no prompt, no notice, logged.
 *
 * Only what the contract keeps outside every pass may still ask: the pass tools themselves and an irreversible call
 * the pass doesn't include. A tool registered later is walked the day it lands; one that isn't covered fails here.
 *
 *   node apps/console-web/plugins/token-control/pass-walk.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const T = mkdtempSync(join(tmpdir(), 'axf-pass-walk-'));
Object.assign(process.env, {
  AXF_APPEARANCE_FILE: join(T, 'appearance.json'), AXF_AMBERX_NOTES_DIR: join(T, 'notes'), AXF_CONTROL_DATA_DIR: join(T, 'data'),
  AXF_PLAN_TREE_DIR: join(T, 'plans'), AXF_ORCH_FILE: join(T, 'orch.json'), AXF_CONTROL_SALT: 'walk-salt',
  AXF_THREADS_FILE: join(T, 'THREADS.md'), AXF_PASS_SECRET: 'walk-secret', AXF_NO_TTY_APPROVAL: '1',
  AXF_PLUGIN_COMMANDS_DATA_DIR: join(T, 'plugin-commands'),
});
writeFileSync(process.env.AXF_APPEARANCE_FILE, JSON.stringify({ $axf: 'appearance@1', slots: { 'design-package': 'hub-default', layout: 'axhub-console' }, settings: {} }));

const ROOT = new URL('../../../../', import.meta.url);
const pc = await import('../../../../framework/core/engines/control-pass.mjs');
const rules = await import('../../../../framework/core/engines/control-rules.mjs');
const { commandToolName } = await import('../../../../framework/core/engines/plugin-commands.mjs');
const { runControl } = await import('./control.mjs');
const passLib = await import('./lib/pass.mjs');
const { plan, registry } = await import('../plugin-commands/commands.mjs');

const SERVICE = pc.PASS_CONSOLE_SERVICE;
/** The policies a pass lifts → what the log calls the one it skipped (PASS_SKIPPED_POLICIES). */
const SKIPPED = { veto: 'veto', confirm: 'confirm', 'always-approve': 'explicit' };
const HELD = Object.keys(SKIPPED);
/** The pass tools: never covered by any pass (CONTROL.md → Scopes; AXHUB-PASS.md §2 "owner-grant"). */
const isPassTool = (tool) => pc.PASS_TOOL.test(tool);

/* ------------------------------------------------------------------ the registered tools and their policies */

/** tool → { service, tool, policy, from }. First registration wins; a tool seen twice must get the same policy. */
const tools = new Map();
function register(service, tool, policy, from) {
  const key = `${service}.${tool}`;
  const had = tools.get(key);
  if (had) { assert.equal(had.policy, policy, `${key} is registered twice with different policies (${had.from}: ${had.policy}, ${from}: ${policy})`); return; }
  tools.set(key, { service, tool, policy, from });
}

// 1. the console MCP server: the policy follows the annotation (CONTROL.md → Recommended axHub policy)
const ANNOTATION_POLICY = { READ: 'allow', NAVIGATE: 'allow', WRITE: 'veto', IDEMPOTENT: 'veto', DESTRUCTIVE: 'confirm' };
{
  const src = readFileSync(new URL('apps/console-web/server/mcp_server.py', ROOT), 'utf8');
  const decorated = [...src.matchAll(/@mcp\.tool\(annotations=([A-Z_]+)\)\s*\n\s*async def (\w+)\(/g)];
  for (const [, ann, name] of decorated) {
    assert.ok(ann in ANNOTATION_POLICY, `mcp_server.py: ${name} has an annotation this walk doesn't know (${ann}); give it a policy in ANNOTATION_POLICY`);
    register(SERVICE, name, ANNOTATION_POLICY[ann], 'mcp_server.py');
  }
  // the pass tools are registered in one loop, each under two names
  const loop = src.match(/for fn, ann in \(([^\n]+)\):\n\s*mcp\.tool\(annotations=ann\)\(fn\)\n\s*mcp\.tool\(name=f"token_\{fn\.__name__\}"/);
  assert.ok(loop, 'mcp_server.py: the pass tools loop is where this walk reads it');
  const looped = [...loop[1].matchAll(/\((\w+), ([A-Z_]+)\)/g)];
  for (const [, name, ann] of looped) for (const n of [name, `token_${name}`]) register(SERVICE, n, ANNOTATION_POLICY[ann], 'mcp_server.py');
  // every registration in the file is one of the two forms above: a new form must be taught to this walk, not skipped
  const registrations = (src.match(/\bmcp\.tool\(/g) ?? []).length;
  assert.equal(decorated.length + 2, registrations, `mcp_server.py registers ${registrations} tools but this walk reads ${decorated.length + 2}: a tool is registered in a form the walk doesn't parse`);
  assert.ok(decorated.length > 50 && looped.length >= 4, 'the walk found the console MCP tools');
}

// 2. the control@1 tools (one per op), as every MCP server exposing control@1 publishes them
const EFFECT_POLICY = { read: 'allow', navigate: 'allow', write: 'veto', destructive: 'confirm' };
for (const t of rules.controlTools()) register(SERVICE, t.name, EFFECT_POLICY[t.effect], 'controlTools()');

// 3. every plugin command (MCP tool `<plugin>_<command>`); one that asks for the console's confirm token is always-approve
const reg = registry({ apps: ['console-web'] });
const commands = [];
for (const p of reg.plugins) {
  if (p.app !== 'console-web') continue;
  for (const c of p.commands) {
    const tool = c.tool || commandToolName(p.folder, c.id);
    const policy = c.kind === 'read' || c.effect === 'read' ? 'allow' : c.confirm ? 'always-approve' : EFFECT_POLICY[c.effect];
    assert.ok(policy, `${p.folder}/${c.id}: effect ${c.effect} has no policy in this walk`);
    commands.push({ plugin: p, cmd: c, tool, policy });
    if (!tools.has(`${SERVICE}.${tool}`)) register(SERVICE, tool, policy, `plugin ${p.folder}`);
  }
}

// 4. the calls the build names, as the hub holds them
register('vps', 'run', 'veto', 'axHub: a shell on the veto countdown');
assert.equal(tools.get(`${SERVICE}.console_terminal_sessions_stop`)?.policy, 'always-approve', 'console_terminal_sessions_stop is registered and asks for a straight approval');

/* ------------------------------------------------------------------ the passes */

const now = Date.now();
const granted = await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'grant', input: { minutes: pc.PASS_MAX_MINUTES }, by: 'walk' }, { approver: { via: 'console', name: 'brett' } });
assert.equal(granted.ok, true, `the walk's pass was granted: ${granted.message ?? ''}`);
const stored = passLib.loadPasses(now).passes.find((p) => p.id === granted.item.id);
assert.ok(stored && pc.passActive(stored, now), 'the granted pass is active in the store');
assert.equal(pc.passCoversOf(stored), 'all', 'a grant that names nothing covers all');

const iso = (ms) => new Date(now + ms).toISOString();
const PASSES = [
  { name: `console store, ${pc.PASS_MAX_MINUTES} min`, pass: stored },
  { name: 'hub pass, 24 hours', pass: { id: 'walk-24h', scope: 'all', covers: 'all', state: 'active', expiresAt: iso(24 * 3600e3) } },
  { name: 'stored before covers', pass: { id: 'walk-old', scope: 'all', state: 'active', expiresAt: iso(3600e3) } },
];
const withIrreversible = { id: 'walk-irr', scope: 'all', covers: 'all', state: 'active', includeIrreversible: true, expiresAt: iso(3600e3) };
const ended = { id: 'walk-ended', scope: 'all', covers: 'all', state: 'active', expiresAt: iso(-1000) };
const revoked = { id: 'walk-revoked', scope: 'all', covers: 'all', state: 'revoked', expiresAt: iso(3600e3) };

/* ------------------------------------------------------------------ the walk */

const leaks = [];
const leak = (what, why) => leaks.push(`${what}: ${why}`);
const counts = { allow: 0, veto: 0, confirm: 0, 'always-approve': 0, passTools: 0, targets: 0, commands: 0, irreversible: 0 };

// a. every registered tool, as a call axHub holds
for (const { service, tool, policy, from } of tools.values()) {
  const what = `${service}.${tool} (${policy}, ${from})`;
  const call = { service, tool };
  if (isPassTool(tool)) {
    counts.passTools++;
    for (const { name, pass } of PASSES) if (pc.passCoveringCall([pass], call, now)) leak(what, `a pass tool is covered by the ${name} pass; no pass may run one`);
    if (service === SERVICE && passLib.coveringCall(call, now)) leak(what, 'a pass tool is covered by the stored pass');
    continue;
  }
  counts[policy]++;
  if (!HELD.includes(policy)) continue; // allow: runs anyway, no pass is used
  for (const { name, pass } of PASSES) {
    const hit = pc.passCoveringCall([pass], call, now);
    if (hit?.id !== pass.id) { leak(what, `not covered by the ${name} pass: it would still ${policy === 'veto' ? 'count down' : 'prompt'} and notify`); continue; }
    const log = pc.passRanUnder(hit, SKIPPED[policy]);
    if (log.ranUnder !== pass.id || log.skippedPolicy !== SKIPPED[policy]) leak(what, `the run is not logged under the ${name} pass (${JSON.stringify(log)})`);
  }
  if (passLib.coveringCall(call, now)?.id !== stored.id) leak(what, 'the pass check the hub asks (coveringCall) does not answer the stored pass');
  // the walk means something: with no pass, an ended pass or a revoked one the same call is held
  for (const p of [[], [ended], [revoked]]) if (pc.passCoveringCall(p, call, now)) leak(what, `covered with ${p[0]?.id ?? 'no pass'}`);
}

// b. every control@1 target × write op, as the runner decides it (veto, and the confirm token on a remove)
for (const [target, def] of Object.entries(rules.CONTROL_TARGETS)) {
  for (const op of def.ops.filter((o) => pc.PASS_ALL_OPS.includes(o))) {
    const cmd = { op, target, path: 'x', ...(op === 'act' ? { action: 'x' } : {}) };
    const what = `control@1 ${op} ${target}`;
    const irreversible = rules.controlIrreversible(cmd);
    const excluded = pc.PASS_EXCLUDED_TARGETS.includes(target);
    counts.targets++;
    for (const { name, pass } of PASSES) {
      const hit = pc.passCovering([pass], cmd, now, { irreversible });
      if (excluded) { if (hit) leak(what, `the pass target is covered by the ${name} pass`); continue; }
      if (irreversible) { if (hit) leak(what, `an irreversible command is covered by the ${name} pass, which does not include them`); continue; }
      if (hit?.id !== pass.id) leak(what, `not covered by the ${name} pass`);
    }
    const viaStore = passLib.coveringPass(cmd, now);
    if (excluded || irreversible) { if (viaStore) leak(what, 'covered by the stored pass'); } else if (viaStore?.id !== stored.id) leak(what, 'the runner (coveringPass) does not answer the stored pass');
    if (irreversible) {
      counts.irreversible++;
      if (pc.passCovering([withIrreversible], cmd, now, { irreversible })?.id !== withIrreversible.id) leak(what, 'not covered by a pass that includes irreversible commands');
    }
    if (pc.passCovering([ended], cmd, now, { irreversible }) || pc.passCovering([], cmd, now, { irreversible })) leak(what, 'covered with no active pass');
  }
}

// c. every plugin command, through the console's own confirm layer
let asked = 0;
for (const { plugin, cmd, tool, policy } of commands) {
  if (cmd.kind === 'read' || plugin.enabled === false) continue;
  const what = `${plugin.folder}/${cmd.id} (${tool}, ${policy})`;
  // placeholders for the required input: the confirm is decided before any input reaches the plugin
  const props = cmd.input?.properties ?? {};
  const input = Object.fromEntries((cmd.input?.required ?? []).map((k) => {
    const s = props[k] ?? {};
    return [k, Array.isArray(s.enum) ? s.enum[0] : s.type === 'number' || s.type === 'integer' ? 1 : s.type === 'boolean' ? true : s.type === 'array' ? [] : s.type === 'object' ? {} : 'x'];
  }));
  const command = { op: 'act', target: 'plugins.commands', path: `${plugin.folder}/${cmd.id}`, action: 'run', input };
  counts.commands++;
  const bare = plan(command, { reg });
  if (cmd.confirm) {
    if (bare.code !== 'confirmation_required') { leak(what, `the walk could not reach its confirm (${bare.code ?? 'ran'}: ${bare.message ?? ''}); fix the placeholders`); continue; }
    asked++;
  }
  const ways = [
    ...PASSES.map(({ name, pass }) => ({ name: `${name} pass sent with the call`, opts: { pass } })),
    ...PASSES.map(({ name, pass }) => ({ name: `${name} pass on the console`, opts: { passes: [pass] } })),
    { name: 'stored pass, read when asked', opts: { passes: (at) => passLib.loadPasses(at).passes } },
  ];
  for (const { name, opts } of ways) {
    const r = plan(command, { reg, ...opts });
    if (cmd.irreversible === true && cmd.confirm) { if (r.code !== 'confirmation_required') leak(what, `irreversible, yet the ${name} lifted its confirm`); continue; }
    if (r.code === 'confirmation_required') { leak(what, `still answers confirmation_required under the ${name}`); continue; }
    if (cmd.confirm && r.dispatch && (!r.ranUnder || r.skippedPolicy !== 'confirm')) leak(what, `ran under the ${name} without saying so (ranUnder ${r.ranUnder}, skippedPolicy ${r.skippedPolicy})`);
  }
  if (cmd.confirm) {
    if (cmd.irreversible === true && plan(command, { reg, pass: withIrreversible }).code === 'confirmation_required') leak(what, 'still asks under a pass that includes irreversible commands');
    for (const p of [ended, revoked]) if (plan(command, { reg, pass: p }).code !== 'confirmation_required') leak(what, `${p.id} lifted its confirm`);
  }
}

/* ------------------------------------------------------------------ the contract says the same */

const decision = JSON.parse(readFileSync(new URL('framework/schemas/axhub-pass.json', ROOT), 'utf8'))['x-decision'];
for (const policy of HELD) {
  const d = decision?.policies?.[policy];
  assert.deepEqual(d && { underPass: d.underPass, ranUnder: d.ranUnder, countdown: d.countdown, prompt: d.prompt, notice: d.notice },
    { underPass: 'run', ranUnder: true, countdown: false, prompt: false, notice: false }, `axhub-pass.json x-decision: ${policy} runs at once under a pass, logged`);
  assert.ok(pc.PASS_SKIPPED_POLICIES.includes(SKIPPED[policy]), `the log can name ${policy} as the policy skipped`);
}
assert.equal(decision.policies.deny.underPass, 'deny', 'no pass lifts a deny');
const pub = passLib.publication().body;
assert.equal(pub.coversDefault, 'all', 'the publication says a pass covers all by default');
assert.deepEqual(pub.skippedPolicies, pc.PASS_SKIPPED_POLICIES);
assert.equal(pub.active.find((p) => p.id === stored.id)?.covers, 'all', 'the published pass shows what it covers');

/* ------------------------------------------------------------------ the answer */

rmSync(T, { recursive: true, force: true });
assert.ok(counts.veto > 20 && counts.confirm > 0 && counts['always-approve'] > 0 && asked > 0 && counts.targets > 10 && counts.passTools >= 8, `the walk reached every policy class (${JSON.stringify(counts)})`);
if (leaks.length) {
  console.error(`✗ pass walk: ${leaks.length} call(s) an active covers-all pass does not cover\n  ${leaks.slice(0, 60).join('\n  ')}${leaks.length > 60 ? `\n  … and ${leaks.length - 60} more` : ''}`);
  process.exit(1);
}
console.log(`✓ pass walk: a covers-all pass covers ${counts.veto} veto, ${counts.confirm} confirm and ${counts['always-approve']} always-approve tools (${tools.size} registered, ${counts.allow} allow, ${counts.passTools} pass tools never covered), ${counts.targets} control@1 target ops (${counts.irreversible} irreversible keep their guard), ${counts.commands} plugin commands (${asked} confirms lifted)`);
