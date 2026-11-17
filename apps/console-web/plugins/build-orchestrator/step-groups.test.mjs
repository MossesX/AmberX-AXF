#!/usr/bin/env node
/**
 * step-groups@1 end to end (framework/spec/BUILD-GROUPS.md): a long build is split by a fake `claude` in
 * HOME/.local/bin (the real splitter path: prompt, answer with files and dependsOn, planGroups), queued, and the
 * dispatcher (pipeline.mjs tick, fake launcher, scratch store, mkdir worktrees) starts two independent groups in two
 * slots while the dependent group waits; merge order holds; a merge conflict raises the banner item and the
 * group-conflict alert; Fix with Claude and the last merge make the build built. Then the REST / MCP / CLI parity of
 * every orchestrator-groups-* command. Run: node apps/console-web/plugins/build-orchestrator/step-groups.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log(`  ✓ ${name}`); };

const tmp = mkdtempSync(join(tmpdir(), 'axf-step-groups-'));
const home = join(tmp, 'home'); const bin = join(home, '.local', 'bin');
const storeFile = join(tmp, 'store.json'); const pipeDir = join(tmp, 'pipeline'); const slotsDir = join(tmp, 'slots'); const hdir = join(tmp, 'headless');
const accountsDir = join(tmp, 'accounts'); const workersDir = join(tmp, 'workers'); const wtRoot = join(tmp, 'worktrees');
for (const d of [bin, pipeDir, slotsDir, hdir, accountsDir, workersDir, wtRoot]) mkdirSync(d, { recursive: true });
for (const name of ['console', 'w-max', 'w-pro']) { mkdirSync(join(accountsDir, name), { recursive: true }); writeFileSync(join(accountsDir, name, '.credentials.json'), '{}'); }
writeFileSync(join(accountsDir, '.active'), 'console\n');
writeFileSync(join(workersDir, 'seen.json'), JSON.stringify({ console: { email: 'c@x', plan: 'max' }, 'w-max': { email: 'max@x', plan: 'max' }, 'w-pro': { email: 'pro@x', plan: 'pro' } }));
writeFileSync(join(workersDir, 'workers.json'), JSON.stringify({ workers: ['w-max', 'w-pro'] }));

// the fake claude: keeps the prompt, answers like `claude -p --output-format json` with a split that names files and
// dependsOn: s1 + s4 share a.mjs (one group), s2 stands alone, s3 needs s1 (its group waits for s1's group to merge)
const answer = { steps: [
  { text: 'Engine core in a.mjs', model: 'Opus', estimate: '10 min', files: ['a.mjs'] },
  { text: 'Panel in b.tsx', model: 'Opus', estimate: '10 min', files: ['b.tsx'] },
  { text: 'REST routes on the engine', model: 'Opus', estimate: '10 min', files: ['c.py'], dependsOn: ['s1'] },
  { text: 'Engine tests next to a.mjs', model: 'Opus', estimate: '10 min', files: ['a.mjs', 'a.test.mjs'] },
] };
writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash
cat > "${tmp}/split-prompt.txt"
printf '%s' ${JSON.stringify(JSON.stringify({ type: 'result', result: JSON.stringify(answer) }))}
`); chmodSync(join(bin, 'claude'), 0o755);

// the fake launcher: records the call, spends the dispatch token (with the group key) and "starts" axf-<name>
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "${tmp}/launches.log"
name=""; account=""
while [[ $# -gt 0 ]]; do case "$1" in --name) name="$2"; shift 2;; --account) account="$2"; shift 2;; --) shift;; *) shift;; esac; done
node "${ROOT}/framework/cli/dispatch-gate.mjs" consume --name "$name" >> "${tmp}/gate.log" 2>&1 || echo "GATE-REFUSED $name" >> "${tmp}/gate.log"
echo "{\\"event\\":\\"session-start\\",\\"session\\":\\"axf-$name\\",\\"name\\":\\"$name\\",\\"account\\":\\"$account\\",\\"at\\":\\"$(date -u +%FT%TZ)\\"}" >> "${hdir}/events.jsonl"
echo "started axf-$name in $(pwd)"
`); chmodSync(launcher, 0o755);

const env = { ...process.env, AXF_BUILD_LIMIT: 'off', HOME: home, PATH: `${process.env.PATH}`, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: pipeDir,
  AXF_SLOTS_DIR: slotsDir, AXF_SLOTS_TMUX: 'off', AXF_SLOTS_MEM_GB: '8', AXF_HEADLESS_DIR: hdir, AXF_CLAUDE_ACCOUNTS: accountsDir, AXF_CLAUDE_SEEN: join(workersDir, 'seen.json'),
  AXF_CLAUDE_WORKERS: workersDir, AXF_CLAUDE_HOME: join(tmp, 'claude-home'), AXF_CLAUDE_GLOBAL: join(tmp, 'claude.json'), AXF_PIPELINE_LAUNCHER: launcher,
  AXF_PIPELINE_WORKTREES: wtRoot, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_PIPELINE_SETTINGS: JSON.stringify({ parallelPerAccount: 1, idleAfterMin: 0, splitProvider: 'claude', healthEveryMin: 0 }),
  AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all', AXF_CREW_SAY: 'off', AXF_BUILD_RULES: 'off' };
delete env.AXF_PIPELINE_SPLITTER;
mkdirSync(join(tmp, 'claude-home'), { recursive: true }); writeFileSync(join(tmp, 'claude.json'), '{}');
const run = (file, ...args) => { const r = spawnSync(process.execPath, [join(HERE, file), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0 && !args.includes('--expect-fail')) throw new Error(`${file} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`); return r; };
const json = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
const pipe = (...a) => json(run('pipeline.mjs', ...a, '--json'));
const orch = (...a) => run('orchestrator.mjs', ...a);
const build = () => JSON.parse(readFileSync(storeFile, 'utf8')).builds.find((b) => b.id === 'gamma');
const group = (gid) => build().groups.find((g) => g.id === gid);
const endSession = (gid, exit = 0, kind = 'phase-done') => appendFileSync(join(hdir, 'events.jsonl'), `${JSON.stringify({ event: 'session-end', session: group(gid).session, exit, kind, at: new Date().toISOString() })}\n`);
const tick = (gid) => orch('act', 'step', 'gamma', gid, 'done');

console.log('step-groups (end to end)');
try {
  orch('act', JSON.stringify({ action: 'add', id: 'gamma', title: 'Gamma, a long build', detail: 'Build the gamma engine, its panel, its API and tests.', said: 'split it over slots, kid' }));

  t('intake: the fake claude in HOME/.local/bin splits it with files and dependsOn; 40 min over 30 = 3 groups', () => {
    const r = pipe('intake');
    assert.deepEqual(r.split.map((x) => x.id), ['gamma']); assert.equal(r.split[0].provider, 'claude', JSON.stringify(r.split[0]));
    assert.match(readFileSync(join(tmp, 'split-prompt.txt'), 'utf8'), /"dependsOn"/, 'the prompt asks for dependsOn');
    const b = build();
    assert.deepEqual(b.steps.find((s) => s.id === 's3').dependsOn, ['s1']);
    assert.deepEqual(b.groups.map((g) => [g.id, g.steps, g.dependsOn]), [['g1', ['s1', 's4'], []], ['g2', ['s2'], []], ['g3', ['s3'], ['g1']]]);
    assert.deepEqual(b.steps.map((s) => s.group), ['g1', 'g2', 'g3', 'g1']);
  });

  pipe('queue', 'gamma');
  t('tick: two independent groups start in two slots on two accounts; the dependent group waits for g1 to merge', () => {
    const r = pipe('tick');
    assert.deepEqual(r.launched.map((l) => l.group).sort(), ['g1', 'g2'], JSON.stringify({ waits: r.plan.waits, failed: r.failed }));
    assert.equal(new Set(r.launched.map((l) => l.account)).size, 2, 'one account each (parallel 1)');
    assert.ok(r.plan.waits.some((w) => w.group === 'g3' && /waiting for g1 to merge/.test(w.why)));
    const log = readFileSync(join(tmp, 'launches.log'), 'utf8');
    assert.match(log, /--name gamma--g1 --group g1 --worktree \S+gamma--g1/); assert.match(log, /--name gamma--g2 --group g2/);
    assert.ok(!readFileSync(join(tmp, 'gate.log'), 'utf8').includes('GATE-REFUSED'), 'each group spends its own dispatch token');
    const brief = readFileSync(join(wtRoot, 'gamma--g2', '.axf-brief.md'), 'utf8');
    assert.match(brief, /step group g2/); assert.match(brief, /\[ \] s2 /); assert.ok(!/\[ \] s1 /.test(brief), 'the group brief lists only its own steps');
    assert.match(brief, /split it over slots, kid/, "Brett's words stay whole"); assert.match(brief, /Branch: claude\/gamma--g2/);
    assert.equal(build().status, 'running'); assert.equal(group('g1').state, 'running'); assert.equal(group('g3').state, 'planned');
    assert.equal(pipe('groups', 'list', 'gamma').groups.find((g) => g.id === 'g3').label, 'Waiting on g1');
  });

  t('merge order holds: g2 finishes first and waits; g1 finishes, both merge in order and g3 starts after the merge', () => {
    tick('s2'); endSession('g2');
    let r = pipe('tick');
    assert.equal(group('g2').state, 'ready-to-merge', 'g2 waits for g1 (merge order)'); assert.equal(group('g1').state, 'running');
    assert.ok(!r.launched.some((l) => l.group === 'g3'));
    tick('s1'); tick('s4'); endSession('g1');
    r = pipe('tick');
    assert.equal(group('g1').state, 'merged'); assert.equal(group('g2').state, 'merged');
    assert.ok(Date.parse(group('g1').mergedAt) <= Date.parse(group('g2').mergedAt));
    assert.deepEqual(r.launched.map((l) => l.group), ['g3'], 'the dependent group starts once g1 is merged');
    assert.ok(!existsSync(join(wtRoot, 'gamma--g1')), 'a merged group\'s worktree is removed');
    assert.equal(build().status, 'running', 'not built while a group is open');
  });

  t('a merge conflict marks the group, raises the alert and the banner item, and the build is not built', () => {
    writeFileSync(join(wtRoot, 'gamma--g3', '.axf-merge-conflict'), 'c.py\n');
    tick('s3'); endSession('g3');
    const r = pipe('tick');
    assert.equal(group('g3').state, 'conflict'); assert.match(group('g3').note, /merge conflict in c\.py/);
    assert.ok(r.alertsSent.some((a) => a.kind === 'group-conflict' && a.key === 'pipeline:group-conflict:gamma:g3'));
    assert.deepEqual(pipe('groups', 'conflicts').conflicts.map((c) => `${c.id}/${c.group}`), ['gamma/g3'], 'the banner item reads this list');
    assert.equal(build().status, 'running');
    const held = spawnSync(process.execPath, [join(ROOT, 'apps/console-web/plugins/gate/fixers/parallel-groups.mjs'), 'check', '--build', 'gamma'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(held.status, 3, `the gate holds the PR: ${held.stdout}`); assert.match(held.stdout, /g3/);
  });

  t('Fix with Claude starts on the group branch; its end merges the group and the build is built (one PR from the build branch)', () => {
    rmSync(join(wtRoot, 'gamma--g3', '.axf-merge-conflict'));
    const f = pipe('groups', 'fix', 'gamma', 'g3');
    assert.ok(f.account && f.session === 'axf-gamma--g3');
    assert.match(readFileSync(join(wtRoot, 'gamma--g3', '.axf-brief.md'), 'utf8'), /Merge conflict: fix it/);
    endSession('g3');
    pipe('tick');
    assert.equal(group('g3').state, 'merged'); assert.equal(build().status, 'built');
    const ok = spawnSync(process.execPath, [join(ROOT, 'apps/console-web/plugins/gate/fixers/parallel-groups.mjs'), 'check', '--build', 'gamma'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout);
  });

  t('a crashed group goes back to the queue, and fails after 3 crashes', () => {
    orch('act', JSON.stringify({ action: 'add', id: 'delta', title: 'Delta', steps: [1, 2, 3, 4].map((i) => ({ text: `step ${i} on f${i}`, model: 'Opus', estimate: '10 min', files: [`f${i}.mjs`] })) }));
    pipe('groups', 'plan', 'delta'); pipe('queue', 'delta');
    const d = () => JSON.parse(readFileSync(storeFile, 'utf8')).builds.find((b) => b.id === 'delta');
    for (let i = 1; i <= 3; i += 1) {
      pipe('tick');
      const g1 = d().groups.find((g) => g.id === 'g1'); assert.equal(g1.state, 'running', `run ${i}`);
      appendFileSync(join(hdir, 'events.jsonl'), `${JSON.stringify({ event: 'session-end', session: g1.session, exit: 1, kind: 'crash', at: new Date().toISOString() })}\n`);
      pipe('tick');
    }
    const g1 = d().groups.find((g) => g.id === 'g1');
    assert.equal(g1.state, 'failed'); assert.match(g1.note, /crashed 3 times/);
    pipe('groups', 'rerun', 'delta', 'g1'); assert.equal(d().groups.find((g) => g.id === 'g1').state, 'ready');
  });
} finally { rmSync(tmp, { recursive: true, force: true }); }

// ---------------- REST / MCP / CLI parity: every orchestrator-groups-* command is one route, one CLI subcommand, one function
console.log('step-groups (parity)');
t('every orchestrator-groups-* MCP command names a server route that runs the matching `pipeline.mjs groups` subcommand', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
  const server = readFileSync(join(HERE, 'server', '__init__.py'), 'utf8');
  const cli = readFileSync(join(HERE, 'pipeline.mjs'), 'utf8');
  const cmds = manifest.commands.items.filter((c) => c.id.startsWith('orchestrator-groups-'));
  assert.equal(cmds.length, 10);
  for (const c of cmds) {
    const [method, path] = c.route.split(' ');
    const deco = `@router.${method.toLowerCase()}("${path}")`;
    const at = server.indexOf(deco); assert.ok(at >= 0, `${c.id}: no ${deco}`);
    const body = server.slice(at, server.indexOf('\n\n\n', at));
    const sub = c.id.replace('orchestrator-groups-', '').replace(/-set$/, '');
    const verb = { list: 'list' }[sub] ?? sub;
    assert.ok(body.includes(`"groups", "${verb}"`) || body.includes(`_group_act("${verb}"`), `${c.id}: the route does not run groups ${verb}`);
    assert.ok(cli.includes(`sub === '${verb}'`), `${c.id}: no CLI groups ${verb}`);
  }
});
t('voice / console actions groups.show, groups.start, groups.merge call the same routes', () => {
  const web = readFileSync(join(HERE, 'web', 'index.tsx'), 'utf8');
  for (const a of ['groups.show', 'groups.start', 'groups.merge']) assert.ok(web.includes(`'${a}'`), a);
  assert.match(web, /step-groups\/\$\{path\}/);
});
console.log(`step-groups: ${n} checks passed`);
