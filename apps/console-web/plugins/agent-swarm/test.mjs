// Self-test: node apps/console-web/plugins/agent-swarm/test.mjs
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from './web/swarm-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const here = (p) => new URL(p, import.meta.url);
const roster = c.normRoster(JSON.parse(readFileSync(here('./agents/roster.json'), 'utf8')));
const skills = Object.fromEntries(readdirSync(here('./agents/skills/')).filter((f) => f.endsWith('.md')).map((f) => { const s = c.parseSkill(readFileSync(here(`./agents/skills/${f}`), 'utf8')); return [s.id, s]; }));

// s1 roster + skills
t('roster and skills are valid', () => assert.deepEqual(c.checkRoster(roster, skills), []));
t('the eight specialist skills exist', () => assert.deepEqual(Object.keys(skills).sort(), ['assets-themes', 'docs', 'kotlin-compose', 'merge-fixer', 'plugin-manifests', 'python-server', 'react-ui', 'tests']));
t('every skill is under one page', () => { for (const s of Object.values(skills)) assert.ok(s.lines <= c.SKILL_MAX_LINES && s.chars <= c.SKILL_MAX_CHARS, s.id); });
t('models sort cheapest first', () => assert.deepEqual(c.normAgent({ id: 'x', models: ['opus', 'haiku', 'nope'] }).models, ['haiku', 'opus']));
t('bad roster is reported', () => { const r = c.normRoster({ agents: [{ id: 'A b', skill: 'none' }, { id: 'A b' }] }); const p = c.checkRoster(r, skills); assert.ok(p.some((x) => /lowercase/.test(x)) && p.some((x) => /twice/.test(x)) && p.some((x) => /no skill file/.test(x))); });
t('long skill is flagged', () => { const s = c.parseSkill(`---\n$axf: agent-skill@1\nid: big\n---\n${'line\n'.repeat(80)}`); assert.match(c.checkRoster({ agents: [] }, { big: s })[0], /one page/); });

// s2 planner
const B = (id, steps) => ({ id, steps: steps.map((s, i) => ({ id: `s${i + 1}`, model: 'Opus', estimate: '20 min', ...s })) });
t('glob and leases', () => { assert.ok(c.globMatch('**/*.tsx', 'a/b/c.tsx')); assert.ok(c.globMatch('apps/x/', 'apps/x/y.ts')); assert.ok(!c.globMatch('*.tsx', 'a/b.tsx')); assert.ok(c.leasesOverlap(['apps/x/'], ['apps/x/a.ts'])); assert.ok(!c.leasesOverlap(['a.ts'], ['b.ts'])); });
t('files from step text', () => assert.deepEqual(c.stepFiles({ text: 'Edit apps/console-web/plugins/x/web/ui.tsx and README.md.' }), ['apps/console-web/plugins/x/web/ui.tsx', 'README.md']));
t('skill match picks the specialist', () => {
  const p = c.planJobs(B('b', [{ text: 'React card view in apps/console-web/plugins/x/web/ui.tsx' }, { text: 'FastAPI route in apps/console-web/plugins/x/server/__init__.py' }, { text: 'Update the README docs' }]), roster);
  assert.deepEqual(p.jobs.map((j) => j.agent), ['rio', 'py', 'doc']);
});
t('cheapest capable model', () => {
  const p = c.planJobs(B('b', [{ text: 'Update the README docs' }, { text: 'React card view' }, { text: 'Design the agent contract schema', model: 'Fable' }, { text: 'Refactor the engine' }]), roster);
  assert.deepEqual(p.jobs.map((j) => j.model), ['haiku', 'sonnet', 'fable', 'opus']);
});
t('overlapping leases are sequenced, others run together', () => {
  const p = c.planJobs([B('a', [{ text: 'React ui in apps/x/web/ui.tsx' }]), B('b', [{ text: 'Python apps/x/server/main.py' }, { text: 'More React in apps/x/web/ui.tsx' }])], roster);
  assert.deepEqual(p.jobs.map((j) => j.wave), [0, 0, 1]); assert.deepEqual(p.jobs[2].after, ['a.s1']); assert.deepEqual(p.waves, [['a.s1', 'b.s1'], ['b.s2']]);
});
t('shared files are never leased', () => { const j = c.planJobs(B('b', [{ text: 'docs', files: ['_claude/THREADS.md', 'apps/x/README.md'] }]), roster).jobs[0]; assert.deepEqual(j.leases, ['apps/x/README.md']); assert.deepEqual(j.shared, ['_claude/THREADS.md']); });
t('done and skipped steps make no job; ineligible agents are passed over', () => {
  const p = c.planJobs(B('b', [{ text: 'docs', done: true }, { text: 'docs', skip: true }, { text: 'Update the README docs' }]), roster, { eligible: (a) => a.id !== 'doc' });
  assert.equal(p.jobs.length, 1); assert.notEqual(p.jobs[0].agent, 'doc');
  assert.match(c.planJobs(B('b', [{ text: 'x' }]), roster, { eligible: () => false }).warnings[0], /no agent/);
});
t('budget scales with the estimate', () => { const a = roster.agents[1]; assert.equal(c.budgetFor(a, { estimate: '30 min' }).tokens, a.tokenBudget); assert.equal(c.budgetFor(a, { estimate: '5 min' }).tokens, a.tokenBudget * 0.25); });

// s3 context packer
t('shared prefix is byte-identical for every job', () => { assert.equal(c.sharedPrefix({ persona: 'P' }), c.sharedPrefix({ persona: 'P' })); assert.doesNotMatch(c.sharedPrefix(), /JOB|\d{4}-\d\d/); assert.match(c.sharedPrefix(), /swarm-report@1/); });
t('short file goes whole, long file is excerpted', () => {
  assert.equal(c.extractSnippet('a', 'x\ny', 'task').whole, true);
  const big = Array.from({ length: 400 }, (_, i) => (i === 200 ? 'function salaryLeft() {}' : `line ${i}`)).join('\n');
  const s = c.extractSnippet('b', big, 'Show salary left on the card');
  assert.equal(s.whole, false); assert.match(s.text, /salaryLeft/); assert.match(s.text, /@@ lines 1-12/); assert.ok(s.text.split('\n').length < 40);
});
t('brief carries only the job, its leases and snippets', () => {
  const job = c.planJobs(B('b', [{ text: 'React card in apps/x/web/ui.tsx', files: ['apps/x/web/ui.tsx', '_claude/THREADS.md'] }]), roster).jobs[0];
  const p = c.packJob(job, { prefix: c.sharedPrefix(), skill: skills['react-ui'], snippets: [c.extractSnippet('apps/x/web/ui.tsx', 'export const A = 1;', job.text)] });
  assert.ok(p.system.startsWith(c.sharedPrefix())); assert.match(p.system, /React UI/); assert.match(p.prompt, /Leased files \(only these\): apps\/x\/web\/ui\.tsx/); assert.match(p.prompt, /Boss will write.*THREADS/); assert.match(p.prompt, /export const A/);
  assert.ok(p.tokens.system + p.tokens.prompt < 2500);
});

// s4 headless runner (fake Claude Code binaries)
const { runJob } = await import('./runner.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'swarm-'));
const fake = (name, body) => { const f = join(tmp, name); writeFileSync(f, `#!/usr/bin/env node\n${body}`); chmodSync(f, 0o755); return f; };
const say = (o) => `console.log(${JSON.stringify(JSON.stringify(o))});`;
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 };
const okBin = fake('ok', [say({ type: 'system', subtype: 'init' }), say({ type: 'assistant', message: { usage } }),
  say({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: 0.01, usage, result: 'Done.\n```json\n{"status":"done","summary":"card added","files":["a.tsx"],"checks":[{"name":"tsc","ok":true}]}\n```' })].join('\n'));
const hogBin = fake('hog', `const u=${JSON.stringify(usage)}; setInterval(()=>console.log(JSON.stringify({type:'assistant',message:{usage:u}})),5);`);
const job4 = c.planJobs(B('b', [{ text: 'React card in apps/x/web/ui.tsx' }]), roster).jobs[0]; const ag4 = roster.agents.find((a) => a.id === job4.agent);
const brief4 = c.packJob(job4, { prefix: c.sharedPrefix(), skill: skills[job4.skill] });
t('claude args: model id, own system prompt, max turns, only the job tools, no MCP', () => {
  const a = c.claudeArgs(brief4, job4, ag4); const at = (k) => a[a.indexOf(k) + 1];
  assert.equal(at('--model'), 'claude-sonnet-5-5'); assert.equal(at('--system-prompt'), brief4.system); assert.equal(at('--max-turns'), String(job4.budget.maxTurns));
  assert.equal(at('--allowedTools'), ag4.tools.join(',')); assert.equal(at('--output-format'), 'stream-json'); assert.ok(a.includes('--strict-mcp-config'));
});
const r4 = await runJob(job4, ag4, brief4, { bin: okBin, cwd: tmp });
t('a good run ends with its report and usage', () => { assert.equal(r4.status, 'done'); assert.equal(r4.report.summary, 'card added'); assert.equal(r4.usage.input, 1000); assert.equal(r4.budgetTokens, 1000 + 200 + 500); assert.equal(r4.reportedCost, 0.01); });
const r5 = await runJob({ ...job4, budget: { tokens: 20000, maxTurns: 5 } }, ag4, brief4, { bin: hogBin, cwd: tmp });
t('over budget is killed', () => { assert.equal(r5.status, 'killed'); assert.match(r5.reason, /token budget/); });
const r6 = await runJob(job4, ag4, brief4, { bin: join(tmp, 'missing'), cwd: tmp });
t('missing binary is an error, not a crash', () => { assert.equal(r6.status, 'error'); assert.match(r6.reason, /not found/); });
t('report parsing: last valid block wins, bad status ignored', () => { assert.equal(c.parseReport('```json\n{"status":"done"}\n```\n```json\n{"status":"meh"}\n```').status, 'done'); assert.equal(c.parseReport('no block'), null); assert.equal(c.runOutcome({ ...c.newTracker(), final: true, text: 'x' }).status, 'failed'); });

console.log(`agent-swarm: ${n} checks passed`);
