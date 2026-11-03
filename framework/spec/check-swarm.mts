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
import * as C from '../core/engines/swarm-chat.mjs';
import * as V from '../core/engines/swarm-vibe.mjs';
import { PRESETS as PRESETS_ } from '../core/engines/swarm-rules.mjs';
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
eq(N.rosterJunk, { $axf: 'swarm-roster@1', tune: { scale: 1, basis: '' }, fallback: '', agents: [] }, 'roster from junk');
eq(S.normRoster({ ...roster, fallback: 'doc' }).fallback, 'doc', 'the fallback agent is kept');
eq(fields(S.rosterErrors({ ...roster, fallback: 'ghost' }, skills)).filter((f) => f === 'fallback'), ['fallback'], 'a fallback who is not on the roster is named');
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

/* ---- the group chat contract (swarm-chat.mjs): computed here, replayed from spec/fixtures/swarm-chat.json ---- */
const names = S.normRoster(roster);
const plan = { jobs: [S.normJob({ ...job, after: [] }), S.normJob({ ...job, id: 'b.s2', stepId: 's2', agent: 'doc', skill: 'docs', leases: ['apps/x/web/ui.tsx'], wave: 1, after: ['b.s1'] })] };
const chatState = () => S.normState({ chat: { enabled: true, agents: { doc: false } }, agents: { rio: { status: 'fired' } } }, S.normRoster({ agents: [agent, { id: 'doc', skill: 'docs', tools: ['Read'] }, { id: 'tex', skill: 'tests', tools: ['Read'] }, { id: 'kat', skill: 'kotlin-compose', tools: ['Read'] }] }));
const roomOff = () => S.normState({ chat: { enabled: false } }, names);
const postInto = (state: ReturnType<typeof chatState>, msgs: unknown[], filter?: (m: any) => any) => { const n = C.post(state, msgs as any, AT, filter); return { n, messages: state.messages }; };
const messageCases: Record<string, [unknown, string[]]> = {
  'boss-assign': [{ from: 'boss', kind: 'assign', jobId: 'b.s1', text: 'Rio, you got b.s1.' }, ['rio']],
  'agent-report': [{ from: 'rio', kind: 'report', jobId: 'b.s1', text: 'Done.' }, ['rio']],
  'brett': [{ from: 'brett', kind: 'brett', text: 'nice' }, ['rio']],
  'agent-assigns': [{ from: 'rio', kind: 'assign', jobId: 'b.s1', text: 'I got it.' }, ['rio']],
  'boss-banter': [{ from: 'boss', kind: 'banter', text: 'lol' }, ['rio']],
  'stranger': [{ from: 'ghost', kind: 'banter', text: 'boo' }, ['rio']],
  'report-without-job': [{ from: 'rio', kind: 'report', text: 'Done.' }, ['rio']],
  'empty': [{ from: '', kind: 'nope', text: '' }, []],
  'too-long': [{ from: 'brett', kind: 'brett', text: 'x'.repeat(1001) }, []],
  'junk': ['nope', []],
};
const chatComputed = {
  messages: Object.fromEntries(Object.entries(messageCases).map(([k, [m, agents]]) => [k, C.messageErrors(m, agents)])),
  lines: {
    assign: C.assignLine(plan.jobs[0], names),
    lease: C.leaseLines(plan, names),
    leaseNoOverlap: C.leaseLines(plan, names, () => false),
    reportDone: C.reportLines(S.normRun(buildRun)),
    reportBlocked: C.reportLines(S.normRun({ ...buildRun, status: 'blocked', report: { ...report, status: 'blocked', handoff: '', question: 'Which theme?' } })),
    reportKilled: C.reportLines(S.normRun({ ...buildRun, status: 'killed', reason: 'over the token budget', report: null })),
    reportFailed: C.reportLines(S.normRun({ ...buildRun, status: 'failed', reason: 'no swarm-report@1 block', report: null })),
    merge: C.mergeLines({ branch: 'swarm/b/merge', merged: ['b.s1'], conflicts: [{ job: 'b.s2', files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'], fixer: 'b.fix-s2' }], refused: [{ job: 'b.s3', outside: ['z.ts'], shared: ['_claude/THREADS.md'] }] }, { max: 'Merge Max' }),
    status: C.statusLine('rio', 'Off duty', 'day off', names),
    raise: C.payLine('raise', 'rio', { from: 5, to: 9, note: 'great work' }, names),
    dock: C.payLine('dock', 'rio', { from: 9, to: 3 }, names),
    topup: C.payLine('topup', 'rio', { usd: 5 }, names),
    bonus: C.payLine('bonus', 'rio', { jobId: 'b.s1', cost: 0.05, usd: 0.95 }, names),
    broke: C.brokeLine('rio', { spent: 4, salary: 4, topups: 0, payday: '2026-11-09T00:00:00.000Z' }),
    suspend: C.disciplineLines('suspend', 'rio', { until: '2026-11-04T00:00:00.000Z', reason: 'pushed to main' }, names),
    suspensionOver: C.disciplineLines('suspension-over', 'rio'),
    backFromLeave: C.disciplineLines('back-from-leave', 'rio'),
    rehire: C.disciplineLines('rehire', 'rio', {}, names),
    quit: C.disciplineLines('quit', 'rio', { streak: 3 }, names),
    unknownMoment: C.disciplineLines('party', 'rio'),
    hired: C.hiredLine('Site Rookie', 'Site health check'),
    newCards: C.newCardsLine('My pass'),
    newCardsDefault: C.newCardsLine(''),
    waiting: C.waitingLine('Rio React', { position: 2, used: 6, cap: 6 }),
    assignJob: C.assignJobLine('Site health check', 'Ping Paulie', 'opus', 100000, 1, 'site-check'),
    unassigned: C.unassignedLine('Cert renewals', 'nobody owns it', 'cert-renew'),
    fileLists: { none: C.fileList([]), three: C.fileList(['a', 'b', 'c']), five: C.fileList(['a', 'b', 'c', 'd', 'e']) },
    names: { boss: C.namer(names)('boss'), brett: C.namer(names)('brett'), agent: C.namer(names)('rio'), unknown: C.namer(names)('ghost'), map: C.namer({ rio: 'R' })('rio'), fn: C.namer((id: string) => id.toUpperCase())('rio') },
  },
  banter: {
    moments: C.BANTER_MOMENTS,
    lines: Object.fromEntries(C.BANTER_MOMENTS.map((m) => [m, [C.banterLine(m, 'seed-a', { other: 'Rio', file: 'ui.tsx', job: 'b.s1' }), C.banterLine(m, 'seed-b', { other: 'Rio', file: 'ui.tsx', job: 'b.s1' })]])),
    unknownMoment: C.banterLine('party', 'seed-a', { other: 'Rio' }),
    reactors: { two: C.reactors(chatState(), S.normRoster({ agents: [agent, { id: 'doc', skill: 'docs' }, { id: 'tex', skill: 'tests' }, { id: 'kat', skill: 'kotlin-compose' }] }), 'tex', 2, 'seed').map((a: { id: string }) => a.id), none: C.reactors(roomOff(), names, 'rio', 2, 'seed').map((a: { id: string }) => a.id) },
    prompt: C.banterPrompt(names, [{ from: 'boss', text: 'go' }, { from: 'rio', text: 'on it' }], 4),
    promptQuiet: C.banterPrompt(names, [], 2),
    parsed: C.parseBanter('ok [{"agent":"rio","text":"yo"},{"agent":"ghost","text":"boo"},{"agent":"doc","text":""},{"agent":"doc","text":"' + 'x'.repeat(300) + '"}]', names).map((m: { from: string; text: string }) => ({ from: m.from, len: m.text.length })),
    parsedNone: C.parseBanter('nope', names),
    parsedBad: C.parseBanter('[{"agent":', names),
  },
  post: {
    roomOn: postInto(chatState(), [{ from: 'boss', kind: 'assign', jobId: 'b.s1', text: 'x' }, { from: 'rio', kind: 'banter', text: 'fired but talking' }, { from: 'doc', kind: 'banter', text: 'switched off' }, { from: 'tex', kind: 'banter', text: 'y' }, { from: 'brett', kind: 'brett', text: 'z' }, { from: 'kat', kind: 'banter', text: '' }]),
    roomOff: postInto(roomOff(), [{ from: 'boss', kind: 'assign', jobId: 'b.s1', text: 'x' }]),
    filtered: postInto(chatState(), [{ from: 'tex', kind: 'banter', text: 'drop me' }, { from: 'tex', kind: 'banter', text: 'keep me' }], (m: { text: string }) => (m.text === 'drop me' ? null : { ...m, text: m.text.toUpperCase(), toned: true })),
  },
};
const CFX = 'framework/spec/fixtures/swarm-chat.json';
if (process.argv.includes('--write')) writeFileSync(new URL(CFX, root), `${JSON.stringify({ $axf: 'fixture@1', about: 'agent swarm group chat contract (core/engines/swarm-chat.mjs); regenerate: npx -y tsx framework/spec/check-swarm.mts --write', at: AT, ...chatComputed }, null, 1)}\n`);
const cfx = read(CFX);
for (const k of Object.keys(chatComputed) as (keyof typeof chatComputed)[]) eq(chatComputed[k], cfx[k], `chat fixture: ${k}`);
const M = cfx.messages;
for (const k of ['boss-assign', 'agent-report', 'brett']) eq(M[k], [], `message ${k}: fine`);
eq(fields(M['agent-assigns']), ['message.kind'], 'an agent cannot hand out jobs');
eq(fields(M['boss-banter']), ['message.kind'], 'Boss does not banter');
eq(fields(M['stranger']), ['message.from'], 'only Boss, Brett and roster agents speak');
eq(fields(M['report-without-job']), ['message.jobId'], 'a report names its job');
eq(fields(M['empty']), ['message.from', 'message.kind', 'message.text'], 'every missing field named');
eq(fields(M['too-long']), ['message.text'], 'text is capped');
const L = cfx.lines;
ok(/^Rio React, you got b\.s1: .* Files: apps\/x\/web\/ui\.tsx\. Model Opus, budget 200k tokens \/ 20 turns\.$/.test(L.assign.text) && L.assign.jobId === 'b.s1', 'assign line: name, task, files, model word, budget');
ok(L.lease.length === 1 && /^doc waits on Rio React \(b\.s1\): both want apps\/x\/web\/ui\.tsx\. Wave 2\.$/.test(L.lease[0].text), 'lease line: who waits on whom, over what, which wave');
ok(/same agent or no files named/.test(L.leaseNoOverlap[0].text), 'lease line without a shared file says so');
eq(L.reportDone.map((l: { kind: string }) => l.kind), ['report', 'handoff'], 'a done run with a handoff posts two lines');
ok(/^Done with b\.s1\. card added$/.test(L.reportDone[0].text) && L.reportDone[1].text === 'Handoff: props renamed', 'report + handoff text');
ok(/Blocked on b\.s1\. card added Q for Brett: Which theme\?/.test(L.reportBlocked[0].text) && L.reportBlocked.length === 1, 'a blocked run carries the question');
ok(/^Got killed on b\.s1: over the token budget\.$/.test(L.reportKilled[0].text) && /^Failed b\.s1: no swarm-report@1 block\.$/.test(L.reportFailed[0].text), 'killed and failed heads');
eq(L.merge.map((l: { kind: string }) => l.kind), ['merge', 'handoff', 'lease'], 'merge lines: merged, a fixer handoff, a refusal');
ok(/^Merge Max, b\.s2 clashed on a\.ts, b\.ts, c\.ts \+1\. Clean it up \(b\.fix-s2\)\.$/.test(L.merge[1].text) && L.merge[1].jobId === 'b.fix-s2', 'the fixer is named with the clash');
ok(/outside its lease \(z\.ts, _claude\/THREADS\.md\)/.test(L.merge[2].text), 'a refusal names what left the lease');
eq(L.status.text, 'Rio React is now Off duty: day off.', 'status line');
eq([L.raise.text, L.dock.text, L.topup.text, L.bonus.text], ['Rio React gets a raise: $5.00 → $9.00 a week. great work', 'Rio React got docked: $9.00 → $3.00 a week.', 'Brett topped Rio React up by $5.00 this week.', 'Rio React finished b.s1 for $0.05, $0.95 under budget. Bonus.'], 'pay lines');
ok(/^I'm broke\. Spent \$4\.00 of \$4\.00 this week, so no more jobs till payday \(2026-11-09\)/.test(L.broke.text) && L.broke.from === 'rio', 'broke line is the agent\'s own');
eq(L.suspend[0].text, 'Rio React is suspended until 2026-11-04 00:00 UTC. Reason: pushed to main.', 'suspend line');
eq([L.suspensionOver[0].text, L.backFromLeave[0].text, L.rehire[0].text], ["rio's suspension is over. Back on duty.", 'rio is back from medical leave and on duty.', "Rio React is rehired and back on duty. Don't make me regret it."], 'discipline lines');
eq(L.quit.map((l: { from: string; kind: string }) => [l.from, l.kind]), [['rio', 'discipline'], ['boss', 'discipline']], 'a rage-quit is the agent\'s line then Boss\'s');
eq(L.unknownMoment, [], 'an unknown discipline moment posts nothing');
eq([L.hired.text, L.newCards.text, L.newCardsDefault.text], ['Hired Site Rookie to own Site health check. Welcome to the crew.', 'New ID cards for everybody (My pass). Smile, assholes.', 'New ID cards for everybody. Smile, assholes.'], 'hire + cards lines');
eq(L.waiting.text, 'Rio React is waiting for a desk (position 2 in the queue, 6/6 running).', 'agent cap line');
eq([L.assignJob.text, L.assignJob.jobId, L.unassigned.text], ["Ping Paulie, you're on Site health check. opus, up to 100k tokens ($1.00).", 'site-check', 'Cert renewals has nobody: nobody owns it.'], 'agent job lines');
eq(L.fileLists, { none: 'no files named', three: 'a, b, c', five: 'a, b, c +2' }, 'file lists');
eq(L.names, { boss: 'Boss', brett: 'Brett', agent: 'Rio React', unknown: 'ghost', map: 'R', fn: 'RIO' }, 'names from a roster, a map or a function; Boss and Brett always known');
for (const l of [L.assign, ...L.lease, ...L.reportDone, ...L.merge, L.status, L.raise, L.topup, L.bonus, L.broke, ...L.suspend, ...L.quit, L.hired, L.newCards, L.waiting, L.assignJob, L.unassigned]) eq(C.messageErrors(l, ['rio', 'doc', 'max']), [], `every built line passes the message contract: ${l.kind} "${l.text.slice(0, 30)}"`);
const B = cfx.banter;
eq(B.moments, ['idle', 'gradle', 'fight', 'done', 'failed', 'raise', 'bonus', 'docked'], 'the eight banter moments');
for (const m of B.moments) { ok(!/\{\w+\}/.test(B.lines[m][0]) && !/\{\w+\}/.test(B.lines[m][1]), `${m}: placeholders filled`); eq(B.lines[m][0], C.banterLine(m, 'seed-a', { other: 'Rio', file: 'ui.tsx', job: 'b.s1' }), `${m}: deterministic from the seed`); }
ok(C.BANTER.idle.includes(B.unknownMoment), 'an unknown moment reads as idle');
ok(!/\b(race|religio|gay|straight|woman|women|black|white|asian|muslim|jew|christian)\w*/i.test(Object.values(C.BANTER).flat().join(' ')), 'the bank never jokes about identity');
eq(B.reactors.two, ['kat'], 'reactors skip the subject (tex), the fired (rio) and the switched-off (doc): only kat is left, even when two were asked for');
eq(B.reactors.none, [], 'room off = nobody reacts');
ok(/^Write 4 short group-chat lines/.test(B.prompt) && /Never joke about race/.test(B.prompt) && /rio \(Rio React, Front-end engineer\)/.test(B.prompt) && /Recent:\nboss: go\nrio: on it/.test(B.prompt) && /under 140 characters/.test(B.prompt), 'the batch prompt');
ok(/\(quiet day\)/.test(B.promptQuiet), 'a quiet room says so');
eq(B.parsed, [{ from: 'rio', len: 2 }, { from: 'doc', len: 200 }], 'parsing keeps real agents with text, caps the text, drops empties and strangers');
eq([B.parsedNone, B.parsedBad], [[], []], 'no JSON list or broken JSON = nothing');
const P = cfx.post;
eq(P.roomOn.n, 4, 'room on: Boss, a working agent and Brett post; a fired agent still posts (a status is not a switch); the switched-off agent and the empty line do not');
eq(P.roomOn.messages.map((m: { from: string }) => m.from), ['boss', 'rio', 'tex', 'brett'], 'posted in order');
ok(P.roomOn.messages.every((m: { id: string; at: string }) => /^m\d+-\d+$/.test(m.id) && m.at === AT), 'ids and times are deterministic');
eq(P.roomOff, { n: 0, messages: [] }, 'room off: nothing kept');
eq(P.filtered.messages.map((m: { text: string; toned: boolean }) => [m.text, m.toned]), [['KEEP ME', true]], 'the filter hook tones or drops');

/* ---- the vibe engine (swarm-vibe.mjs): computed here, replayed from spec/fixtures/swarm-vibe.json ---- */
const CS = (o: Record<string, unknown> = {}) => S.normChatSettings(o);
const wild = { from: 'rio', kind: 'banter', text: 'Oh sure, TEX gets a raise. For WHAT? I fixed three damn conflicts, rich ass!!' };
const vibeComputed = {
  scores: {
    work: V.scoreVibe('Rio React, you got b.s1: React card. Files: ui.tsx. Model Opus, budget 200k tokens / 20 turns.', 'assign'),
    brett: V.scoreVibe('nice', 'brett'), plain: V.scoreVibe('Gradle\'s running. Cracking a beer, wake me up in twenty.'), wild: V.scoreVibe(wild.text),
    shout: V.scoreVibe('READ THE JSON API DOCS'), bangs: V.scoreVibe('go!!!!!!!!'), slang: V.scoreVibe('yo bro, y\'all gonna ship?'), max: V.scoreVibe(`${'fuck '.repeat(20)}`), empty: V.scoreVibe(''),
  },
  clean: { c0: V.cleanCussing('Damn, that shit is fucking broken, hell.', 0), c50: V.cleanCussing('Damn, that shit is fucking broken, hell.', 50), c100: V.cleanCussing('Damn, that shit is fucking broken, hell.', 100), caps: V.cleanCussing('SHIT. Shitty day. Bitches.', 0) },
  calm: { shout: V.calmDown('That is DONE!!! Oh sure, who knew. Keep the CSS and JSON.'), plain: V.calmDown('fine.') },
  filter: {
    rails: V.vibeFilter(wild, CS(PRESETS_.rails)), business: V.vibeFilter(wild, CS(PRESETS_.business)), mid: V.vibeFilter(wild, CS({ ...PRESETS_.breakroom, vibe: 120 })),
    workToned: V.vibeFilter({ from: 'py', kind: 'discipline', text: 'That\'s 3 in a row. I\'m DONE with this shit. I quit.' }, CS(PRESETS_.business)),
    workKept: V.vibeFilter({ from: 'boss', kind: 'assign', jobId: 'b.s1', text: 'Rio, you got b.s1.' }, CS({ vibe: 1 })),
    brett: V.vibeFilter({ from: 'brett', kind: 'brett', text: 'FUCK yeah!!' }, CS(PRESETS_.business)),
    identity: V.vibeFilter({ from: 'rio', kind: 'banter', text: 'a joke about religion' }, CS(PRESETS_.rails)),
    dramaLow: V.vibeFilter({ from: 'rio', kind: 'banter', text: 'Tex, get your hands off ui.tsx.' }, CS({ ...PRESETS_.rails, drama: 10 })),
    dramaHigh: V.vibeFilter({ from: 'rio', kind: 'banter', text: 'Tex, get your hands off ui.tsx.' }, CS(PRESETS_.rails)),
    overrideRio: V.vibeFilter({ from: 'rio', kind: 'banter', text: 'Damn, nice one.' }, CS({ ...PRESETS_.rails, overrides: { doc: { vibe: 1, cussing: 0 } } })),
    overrideDoc: V.vibeFilter({ from: 'doc', kind: 'banter', text: 'Damn, nice one.' }, CS({ ...PRESETS_.rails, overrides: { doc: { vibe: 1, cussing: 0 } } })),
  },
  reactions: { business: V.reactionsFor(CS(PRESETS_.business)), crew: V.reactionsFor(CS(PRESETS_.crew)), breakroom: V.reactionsFor(CS(PRESETS_.breakroom)), rails: V.reactionsFor(CS(PRESETS_.rails)) },
  banter: (() => {
    const st = S.normState({ chatSettings: { ...PRESETS_.breakroom, banterBudget: 0.1 } }, names);
    const before = V.banterAllowed(st, AT); st.banterSpend.push({ at: AT, usd: 0.2 });
    return { before, spent: V.banterAllowed(st, AT), count: V.reactCount(st, AT), tomorrow: V.banterAllowed(st, '2026-11-04T01:00:00.000Z'), quietCrew: V.banterAllowed(S.normState({ chatSettings: PRESETS_.crew }, names), AT), off: V.banterAllowed(S.normState({ chat: { enabled: false }, chatSettings: PRESETS_.rails }, names), AT), noSettings: V.reactCount({ banterSpend: [] }, AT) };
  })(),
  preview: { rails: V.previewLine(CS(PRESETS_.rails)), crew: V.previewLine(CS(PRESETS_.crew)), cleanRoom: V.previewLine(CS({ ...PRESETS_.breakroom, cussing: 0 })), dropped: V.previewLine(CS({ ...PRESETS_.rails, vibe: 1 })) },
  shade: { low: V.vibeShade(10, 500), mid: V.vibeShade(250, 500), top: V.vibeShade(500, 500), over: V.vibeShade(600, 500), one: V.vibeShade(1, 500), none: V.vibeShade(null, 500) },
};
const VFX = 'framework/spec/fixtures/swarm-vibe.json';
if (process.argv.includes('--write')) writeFileSync(new URL(VFX, root), `${JSON.stringify({ $axf: 'fixture@1', about: 'agent swarm vibe engine (core/engines/swarm-vibe.mjs); regenerate: npx -y tsx framework/spec/check-swarm.mts --write', at: AT, wild: wild.text, ...vibeComputed }, null, 1)}\n`);
const vfx = read(VFX);
for (const k of Object.keys(vibeComputed) as (keyof typeof vibeComputed)[]) eq(vibeComputed[k], vfx[k], `vibe fixture: ${k}`);
const SC = vfx.scores;
ok(SC.work <= 20 && SC.brett >= 40 && SC.plain < 100 && SC.wild > 250 && SC.max === 500 && SC.empty === 40, 'scores: work low, Brett and banter from 40, chill under 100, wild over 250, capped at 500');
ok(SC.shout > SC.plain && SC.bangs > 40 && SC.slang > 40, 'shouting, exclamation piles and slang raise the score');
eq(vfx.clean, { c0: 'Darn, that stuff is freaking broken, heck.', c50: 'Damn, that stuff is freaking broken, hell.', c100: 'Damn, that shit is fucking broken, hell.', caps: 'Stuff. Crappy day. Complain.' }, 'cussing slider: clean, mild, filthy; case kept');
eq(vfx.calm, { shout: 'That is done. Keep the CSS and JSON.', plain: 'fine.' }, 'calm: no shouting, no bang piles, sarcastic sentences go whole, acronyms stay');
const F = vfx.filter;
eq(F.rails.text, wild.text, 'off the rails: untouched');
eq(F.business, null, 'all business: wild banter dropped');
ok(F.mid === null || F.mid.vibe <= 120, 'a ceiling of 120 holds');
ok(F.workToned && !/shit|DONE/.test(F.workToned.text) && F.workToned.toned === true, 'a work line is toned down, never dropped');
ok(F.workKept && F.workKept.vibe === 1 && F.workKept.toned === false, 'a plain work line under a ceiling of 1 passes as is');
ok(F.brett && F.brett.text === 'FUCK yeah!!' && F.brett.toned === false && F.brett.vibe > 40, 'Brett is scored, never changed');
eq([F.identity, F.dramaLow], [null, null], 'identity jokes always dropped; fights need the drama slider');
ok(F.dramaHigh && F.dramaHigh.text === 'Tex, get your hands off ui.tsx.', 'with drama up the fight stays');
ok(F.overrideRio.text === 'Damn, nice one.' && F.overrideDoc?.text !== 'Damn, nice one.', 'per-agent overrides beat the room');
eq(vfx.reactions, { business: 0, crew: 1, breakroom: 2, rails: 2 }, 'reactions by chattiness');
const BA = vfx.banter;
ok(BA.before.ok === true && BA.spent.ok === false && /quiet till tomorrow/.test(BA.spent.why) && BA.count === 0 && BA.tomorrow.ok === true, 'the daily banter budget: fine, spent (quiet), new day');
ok(/chattiness/.test(BA.quietCrew.why) && /chat is off/.test(BA.off.why) && BA.noSettings === 1, 'why paid banter is refused; no settings = one reaction');
ok(vfx.preview.rails.text !== vfx.preview.crew.text && !/shit|hell/.test(vfx.preview.cleanRoom.text) && vfx.preview.dropped.dropped === true, 'preview follows the sliders and says when it is dropped');
eq(vfx.shade, { low: 0.08, mid: 0.5, top: 1, over: 1, one: 0.08, none: 0 }, 'colour by vibe: faintest tint 0.08, darkest at the ceiling, none without a score');

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
