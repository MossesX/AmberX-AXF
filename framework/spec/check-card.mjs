#!/usr/bin/env node
/**
 * card@1 + home-layout@1 check (core/engines/card-rules.mjs): binding (path, where, reduce), view picking from the
 * data's shape, view models, live refresh, suggestions from the plugin-commands@1 registry, drops onto Home, the Home
 * layout ops, both validators agreeing, and the zero-token rule (no language model anywhere in the card engine or the
 * code that draws cards). Golden outputs: spec/fixtures/card.json (`--write` regenerates it after an engine change).
 *
 *   node framework/spec/check-card.mjs [--write]
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../core/engines/card-rules.mjs';
import { validateAsset } from '../cli/build-engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(ROOT, 'framework/spec/fixtures/card.json');
let n = 0;
const fails = [];
const t = (name, fn) => { n++; try { fn(); } catch (e) { fails.push(`${name}: ${e.message}`); } };

/* ------------------------------------------------------------------ cases (inputs; outputs go in the fixture) */

const progress = { ok: true, profile: 'current', progress: { builds: 2, complete: 1, total: 8, done: 5, pct: 63, active: false }, active: [{ id: 'a' }, { id: 'b' }] };
const items = { items: [{ name: 'Home', app: 'console-web', status: 'waiting', createdAt: '2026-11-03T10:00:00Z' }, { name: 'Menu', app: 'axhub-web', status: 'approved', createdAt: '2026-11-02T10:00:00Z' }, { name: 'Bell', app: 'console-web', status: 'waiting', createdAt: '2026-11-03T12:00:00Z' }] };
const spend = { state: { spend: { kat: { today: { usd: 1.25 } }, rio: { today: { usd: 0.5 } }, max: { today: { usd: 2 } } } } };
const series = [{ at: '2026-11-01', runs: 3 }, { at: '2026-11-02', runs: 5 }, { at: '2026-11-03', runs: 4 }];

const MODEL_CASES = [
  ['count of a list', { source: { kind: 'command', plugin: 'builds-page', command: 'progress' }, path: 'active', reduce: 'count', view: 'number' }, progress],
  ['auto: single number', { source: { kind: 'command', plugin: 'x', command: 'y' }, path: 'progress.pct' }, progress],
  ['auto: record of numbers → table (has a boolean)', { source: { kind: 'command', plugin: 'x', command: 'y' }, path: 'progress' }, progress],
  ['meter from one record', { source: { kind: 'command', plugin: 'x', command: 'y' }, path: 'progress', view: 'meter', fields: { value: 'done', max: 'total', label: 'Steps done' } }, progress],
  ['where + list', { source: { kind: 'command', plugin: 'ui-review', command: 'items' }, path: 'items', where: { status: 'waiting' }, view: 'list', fields: { title: 'name', subtitle: 'app', badge: 'status' } }, items],
  ['auto: rows with a time → feed, newest first', { source: { kind: 'command', plugin: 'x', command: 'y' }, path: 'items' }, items],
  ['wildcard path + sum', { source: { kind: 'command', plugin: 'agent-swarm', command: 'state' }, path: 'state.spend.*.today.usd', reduce: 'sum', view: 'number', unit: 'USD' }, spend],
  ['auto: time series → chart', { source: { kind: 'command', plugin: 'x', command: 'y' } }, series],
  ['bar chart', { source: { kind: 'command', plugin: 'x', command: 'y' }, view: 'chart', chart: 'bar' }, series],
  ['auto: status word', { source: { kind: 'command', plugin: 'x', command: 'y' }, path: 'state' }, { state: 'failed' }],
  ['auto: status object', { source: { kind: 'command', plugin: 'x', command: 'y' } }, { status: 'ok', message: 'All green' }],
  ['table of a record', { source: { kind: 'console', id: 'console.project' }, view: 'table' }, { 'Open project': 'apps/demo', Libraries: 12 }],
  ['missing path', { source: { kind: 'command', plugin: 'x', command: 'y' }, path: 'nope.here' }, progress],
  ['empty list', { source: { kind: 'command', plugin: 'x', command: 'y' }, path: 'active' }, { active: [] }],
  ['coverage meter (starter)', { source: { kind: 'console', id: 'tracker.coverage' }, view: 'meter', fields: { label: 'label', value: 'built', max: 'total' } }, [{ label: 'Kernel', built: 3, total: 10 }, { label: 'Console', built: 9, total: 9 }]],
];

const REGISTRY = { plugins: [
  { folder: 'builds-page', app: 'console-web', name: 'Builds', enabled: true, commands: [{ id: 'progress', kind: 'read', title: 'Progress' }, { id: 'ops', kind: 'command', title: 'Ops' }, { id: 'info', kind: 'read', title: 'Plugin info' }] },
  { folder: 'ui-review', app: 'console-web', name: 'UI Review', enabled: true, commands: [{ id: 'items', kind: 'read', title: 'Items' }, { id: 'data-file', kind: 'read', title: 'File' }] },
  { folder: 'agent-swarm', app: 'console-web', name: 'Agent swarm', enabled: true, commands: [{ id: 'state', kind: 'read', title: 'State' }] },
  { folder: 'notes-browser', app: 'console-web', name: 'Notes', enabled: false, commands: [{ id: 'notes', kind: 'read', title: 'Notes' }] },
  { folder: 'voicevault', app: 'voicevault', name: 'Voice Vault', commands: [{ id: 'list', kind: 'read', title: 'List' }] },
] };

const STARTERS = [{ id: 'coverage', data: { title: 'Coverage', source: { kind: 'console', id: 'tracker.coverage' }, view: 'meter' } }, { id: 'project', data: { title: 'Project', source: { kind: 'console', id: 'console.project' }, view: 'table' } }];

function produce() {
  const models = Object.fromEntries(MODEL_CASES.map(([name, card, result]) => [name, C.cardModel(card, result)]));
  const shapes = Object.fromEntries([['n', 3], ['s', 'running'], ['t', 'hello'], ['series', [1, 2, 3]], ['rows', [{ a: 1, b: 'x' }]], ['rec', { a: 1, b: 2 }], ['empty', []], ['obj', { status: 'ok' }]].map(([k, v]) => [k, { shape: C.shapeOf(v), view: C.pickView(v) }]));
  const sources = C.cardSources(REGISTRY);
  const suggestions = C.suggestCards(REGISTRY).map((s) => ({ id: s.id, source: s.card.source, view: s.card.view, refresh: s.card.refresh.kind }));
  let L = C.normalizeLayout(null, STARTERS);
  const steps = [];
  const step = (op) => { L = C.applyLayout(L, op, STARTERS); steps.push({ op: op.op, order: L.order, hidden: L.hidden, sizes: L.sizes }); };
  step({ op: 'add', id: 'running', card: { title: 'Builds running', source: { kind: 'command', plugin: 'builds-page', command: 'progress' }, path: 'active', reduce: 'count' } });
  step({ op: 'move', id: 'running', to: 0 });
  step({ op: 'size', id: 'running', size: 'wide' });
  step({ op: 'hide', id: 'project' });
  step({ op: 'hideAll' });
  step({ op: 'showAll' });
  step({ op: 'remove', id: 'coverage' });
  step({ op: 'remove', id: 'running' });
  return { models, shapes, sources, suggestions, layout: steps };
}

/* ------------------------------------------------------------------ behaviour */

t('validators agree (core rules = build engine)', () => {
  const good = { $axf: 'asset@1', type: 'card', id: 'probe', name: 'Probe', version: '1.0.0', data: { source: { kind: 'command', plugin: 'builds-page', command: 'progress' }, view: 'auto', refresh: { kind: 'every', every: 30 } } };
  assert.deepEqual(C.cardErrors('card', good.data), []);
  assert.equal(validateAsset(good).ok, true, JSON.stringify(validateAsset(good).errors));
  const bad = { ...good, data: { source: { kind: 'nope' }, view: 'pie', refresh: { kind: 'every', every: 1 }, size: 'huge' } };
  const errs = C.cardErrors('card', bad.data);
  assert.ok(errs.length >= 4, errs.join('; '));
  assert.equal(validateAsset(bad).ok, false);
  assert.deepEqual(C.cardErrors('job-type', bad.data), []);
});
t('open view registry: a host view validates; built-ins never change', () => {
  C.registerCardView({ id: 'heatmap', label: 'Heat map' });
  assert.deepEqual(C.cardErrors('card', { source: { kind: 'console', id: 'a.b' }, view: 'heatmap' }), []);
  assert.equal(C.registerCardView({ id: 'number', label: 'Mine' }).label, 'Number');
  assert.throws(() => C.registerCardView({ id: 'Bad View' }));
});
t('live refresh: channels and hits', () => {
  const live = { source: { kind: 'command', plugin: 'ui-review', command: 'items' }, refresh: { kind: 'live', channels: ['review'] } };
  assert.deepEqual(C.liveChannels(live), ['ui-review', 'review']);
  assert.equal(C.liveHit(live, 'ui-review'), true);
  assert.equal(C.liveHit(live, 'api:review'), true);
  assert.equal(C.liveHit(live, 'builds'), false);
  assert.equal(C.refreshMs(live), 0);
  assert.equal(C.refreshMs({ ...live, refresh: { kind: 'every', every: 15 } }), 15000);
  assert.deepEqual(C.liveChannels({ ...live, refresh: { kind: 'manual' } }), []);
  assert.ok(C.LIVE_FALLBACK_MS >= 60000);
});
t('every starter asset in the console is a valid card', () => {
  const dir = join(ROOT, 'apps/console-web/src/assets/card');
  for (const f of ['plan-summary', 'build-summary', 'coverage', 'project', 'recent-installs']) {
    const a = JSON.parse(readFileSync(join(dir, `${f}.json`), 'utf8'));
    assert.equal(a.type, 'card');
    assert.deepEqual(C.cardErrors('card', a.data), [], f);
  }
});
t('drops: a read ref, a control path, a draft, a grid row hook; junk is refused', () => {
  assert.equal(C.cardFromDrop({ plugin: 'ui-review', command: 'items' }).source.plugin, 'ui-review');
  assert.equal(C.cardFromDrop('plugins.reads builds-page/progress').source.command, 'progress');
  assert.equal(C.cardFromDrop(JSON.stringify({ source: { kind: 'console', id: 'tracker.coverage' }, view: 'meter' })).view, 'meter');
  assert.equal(C.cardFromDrop({ kind: 'pending', id: 'p1' }).source.id, 'row.pending');
  assert.equal(C.cardFromDrop('hello there'), null);
  assert.equal(C.cardFromDrop({ source: { kind: 'bad' } }), null);
});
t('layout: starters stay (hidden, not removed); a bad card is refused; suggestions already on Home are left out', () => {
  let L = C.applyLayout(null, { op: 'remove', id: 'coverage' }, STARTERS);
  assert.deepEqual(L.hidden, ['coverage']);
  assert.ok(L.order.includes('coverage'));
  assert.throws(() => C.applyLayout(L, { op: 'add', card: { source: { kind: 'nope' } } }, STARTERS));
  assert.throws(() => C.applyLayout(L, { op: 'update', id: 'coverage', card: {} }, STARTERS));
  const first = C.suggestCards(REGISTRY)[0];
  L = C.applyLayout(L, { op: 'add', card: first.card }, STARTERS);
  assert.ok(!C.suggestCards(REGISTRY, C.homeCards(L, STARTERS).map((c) => c.card)).some((s) => s.id === first.id));
  L = C.applyLayout(L, { op: 'dismiss', suggestion: 'suggested-ui-review-waiting' }, STARTERS);
  assert.deepEqual(L.dismissed, ['suggested-ui-review-waiting']);
});
t('suggestions come from what exists (off plugins and other apps\' plugins give none)', () => {
  const ids = C.suggestCards(REGISTRY).map((s) => s.id);
  assert.ok(ids.includes('suggested-builds-running') && ids.includes('suggested-ui-review-waiting') && ids.includes('suggested-cost-today'));
  assert.ok(!ids.includes('suggested-notes-recent'));
  assert.ok(!C.cardSources(REGISTRY).some((s) => s.plugin === 'voicevault' || s.command === 'data-file' || s.command === 'ops'));
  assert.deepEqual(C.suggestCards({ plugins: [] }), []);
  const withProfiles = C.suggestCards({ plugins: [...REGISTRY.plugins, { folder: 'profile-switcher', app: 'console-web', name: 'Profile switcher', enabled: true, commands: [{ id: 'profiles-list', kind: 'read', title: 'List build profiles' }] }] });
  const bp = withProfiles.find((s) => s.id === 'suggested-build-profiles');
  assert.ok(bp && bp.card.view === 'panel' && bp.card.source.plugin === 'profile-switcher' && bp.card.refresh.kind === 'live', 'the Build profiles card is suggested when the Profile switcher is on');
});
t('zero tokens: no language model in the card engine or the code that draws cards', () => {
  const files = ['framework/core/engines/card-rules.mjs', 'framework/react/components/DataCard.tsx', 'apps/console-web/src/views/HomeCards.tsx'];
  const LLM = /(@anthropic-ai|anthropic|openai|langchain|\bllm\b|axf\.llm@1|ai-assistant\/|model-policy|claude -p|messages\.create|completions)/i;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const imports = [...src.matchAll(/^\s*import[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1]);
    for (const i of imports) assert.ok(!LLM.test(i), `${f} imports ${i}`);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/fetch\([^)]*(llm|assistant|anthropic|openai)/i.test(code), `${f} calls a model endpoint`);
  }
});

/* ------------------------------------------------------------------ golden outputs */

const got = produce();
if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, `${JSON.stringify({ $axf: 'fixture@1', about: 'card@1 + home-layout@1 golden outputs (framework/spec/check-card.mjs --write)', ...got }, null, 1)}\n`);
  console.log(`wrote ${FIXTURE}`);
}
t('engine matches the fixture', () => {
  assert.ok(existsSync(FIXTURE), 'no fixture: run with --write');
  const want = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const k of Object.keys(got)) assert.deepEqual(got[k], want[k], k);
});

if (fails.length) { console.error(`✗ card@1: ${fails.length}/${n} failed\n${fails.map((f) => `  ✗ ${f}`).join('\n')}`); process.exit(1); }
console.log(`✓ card@1: ${n} checks (binding, views, live refresh, layout, suggestions, drops, zero tokens, fixture)`);
