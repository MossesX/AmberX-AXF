// Self-test: node apps/console-web/plugins/agent-swarm/test.mjs
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import * as c from './web/swarm-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const here = (p) => new URL(p, import.meta.url);
const roster = c.normRoster(JSON.parse(readFileSync(here('./agents/roster.json'), 'utf8')));
const skills = Object.fromEntries(readdirSync(here('./agents/skills/')).filter((f) => f.endsWith('.md')).map((f) => { const s = c.parseSkill(readFileSync(here(`./agents/skills/${f}`), 'utf8')); return [s.id, s]; }));

// s1 roster + skills
t('roster and skills are valid', () => assert.deepEqual(c.checkRoster(roster, skills), []));
t('the eight build skills, the nine job-crew skills and the companion skill exist', () => assert.deepEqual(Object.keys(skills).sort(), ['assets-themes', 'banner-janitor', 'ci-fix', 'companion', 'docs', 'feature-build', 'kotlin-compose', 'landing', 'listener-qa', 'merge-fixer', 'ops-fix', 'plugin-manifests', 'python-server', 'react-ui', 'screenshots', 'site-checks', 'tests', 'walkthroughs']));
t('the job crew are all-rounders: every skill, a home job, nobody let go', () => { const crew = roster.agents.filter((a) => a.jobsOnly); assert.deepEqual(crew.map((a) => a.id).sort(), ['earl', 'gina', 'joey', 'lenny', 'paulie', 'rhonda', 'sully']); for (const a of crew) { assert.ok(a.skills.includes('*'), a.id); assert.ok(a.home, a.id); assert.ok(a.models.includes('fable'), a.id); } });
t('job crew never gets build steps', () => { const p = c.planJobs([{ id: 'b', steps: [{ id: 's1', text: 'take screenshots of the site check page and land it', files: [] }] }], roster); assert.ok(p.jobs.every((j) => !roster.agents.find((a) => a.id === j.agent).jobsOnly)); });
t('every skill is under one page', () => { for (const s of Object.values(skills)) assert.ok(s.lines <= c.SKILL_MAX_LINES && s.chars <= c.SKILL_MAX_CHARS, s.id); });
t('models sort cheapest first, blocked ones coerced up (model policy: never Sonnet or Haiku)', () => { assert.deepEqual(c.normAgent({ id: 'x', models: ['opus', 'haiku', 'nope'] }).models, ['opus']); assert.deepEqual(c.normAgent({ id: 'y', models: ['fable', 'sonnet'] }).models, ['opus', 'fable']); assert.deepEqual(c.normAgent({ id: 'z' }).models, ['opus']); });
t('bad roster is reported', () => { const r = c.normRoster({ agents: [{ id: 'A b', skill: 'none' }, { id: 'A b' }] }); const p = c.checkRoster(r, skills); assert.ok(p.some((x) => /lowercase/.test(x)) && p.some((x) => /twice/.test(x)) && p.some((x) => /no skill file/.test(x))); });
t('long skill is flagged', () => { const s = c.parseSkill(`---\n$axf: agent-skill@1\nid: big\n---\n${'line\n'.repeat(80)}`); assert.match(c.checkRoster({ agents: [] }, { big: s })[0], /one page/); });

// ID cards (agent-card@1 designs, per-agent identity + design)
t('ID cards: identity edits, per-agent design, default, save as new, remove', () => {
  const at = '2026-10-31T10:00:00.000Z';
  let s = c.normState({}, roster);
  assert.deepEqual(s.cards, { default: '', designs: [] });
  s = c.applyChange(s, { action: 'identity', agent: 'kat', fields: { name: 'Kat K.', hiredAt: '2026-11-01', email: '' } }, roster, at).state;
  const idn = c.cardIdentity(roster.agents.find((a) => a.id === 'kat'), s.agents.kat, 'On duty');
  assert.equal(idn.name, 'Kat K.'); assert.equal(idn.hiredAt, '2026-11-01'); assert.equal(idn.role, 'Android engineer'); assert.equal(idn.page, 'axf://agent-swarm/kat');
  assert.throws(() => c.applyChange(s, { action: 'identity', agent: 'kat', fields: { hiredAt: 'soon' } }, roster, at), /YYYY-MM-DD/);
  assert.throws(() => c.applyChange(s, { action: 'identity', agent: 'kat', fields: { photo: 'javascript:alert(1)' } }, roster, at), /image link/);
  s = c.applyChange(s, { action: 'card-save', taken: ['corporate-badge'], asset: { id: 'my-pass', name: 'My pass', data: { design: 'backstage', front: ['name', 'status'], labels: { status: 'Access' }, evil: '<script>' } } }, roster, at).state;
  assert.deepEqual(s.cards.designs[0].data, { design: 'backstage', front: ['name', 'status'], labels: { status: 'Access' } });
  assert.equal(s.cards.designs[0].type, 'agent-card');
  assert.throws(() => c.applyChange(s, { action: 'card-save', taken: ['corporate-badge'], asset: { id: 'corporate-badge', name: 'x' } }, roster, at), /already a design/);
  s = c.applyChange(s, { action: 'card-default', design: 'my-pass', name: 'My pass' }, roster, at).state;
  assert.equal(c.cardFor(s, 'rio'), 'my-pass'); assert.ok(s.messages.at(-1).text.includes('New ID cards'));
  s = c.applyChange(s, { action: 'card', agent: 'kat', design: 'license' }, roster, at).state;
  assert.equal(c.cardFor(s, 'kat'), 'license');
  s = c.applyChange(s, { action: 'card-delete', design: 'my-pass' }, roster, at).state;
  assert.equal(s.cards.default, ''); assert.equal(c.cardFor(s, 'rio'), ''); assert.equal(c.cardFor(s, 'kat'), 'license');
  assert.deepEqual(c.normState(JSON.parse(JSON.stringify(s)), roster).agents.kat.identity.name, 'Kat K.');
});

// s2 planner
const B = (id, steps) => ({ id, steps: steps.map((s, i) => ({ id: `s${i + 1}`, model: 'Opus', estimate: '20 min', ...s })) });
t('glob and leases', () => { assert.ok(c.globMatch('**/*.tsx', 'a/b/c.tsx')); assert.ok(c.globMatch('apps/x/', 'apps/x/y.ts')); assert.ok(!c.globMatch('*.tsx', 'a/b.tsx')); assert.ok(c.leasesOverlap(['apps/x/'], ['apps/x/a.ts'])); assert.ok(!c.leasesOverlap(['a.ts'], ['b.ts'])); });
t('files from step text', () => assert.deepEqual(c.stepFiles({ text: 'Edit apps/console-web/plugins/x/web/ui.tsx and README.md.' }), ['apps/console-web/plugins/x/web/ui.tsx', 'README.md']));
t('skill match picks the specialist', () => {
  const p = c.planJobs(B('b', [{ text: 'React card view in apps/console-web/plugins/x/web/ui.tsx' }, { text: 'FastAPI route in apps/console-web/plugins/x/server/__init__.py' }, { text: 'Update the README docs' }]), roster);
  assert.deepEqual(p.jobs.map((j) => j.agent), ['rio', 'py', 'doc']);
});
t('the model comes from the policy: the step\'s pin wins, else foundation words → Fable, else the default', () => {
  const b = { ...B('b', [{ text: 'Update the README docs' }, { text: 'React card view' }, { text: 'Design the agent contract schema', model: 'Fable' }, { text: 'Refactor the engine' }]), approvals: [{ phase: 1, from: 'Opus', to: 'Fable', by: 'brett', via: 'console' }] };
  const p = c.planJobs(b, roster);
  assert.deepEqual(p.jobs.map((j) => j.model), ['opus', 'opus', 'fable', 'opus'], 'cheap tiers run as Opus (model policy); an Opus pin holds even on engine words');
});
t('model upgrades need Brett: an unapproved Opus → Fable phase gets no job; a self-approval does not count; downgrades run', () => {
  const steps = [{ text: 'Update the README docs' }, { text: 'Design the agent contract schema', model: 'Fable' }, { text: 'Refactor the engine' }];
  const none = c.planJobs(B('b', steps), roster);
  assert.deepEqual(none.jobs.map((j) => j.stepId), ['s1', 's3']); assert.ok(none.warnings.some((w) => /b\.s2: waits for Brett/.test(w)));
  const self = c.planJobs({ ...B('b', steps), approvals: [{ phase: 1, from: 'Opus', to: 'Fable', selfApproved: true }] }, roster);
  assert.ok(!self.jobs.some((j) => j.stepId === 's2'));
  const down = c.planJobs(B('d', [{ text: 'Design the agent contract schema', model: 'Fable' }, { text: 'Update the README docs' }]), roster);
  assert.deepEqual(down.jobs.map((j) => j.model), ['fable', 'opus'], 'Fable → Opus needs nobody');
});
t('no step goes to an agent on a higher model than its pin', () => {
  const only = { ...roster, agents: roster.agents.map((a) => ({ ...a, models: ['fable'] })) };
  const p = c.planJobs(B('b', [{ text: 'Update the README docs' }]), only);
  assert.equal(p.jobs.length, 0); assert.ok(p.warnings.some((w) => /model upgrade needs Brett's approval/.test(w)));
  const u = c.planJobs({ id: 'u', steps: [{ id: 's1', text: 'Tidy the React settings page copy' }, { id: 's2', text: 'New asset type + schema for cards in framework/assets/' }, { id: 's3', text: 'Kotlin twin of the React view', model: '[Fable] pinned' }, { id: 's4', text: 'docs', model: 'sonnet' }] }, roster);
  assert.deepEqual(u.jobs.map((j) => [j.tier, j.model]), [['opus', 'opus'], ['fable', 'fable'], ['fable', 'fable'], ['opus', 'opus']], 'unpinned: the policy\'s foundation rule; any pin spelling; a Sonnet pin runs as Opus');
  assert.equal(c.requiredTier({ text: 'kernel engine twin' }), 'fable'); assert.equal(c.requiredTier({ text: 'x', model: 'Opus 5.5' }), 'opus');
});
t('an agent that cannot reach the model is passed over; when nobody can, the dearest it has runs with a warning', () => {
  const p = c.planJobs(B('b', [{ text: 'FastAPI route schema in apps/console-web/plugins/x/server/__init__.py', model: 'Fable' }]), roster);
  assert.notEqual(p.jobs[0].agent, 'py', 'py tops out at Opus, so a Fable step goes to a specialist who has Fable'); assert.equal(p.jobs[0].model, 'fable');
  const only = { ...roster, agents: roster.agents.filter((a) => a.id === 'py') };
  const q = c.planJobs(B('b', [{ text: 'Python server', model: 'Fable' }]), only); assert.equal(q.jobs[0].model, 'opus'); assert.match(q.warnings[0], /tops out at opus; job wants fable/);
});
t('every planned job is a swarm-job@1 record', () => {
  const p = c.planJobs([B('a', [{ text: 'React ui in apps/x/web/ui.tsx' }, { text: 'Update the README docs', files: ['_claude/memory/STATUS.md'] }]), B('b', [{ text: 'nothing anyone knows' }])], roster);
  for (const j of p.jobs) { assert.equal(j.$axf, 'swarm-job@1'); assert.deepEqual(c.jobErrors(j), [], j.id); }
  const f = c.fixerJob(p.jobs[0], ['apps/x/web/ui.tsx'], roster, 'a.s2'); assert.deepEqual(c.jobErrors(f), []); assert.equal(f.model, 'opus');
});
t('a step nobody matches goes to the most capable agent, not the cheapest, with a warning', () => {
  const p = c.planJobs(B('b', [{ text: 'nothing anyone knows' }]), roster);
  const best = roster.agents.filter((a) => !a.jobsOnly).reduce((t, a) => (a.tokenBudget > t.tokenBudget ? a : t));
  assert.equal(p.jobs[0].agent, best.id); assert.equal(p.jobs[0].match, 0); assert.match(p.warnings[0], /no clear specialist/);
  assert.notEqual(p.jobs[0].agent, roster.agents.filter((a) => !a.jobsOnly).reduce((t, a) => (a.salary < t.salary ? a : t)).id, 'the $5 docs agent is not the default');
  const r2 = c.normRoster({ ...roster, fallback: 'rio' }); const q = c.planJobs(B('b', [{ text: 'nothing anyone knows' }]), r2);
  assert.equal(q.jobs[0].agent, 'rio'); assert.match(q.warnings[0], /roster's fallback/);
  assert.equal(c.planJobs(B('b', [{ text: 'nothing anyone knows' }]), r2, { eligible: (a) => a.id !== 'rio' }).jobs[0].agent, best.id, 'a fallback who cannot work is passed over');
  assert.deepEqual(c.checkRoster(c.normRoster({ ...roster, fallback: 'ghost' }), skills), ['fallback "ghost" is not an agent on the roster']);
});
t('overlapping leases are sequenced, others run together', () => {
  const p = c.planJobs([B('a', [{ text: 'React ui in apps/x/web/ui.tsx' }]), B('b', [{ text: 'Python apps/x/server/main.py' }, { text: 'More React in apps/x/web/ui.tsx' }])], roster);
  assert.deepEqual(p.jobs.map((j) => j.wave), [0, 0, 1]); assert.deepEqual(p.jobs[2].after, ['a.s1']); assert.deepEqual(p.waves, [['a.s1', 'b.s1'], ['b.s2']]);
});
t('one agent works one job at a time, across builds', () => {
  const p = c.planJobs([B('a', [{ text: 'Python apps/a/server/x.py' }]), B('b', [{ text: 'Python apps/b/server/y.py' }, { text: 'React in apps/b/web/z.tsx' }])], roster);
  assert.deepEqual(p.jobs.map((j) => j.agent), ['py', 'py', 'rio']); assert.deepEqual(p.jobs.map((j) => j.wave), [0, 1, 0]); assert.deepEqual(p.jobs[1].after, ['a.s1']);
});
t('a folder lease and a glob rooted inside it overlap; globs with different roots do not', () => {
  assert.ok(c.leasesOverlap(['apps/console-web/'], ['apps/*/src/'])); assert.ok(c.leasesOverlap(['apps/*/src/'], ['apps/console-web/src/']));
  assert.ok(!c.leasesOverlap(['apps/console-web/plugins/*/web/'], ['apps/console-web/plugins/*/server/'])); assert.ok(!c.leasesOverlap(['framework/android/'], ['apps/*/src/']));
  assert.ok(!c.leasesOverlap(['**/*.kt'], ['**/*.kts'])); assert.ok(c.leasesOverlap(['**/*.json'], ['apps/x/plugin.json']));
});
t('shared files are never leased', () => { const j = c.planJobs(B('b', [{ text: 'docs', files: ['_claude/memory/STATUS.md', 'apps/x/README.md'] }]), roster).jobs[0]; assert.deepEqual(j.leases, ['apps/x/README.md']); assert.deepEqual(j.shared, ['_claude/memory/STATUS.md']); });
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
t('the best hits win the cap: a definition carrying two task words at the end of a long file beats weak hits at the top', () => {
  const lines = Array.from({ length: 900 }, (_, i) => `filler ${i}`);
  for (let i = 20; i < 600; i += 4) lines[i] = `// salary note ${i}`; // 145 weak hits (one word) before the real thing
  lines[850] = 'export function salaryLeft(agent, payday) {'; lines[851] = '  return agent.salary - spent;'; lines[852] = '}';
  const s = c.extractSnippet('b', lines.join('\n'), 'Show salary left till payday on the card');
  assert.match(s.text, /export function salaryLeft/); assert.match(s.text, /@@ lines 1-12/); assert.ok(s.text.split('\n').length <= c.SNIPPET.maxLines + 40);
  assert.deepEqual(s.lines[0], [1, 12]); assert.ok(s.lines.every(([a, b]) => a <= b)); assert.ok(s.hits > 100);
  const noisy = Array.from({ length: 300 }, (_, i) => (i === 150 ? 'const cardWidth = 4;' : `card ${i}`)).join('\n'); // "card" is on every line: says nothing
  assert.match(c.extractSnippet('n', noisy, 'card width').text, /cardWidth/); assert.ok(c.extractSnippet('n', noisy, 'card width').text.split('\n').length < 30);
});
t('brief carries only the job, its leases, snippets and folder listings', () => {
  const job = c.planJobs(B('b', [{ text: 'React card in apps/x/web/ui.tsx', files: ['apps/x/web/ui.tsx', 'apps/x/web/', '_claude/memory/STATUS.md'] }]), roster).jobs[0];
  const p = c.packJob(job, { prefix: c.sharedPrefix(), skill: skills['react-ui'], snippets: [c.extractSnippet('apps/x/web/ui.tsx', 'export const A = 1;', job.text)], indexes: [c.folderIndex('apps/x/web/', ['ui.tsx', 'cards.tsx', 'swarm.css'])] });
  assert.ok(p.system.startsWith(c.sharedPrefix())); assert.match(p.system, /React UI/); assert.match(p.prompt, /Leased files and folders \(only these\): apps\/x\/web\/ui\.tsx, apps\/x\/web\//); assert.match(p.prompt, /Boss will write.*STATUS/); assert.match(p.prompt, /export const A/);
  assert.match(p.prompt, /--- apps\/x\/web\/ \(3 files\) ---\ncards\.tsx\nswarm\.css\nui\.tsx/);
  assert.ok(p.tokens.system + p.tokens.prompt < 2500);
  const big = c.folderIndex('f/', [...Array.from({ length: 200 }, (_, i) => `sub${i % 3}/f${String(i).padStart(3, '0')}.ts`), 'README.md']);
  assert.deepEqual(big, { path: 'f/', names: ['README.md', 'sub0/ (67 files)', 'sub1/ (67 files)', 'sub2/ (66 files)'], total: 201, outline: true }, 'a big folder is an outline: own files, then subfolders with counts');
  assert.match(c.packJob(job, { prefix: '', indexes: [big] }).prompt, /\(201 files, outline\) ---\nREADME\.md\nsub0\/ \(67 files\)/);
  const flat = c.folderIndex('g/', Array.from({ length: 300 }, (_, i) => `g${String(i).padStart(3, '0')}.ts`)); assert.equal(flat.names.length, c.FOLDER_INDEX_MAX);
  const four = c.indexBlocks([flat, flat, flat, flat]); assert.equal(four.length, 4); assert.ok(four.every((b) => b.split('\n').length <= 2 + c.FOLDER_INDEX_MAX / 4), 'four folders share the cap'); assert.match(four[0], /… \d+ more$/);
});
const { listFolder } = await import('./swarm.mjs');
t('an area job gets its folders listed, not read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-area-')); mkdirSync(join(dir, 'apps', 'z', 'web', 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'apps', 'z', 'web', 'ui.tsx'), 'export const Z = 1;\n'); writeFileSync(join(dir, 'apps', 'z', 'web', 'node_modules', 'x.js'), '');
  assert.deepEqual(listFolder(join(dir, 'apps', 'z')), ['web/ui.tsx']);
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
  assert.equal(at('--model'), 'claude-opus-5-5'); assert.equal(at('--system-prompt'), brief4.system); assert.equal(at('--max-turns'), String(job4.budget.maxTurns));
  assert.equal(at('--allowedTools'), ag4.tools.join(',')); assert.equal(at('--output-format'), 'stream-json'); assert.ok(a.includes('--strict-mcp-config'));
});
const r4 = await runJob(job4, ag4, brief4, { bin: okBin, cwd: tmp });
t('a good run ends with its report and usage', () => { assert.equal(r4.status, 'done'); assert.equal(r4.report.summary, 'card added'); assert.equal(r4.usage.input, 1000); assert.equal(r4.budgetTokens, 1000 + 200 + 500); assert.equal(r4.reportedCost, 0.01); });
const r5 = await runJob({ ...job4, budget: { tokens: 20000, maxTurns: 5 } }, ag4, brief4, { bin: hogBin, cwd: tmp });
t('over budget is killed', () => { assert.equal(r5.status, 'killed'); assert.match(r5.reason, /token budget/); });
const r6 = await runJob(job4, ag4, brief4, { bin: join(tmp, 'missing'), cwd: tmp });
t('missing binary is an error, not a crash', () => { assert.equal(r6.status, 'error'); assert.match(r6.reason, /not found/); });
t('report parsing: last valid block wins, bad status ignored', () => { assert.equal(c.parseReport('```json\n{"status":"done"}\n```\n```json\n{"status":"meh"}\n```').status, 'done'); assert.equal(c.parseReport('no block'), null); assert.equal(c.runOutcome({ ...c.newTracker(), final: true, text: 'x' }).status, 'failed'); });

// s5 leases, shared files, batch merge
t('lease check: inside ok, outside and shared refused', () => {
  const j = { leases: ['apps/x/web/', 'README.md'], leaseKind: 'files' };
  assert.equal(c.leaseCheck(j, ['apps/x/web/ui.tsx', 'README.md']).ok, true);
  const r = c.leaseCheck(j, ['apps/y/a.ts', '_claude/memory/STATUS.md']); assert.deepEqual(r.outside, ['apps/y/a.ts']); assert.deepEqual(r.shared, ['_claude/memory/STATUS.md']);
});
t('merge queue: done + lease clean + not merged, in plan order', () => {
  const p = { jobs: [{ id: 'b.s1' }, { id: 'b.s2' }, { id: 'b.s3' }, { id: 'b.s4' }] };
  const runs = [{ jobId: 'b.s2', status: 'done' }, { jobId: 'b.s1', status: 'done' }, { jobId: 'b.s3', status: 'done', lease: { ok: false } }, { jobId: 'b.s4', status: 'failed' }];
  assert.deepEqual(c.mergeQueue(p, runs).map((q) => q.job.id), ['b.s1', 'b.s2']); assert.deepEqual(c.mergeQueue(p, runs, ['b.s1']).map((q) => q.job.id), ['b.s2']);
});
t('fixer job goes to the merge fixer with the conflicted files', () => { const f = c.fixerJob({ id: 'b.s2', buildId: 'b', stepId: 's2', checks: [], wave: 1 }, ['a.ts'], roster, 'b.s1'); assert.equal(f.agent, 'max'); assert.deepEqual(f.leases, ['a.ts']); assert.match(f.text, /against b\.s1/); });
t('Boss writes the tracker after merge: ticks, agent, one note, notes lines', () => {
  const tr = { builds: [{ id: 'b', steps: [{ id: 's1' }, { id: 's2' }] }] };
  const r = c.applyMerge(tr, 'b', [{ job: { id: 'b.s1', stepId: 's1', agent: 'rio', model: 'sonnet' }, run: { report: { summary: 'card', notes: 'STATUS: cards' } } }], 'T');
  assert.equal(r.tracker.builds[0].steps[0].done, true); assert.match(r.tracker.builds[0].steps[0].note, /rio on sonnet: card/); assert.equal(r.tracker.builds[0].steps[1].done, undefined);
  assert.equal(r.tracker.builds[0].notes.length, 1); assert.deepEqual(r.lines, ['b.s1: STATUS: cards']); assert.equal(tr.builds[0].steps[0].done, undefined);
});
// s6 cost meter
const P = c.prices({ models: { sonnet: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } } });
t('cost from usage, reported cost wins', () => {
  assert.equal(c.costOf({ input: 1e6, output: 1e5, cacheRead: 1e6, cacheWrite: 0 }, 'sonnet', P), 2 + 1 + 0.1);
  assert.equal(c.runCost({ reportedCost: 0.5, usage: { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, model: 'opus' }, P), 0.5);
  assert.equal(P.haiku.estimate, true);
});
t('meter per agent, job, build and model', () => {
  const runs = [{ agent: 'rio', jobId: 'b.s1', buildId: 'b', model: 'sonnet', status: 'done', reportedCost: 1, usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 } }, { agent: 'rio', jobId: 'b.s1', buildId: 'b', model: 'sonnet', status: 'failed', reportedCost: 0.5, usage: null }, { agent: 'doc', jobId: 'c.s1', buildId: 'c', model: 'haiku', status: 'done', reportedCost: 0.25 }];
  const m = c.meter(runs, P); assert.equal(m.total.usd, 1.75); assert.equal(m.byAgent.rio.runs, 2); assert.equal(m.byAgent.rio.failed, 1); assert.equal(m.byBuild.c.usd, 0.25); assert.equal(m.byJob['b.s1'].tokens, 10); assert.equal(m.byModel.haiku.done, 1);
});
t('formatting', () => { assert.equal(c.fmtUsd(1.234), '$1.23'); assert.equal(c.fmtUsd(123.4), '$123'); assert.equal(c.fmtTokens(1500), '2k'); assert.equal(c.fmtTokens(2.5e6), '2.5M'); });

// s7 pilot
t('roster tune scales planned budgets', () => { const j = c.planJobs(B('b', [{ text: 'React card', estimate: '30 min' }]), roster).jobs[0]; assert.equal(j.budget.tokens, Math.round(roster.agents.find((a) => a.id === j.agent).tokenBudget * roster.tune.scale)); assert.ok(roster.tune.scale >= 0.25 && roster.tune.scale <= 2); });
t('pilot: projections, saving and a clamped scale', () => {
  const b = B('p', [{ text: 'React card in apps/x/web/ui.tsx', estimate: '30 min' }, { text: 'Update the README docs', estimate: '10 min' }]);
  const p = c.planJobs(b, roster, { tune: { scale: 1 } }); const briefs = Object.fromEntries(p.jobs.map((j) => [j.id, { system: 500, prompt: 300 }]));
  const r = c.pilotReport(b, p, briefs, P, null, 8000);
  assert.equal(r.jobs.length, 2); assert.equal(r.single.minutes, 40); assert.ok(r.swarm.usd > 0 && r.single.usd > r.swarm.usd); assert.ok(r.scale >= 0.25 && r.scale <= 2);
  const u = c.projectRun({ budget: { maxTurns: 10 } }, 1000); assert.equal(u.cacheWrite, 1000 + 1500 * 6); assert.equal(u.output, 6 * 800);
});

// s8 persona in the cached prefix
t('Amber persona is a few lines, in the shared prefix, and keeps code clean', () => {
  const per = c.parseSkill(readFileSync(here('./agents/persona.md'), 'utf8'));
  assert.ok(per.lines <= 8, `${per.lines} lines`); assert.match(per.body, /Code, code comments, commit messages/); assert.match(per.body, /no jokes about race/);
  const pre = c.sharedPrefix({ persona: per.body }); assert.match(pre, /PERSONA\nYou talk like Amber/); assert.match(pre, /clean and professional/);
  const job = c.planJobs(B('b', [{ text: 'React card' }]), roster).jobs[0]; const job2 = c.planJobs(B('z', [{ text: 'Update the README docs' }]), roster).jobs[0];
  const a = c.packJob(job, { prefix: pre, skill: skills[job.skill] }); const d = c.packJob(job2, { prefix: pre, skill: skills[job2.skill] });
  assert.ok(a.system.startsWith(pre) && d.system.startsWith(pre)); // same bytes first, so the cache hits across agents
});

// s9 statuses
const AT = '2026-10-31T12:00:00.000Z';
t('statuses gate work; probation takes small jobs and notifies', () => {
  const a = roster.agents[0]; const S = (o) => c.normAgentState(o);
  assert.equal(c.canWork(a, S({}), {}).ok, true);
  for (const st of ['off-duty', 'injured', 'medical-leave', 'fired']) assert.equal(c.canWork(a, S({ status: st }), {}).ok, false, st);
  assert.deepEqual(c.canWork(a, S({ status: 'probation' }), { estimate: '10 min' }), { ok: true, why: '', notify: true });
  assert.equal(c.canWork(a, S({ status: 'probation' }), { estimate: '30 min' }).ok, false);
  assert.equal(c.canWork(a, S({ status: 'custom', custom: { name: 'Coffee run', works: true } }), {}).ok, true);
  assert.match(c.canWork(a, S({ status: 'custom', custom: { name: 'Coffee run', works: false } }), {}).why, /Coffee run/);
});
t('status change keeps history; bad changes refused', () => {
  let s = c.normState({}, roster);
  s = c.applyChange(s, { action: 'status', agent: 'rio', status: 'injured', note: 'tsc keeps failing' }, roster, AT).state;
  assert.equal(s.agents.rio.status, 'injured'); assert.deepEqual([s.agents.rio.history[0].from, s.agents.rio.history[0].to], ['On duty', 'Injured']);
  assert.throws(() => c.applyChange(s, { action: 'status', agent: 'rio', status: 'medical-leave' }, roster, AT), /return date/);
  assert.throws(() => c.applyChange(s, { action: 'status', agent: 'rio', status: 'custom' }, roster, AT), /name/);
  assert.throws(() => c.applyChange(s, { action: 'status', agent: 'nobody', status: 'fired' }, roster, AT), /no agent/);
});
t('medical leave ends by itself', () => {
  let s = c.applyChange(c.normState({}, roster), { action: 'status', agent: 'kat', status: 'medical-leave', until: '2026-11-02T00:00:00.000Z' }, roster, AT).state;
  assert.equal(c.tick(s, '2026-11-01T00:00:00.000Z').log.length, 0);
  const r = c.tick(s, '2026-11-02T00:00:01.000Z'); assert.equal(r.state.agents.kat.status, 'on-duty'); assert.equal(r.state.agents.kat.history.at(-1).by, 'boss');
});
t('the planner skips agents whose status says no', () => {
  const s = c.applyChange(c.normState({}, roster), { action: 'status', agent: 'doc', status: 'fired' }, roster, AT).state;
  const p = c.planJobs(B('b', [{ text: 'Update the README docs' }]), roster, { eligible: (a, j) => c.canWork(a, s.agents[a.id], j).ok });
  assert.notEqual(p.jobs[0].agent, 'doc');
});

// s10 spend per agent + cap
const RUNS = [
  { agent: 'rio', jobId: 'b.s1', status: 'done', reportedCost: 2, endedAt: '2026-10-20T10:00:00.000Z' },
  { agent: 'rio', jobId: 'b.s2', status: 'done', reportedCost: 3, endedAt: '2026-10-27T10:00:00.000Z' },
  { agent: 'rio', jobId: 'b.s2', status: 'failed', reportedCost: 1, endedAt: '2026-10-31T08:00:00.000Z' },
  { agent: 'doc', jobId: 'c.s1', status: 'done', reportedCost: 9, endedAt: '2026-10-31T08:00:00.000Z' },
];
t('week starts Monday UTC', () => { assert.equal(c.weekStart(AT), '2026-10-26T00:00:00.000Z'); assert.equal(c.dayStart(AT), '2026-10-31T00:00:00.000Z'); });
t('spend: all time, week, today, avg per job', () => { const s = c.spendOf(RUNS, 'rio', P, AT); assert.equal(s.all.usd, 6); assert.equal(s.week.usd, 4); assert.equal(s.today.usd, 1); assert.equal(s.jobs, 2); assert.equal(s.avgPerJob, 3); });

// s11 cards + profiles
t('card stats: jobs done, success, failures, favourite model, last seen, feed', () => {
  const runs = [{ agent: 'rio', jobId: 'a', model: 'sonnet', status: 'done', reportedCost: 1, endedAt: '2026-10-30T00:00:00Z', report: { summary: 'ok' } }, { agent: 'rio', jobId: 'b', model: 'sonnet', status: 'failed', reportedCost: 2, endedAt: '2026-10-31T00:00:00Z', reason: 'tsc' }, { agent: 'rio', jobId: 'c', model: 'opus', status: 'done', reportedCost: 3, endedAt: '2026-10-29T00:00:00Z' }];
  const s = c.agentStats(runs, 'rio', P); assert.equal(s.done, 2); assert.equal(s.failed, 1); assert.equal(Math.round(s.successRate * 100), 67); assert.equal(s.favoriteModel, 'sonnet'); assert.equal(s.lastSeen, '2026-10-31T00:00:00Z');
  assert.equal(s.feed[0].jobId, 'c'); assert.equal(s.feed.length, 3); assert.equal(c.agentStats([], 'x', P).successRate, null);
});
t('every agent has a unique look drawn in theme colours', () => {
  const looks = roster.agents.map((a) => { const col = c.avatarColors(a.avatar); assert.ok(c.AVATAR_TOKENS.includes(col.hair) && c.AVATAR_TOKENS.includes(col.shirt)); return JSON.stringify([a.avatar.face, a.avatar.hair, a.avatar.gear, col]); });
  assert.equal(new Set(looks).size, looks.length);
  for (const a of roster.agents) assert.ok(a.catchphrase && a.bio && a.specialty && a.hiredAt, a.id);
});

// s12 group chat
t('work lines come from orchestrator data, no tokens', () => {
  const p = c.planJobs([B('a', [{ text: 'React ui in apps/x/web/ui.tsx' }]), B('b', [{ text: 'More React in apps/x/web/ui.tsx' }])], roster);
  const a = c.assignLine(p.jobs[0], roster); assert.equal(a.from, 'boss'); assert.match(a.text, /Rio React, you got a\.s1.*apps\/x\/web\/ui\.tsx.*Opus, budget/);
  const l = c.leaseLines(p, roster); assert.equal(l.length, 1); assert.match(l[0].text, /waits on Rio React \(a\.s1\): both want apps\/x\/web\/ui\.tsx/);
  const r = c.reportLines({ agent: 'rio', jobId: 'a.s1', status: 'done', report: { summary: 'card in', handoff: 'props renamed' } }, roster); assert.deepEqual(r.map((x) => x.kind), ['report', 'handoff']);
  assert.match(c.mergeLines({ branch: 'm', merged: ['a.s1'], conflicts: [{ job: 'b.s1', files: ['x'], fixer: 'b.fix-s1' }], refused: [] }, roster)[1].text, /Merge Max, b\.s1 clashed on x/);
});
t('switches: global off posts nothing; an agent off stays quiet, Boss still talks', () => {
  const s = c.normState({}, roster);
  assert.equal(c.post(s, [{ from: 'boss', kind: 'assign', text: 'x' }, { from: 'rio', kind: 'banter', text: 'y' }], AT), 2);
  s.chat.agents.rio = false; assert.equal(c.post(s, [{ from: 'boss', kind: 'assign', text: 'x' }, { from: 'rio', kind: 'banter', text: 'y' }], AT), 1);
  s.chat.enabled = false; assert.equal(c.post(s, [{ from: 'boss', kind: 'assign', text: 'x' }], AT), 0);
  assert.throws(() => c.applyChange(s, { action: 'say', text: 'hi' }, roster, AT), /off/);
});
t('banter bank: deterministic, filled in, never about identity', () => {
  assert.equal(c.banterLine('fight', 'k', { other: 'Rio', file: 'ui.tsx' }), c.banterLine('fight', 'k', { other: 'Rio', file: 'ui.tsx' }));
  assert.doesNotMatch(c.banterLine('fight', 'k', { other: 'Rio', file: 'ui.tsx' }), /\{/);
  const all = Object.values(c.BANTER).flat().join(' '); assert.doesNotMatch(all, /\b(race|religio|gay|straight|woman|women|black|white|asian|muslim|jew|christian)\w*/i);
  const re = c.reactors(c.normState({}, roster), roster, 'rio', 2, 'seed'); assert.equal(re.length, 2); assert.ok(re.every((a) => a.id !== 'rio'));
});
t('cheap banter batch: prompt + parsing keeps only real agents', () => {
  assert.match(c.banterPrompt(roster, [{ from: 'boss', text: 'go' }], 4), /Write 4 short.*Never joke about race/s);
  assert.deepEqual(c.parseBanter('ok [{"agent":"rio","text":"yo"},{"agent":"ghost","text":"boo"}]', roster), [{ from: 'rio', kind: 'banter', text: 'yo' }]);
  assert.deepEqual(c.parseBanter('nope', roster), []);
});
t('status changes are posted by Boss', () => { const s = c.applyChange(c.normState({}, roster), { action: 'status', agent: 'tex', status: 'off-duty', note: 'day off' }, roster, AT).state; assert.match(s.messages.at(-1).text, /Tex Tester is now Off duty: day off/); });

// s13 discipline
t('suspend: timed, with a reason, back on duty by itself, posted', () => {
  assert.throws(() => c.applyChange(c.normState({}, roster), { action: 'suspend', agent: 'rio', until: '2026-11-01T00:00:00Z' }, roster, AT), /why/);
  assert.throws(() => c.applyChange(c.normState({}, roster), { action: 'status', agent: 'rio', status: 'suspended' }, roster, AT), /use suspend/);
  const s = c.applyChange(c.normState({}, roster), { action: 'suspend', agent: 'rio', until: '2026-11-01T00:00:00.000Z', reason: 'pushed to main' }, roster, AT).state;
  assert.equal(s.agents.rio.status, 'suspended'); assert.equal(c.canWork(roster.agents[1], s.agents.rio).ok, false); assert.match(s.messages.at(-1).text, /suspended until 2026-11-01 00:00 UTC\. Reason: pushed to main/);
  const t2 = c.tick(s, '2026-11-01T00:00:01.000Z'); assert.equal(t2.state.agents.rio.status, 'on-duty'); assert.equal(t2.state.agents.rio.history.length, 2);
});
t('rage-quit after N failed jobs in a row; blocked does not count; done resets', () => {
  const s = c.applyChange(c.normState({}, roster), { action: 'rules', rageQuitAfter: 2 }, roster, AT).state;
  c.recordRun(s, { agent: 'py', status: 'failed' }, roster, AT); c.recordRun(s, { agent: 'py', status: 'done' }, roster, AT); assert.equal(s.agents.py.failStreak, 0);
  c.recordRun(s, { agent: 'py', status: 'failed' }, roster, AT); c.recordRun(s, { agent: 'py', status: 'blocked' }, roster, AT); assert.equal(s.agents.py.status, 'on-duty');
  assert.equal(c.recordRun(s, { agent: 'py', status: 'killed' }, roster, AT).length, 1); assert.equal(s.agents.py.status, 'quit');
  assert.ok(s.messages.some((m) => m.from === 'py' && /I quit/.test(m.text))); assert.equal(s.agents.py.history.at(-1).by, 'py');
  const r = c.applyChange(s, { action: 'rehire', agent: 'py' }, roster, AT).state; assert.equal(r.agents.py.status, 'on-duty'); assert.equal(r.agents.py.failStreak, 0); assert.match(r.messages.at(-1).text, /rehired/);
  assert.equal(c.normState({}, roster).rules.rageQuitAfter, 3);
});

// s14 salary
t('salary is the weekly budget: spent, left, broke stops work, top-up and payday', () => {
  const rio = roster.agents.find((a) => a.id === 'rio');
  let s = c.applyChange(c.normState({}, roster), { action: 'salary', agent: 'rio', usd: 4 }, roster, AT).state;
  let p = c.payOf(rio, s.agents.rio, RUNS, P, AT); assert.deepEqual([p.salary, p.spent, p.left, p.broke], [4, 4, 0, true]); assert.equal(p.payday, '2026-11-02T00:00:00.000Z');
  assert.match(c.canWork(rio, s.agents.rio, {}, AT, p).why, /broke till payday \(2026-11-02\)/);
  assert.deepEqual(c.payCheck(s, roster, RUNS, P, AT).map((l) => l.split(':')[0]), ['rio', 'doc']); assert.ok(s.messages.some((m) => m.from === 'rio' && /I'm broke/.test(m.text))); assert.equal(c.payCheck(s, roster, RUNS, P, AT).length, 0); // said once a period
  s = c.applyChange(s, { action: 'topup', agent: 'rio', usd: 5 }, roster, AT).state; p = c.payOf(rio, s.agents.rio, RUNS, P, AT); assert.equal(p.left, 5); assert.equal(p.broke, false);
  assert.equal(c.payOf(rio, s.agents.rio, RUNS, P, '2026-11-02T01:00:00.000Z').broke, false); // payday: new period
  assert.equal(c.normAgentState({ cap: 30 }).salary, 30); assert.equal(c.normAgentState({}).salary, null); // old cap becomes the salary
});
t('raises and docks are posted, coworkers react', () => {
  let s = c.applyChange(c.normState({ chatSettings: c.PRESETS.breakroom }, roster), { action: 'salary', agent: 'doc', usd: 9, note: 'great docs' }, roster, AT).state;
  assert.equal(s.agents.doc.pay[0].kind, 'raise'); assert.match(s.messages.find((m) => m.kind === 'pay').text, /Doc Holli gets a raise: \$5\.00 → \$9\.00 a week\. great docs/);
  assert.ok(s.messages.filter((m) => m.kind === 'banter').length >= 1);
  const quiet = c.applyChange(c.normState({ chatSettings: c.PRESETS.business }, roster), { action: 'salary', agent: 'doc', usd: 9 }, roster, AT).state; assert.equal(quiet.messages.filter((m) => m.kind === 'banter').length, 0);
  s = c.applyChange(s, { action: 'salary', agent: 'doc', usd: 3 }, roster, AT).state; assert.equal(s.agents.doc.pay[1].kind, 'dock'); assert.ok(s.messages.some((m) => /got docked/.test(m.text)));
  assert.throws(() => c.applyChange(s, { action: 'salary', agent: 'doc', usd: 3 }, roster, AT), /same salary/);
});
t('finishing under budget earns a bonus and a jealous coworker', () => {
  const s = c.normState({}, roster);
  c.recordRun(s, { agent: 'rio', jobId: 'b.s1', status: 'done', model: 'sonnet', budget: { tokens: 100000, maxTurns: 10 }, reportedCost: 0.05 }, roster, AT, P);
  assert.equal(s.agents.rio.bonuses.length, 1); assert.ok(s.agents.rio.bonuses[0].usd > 0); assert.ok(s.messages.some((m) => /under budget\. Bonus/.test(m.text)));
  c.recordRun(s, { agent: 'rio', jobId: 'b.s2', status: 'done', model: 'sonnet', budget: { tokens: 1000, maxTurns: 10 }, reportedCost: 50 }, roster, AT, P); assert.equal(s.agents.rio.bonuses.length, 1);
});

// s15 chat settings suite
const CS = (o = {}) => c.normChatSettings(o);
t('vibe scores: plain work lines low, wild banter high', () => {
  const work = c.scoreVibe(c.assignLine(c.planJobs(B('b', [{ text: 'React card' }]), roster).jobs[0], roster).text, 'assign');
  assert.ok(work <= 20, `work ${work}`);
  const chill = c.scoreVibe('Gradle\'s running. Cracking a beer, wake me up in twenty.'); const wild = c.scoreVibe('Oh sure, TEX gets a raise. For WHAT? I fixed three damn conflicts, rich ass!!');
  assert.ok(chill < 100 && wild > 250, `${chill} ${wild}`); assert.ok(c.scoreVibe('x'.repeat(10) + ' fuck '.repeat(20)) <= 500);
});
t('the vibe is a hard ceiling: cleaned, calmed, else dropped; work never dropped', () => {
  const wild = { from: 'rio', kind: 'banter', text: 'Oh sure, TEX gets a raise. For WHAT? I fixed three damn conflicts, rich ass!!' };
  const off = CS(c.PRESETS.rails); assert.equal(c.vibeFilter(wild, off).text, wild.text);
  const mid = CS({ ...c.PRESETS.breakroom, vibe: 120 }); const m = c.vibeFilter(wild, mid); assert.ok(m === null || m.vibe <= 120);
  assert.equal(c.vibeFilter(wild, CS(c.PRESETS.business)), null);
  const work = c.vibeFilter({ from: 'py', kind: 'discipline', text: 'That\'s 3 in a row. I\'m DONE with this shit. I quit.' }, CS(c.PRESETS.business));
  assert.ok(work && !/shit|DONE/.test(work.text) && work.toned, work?.text);
  for (const k of ['assign', 'report', 'lease']) assert.ok(c.vibeFilter({ from: 'boss', kind: k, text: 'Rio, you got b.s1.' }, CS({ vibe: 1 })));
});
t('cussing slider: clean, mild, filthy', () => {
  const t0 = 'Damn, that shit is fucking broken, hell.';
  assert.equal(c.cleanCussing(t0, 0), 'Darn, that stuff is freaking broken, heck.'); assert.equal(c.cleanCussing(t0, 50), 'Damn, that stuff is freaking broken, hell.'); assert.equal(c.cleanCussing(t0, 100), t0);
});
t('drama slider drops fights and jealousy; identity jokes always dropped', () => {
  const fight = { from: 'rio', kind: 'banter', text: 'Tex, get your hands off ui.tsx.' };
  assert.equal(c.vibeFilter(fight, CS({ ...c.PRESETS.rails, drama: 10 })), null); assert.ok(c.vibeFilter(fight, CS(c.PRESETS.rails)));
  assert.equal(c.vibeFilter({ from: 'rio', kind: 'banter', text: 'a joke about religion' }, CS(c.PRESETS.rails)), null);
});
t('per-agent overrides beat the room', () => {
  const cs = CS({ ...c.PRESETS.rails, overrides: { doc: { vibe: 1, cussing: 0 } } });
  const line = { kind: 'banter', text: 'Damn, nice one.' };
  assert.equal(c.vibeFilter({ ...line, from: 'rio' }, cs).text, 'Damn, nice one.'); assert.notEqual(c.vibeFilter({ ...line, from: 'doc' }, cs)?.text, 'Damn, nice one.');
});
t('chattiness sets reactions; daily banter budget makes it quiet when hit', () => {
  assert.equal(c.reactionsFor(CS(c.PRESETS.business)), 0); assert.equal(c.reactionsFor(CS(c.PRESETS.crew)), 1); assert.equal(c.reactionsFor(CS(c.PRESETS.rails)), 2);
  const s = c.normState({ chatSettings: { ...c.PRESETS.breakroom, banterBudget: 0.1 } }, roster);
  assert.equal(c.banterAllowed(s, AT).ok, true); s.banterSpend.push({ at: AT, usd: 0.2 });
  assert.match(c.banterAllowed(s, AT).why, /quiet till tomorrow/); assert.equal(c.reactCount(s, AT), 0); assert.equal(c.banterAllowed(s, '2026-11-01T01:00:00.000Z').ok, true);
  assert.match(c.banterAllowed(c.normState({ chatSettings: c.PRESETS.crew }, roster), AT).why, /chattiness/);
});
t('presets, custom presets, overrides through applyChange', () => {
  let s = c.normState({}, roster); assert.equal(s.chatSettings.preset, 'crew'); assert.equal(s.chatSettings.vibe, 100);
  s = c.applyChange(s, { action: 'chat-settings', preset: 'rails' }, roster, AT).state; assert.equal(s.chatSettings.vibe, 500);
  s = c.applyChange(s, { action: 'chat-settings', values: { vibe: 333, drama: 5 } }, roster, AT).state; assert.equal(s.chatSettings.preset, 'custom');
  s = c.applyChange(s, { action: 'chat-settings', save: 'Friday' }, roster, AT).state; s = c.applyChange(s, { action: 'chat-settings', preset: 'business' }, roster, AT).state;
  s = c.applyChange(s, { action: 'chat-settings', preset: 'Friday' }, roster, AT).state; assert.deepEqual([s.chatSettings.vibe, s.chatSettings.drama], [333, 5]);
  s = c.applyChange(s, { action: 'chat-settings', agent: 'kat', override: { vibe: 10 } }, roster, AT).state; assert.equal(c.settingsFor(s.chatSettings, 'kat').vibe, 10);
  s = c.applyChange(s, { action: 'chat-settings', agent: 'kat', override: null }, roster, AT).state; assert.equal(s.chatSettings.overrides.kat, undefined);
  assert.throws(() => c.applyChange(s, { action: 'chat-settings', save: 'rails' }, roster, AT), /another preset name/);
});
t('live preview follows the sliders; color by vibe shades darker to the ceiling', () => {
  assert.notEqual(c.previewLine(CS(c.PRESETS.rails)).text, c.previewLine(CS(c.PRESETS.crew)).text);
  assert.doesNotMatch(c.previewLine(CS({ ...c.PRESETS.breakroom, cussing: 0 })).text, /shit|hell/);
  assert.ok(c.vibeShade(10, 500) < c.vibeShade(250, 500)); assert.equal(c.vibeShade(500, 500), 1); assert.equal(c.vibeShade(600, 500), 1); assert.ok(c.vibeShade(1, 500) > 0);
});

// s16 contracts and wiring
t('the type file only names exports the core has', () => {
  const dts = readFileSync(here('./web/swarm-core.d.mts'), 'utf8');
  for (const m of dts.matchAll(/export (?:const|function) (\w+)/g)) assert.ok(m[1] in c, m[1]);
});
t('server part compiles and only reads through the CLI', () => {
  const r = spawnSync('python3', ['-m', 'py_compile', new URL('./server/__init__.py', import.meta.url).pathname], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  const py = readFileSync(here('./server/__init__.py'), 'utf8'); assert.match(py, /swarm\.mjs/); assert.doesNotMatch(py, /shell=True|_run\("(run|banter|merge|fix|pilot)"/); // a page request never spends tokens
});
t('CLI answers --json errors as JSON', () => {
  const r = spawnSync(process.execPath, [new URL('./swarm.mjs', import.meta.url).pathname, 'nope', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.deepEqual(JSON.parse(r.stdout), { ok: false, error: 'unknown command nope' });
});
t('book: a Claude session on an agent card grows, then closes once (agent-pick)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-book-'));
  const run = (...a) => JSON.parse(spawnSync(process.execPath, [new URL('./swarm.mjs', import.meta.url).pathname, ...a, '--json'], { encoding: 'utf8', env: { ...process.env, AXF_SWARM_DIR: dir, AXF_SWARM_CHATS_DIR: 'off' } }).stdout);
  let r = run('book', JSON.stringify({ session: 's1', agent: 'Snap Sully', usd: 0.5, commits: ['abc1234'] }));
  assert.equal(run('crew').crew.find((x) => x.id === 'sully').stats.failed, 0, 'an open session is not a failure');
  assert.equal(r.run.agent, 'sully'); assert.equal(r.run.status, 'running'); assert.equal(r.run.kind, 'job'); assert.equal(r.run.jobType, 'agent-session');
  r = run('book', JSON.stringify({ session: 's1', agent: 'sully', usd: 1, commits: ['def5678'], final: true }));
  assert.equal(r.run.status, 'done'); assert.match(r.run.report.summary, /commits: abc1234, def5678/);
  assert.equal(run('book', JSON.stringify({ session: 's1', agent: 'rio' })).ok, false, 'a session stays on its agent');
  assert.equal(run('book', JSON.stringify({ session: 's2', agent: 'nobody' })).ok, false);
  const crew = run('crew').crew; const s = crew.find((a) => a.id === 'sully');
  assert.equal(s.spend.today, 1); assert.equal(s.stats.done, 1); assert.ok(Array.isArray(s.writeups) && Array.isArray(s.raises));
  const chat = run('chat', '50').messages.filter((m) => m.from === 'sully'); assert.equal(chat.length, 1, 'one report in the chat, at the close');
});
t('manifest: lifecycle, builtWith, page and settings tab', () => {
  const m = JSON.parse(readFileSync(here('./plugin.json'), 'utf8'));
  assert.equal(m.lifecycle.dataDir, '.axf-console/plugins/agent-swarm'); assert.ok(m.builtWith.model && m.builtWith.builtAt);
  assert.deepEqual(m.provides, ['view:agent-swarm', 'settings-tab:agent-swarm', 'service:agent-jobs@1', 'service:axf.crew@1', 'service:axf.swarm-roster@1']); assert.equal(m.tabable.view, 'agent-swarm');
});

// batch merge end to end on a scratch repo
{
  const repo = mkdtempSync(join(tmpdir(), 'swarm-repo-'));
  const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
  g(repo, 'init', '-q', '-b', 'main'); g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'a.md'), 'one\n'); writeFileSync(join(repo, 'b.md'), 'two\n'); g(repo, 'add', '.'); g(repo, 'commit', '-qm', 'base');
  const branchWith = (name, file, text) => { g(repo, 'branch', name, 'main'); const wt = join(repo, '..', `${name.replace(/\//g, '_')}-${process.pid}`); g(repo, 'worktree', 'add', '-q', wt, name); writeFileSync(join(wt, file), text); g(wt, 'commit', '-qam', name); return wt; };
  const w1 = branchWith('swarm/m/s1', 'a.md', 'one changed\n'); const w2 = branchWith('swarm/m/s2', 'a.md', 'one clashing\n'); const w3 = branchWith('swarm/m/s3', 'b.md', 'two changed\n');
  const dd = mkdtempSync(join(tmpdir(), 'swarm-data-')); const tf = join(dd, 'orch.json');
  writeFileSync(tf, JSON.stringify({ builds: [{ id: 'm', steps: [{ id: 's1', text: 'docs', files: ['a.md'] }, { id: 's2', text: 'docs again', files: ['a.md'] }, { id: 's3', text: 'docs', files: ['a.md'] }] }] }));
  Object.assign(process.env, { AXF_SWARM_REPO: repo, AXF_SWARM_DIR: dd, AXF_ORCH_FILE: tf, AXF_SLOTS_DIR: join(dd, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_SLOTS_MEM_GB: '8' });
  const cli = await import('./swarm.mjs');
  const rep = (s) => ({ status: 'done', summary: s, notes: s === 's1' ? 'STATUS line' : '' });
  for (const [s, wt] of [['s1', w1], ['s2', w2], ['s3', w3]]) cli.saveRun({ jobId: `m.${s}`, status: 'done', branch: `swarm/m/${s}`, worktree: wt, report: rep(s) });
  const r = cli.batchMerge('m', { base: 'main' });
  t('batch merge: clean job in, clash → merge fixer, out-of-lease refused', () => {
    assert.deepEqual(r.merged, ['m.s1']); assert.equal(r.conflicts[0].job, 'm.s2'); assert.deepEqual(r.conflicts[0].files, ['a.md']); assert.equal(r.conflicts[0].fixer, 'm.fix-s2');
    assert.deepEqual(r.refused.map((x) => x.job), ['m.s3']); assert.deepEqual(r.notes, ['m.s1: STATUS line']);
    const tr = JSON.parse(readFileSync(tf, 'utf8')); assert.equal(tr.builds[0].steps[0].done, true); assert.notEqual(tr.builds[0].steps[1].done, true);
    assert.match(g(join(dd, 'worktrees', '_merge-m'), 'log', '--oneline', '-1'), /Swarm merge: m\.s1/);
  });
  cli.act({ action: 'chat-settings', preset: 'rails' }); // every reaction gets through
  const rr = await cli.run('m', 's3', { cwd: tmp, bin: okBin });
  t('a run posts Boss\'s assignment, the agent\'s report and a coworker reaction', () => {
    assert.equal(rr.status, 'done'); const ms = cli.loadState().messages; const kinds = ms.map((m) => m.kind);
    assert.ok(kinds.includes('assign') && kinds.includes('report') && kinds.includes('banter'), kinds.join());
    assert.match(ms.find((m) => m.kind === 'report').text, /Done with m\.s3\. card added/);
  });
  const f = await cli.fix('m', 's2', { dry: true });
  t('merge fixer gets the half-done merge and the conflicted files', () => { assert.equal(f.job.agent, 'max'); assert.match(f.brief.prompt, /a\.md/); assert.match(readFileSync(join(dd, 'worktrees', 'm.fix-s2', 'a.md'), 'utf8'), /<<<<<<<|>>>>>>>/); });
}

// agent jobs (job-type@1): routing to the owner, unassigned + hire, duty and budget checks, launch naming, run recorded
{
  const jc = await import('./jobs-core.mjs');
  const rules = await import('../../../../framework/core/engines/job-type-rules.mjs');
  const typesDir = new URL('../../../../framework/assets/job-type/', import.meta.url).pathname;
  const types = jc.jobTypes(readdirSync(typesDir).map((f) => JSON.parse(readFileSync(join(typesDir, f), 'utf8'))));
  const at = '2026-11-04T12:00:00.000Z'; const table = c.prices(JSON.parse(readFileSync(here('../../../../framework/schemas/model-pricing.json'), 'utf8')));
  const site = types.find((x) => x.id === 'site-check');
  const crew = roster.agents.filter((a) => a.jobsOnly);
  const allOff = (st0, except = []) => crew.filter((a) => !except.includes(a.id)).reduce((st, a) => c.applyChange(st, { action: 'status', agent: a.id, status: 'off-duty', note: 'nap' }, roster, at).state, st0);
  t('job types: nine, all valid, every crew member can take each, the home agent listed first', () => {
    assert.equal(types.length, 9); for (const jt of types) { assert.deepEqual(jt.errors, [], jt.id); const o = jc.owners(jt, roster, c.normState({}, roster)); assert.equal(o.length, crew.length, jt.id); assert.ok(o.every((a) => a.jobsOnly), jt.id); }
    for (const a of crew) assert.equal(jc.owners(types.find((x) => x.id === a.home), roster, c.normState({}, roster))[0].id, a.id, a.home);
    assert.ok(['feature-build', 'ops-fix'].every((id) => types.some((x) => x.id === id)));
    assert.equal(jc.jobsOf(types, crew[0]).length, 9); assert.equal(jc.jobsOf(types, crew[0])[0].home, true);
    assert.ok(!jc.canTake(site, roster.agents.find((a) => a.id === 'rio')), 'build agents keep their own skill');
  });
  t('job-type validation: a bad job type is named and never routed', () => {
    const bad = jc.jobTypes([{ type: 'job-type', id: 'bad', name: 'Bad', data: { specialty: 'site-checks', budget: { tokens: 5 }, trigger: { kind: 'cron' }, brief: 'x {{nope}}' } }])[0];
    assert.ok(bad.errors.length >= 3); const r = jc.route(bad, roster, c.normState({}, roster), [], table, at); assert.equal(r.ok, false); assert.match(r.why, /invalid/);
  });
  t('routing goes to the owner, on the job model, with a cap', () => {
    const r = jc.route(site, roster, c.normState({}, roster), [], table, at);
    assert.equal(r.ok, true); assert.equal(r.agent.id, 'paulie'); assert.equal(r.model, 'opus'); assert.equal(r.cap, 1);
  });
  t('home agent off duty = the next free all-rounder takes it; nobody on duty = not routed, with the reasons', () => {
    const st = c.applyChange(c.normState({}, roster), { action: 'status', agent: 'paulie', status: 'off-duty', note: 'nap' }, roster, at).state;
    const r = jc.route(site, roster, st, [], table, at); assert.equal(r.ok, true); assert.notEqual(r.agent.id, 'paulie'); assert.ok(r.agent.jobsOnly);
    const none = jc.route(site, roster, allOff(c.normState({}, roster)), [], table, at); assert.equal(none.ok, false); assert.equal(none.unassigned, false); assert.match(none.why, /paulie: Off duty/);
  });
  t('router: home job first, then least busy, then fewest runs today (round the crew), never nobody while someone is free', () => {
    const st = c.normState({}, roster); const running = (agent, i = 0) => ({ kind: 'job', jobId: `r${agent}${i}`, agent, status: 'running', startedAt: at });
    assert.equal(jc.route(site, roster, st, [running('paulie')], table, at).agent.id, 'paulie', 'home wins even when busy');
    const fb = types.find((x) => x.id === 'ops-fix');
    const first = jc.route(fb, roster, st, [], table, at).agent.id;
    const second = jc.route(fb, roster, st, [running(first)], table, at).agent.id; assert.notEqual(second, first, 'busy agent skipped');
    const done = (agent) => ({ kind: 'job', jobId: `d${agent}`, agent, status: 'done', startedAt: at });
    assert.notEqual(jc.route(fb, roster, st, [done(first)], table, at).agent.id, first, 'a day\'s runs spread the work');
    const one = allOff(st, ['earl']); assert.equal(jc.route(site, roster, one, [], table, at).agent.id, 'earl', 'the one free agent gets it');
  });
  t('router: --agent picks that agent; force books someone when nobody is free and says why', () => {
    const st = c.normState({}, roster); const fb = types.find((x) => x.id === 'feature-build');
    assert.equal(jc.route(fb, roster, st, [], table, at, { agent: 'lenny' }).agent.id, 'lenny');
    assert.match(jc.route(fb, roster, st, [], table, at, { agent: 'zed' }).why, /no agent "zed"/);
    const off = allOff(st); const f = jc.route(fb, roster, off, [], table, at, { force: true }); assert.equal(f.ok, true); assert.equal(f.forced, true); assert.match(f.why, /nobody free/);
  });
  t('a headless build ends done on a clean result, blocked (no strike) when stopped part way', () => {
    assert.equal(jc.buildOutcome({ final: true, isError: false }).status, 'done'); assert.equal(jc.buildOutcome({ final: true, isError: true, subtype: 'error_max_turns' }).reason, 'error_max_turns');
    assert.equal(jc.buildOutcome({ final: false }).status, 'blocked'); assert.ok(jc.isBuildRun({ source: 'assign' })); assert.ok(!jc.isBuildRun({}));
  });
  t('budget check: an agent whose pay left this week is under the run cap is not routed', () => {
    const st = crew.reduce((x, a) => c.applyChange(x, { action: 'salary', agent: a.id, usd: 0.5 }, roster, at).state, c.normState({}, roster));
    const r = jc.route(site, roster, st, [], table, at); assert.equal(r.ok, false); assert.match(r.why, /\$0\.50 left this week, the run may cost up to \$1\.00/);
    assert.equal(jc.route(site, roster, c.applyChange(c.normState({}, roster), { action: 'salary', agent: 'paulie', usd: 0.5 }, roster, at).state, [], table, at).ok, true, 'someone else under budget takes it');
    const broke = crew.reduce((x, a) => c.applyChange(x, { action: 'salary', agent: a.id, usd: 0 }, roster, at).state, c.normState({}, roster));
    assert.match(jc.route(site, roster, broke, [], table, at).why, /broke/);
  });
  const orphan = jc.jobTypes([{ type: 'job-type', id: 'cert-renew', name: 'Cert renewals', description: 'Renew certificates.', data: { specialty: 'certs', budget: { tokens: 50000 }, trigger: { kind: 'on-demand' }, brief: 'Renew {{date}}' } }])[0];
  t('a new job type: the all-rounders take it; with no crew it is unassigned, and a one-tap hire owns it after', () => {
    assert.equal(jc.route(orphan, roster, c.normState({}, roster), [], table, at).ok, true, 'all-rounders take job types added later');
    const builders = { ...roster, agents: roster.agents.filter((a) => !a.jobsOnly) };
    const r = jc.route(orphan, builders, c.normState({}, builders), [], table, at); assert.equal(r.unassigned, true); assert.match(r.why, /nobody can take Cert renewals/);
    const h = jc.hireFor(orphan, builders, at); assert.equal(h.agent.skill, 'certs'); assert.equal(h.agent.home, 'cert-renew'); assert.ok(h.agent.jobsOnly); assert.ok(!roster.agents.some((a) => a.id === h.agent.id));
    const r2 = { ...builders, agents: [...builders.agents, h.agent] }; const ok2 = jc.route(orphan, r2, c.normState({}, r2), [], table, at); assert.equal(ok2.ok, true); assert.equal(ok2.agent.id, h.agent.id);
    assert.deepEqual(c.checkRoster(r2, { ...skills, certs: { ...h.skill, schema: 'agent-skill@1' } }), []);
  });
  t('brief = the job brief + the agent\'s own notes only; read-only gets no edit tools', () => {
    const paulie = roster.agents.find((a) => a.id === 'paulie');
    const b = jc.jobBrief(site, paulie, { values: rules.jobInputs(site.data, {}).values, at, runId: 'job-site-check-x', skill: skills['site-checks'], notes: 'NOTE-LINE' });
    assert.match(b.text, /NOTE-LINE/); assert.match(b.text, /demo\.amberxai\.com/); assert.doesNotMatch(b.text, /_claude\/memory\/STATUS|RULES\.md/);
    assert.ok(b.tokens < 2500, `brief is ${b.tokens} tokens`);
    const args = jc.jobArgs(site, paulie, 'opus'); const tools = args[args.indexOf('--allowedTools') + 1];
    assert.doesNotMatch(tools, /\b(Edit|Write)\b/); assert.equal(args[args.indexOf('--permission-mode') + 1], 'default'); assert.ok(args.includes('--strict-mcp-config'));
  });
  // end to end through jobs.mjs: a fake launcher, a scratch repo, then a finished stream swept onto the agent
  const repo = mkdtempSync(join(tmpdir(), 'jobs-repo-')); const dd = mkdtempSync(join(tmpdir(), 'jobs-data-'));
  const g = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  g(repo, 'init', '-q', '-b', 'main'); g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't'); writeFileSync(join(repo, 'a.md'), 'a\n'); g(repo, 'add', '.'); g(repo, 'commit', '-qm', 'base');
  const argsFile = join(dd, 'launch-args.txt');
  const launch = join(dd, 'fake-launch.sh'); writeFileSync(launch, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\necho "started axf-$2 in $(pwd)"\n`); chmodSync(launch, 0o755);
  Object.assign(process.env, { AXF_SWARM_REPO: repo, AXF_SWARM_DIR: dd, AXF_JOB_LAUNCHER: launch, AXF_JOB_TYPES_DIR: typesDir });
  const jobs = await import('./jobs.mjs'); const sw = await import('./swarm.mjs');
  const rec = jobs.run('site-check', { inputs: { sites: 'demo.amberxai.com' } });
  t('launcher naming: claude-headless gets --name <agent>-<job>, the brief file and the job\'s model', () => {
    assert.equal(rec.ok, true); const a = readFileSync(argsFile, 'utf8').split('\n');
    assert.equal(a[a.indexOf('--name') + 1], 'paulie-site-check'); assert.match(a[a.indexOf('--brief') + 1], /job-briefs\/job-site-check-.*\.md$/);
    assert.equal(a[a.indexOf('--model') + 1], 'claude-opus-5-5'); assert.equal(rec.run.tmux, 'axf-paulie-site-check'); assert.equal(rec.run.session, 'paulie-site-check');
    assert.match(readFileSync(a[a.indexOf('--brief') + 1], 'utf8'), /Check these sites, read-only: demo\.amberxai\.com\./);
  });
  t('unassigned through the CLI: no launch, Boss says so', () => {
    const r = jobs.run('listener-qa', { inputs: { symptom: 'x' }, dry: true }); assert.equal(r.ok, true); assert.equal(r.agent, 'earl');
    assert.throws(() => jobs.run('listener-qa', { dry: true }), /needs --input symptom=/);
  });
  const stream = [JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2000, output_tokens: 500 } } }), JSON.stringify({ type: 'result', subtype: 'success', num_turns: 3, total_cost_usd: 0.12, usage: { input_tokens: 9000, output_tokens: 1500 }, result: 'All four up, kid.\n```json\n{"status":"done","summary":"4 sites ok","files":[],"checks":[{"name":"curl","ok":true}]}\n```' })];
  writeFileSync(join(rec.run.cwd, `${rec.run.log.replace(/\.log$/, '')}.jsonl`), `${stream.join('\n')}\n`);
  const closed = jobs.sweep({ alive: () => false });
  t('run recorded on the agent: runs, stats, spend, report saved, chat', () => {
    assert.deepEqual(closed, [rec.run.jobId]); const r = sw.loadRuns().find((x) => x.jobId === rec.run.jobId);
    assert.equal(r.status, 'done'); assert.equal(r.kind, 'job'); assert.equal(r.reportedCost, 0.12); assert.ok(existsSync(r.reportFile));
    const stats = c.agentStats(sw.loadRuns(), 'paulie', sw.priceTable()); assert.equal(stats.done, 1); assert.equal(stats.feed[0].summary, '4 sites ok');
    const v = jobs.list().find((j) => j.id === 'site-check'); assert.equal(v.lastRun.status, 'done'); assert.equal(v.cost.runs, 1); assert.ok(v.next > v.lastRun.at);
    const ms = sw.loadState().messages; assert.ok(ms.some((m) => m.kind === 'assign' && /Ping Paulie, you're on Site health check/.test(m.text))); assert.ok(ms.some((m) => m.kind === 'report' && m.from === 'paulie'));
  });
  t('queued by the agent cap: recorded, kept open while it waits for a desk', () => {
    writeFileSync(launch, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\necho "queued at position 2 (slot-abc) · starts when a desk frees"\n`);
    const q = jobs.run('ui-screenshots', { at: '2026-11-04T12:30:00.000Z', inputs: { screen: '/agent-swarm' } });
    assert.deepEqual(q.run.queued, { position: 2, id: 'slot-abc' }); assert.equal(q.run.tmux, '');
    const runs = sw.loadRuns(); runs.find((x) => x.jobId === q.run.jobId).startedAt = new Date().toISOString(); writeFileSync(sw.runsFile(), JSON.stringify({ runs }));
    assert.deepEqual(jobs.sweep(), []); assert.equal(sw.loadRuns().find((x) => x.jobId === q.run.jobId).status, 'running');
    writeFileSync(launch, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\necho "started axf-$2 in $(pwd)"\n`);
  });
  t('a session gone without a result is closed as error', () => {
    const r2 = jobs.run('banner-cleanup', { at: '2026-11-04T13:00:00.000Z' }); assert.equal(r2.ok, true);
    assert.ok(jobs.sweep({ alive: (x) => x.jobId !== r2.run.jobId }).includes(r2.run.jobId)); assert.equal(sw.loadRuns().find((x) => x.jobId === r2.run.jobId).status, 'error');
  });
  t('a job type added later needs no hire: the crew take it', () => {
    const d2 = join(dd, 'types2'); mkdirSync(d2); writeFileSync(join(d2, 'cert-renew.json'), JSON.stringify({ $axf: 'asset@1', type: 'job-type', id: 'cert-renew', name: 'Cert renewals', version: '1.0.0', data: { specialty: 'certs', budget: { tokens: 50000 }, trigger: { kind: 'on-demand' }, brief: 'Renew {{date}}' } }));
    process.env.AXF_JOB_TYPES_DIR = d2;
    assert.equal(jobs.list()[0].unassigned, false, 'the all-rounders take a job type added later');
    assert.throws(() => jobs.hire('cert-renew'), /already has an owner/);
    process.env.AXF_JOB_TYPES_DIR = typesDir;
  });
}

// every headless session is booked on a named agent (deploy/claude-headless.sh → jobs.mjs book; back-assign → assign)
{
  const jobs = await import('./jobs.mjs'); const sw = await import('./swarm.mjs');
  const root = mkdtempSync(join(tmpdir(), 'builds-')); process.env.AXF_BUILDS_ROOT = root;
  const b = join(root, 'demo-fix'); mkdirSync(b);
  writeFileSync(join(b, '.axhub-build.json'), JSON.stringify({ name: 'demo-fix', repo: 'AmberX-AXF', base: 'main', model: 'opus', startedAt: 1793713010 }));
  writeFileSync(join(b, 'demo-fix.log'), 'x\n');
  writeFileSync(join(b, 'demo-fix.jsonl'), `${JSON.stringify({ type: 'result', subtype: 'success', num_turns: 9, total_cost_usd: 3.5, usage: { input_tokens: 900, output_tokens: 100 }, result: 'Built it.' })}\n`);
  const a = jobs.assign('demo-fix');
  t('assign: a finished build is booked on a crew agent, closed done with its cost, no bonus, no strike', () => {
    assert.ok(a.agent.jobsOnly); assert.equal(a.closed, true);
    const r = sw.loadRuns().find((x) => x.jobId === a.run.jobId); assert.equal(r.status, 'done'); assert.equal(r.reportedCost, 3.5); assert.equal(r.build, 'demo-fix'); assert.equal(r.source, 'assign'); assert.equal(r.jobType, 'feature-build');
    assert.equal(r.startedAt, new Date(1793713010 * 1000).toISOString());
    assert.equal(sw.loadState().agents[a.agent.id].bonuses.filter((x) => x.jobId === r.jobId).length, 0);
    assert.equal(jobs.assign('demo-fix').existing, true, 'assigning twice books once');
  });
  t('book: a launch is booked on the agent asked for, else the router\'s pick; unknown agents are refused', () => {
    const l = jobs.book({ name: 'next-build', agent: 'lenny', cwd: b, log: 'next.log' }); assert.equal(l.agent.id, 'lenny'); assert.equal(l.run.status, 'running'); assert.equal(l.run.source, 'launcher');
    const p = jobs.book({ name: 'other-build', cwd: b }); assert.ok(p.agent.jobsOnly); assert.notEqual(p.agent.id, 'lenny', 'least busy');
    assert.throws(() => jobs.book({ name: 'x', agent: 'zed' }), /no agent "zed"/);
    assert.ok(sw.loadState().messages.some((m) => m.kind === 'assign' && /next-build/.test(m.text)));
  });
}

// chat watch: read-only hub mirror + mentions of Brett (breakroom-chats@1)
{
  const w = await import('./web/chat-watch.mjs');
  const st = { chat: { enabled: true }, messages: [
    { id: 'a', at: '2026-11-03T10:00:00.000Z', from: 'boss', kind: 'assign', text: 'Brett wants this today.' },
    { id: 'b', at: '2026-11-03T10:01:00.000Z', from: 'rio', kind: 'banter', text: 'Brett is a cheapskate, docked my pay again.' },
    { id: 'c', at: '2026-11-03T10:02:00.000Z', from: 'kat', kind: 'report', text: 'Done. Q for Brett: which theme? key ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    { id: 'd', at: '2026-11-03T10:03:00.000Z', from: 'kat', kind: 'banter', text: 'Boss gave me the merge, he said ship it.' },
    { id: 'e', at: '2026-11-03T10:04:00.000Z', from: 'brett', kind: 'brett', text: 'Brett here.' },
  ] };
  t('mentions: about Brett only, newest first, Boss and Brett posts skipped, tone marked', () => {
    const m = w.mentions(st, roster); assert.deepEqual(m.map((x) => x.id), ['c', 'b']);
    assert.equal(m[1].tone, 'negative'); assert.equal(m[0].tone, 'neutral'); assert.deepEqual(w.mentions(st, roster, { negativeOnly: true }).map((x) => x.id), ['b']);
    assert.equal(m[1].fromName, roster.agents.find((a) => a.id === 'rio').name);
  });
  t('a bare "Boss" is the orchestrator, "the boss" is Brett', () => { assert.deepEqual(w.mentionHits('Boss gave me the job'), []); assert.deepEqual(w.mentionHits('the boss docked me'), ['the boss']); assert.deepEqual(w.mentionHits('he said ok'), []); });
  t('secrets are redacted on the way out', () => { const d = w.chatDocs(st, roster, '2026-11-03T11:00:00.000Z'); const all = JSON.stringify(d); assert.ok(!all.includes('ghp_abc')); assert.match(all, /redacted:github-token/); assert.equal(d['index.json'].readOnly, true); assert.equal(d['index.json'].mentions.path, 'agent-swarm/chats/mentions.json'); });
  t('the hub mirror is written on save and only into its own folder', () => {
    const d = mkdtempSync(join(tmpdir(), 'axf-chats-')); const hub = join(d, 'hub');
    writeFileSync(join(d, 'state.json'), JSON.stringify(st));
    const r = spawnSync(process.execPath, [new URL('./swarm.mjs', import.meta.url).pathname, 'act', 'say', 'hi', 'crew', '--json'], { env: { ...process.env, AXF_SWARM_DIR: d, AXF_SWARM_CHATS_DIR: hub }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(readdirSync(hub).sort(), ['group.json', 'index.json', 'mentions.json']);
    const g = JSON.parse(readFileSync(join(hub, 'group.json'), 'utf8')); assert.equal(g.messages.at(-1).text, 'hi crew');
    const m = spawnSync(process.execPath, [new URL('./swarm.mjs', import.meta.url).pathname, 'mentions', '--negative', '--json'], { env: { ...process.env, AXF_SWARM_DIR: d }, encoding: 'utf8' });
    assert.equal(JSON.parse(m.stdout).count, 1);
  });
}

console.log(`agent-swarm: ${n} checks passed`);
