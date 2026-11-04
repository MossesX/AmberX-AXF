/** Self-test of web/core.ts: npx -y tsx apps/console-web/plugins/crew-live/web/core-check.mts (prints JSON last). */
import { directoryOf, elapsed, filterRuns, highlight, isSnapshot, sortRuns, stepLine, tokensText, usd, type Run, type Snapshot } from './core';

const out: [string, boolean][] = [];
const check = (name: string, ok: boolean) => out.push([name, ok]);

const t0 = Date.parse('2026-11-03T18:00:00Z');
const run = (over: Partial<Run>): Run => ({
  id: 'axf-a', session: 'axf-a', name: 'a', cwd: '/x', model: 'claude-opus-5-5', modelKey: 'opus', startedAt: '2026-11-03T18:00:00Z', lastEventAt: '2026-11-03T18:05:00Z',
  costUsd: 1.25, costExact: false, tokens: { input: 1 }, tokensTotal: 1500, turns: 3, toolRunning: true, ended: false, result: null, tools: [], lastText: '',
  build: { id: 'crew-live', title: 'Crew', status: 'running', branch: 'b', pr: '', prUrl: '', steps: [{ id: 's1', text: 'one', model: 'Opus', state: 'done', doneAt: '' }, { id: 's2', text: 'Crew routes', model: 'Opus', state: 'now', doneAt: '' }, { id: 's3', text: 'three', model: 'Opus', state: 'next', doneAt: '' }], done: 1, total: 3, now: { id: 's2', text: 'Crew routes', model: 'Opus', state: 'now', doneAt: '' }, stepStartedAt: null, waitingApproval: false },
  sessionId: 's', status: 'working', now: 'Editing ui.tsx',
  agent: { id: 'paulie', name: 'Ping Paulie', role: 'Site checker', avatar: { face: 'tall', hair: 1, gear: 'cap', hue: 100 }, initials: 'PP', known: true },
  ...over,
});

check('timer seconds', elapsed('2026-11-03T18:00:00Z', t0 + 4000) === '4s');
check('timer minutes', elapsed('2026-11-03T18:00:00Z', t0 + 12 * 60_000 + 3000) === '12m 03s');
check('timer hours', elapsed('2026-11-03T18:00:00Z', t0 + 2 * 3600_000 + 5 * 60_000) === '2h 05m');
check('timer without a start', elapsed(null, t0) === '—');
check('usd small / mid / big', usd(0.0421) === '$0.042' && usd(3.456) === '$3.46' && usd(150.2) === '$150');
check('tokens k / M', tokensText(15_400) === '15k' && tokensText(5_137_901) === '5.1M' && tokensText(12) === '12');
check('step line: "s2 of 3: …"', stepLine(run({}).build) === 's2 of 3: Crew routes');
check('step line: no build', stepLine(null) === 'No build on record');
const all = [run({}), run({ id: 'axf-b', name: 'b', status: 'idle', costUsd: 9, agent: { id: 'earl', name: 'Earl the Ear', role: '', avatar: null, initials: 'EE', known: true } }), run({ id: 'axf-c', name: 'c', status: 'stuck', costUsd: 0.5 })];
check('filter by status', filterRuns(all, '', 'idle').map((r) => r.id).join() === 'axf-b');
check('search by agent, build and doing', filterRuns(all, 'earl', '').length === 1 && filterRuns(all, 'crew routes', '').length === 3 && filterRuns(all, 'ui.tsx', '').length === 3);
check('sort by cost, both ways', sortRuns(all, 'cost', -1)[0]!.id === 'axf-b' && sortRuns(all, 'cost', 1)[0]!.id === 'axf-c');
check('sort by status: working first', sortRuns(all, 'status', 1).map((r) => r.status).join() === 'working,stuck,idle');
const snap: Snapshot = { $axf: 'crew@1', now: '', buildAgents: { 'auto-land': 'earl' }, runs: all, offTheClock: [{ id: 'kat', name: 'Kotlin Kat', role: '', avatar: null, initials: 'KK', known: true }], totals: { working: 2, runs: 3, costRunningUsd: 1, costTodayUsd: 2 } };
check('snapshot shape guard', isSnapshot(snap) && !isSnapshot({ runs: [] }) && !isSnapshot(null));
check('agent directory from the snapshot: known agents once each', directoryOf(snap).map((a) => a.id).sort().join() === 'earl,kat,paulie');
check('every build naming an agent becomes an alias', directoryOf(snap).find((a) => a.id === 'earl')!.aliases.includes('auto-land'));
check('runs and builds become aliases of their agent', directoryOf(snap).find((a) => a.id === 'paulie')!.aliases.includes('crew-live') && directoryOf(snap).find((a) => a.id === 'paulie')!.aliases.includes('axf-a'));
const h = highlight("const x = 'hi'; // note");
check('highlight: keyword, string, comment', h.some((t) => t.k === 'kw' && t.v === 'const') && h.some((t) => t.k === 'str' && t.v === "'hi'") && h.some((t) => t.k === 'com' && t.v === '// note'));
check('highlight keeps the text', highlight("def a(): return 42  # x").map((t) => t.v).join('') === 'def a(): return 42  # x');
check('highlight: numbers', highlight('n = 42').some((t) => t.k === 'num' && t.v === '42'));
check('highlight: css colour hash is not a comment', !highlight('color: #fff;').some((t) => t.k === 'com'));

const failed = out.filter(([, ok]) => !ok).map(([n]) => n);
for (const [n, ok] of out) console.log(`${ok ? '✓' : '✗'} ${n}`);
console.log(JSON.stringify({ total: out.length, failed }));
(globalThis as { process?: { exit(c: number): void } }).process?.exit(failed.length ? 1 : 0);
