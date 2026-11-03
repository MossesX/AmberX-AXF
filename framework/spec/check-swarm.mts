/**
 * Agent swarm contracts (core/engines/swarm-rules.mjs): agent@1, agent-skill@1, swarm-roster@1, swarm-state@1,
 * swarm-job@1, swarm-run@1 (kind build and kind job) and swarm-report@1. The fixture replays (normalizers, validators
 * that name the field, report parsing), every model choice goes through model-policy@1, the registry snapshot and the
 * JSON Schemas are current, the shipped roster and skill pages validate, and the console plugin uses the framework's
 * contract (its core re-exports the same functions, never a copy). Kotlin twin deferred (PORTING.md).
 *   npx -y tsx framework/spec/check-swarm.mts            (--write regenerates spec/fixtures/swarm.json)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import * as S from '../core/engines/swarm-rules.mjs';
import { ALLOWED_MODELS, DEFAULT_MODEL, MODEL_TIERS } from '../core/model-policy.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const fields = (errs: { field: string }[]) => errs.map((e) => e.field);

/* ---- the contract: computed here, replayed from the fixture ---- */
const AT = '2026-11-03T14:00:00.000Z';
const agent = { $axf: 'agent@1', id: 'rio', name: 'Rio React', role: 'Front-end engineer', skill: 'react-ui', specialty: 'React views on the framework controls', keywords: ['React', 'tsx', 'hook'], paths: ['apps/console-web/plugins/**/web/', '**/*.tsx'], models: ['sonnet', 'fable'], tools: ['Read', 'Edit', 'Grep'], maxTurns: 30, tokenBudget: 400000, salary: 20, hiredAt: '2026-10-31', avatar: { face: 'square', hair: 4, gear: 'shades', hue: 200 }, catchphrase: 'Ship it.', bio: 'Lives in the console.' };
const skillMd = '---\n$axf: agent-skill@1\nid: react-ui\ntitle: React UI\n---\nBuild views from framework controls only.\n- Tokens only, no raw colours.\n';
const roster = { $axf: 'swarm-roster@1', tune: { scale: 0.5, basis: 'pilot' }, agents: [agent, { id: 'doc', skill: 'docs', tools: ['Read', 'Edit'], models: ['haiku'] }] };
const skills = { 'react-ui': S.parseSkill(skillMd), docs: S.normSkill({ id: 'docs', title: 'Docs', body: 'Write the docs.' }) };
const state = {
  updatedAt: AT, rules: { rageQuitAfter: 2 },
  agents: { rio: { status: 'probation', note: 'watch the leases', cap: 30, history: [{ at: AT, from: 'On duty', to: 'Probation', note: 'watch the leases' }], identity: { name: 'Rio R.', photo: 'https://example.test/rio.png' }, card: 'license' }, gone: { status: 'fired' } },
  chat: { enabled: true, agents: { doc: false } }, chatSettings: { vibe: 999, chattiness: 65, cussing: -5, preset: 'breakroom', overrides: { rio: { vibe: 50, drama: 200 } }, banterBudget: 2, saved: [{ name: 'Friday', vibe: 333 }] },
  messages: [{ id: 'm1', at: AT, from: 'boss', kind: 'assign', text: 'Rio, you got b.s1.', jobId: 'b.s1' }, { from: 'rio', kind: 'nope', text: 'yo', vibe: 120, toned: true }],
  banterSpend: [{ at: AT, usd: 0.1 }], notices: [{ at: AT, agent: 'rio', text: 'probation run' }],
  cards: { default: 'corporate-badge', designs: [{ id: 'my-pass', name: 'My pass', data: { design: 'backstage', front: ['name', 'status'], labels: { status: 'Access' }, evil: 1 } }, { id: 'X', data: {} }] },
  hired: [{ id: 'paulie', skill: 'site-checks', jobsOnly: true, tools: ['Read'], models: ['opus'] }], hiredSkills: { 'site-checks': { title: 'Site checks', body: 'Ping the sites.' } },
};
const job = { $axf: 'swarm-job@1', id: 'b.s1', buildId: 'b', stepId: 's1', text: 'React card in apps/x/web/ui.tsx', estimate: '20 min', agent: 'rio', skill: 'react-ui', tier: 'sonnet', model: 'sonnet', match: 5, leases: ['apps/x/web/ui.tsx'], leaseKind: 'files', shared: ['_claude/THREADS.md'], budget: { tokens: 200000, maxTurns: 20 }, checks: ['tsc'], wave: 1, after: ['a.s1'] };
const report = { $axf: 'swarm-report@1', status: 'done', summary: 'card added', files: ['apps/x/web/ui.tsx'], checks: [{ name: 'tsc', ok: true }, { name: 'lint', ok: 'yes' }], notes: 'STATUS: card', handoff: 'props renamed', question: '' };
const usage = { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0 };
const buildRun = { $axf: 'swarm-run@1', kind: 'build', jobId: 'b.s1', buildId: 'b', stepId: 's1', agent: 'rio', model: 'haiku', startedAt: AT, endedAt: '2026-11-03T14:20:00.000Z', status: 'done', reason: '', report, usage, budget: { tokens: 200000, maxTurns: 20 }, turns: 7, reportedCost: 0.42, cwd: '/tmp/wt', branch: 'swarm/b/s1', worktree: '/tmp/wt', lease: { ok: true, outside: [], shared: [], files: ['apps/x/web/ui.tsx'] } };
const jobRun = { kind: 'job', jobId: 'job-site-check-2026-11-03-1400', buildId: 'job:site-check', stepId: 'site-check', jobType: 'site-check', agent: 'paulie', model: 'opus', startedAt: AT, endedAt: '', status: 'running', reason: '', report: null, usage: null, reportedCost: null, turns: 0, budget: { tokens: 100000, maxTurns: 10 }, session: 'paulie-site-check', cwd: '/tmp/j', branch: '', worktree: '/tmp/j', log: 'run.log', reportPath: 'r/site-check/2026-11-03-1400.md', group: 'Checks - Nov 3', inputs: { sites: 'demo.amberxai.com' }, briefTokens: 800, tmux: 'axf-paulie-site-check', queued: null };
const reportText = 'All done.\n```json\n{"status":"done","summary":"card added","files":["a.tsx"],"checks":[{"name":"tsc","ok":true}]}\n```\nthen\n```json\n{"status":"meh"}\n```';

const errorCases: Record<string, [string, unknown, unknown?]> = {
  'agent-ok': ['agent@1', S.normAgent(agent)],
  'agent-sonnet': ['agent@1', agent],
  'agent-bad': ['agent@1', { id: 'Rio R', models: ['sonnet', 'gpt'], tools: [], maxTurns: 0, salary: -1, avatar: { face: 'oval', hair: 9 }, hiredAt: 'soon', keywords: 'react' }],
  'agent-junk': ['agent@1', 'nope'],
  'skill-ok': ['agent-skill@1', skills['react-ui']],
  'skill-bad': ['agent-skill@1', S.parseSkill(`---\nid: big\n---\n${'line\n'.repeat(80)}`)],
  'roster-ok': ['swarm-roster@1', S.normRoster(roster), { skills }],
  'roster-blocked-models': ['swarm-roster@1', roster, { skills }],
  'roster-bad': ['swarm-roster@1', { $axf: 'roster@0', tune: { scale: 9 }, agents: [{ id: 'A b', skill: 'none' }, { id: 'A b' }] }, { skills }],
  'state-ok': ['swarm-state@1', S.normState(state, S.normRoster(roster))],
  'state-bad': ['swarm-state@1', { $axf: 'state@0', updatedAt: 'yesterday', rules: { rageQuitAfter: 0 }, agents: { rio: { status: 'awol', custom: {}, salary: -5, card: 'X', history: 'none' }, kat: { status: 'custom' } }, chatSettings: { vibe: 0, cussing: 101, banterBudget: 5000, overrides: [] }, messages: [{ kind: 'shout', text: '' }, 'x'], cards: { default: 'X', designs: [{ id: 'X' }] }, hired: [{ id: 'bad id' }] }],
  'job-ok': ['swarm-job@1', S.normJob(job)],
  'job-sonnet': ['swarm-job@1', job],
  'job-bad': ['swarm-job@1', { $axf: 'job@0', id: '', agent: 'Rio', model: 'sonnet', leaseKind: 'some', budget: { tokens: 1, maxTurns: 999 }, wave: -1, after: 'a.s1' }],
  'run-ok-build': ['swarm-run@1', S.normRun(buildRun)],
  'run-haiku': ['swarm-run@1', buildRun],
  'run-ok-job': ['swarm-run@1', jobRun],
  'run-bad': ['swarm-run@1', { $axf: 'run@0', kind: 'test', jobId: '', agent: 'rio', model: 'gpt', startedAt: 'now', endedAt: '', status: 'lost', report: { status: 'blocked', question: '' }, usage: { input: 'many' }, reportedCost: 'free' }],
  'report-ok': ['swarm-report@1', S.normReport(report)],
  'report-loose-check': ['swarm-report@1', report],
  'report-bad': ['swarm-report@1', { status: 'blocked', summary: 1, files: 'a.tsx', checks: [{ name: 'tsc' }], notes: [] }],
  'unknown-tag': ['widget@1', {}],
};
const computed = {
  normalized: {
    agent: S.normAgent(agent),
    agentJunk: S.normAgent(null),
    agentBlockedModels: S.normAgent({ id: 'x', models: ['haiku', 'sonnet', 'nope'] }).models,
    skill: skills['react-ui'],
    skillNoFrontMatter: S.parseSkill('Just a body.'),
    roster: S.normRoster(roster),
    rosterJunk: S.normRoster(42),
    state: S.normState(state, S.normRoster(roster)),
    stateJunk: S.normState(null, null),
    job: S.normJob(job),
    jobJunk: S.normJob({}),
    report: S.normReport(report),
    reportJunk: S.normReport('x'),
    runBuild: S.normRun(buildRun),
    runJob: S.normRun(jobRun),
    runJunk: S.normRun({}),
  },
  errors: Object.fromEntries(Object.entries(errorCases).map(([k, [tag, v, ctx]]) => [k, S.swarmErrors(tag, v, ctx)])),
  parsed: { report: S.parseReport(reportText), none: S.parseReport('no block'), badStatus: S.parseReport('```json\n{"status":"meh"}\n```') },
  budgetTokens: { usage: S.budgetTokens(usage), none: S.budgetTokens(null) },
};
const FX = 'framework/spec/fixtures/swarm.json';
if (process.argv.includes('--write')) writeFileSync(new URL(FX, root), `${JSON.stringify({ $axf: 'fixture@1', about: 'agent swarm contracts (core/engines/swarm-rules.mjs); regenerate: npx -y tsx framework/spec/check-swarm.mts --write', at: AT, inputs: { agent, skillMd, roster, state, job, report, buildRun, jobRun, reportText }, ...computed }, null, 1)}\n`);
const fx = read(FX);
for (const k of Object.keys(computed) as (keyof typeof computed)[]) eq(computed[k], fx[k], `fixture: ${k}`);

/* ---- what the fixture must say ---- */
const N = fx.normalized;
eq(N.agent.models, ['opus', 'fable'], 'a stored Sonnet runs as Opus (model policy: coerced up, never down)');
eq(N.agentBlockedModels, ['opus'], 'blocked and unknown models collapse to the cheapest allowed');
eq(N.agentJunk.models, [DEFAULT_MODEL], 'no models = the policy default');
eq(N.agent.keywords, ['react', 'tsx', 'hook'], 'keywords are lowercased');
eq(N.agent.avatar, { face: 'square', hair: 4, gear: 'shades', hue: 200 }, 'avatar kept as given');
eq(N.agentJunk.avatar, { face: 'round', hair: 0, gear: 'none', hue: 0 }, 'avatar defaults');
ok(N.skill.schema === 'agent-skill@1' && N.skill.id === 'react-ui' && N.skill.lines === 2, 'skill front matter parsed');
eq(N.skillNoFrontMatter.body, 'Just a body.', 'a file without front matter is all body');
eq(N.roster.agents[1].models, ['opus'], 'a Haiku-only roster agent runs as Opus');
eq(N.roster.tune, { scale: 0.5, basis: 'pilot' }, 'tune kept');
eq(N.rosterJunk, { $axf: 'swarm-roster@1', tune: { scale: 1, basis: '' }, agents: [] }, 'roster from junk');
eq(N.state.agents.rio.salary, 30, 'an old spend cap becomes the salary');
eq(N.state.agents.rio.card, 'license', 'per-agent card design kept');
eq(N.state.agents.rio.identity.name, 'Rio R.', 'identity edits kept');
eq(Object.keys(N.state.agents).sort(), ['doc', 'gone', 'rio'], 'every roster agent has a state; agents off the roster keep theirs');
eq([N.state.chatSettings.vibe, N.state.chatSettings.cussing, N.state.chatSettings.overrides.rio], [500, 0, { vibe: 50, drama: 100 }], 'sliders clamped to their ranges');
eq(N.state.messages[1].kind, 'banter', 'an unknown message kind reads as banter');
eq(N.state.cards.designs.map((d: { id: string }) => d.id), ['my-pass'], 'a design with a bad id is dropped');
eq(N.state.cards.designs[0].data, { design: 'backstage', front: ['name', 'status'], labels: { status: 'Access' } }, 'a saved design keeps only agent-card keys');
eq(N.state.hired[0].jobsOnly, true, 'Breakroom hires are kept with their flag');
eq(N.state.hiredSkills['site-checks'].id, 'site-checks', 'hired skill pages are keyed by id');
eq(N.stateJunk.$axf, 'swarm-state@1', 'state from junk');
eq([N.job.tier, N.job.model], ['opus', 'opus'], 'a Sonnet job runs as Opus');
eq(N.jobJunk.leaseKind, 'all', 'a job with no leases leases everything');
eq(N.report.checks, [{ name: 'tsc', ok: true }, { name: 'lint', ok: false }], 'a check is ok only when ok is true');
eq(N.reportJunk.status, 'failed', 'a report from junk is a failure');
eq([N.runBuild.kind, N.runBuild.model, N.runBuild.budgetTokens], ['build', 'opus', 1700], 'build run: kind, model coerced, budget tokens from usage');
eq(N.runJob.kind, 'job', 'job run keeps its kind');
eq([N.runJob.jobType, N.runJob.session, N.runJob.inputs, N.runJob.queued], ['site-check', 'paulie-site-check', { sites: 'demo.amberxai.com' }, null], 'job run keeps its launch fields');
eq(N.runJunk.status, 'error', 'a run from junk is an error');
eq(fx.parsed.report.summary, 'card added', 'the last valid report block wins');
eq([fx.parsed.none, fx.parsed.badStatus], [null, null], 'no block or a bad status = no report');
eq(fx.budgetTokens, { usage: 1700, none: 0 }, 'cache reads count a tenth');

/* ---- validators name the field ---- */
const E = fx.errors;
for (const k of ['agent-ok', 'skill-ok', 'roster-ok', 'state-ok', 'job-ok', 'run-ok-build', 'run-ok-job', 'report-ok']) eq(E[k], [], `${k}: no errors`);
eq(fields(E['agent-bad']), ['agent.id', 'agent.skill', 'agent.models[0]', 'agent.models[1]', 'agent.tools', 'agent.keywords', 'agent.maxTurns', 'agent.salary', 'agent.avatar.face', 'agent.avatar.hair', 'agent.hiredAt'], 'agent: every bad field named');
ok(E['agent-bad'].some((e: { message: string }) => /never Sonnet/.test(e.message)), 'a Sonnet agent is refused by the model rule');
eq(fields(E['agent-sonnet']), ['agent.models[0]'], 'a raw roster naming Sonnet is refused by name (normalized, it runs as Opus)');
eq(fields(E['roster-blocked-models']), ['agents[0].models[0]', 'agents[1].models[0]'], 'a raw roster naming Sonnet or Haiku is refused per agent');
eq(fields(E['job-sonnet']), ['job.model'], 'a raw Sonnet job is refused by name');
eq(fields(E['run-haiku']), ['run.model', 'run.report.checks[1]'], 'a raw Haiku run is refused by name, and its report is checked inside');
eq(fields(E['agent-junk']), ['agent'], 'agent junk');
eq(fields(E['skill-bad']), ['skill.schema', 'skill.body'], 'skill: front matter + one page');
eq(fields(E['roster-bad']), ['$axf', 'tune.scale', 'agents[0].id', 'agents[0].tools', 'agents[0].skill', 'agents[1].id', 'agents[1].skill', 'agents[1].tools', 'agents[1].id'], 'roster: bad id, no tools, missing skill file, listed twice');
ok(E['roster-bad'].some((e: { message: string }) => /listed twice/.test(e.message)) && E['roster-bad'].some((e: { message: string }) => /no skill file/.test(e.message)), 'roster messages read as sentences');
eq(fields(E['state-bad']), ['$axf', 'updatedAt', 'rules.rageQuitAfter', 'agents.rio.status', 'agents.rio.salary', 'agents.rio.card', 'agents.rio.history', 'agents.kat.custom.name', 'chatSettings.vibe', 'chatSettings.cussing', 'chatSettings.banterBudget', 'chatSettings.overrides', 'messages[0].kind', 'messages[0].text', 'messages[0].from', 'messages[1]', 'cards.default', 'cards.designs[0].id', 'hired[0].id', 'hired[0].skill', 'hired[0].tools'], 'state: every bad field named');
eq(fields(E['job-bad']), ['job.$axf', 'job.id', 'job.buildId', 'job.stepId', 'job.skill', 'job.agent', 'job.model', 'job.leases', 'job.leaseKind', 'job.budget.tokens', 'job.budget.maxTurns', 'job.wave', 'job.after'], 'job: every bad field named');
eq(fields(E['run-bad']), ['run.$axf', 'run.kind', 'run.jobId', 'run.model', 'run.startedAt', 'run.status', 'run.endedAt', 'run.report.$axf', 'run.report.question', 'run.usage', 'run.reportedCost'].filter((f) => f !== 'run.report.$axf'), 'run: every bad field named, the report checked inside');
eq(fields(E['report-bad']), ['report.summary', 'report.files', 'report.checks[0]', 'report.notes', 'report.question'], 'report: every bad field named; blocked needs the question');
eq(fields(E['report-loose-check']), ['report.checks[1]'], 'a check whose ok is not a boolean is named');
eq(fields(E['unknown-tag']), ['$axf'], 'an unknown tag is one error');
ok(S.rejection(E['job-bad']).includes('job.id is missing'), 'rejection joins the messages');

/* ---- models only through the policy ---- */
eq(S.SWARM.models, { tiers: MODEL_TIERS, allowed: ALLOWED_MODELS, default: DEFAULT_MODEL }, 'the registry carries the policy (same arrays, no copy)');
ok(S.SWARM.models.tiers === MODEL_TIERS, 'tiers are the policy\'s own array');
for (const m of ['haiku', 'sonnet']) ok(!S.jsonSchemas()['agent.schema.json'].properties.models.items.enum.includes(m), `the agent schema never allows ${m}`);

/* ---- snapshot + JSON Schemas current (run axf schemas) ---- */
eq(read('framework/schemas/swarm.json'), JSON.parse(JSON.stringify(S.SWARM)), 'schemas/swarm.json matches SWARM (run axf schemas)');
for (const [name, schema] of Object.entries(S.jsonSchemas())) eq(read(`framework/schemas/json/${name}`), JSON.parse(JSON.stringify(schema)), `schemas/json/${name} is current (run axf schemas)`);
ok(Object.keys(S.jsonSchemas()).length === 7, 'seven JSON Schemas, one per record');

/* ---- the shipped roster and skill pages (found, never named: a plugin folder is not referenced outside itself) ---- */
const plugins = 'apps/console-web/plugins';
const rosters = readdirSync(new URL(`${plugins}/`, root)).map((f) => `${plugins}/${f}`).filter((d) => existsSync(new URL(`${d}/agents/roster.json`, root)));
ok(rosters.length >= 1, 'a plugin ships a roster');
for (const d of rosters) {
  const r = read(`${d}/agents/roster.json`);
  const sk = Object.fromEntries(readdirSync(new URL(`${d}/agents/skills/`, root)).filter((f) => f.endsWith('.md')).map((f) => { const s = S.parseSkill(readFileSync(new URL(`${d}/agents/skills/${f}`, root), 'utf8')); return [s.id, s]; }));
  eq(S.rosterErrors(r, sk), [], `${d}: roster + skills validate`);
  eq(S.rosterErrors(S.normRoster(r), sk), [], `${d}: the normalized roster validates too`);
  for (const a of r.agents) for (const m of a.models ?? []) ok(ALLOWED_MODELS.includes(m), `${d}: ${a.id} runs on ${m}`);
  // the plugin's core re-exports the framework's contract: the same functions, never a copy
  const core = await import(new URL(`${d}/web/swarm-core.mjs`, root).href);
  for (const k of ['normAgent', 'normRoster', 'parseSkill', 'normState', 'normAgentState', 'normChatSettings', 'normCardDesign', 'normReport', 'parseReport', 'normRun', 'budgetTokens', 'STATUSES', 'PRESETS', 'SHARED_FILES', 'AVATAR_TOKENS']) ok(core[k] === (S as Record<string, unknown>)[k], `${d}: core.${k} is the framework's`);
}

console.log(`✓ swarm: ${n} checks passed`);
