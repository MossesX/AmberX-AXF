#!/usr/bin/env node
/**
 * dup-gate@1 golden fixtures: every port replays `in` (a small corpus of things that exist, candidates, options) and must
 * answer `out` (dup-gate-verdict@1 per case, plus the tokeniser and schema snapshots).
 *
 *   node framework/spec/gen-dup-gate-fixtures.mjs           check fixtures/dup-gate.json against the engine (CI)
 *   node framework/spec/gen-dup-gate-fixtures.mjs --write   regenerate the expected outputs
 *
 * Cases: the auto-land rebuild (exists on main since Nov 4 with its switch off: blocks with the fix 'turn autoLand on'),
 * a duplicate of a queued build, a duplicate of a built-but-unlanded build, near-miss titles that must pass, an override
 * that turns the block into a pass, a candidate with no title (voice), a shipped record that never landed (scored as a
 * build, never as "on main"), and the same id filed again with a round marker.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../core/dup-gate.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/dup-gate.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const NOW = '2026-11-16T13:40:00Z';

// ------------------------------------------------------------------ inputs: what exists on Nov 16 2026 (trimmed to the records the cases need)

const ITEMS = [
  // landed on main Nov 4 (PR #270): the feature Brett saw rebuilt five times
  { kind: 'shipped', id: 'auto-land', title: 'Auto-land finished builds (zero-token merge pipeline)', said: 'Earl the Ear. Plain-script merge pipeline reusing the push banner batch merge; AI only for real conflicts / red CI needing code.', plugins: ['push-banner', 'build-orchestrator'], files: ['apps/console-web/plugins/push-banner/land/land.mjs', 'apps/console-web/plugins/push-banner/land/land-core.mjs'], where: { path: '_claude/builds/shipped/auto-land.json', pr: 270, commit: '3caf0ee0026759a4ced995c2e53cf93cca2597bd' }, landed: true, since: '2026-11-04T00:53:37Z', state: { on: false, source: 'lander-config', key: 'autoLand', since: '2026-11-04T01:00:00Z' } },
  // the switch itself, read from the push banner's config.json
  { kind: 'setting', id: 'autoLand', title: 'Auto-land finished builds', detail: 'the lander lands each finished build by itself; on or off', settings: ['autoLand'], where: { key: 'autoLand', path: 'push-banner/config.json' }, state: { on: false, source: 'lander-config', key: 'autoLand', since: '2026-11-04T01:00:00Z' } },
  // a real extension of the lander, landed Nov 13
  { kind: 'shipped', id: 'lander-regenerates-generated-files-clash', title: 'Lander regenerates generated files on clash', said: 'When the lander hits a clash in generated files it should regenerate them from main instead of stopping.', plugins: ['push-banner'], where: { path: '_claude/builds/shipped/lander-regenerates-generated-files-clash.json', pr: 686, commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' }, landed: true, since: '2026-11-13T21:10:00Z' },
  // other landed work, for a corpus with common words
  { kind: 'shipped', id: 'gate-rules-plugin-in-the-console', title: 'Gate & rules plugin in the console', said: 'Where is the gate and rules plugin, open it on my screen.', plugins: ['gate'], where: { path: '_claude/builds/shipped/gate-rules-plugin-in-the-console.json', pr: 700, commit: 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1' }, landed: true, since: '2026-11-15T09:00:00Z' },
  { kind: 'shipped', id: 'theme-sync-pane', title: 'Theme sync pane', said: 'A pane in the console that shows which theme each app is on and syncs them.', plugins: ['theme-sync'], where: { path: '_claude/builds/shipped/theme-sync-pane.json', pr: 190, commit: 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2' }, landed: true, since: '2026-11-01T10:00:00Z' },
  { kind: 'shipped', id: 'home-cards', title: 'Console Home cards: card@1 asset plugins carry, Home shows every card', said: 'Every plugin gets a home card.', plugins: ['home'], where: { path: '_claude/builds/shipped/home-cards.json', pr: 171, commit: 'd4e5f60718293a4b5c6d7e8f9012345678a1b2c3' }, landed: true, since: '2026-10-30T12:00:00Z' },
  { kind: 'shipped', id: 'skins-own-everything', title: 'Skins own everything: colour theme swaps independent of layout', said: 'A skin swaps colours without touching layout.', plugins: ['skins'], where: { path: '_claude/builds/shipped/skins-own-everything.json', pr: 300, commit: 'e5f60718293a4b5c6d7e8f9012345678a1b2c3d4' }, landed: true, since: '2026-11-06T08:00:00Z' },
  // recorded in Shipped features but never landed (no commit, no PR): a build, not "on main"
  { kind: 'build', id: 'orchestrator-dup-check', title: 'Orchestrator: cheap redundancy check at split time', said: 'Every time the orchestrator takes a build request and splits it into steps, it runs a cheap redundancy check before registering it.', where: { path: '_claude/builds/shipped/orchestrator-dup-check.json', status: 'recorded' }, landed: false, since: '2026-11-07T14:11:33Z' },
  // in progress
  { kind: 'build', id: 'skin-animations-animated-swatches', title: 'Skin animations: animated colour swatches in the skin picker', said: 'The swatches in the skin picker should animate when a skin is chosen.', where: { build: 'skin-animations-animated-swatches', status: 'queued' }, landed: false, since: '2026-11-15T20:00:00Z' },
  { kind: 'build', id: 'merge-all-ready-buttons-server-side', title: 'Merge all ready: buttons + server-side lander', said: 'A Merge all ready button that the server carries out.', where: { build: 'merge-all-ready-buttons-server-side', pr: 580, branch: 'claude/merge-all-ready-buttons-server-side', status: 'built' }, landed: false, since: '2026-11-12T02:47:00Z' },
  { kind: 'build', id: 'console-app-part-2-native-floating', title: 'Console app part 2: native floating windows', said: 'Part two of the console app: floating windows that are native.', where: { build: 'console-app-part-2-native-floating', status: 'pending' }, landed: false, since: '2026-11-14T10:00:00Z' },
  // a plugin on main
  { kind: 'plugin', id: 'push-banner', title: 'Push banner', detail: 'Branches ahead of main, PRs, CI, the lander and the merge queue, in a banner.', plugins: ['push-banner'], where: { plugin: 'push-banner', path: 'apps/console-web/plugins/push-banner' }, landed: true, state: { on: true, source: 'plugin-enabled', key: 'push-banner' } },
];

const CANDIDATES = {
  // the case that prompted the build: the setting was off, so it got "rebuilt"
  'auto-land rebuilt': { id: 'auto-land-every-finished-build-lands', title: 'Auto-land: every finished build lands itself immediately', said: 'Every build that finishes should land by itself straight away. Nothing is landing.' },
  'auto-land, said only (voice)': { id: '', title: '', said: 'Nothing is landing by itself. Make every finished build auto-land again.' },
  // a duplicate of a queued build
  'queued duplicate': { id: 'animate-skin-swatches', title: 'Animated colour swatches in the skin picker', said: 'Make the colour swatches in the skin picker animate when you pick a skin.' },
  // a duplicate of a built, not yet landed build
  'built-but-unlanded duplicate': { id: 'merge-all-ready-button', title: 'Merge all ready button, server-side', said: 'A button that merges everything that is ready; the server does it.' },
  // the same id filed again with a round marker
  'same id, round 2': { id: 'console-app-part-2-native-floating-2', title: 'Console app part 2: native floating windows (round 2)', said: 'Part two of the console app: floating windows that are native.' },
  // near misses that must pass: related to the lander, not the same work
  'near miss: lander extension': { id: 'lander-pauses-on-red-main', title: 'Lander pauses when main CI is red', said: 'When main is red the lander should pause and say so instead of landing onto a red main.' },
  'near miss: lander controls in the gate plugin': { id: 'auto-lander-controls-in-the-gate-plugin', title: 'Auto-lander controls in the gate plugin', said: 'Put the auto-lander controls into the gate plugin.' },
  'near miss: theme sync colours': { id: 'theme-sync-pane-colours', title: 'Theme sync pane: colour swatches follow the active skin', said: 'The theme sync pane should show the colours of the active skin.' },
  // the earlier dup-check work is recorded, not landed: a build match, never a shipped one
  'recorded but never landed': { id: 'redundancy-check-at-split', title: 'Orchestrator: redundancy check at split time', said: 'The orchestrator should run a cheap redundancy check when it splits a build.' },
  // nothing like it
  'new work': { id: 'voicevault-export-wav', title: 'VoiceVault: export a recording as WAV', said: 'Let me export a VoiceVault recording as a WAV file.' },
};
const OVERRIDE = { by: 'brett', at: '2026-11-16T13:45:00Z', reason: 'build it anyway', via: 'voice', build: 'auto-land-every-finished-build-lands' };
const SETTINGS_THRESHOLDS = { block: 0.9, warn: 0.5 };
const TOKEN_SAMPLES = ['Auto-land: every finished build lands itself immediately', 'autoLand', 'Turn the lander on', 'Lander regenerates generated files on clash', 'Shipped features store on the server', 'ui-review items for the push banner'];
const ROUND_SAMPLES = ['auto-land-2', 'skins-r3', 'console-app-part-2-native-floating-2', 'home-card-fable', 'theme-sync-pane', 'land-everything (round 2)'];

const IN = { items: ITEMS, candidates: CANDIDATES, override: OVERRIDE, settingsThresholds: SETTINGS_THRESHOLDS, tokenSamples: TOKEN_SAMPLES, roundSamples: ROUND_SAMPLES, now: NOW };

// ------------------------------------------------------------------ outputs

const run = (c, opts = {}) => D.check(c, ITEMS.filter((i) => !c.id || i.id !== c.id), { now: NOW, ...opts });
const actual = {
  verdicts: Object.fromEntries(Object.entries(CANDIDATES).map(([k, c]) => [k, run(c)])),
  overridden: run(CANDIDATES['auto-land rebuilt'], { override: OVERRIDE }),
  strictThresholds: D.summaryOf(run(CANDIDATES['auto-land rebuilt'], { thresholds: SETTINGS_THRESHOLDS })),
  history: { block: D.historyEntry(run(CANDIDATES['auto-land rebuilt'])), override: D.historyEntry(run(CANDIDATES['auto-land rebuilt'], { override: OVERRIDE })), pass: D.historyEntry(run(CANDIDATES['new work'])) },
  tokens: Object.fromEntries(TOKEN_SAMPLES.map((s) => [s, D.tokens(s)])),
  rounds: Object.fromEntries(ROUND_SAMPLES.map((s) => [s, D.foldRound(s)])),
  thresholds: { clamp: D.normThresholds({ block: 0.7, warn: 0.9 }), decide: { pass: D.decide(0.59), warn: D.decide(0.6), block: D.decide(0.82), overridden: D.decide(0.95, D.THRESHOLDS, { by: 'brett' }) } },
  validate: {
    good: D.validateVerdict(run(CANDIDATES['auto-land rebuilt'])),
    bad: D.validateVerdict({ $axf: 'wrong@1', candidate: {}, verdict: 'maybe', matches: [{ kind: 'nope', score: 2 }, { kind: 'setting', id: 'x', fix: { kind: 'setting' } }], override: { via: 'fax' }, thresholds: { block: 0.5, warn: 0.9 } }),
  },
  registry: D.REGISTRY,
};

if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: D.SCHEMA, note: 'Generated by framework/spec/gen-dup-gate-fixtures.mjs --write; every port replays `in` (a corpus of what exists, candidates, an override, thresholds) and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
t('fixture outputs are what the engine answers', () => { for (const k of Object.keys(actual)) assert.ok(same(fx.out[k], actual[k]), `out.${k} drifted: run with --write`); });

// ------------------------------------------------------------------ the behaviour the fixture pins

const V = actual.verdicts;
t('auto-land rebuilt: blocked, the match is on main with its switch off since Nov 4, the fix is turn autoLand on', () => {
  const v = V['auto-land rebuilt'];
  assert.equal(v.verdict, 'block'); assert.ok(v.blocked && !v.pass);
  assert.ok(v.top.score >= D.THRESHOLDS.block, `top score ${v.top.score}`);
  assert.ok(['shipped', 'setting'].includes(v.top.kind));
  assert.equal(v.top.state.on, false); assert.equal(v.top.state.source, 'lander-config'); assert.equal(v.top.state.since.slice(0, 10), '2026-11-04');
  assert.deepEqual({ kind: v.fix.kind, key: v.fix.key, value: v.fix.value }, { kind: 'setting', key: 'autoLand', value: true });
  assert.ok(v.matches.some((m) => m.kind === 'shipped' && m.id === 'auto-land' && m.landed && m.where.pr === 270 && m.score >= D.THRESHOLDS.block), 'the shipped manifest is among the blocking matches');
  assert.match(v.reason, /^Blocked: .*autoLand to true/);
});
t('auto-land, said only (voice): the subject comes from his words and still blocks', () => { const v = V['auto-land, said only (voice)']; assert.equal(v.verdict, 'block'); assert.equal(v.fix.key, 'autoLand'); });
t('queued duplicate: blocked, points at the queued build', () => { const v = V['queued duplicate']; assert.equal(v.verdict, 'block'); assert.equal(v.top.kind, 'build'); assert.equal(v.top.where.status, 'queued'); assert.equal(v.fix.kind, 'reuse'); assert.equal(v.fix.build, 'skin-animations-animated-swatches'); });
t('built-but-unlanded duplicate: blocked, points at the built build and its PR', () => { const v = V['built-but-unlanded duplicate']; assert.equal(v.verdict, 'block'); assert.equal(v.top.where.status, 'built'); assert.equal(v.fix.kind, 'reuse'); assert.equal(v.fix.pr, 580); });
t('same id with a round marker: blocked as the same work filed again', () => { const v = V['same id, round 2']; assert.equal(v.verdict, 'block'); assert.equal(v.top.id, 'console-app-part-2-native-floating'); assert.match(v.top.note, /round marker/); });
for (const k of ['near miss: lander extension', 'near miss: lander controls in the gate plugin', 'near miss: theme sync colours']) t(`${k}: never blocks`, () => { const v = V[k]; assert.notEqual(v.verdict, 'block', `${k} scored ${v.top?.score} against ${v.top?.id}`); });
t('recorded but never landed: a build match (status recorded), never a shipped one', () => { const v = V['recorded but never landed']; assert.equal(v.top.kind, 'build'); assert.equal(v.top.where.status, 'recorded'); assert.equal(v.top.landed, false); assert.ok(!v.matches.some((m) => m.kind === 'shipped' && m.id === 'orchestrator-dup-check')); });
t('new work: passes with no match above the floor that matters', () => { const v = V['new work']; assert.equal(v.verdict, 'pass'); assert.ok(!v.top || v.top.score < D.THRESHOLDS.warn); });
t('an override turns the block into a pass and is kept on the verdict', () => { const v = actual.overridden; assert.equal(v.verdict, 'pass'); assert.ok(v.pass && !v.blocked); assert.equal(v.override.by, 'brett'); assert.equal(v.override.via, 'voice'); assert.match(v.reason, /^Overridden by brett/); assert.equal(v.top.score, V['auto-land rebuilt'].top.score, 'the matches are unchanged'); });
t('thresholds from settings are used and recorded', () => { const s = actual.strictThresholds; assert.ok(['block', 'warn'].includes(s.verdict)); assert.deepEqual(run(CANDIDATES['auto-land rebuilt'], { thresholds: SETTINGS_THRESHOLDS }).checked.thresholds, SETTINGS_THRESHOLDS); });
t('history entries: fail on a block, override, pass', () => { assert.equal(actual.history.block.action, 'fail'); assert.equal(actual.history.block.kind, 'build-rule'); assert.equal(actual.history.block.id, 'dup-gate'); assert.equal(actual.history.override.action, 'override'); assert.equal(actual.history.override.by, 'brett'); assert.equal(actual.history.pass.action, 'pass'); });
t('every verdict validates and checked names the corpora', () => { for (const [k, v] of Object.entries(V)) { assert.ok(D.validateVerdict(v).ok, k); assert.ok(v.checked.corpora.some((c) => c.kind === 'shipped' && c.count > 0), `${k}: shipped corpus`); assert.ok(v.checked.corpora.some((c) => c.kind === 'builds'), `${k}: builds corpus`); } });
t('tokens: camelCase split, synonyms folded, filler out', () => { assert.deepEqual(actual.tokens.autoLand, ['autoland']); assert.ok(actual.tokens['Auto-land: every finished build lands itself immediately'].includes('autoland')); assert.ok(!actual.tokens['Auto-land: every finished build lands itself immediately'].includes('immediately')); assert.ok(actual.tokens['Turn the lander on'].includes('autoland')); });
t('round markers fold, plain ids stay', () => { assert.equal(actual.rounds['auto-land-2'], 'auto-land'); assert.equal(actual.rounds['skins-r3'], 'skins'); assert.equal(actual.rounds['home-card-fable'], 'home-card'); assert.equal(actual.rounds['theme-sync-pane'], 'theme-sync-pane'); assert.equal(actual.rounds['land-everything (round 2)'], 'land-everything'); });
t('validation names every field', () => { const b = actual.validate.bad; assert.ok(!b.ok); for (const f of ['$axf', 'verdict', 'matches[0].kind', 'matches[0].score', 'matches[1].fix.key', 'override', 'thresholds']) assert.ok(b.errors.some((e) => e.field === f), f); assert.ok(actual.validate.good.ok); });
t('schemas/dup-gate.json + schemas/json/dup-gate-*.schema.json are current (run axf schemas)', () => { assert.ok(same(JSON.parse(rd('framework/schemas/dup-gate.json')), D.REGISTRY)); for (const [name, s] of Object.entries(D.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name); });

console.log(`gen-dup-gate-fixtures: ${n} checks passed`);
