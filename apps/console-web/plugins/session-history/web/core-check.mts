/** Self-test of web/core.ts: npx -y tsx apps/console-web/plugins/session-history/web/core-check.mts (prints JSON last). */
import { facets, family, totals, fmtDuration, fmtTokens, fmtUsd, fmtWhen, matches, nextSort, statusTone, view } from './core';
import type { Run } from './core';

const out: [string, boolean][] = [];
const check = (name: string, ok: boolean) => out.push([name, ok]);

const base: Run = {
  id: 'a', kind: 'session', title: 'Fix the banner', agent: '', build: '', job: '', model: 'claude-opus-5-5', status: 'ended', tokens: {}, tokensTotal: 100,
  usd: 0.5, costFrom: 'usage', models: {}, durationMs: 60_000, startedAt: '2026-10-30T10:00:00Z', lastAt: null, turns: 1, tools: 0, prompts: 1,
  cwd: '/x', branch: 'claude/banner', edits: [], files: {},
};
const runs: Run[] = [
  base,
  { ...base, id: 'b', kind: 'agent', title: 'Write docs', agent: 'docs-writer', build: 'session-history', job: 's7', model: 'claude-haiku-5-5', status: 'running', tokensTotal: 5000, usd: 0.02, startedAt: '2026-10-31T04:00:00Z' },
  { ...base, id: 'c', kind: 'headless', title: 'Kernel', model: 'claude-fable-5-1', status: 'killed-budget', tokensTotal: 2_000_000, usd: 9.5, startedAt: null },
];

check('family', family('claude-opus-5-5') === 'opus' && family('claude-fable-5-1') === 'fable' && family('x') === '');
check('newest first, undated last', view(runs).map((r) => r.id).join() === 'b,a,c');
check('oldest first keeps undated last', view(runs, {}, { key: 'started', dir: 1 }).map((r) => r.id).join() === 'a,b,c');
check('sort by cost, big first', view(runs, {}, { key: 'usd', dir: -1 }).map((r) => r.id).join() === 'c,a,b');
check('sort by tokens, small first', view(runs, {}, { key: 'tokens', dir: 1 })[0]?.id === 'a');
check('sort by agent A→Z', view(runs, {}, { key: 'agent', dir: 1 }).map((r) => r.id).join() === 'b,a,c');
check('kind filter', view(runs, { kind: 'agent' }).map((r) => r.id).join() === 'b');
check('status filter', view(runs, { status: 'killed-budget' }).map((r) => r.id).join() === 'c');
check('model filter', view(runs, { model: 'haiku' }).map((r) => r.id).join() === 'b');
check('search every word, any field', view(runs, { q: 'DOCS s7' }).map((r) => r.id).join() === 'b' && matches(runs[0]!, { q: 'claude/banner' }));
check('search by status label', view(runs, { q: 'for budget' }).map((r) => r.id).join() === 'c');
check('bad rows skipped', view([null as never, { ...base, id: '' }]).length === 0);
check('nextSort flips same column', JSON.stringify(nextSort({ key: 'usd', dir: -1 }, 'usd')) === '{"key":"usd","dir":1}');
check('nextSort new text column starts A→Z, numbers big first', nextSort({ key: 'usd', dir: -1 }, 'title').dir === 1 && nextSort({ key: 'title', dir: 1 }, 'tokens').dir === -1);
check('tones', statusTone('done') === 'success' && statusTone('running') === 'accent' && statusTone('failed') === 'danger' && statusTone('killed-budget') === 'warning' && statusTone('ended') === undefined);
check('tokens', fmtTokens(999) === '999' && fmtTokens(1234) === '1.2k' && fmtTokens(45_000) === '45k' && fmtTokens(2_100_000) === '2.1M' && fmtTokens(undefined) === '0');
check('usd', fmtUsd(1.234) === '$1.23' && fmtUsd(0.5) === '$0.500' && fmtUsd(0.004) === '$0.0040' && fmtUsd(null) === '—' && fmtUsd(0.2, true) === '$0.200 est.');
check('duration', fmtDuration(5000) === '5s' && fmtDuration(95_000) === '1m 35s' && fmtDuration(7_500_000) === '2h 5m' && fmtDuration(null) === '—');
check('when', fmtWhen('2026-10-31T04:50:00Z', true, 2026) === 'Oct 31, 04:50' && fmtWhen('2025-01-02T03:04:00Z', true, 2026) === 'Jan 2 2025, 03:04' && fmtWhen(null) === '—');
check('facets', JSON.stringify(facets(runs)) === JSON.stringify({ statuses: ['ended', 'killed-budget', 'running'], models: ['fable', 'haiku', 'opus'] }));

const mixed: Run[] = [
  { ...base, id: 'm', usd: 10, costFrom: 'result', tokensTotal: 300, turns: 3, models: { opus: { model: 'claude-opus-5-5', turns: 2, tokens: { input: 100, output: 100 }, usd: 3 }, haiku: { model: 'claude-haiku-5-5', turns: 1, tokens: { input: 100 }, usd: 1 } } },
  { ...base, id: 'n', usd: null, costFrom: null, model: 'claude-sonnet-5-5', tokensTotal: 50, turns: 1, models: {} },
  { ...base, id: 'o', usd: 2, model: 'claude-opus-5-5', status: 'running', tokensTotal: 10, turns: 1, models: { opus: { model: 'claude-opus-5-5', turns: 1, tokens: { output: 10 }, usd: 2 } } },
];
const tt = totals(mixed);
check('totals: runs, tokens, usd, unpriced, running', tt.runs === 3 && tt.tokens === 360 && tt.usd === 12 && tt.unpriced === 1 && tt.running === 1);
const om = tt.byModel.find((m) => m.model === 'opus'), hm = tt.byModel.find((m) => m.model === 'haiku'), sm = tt.byModel.find((m) => m.model === 'sonnet');
check('per-model split scaled to the exact total', om?.usd === 9.5 && hm?.usd === 2.5 && om.runs === 2 && om.turns === 3 && om.tokens === 210);
check('run without per-model usage counts under its model', sm?.runs === 1 && sm.usd === 0 && sm.tokens === 50);
check('models by cost, dearest first', tt.byModel[0]?.model === 'opus');
check('per-model sums to the total', Math.abs(tt.byModel.reduce((s, m) => s + m.usd, 0) - tt.usd) < 1e-9);

for (const [n, ok] of out) console.log(`  ${ok ? '✓' : '✗'} ${n}`);
console.log(JSON.stringify({ total: out.length, failed: out.filter(([, ok]) => !ok).map(([n]) => n) }));
