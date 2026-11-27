#!/usr/bin/env node
/**
 * model-triage@1 conformance (framework/core/model-triage.mjs, framework/spec/MODEL-TRIAGE.md): the gate's decision
 * for a table of work (every rule, every lane, the overrides, the approval hold), the edits it accepts and refuses,
 * and the text readers (a brief that names its model, path patterns, areas). A twin replays the fixture.
 *   node framework/spec/check-model-triage.mjs           check
 *   node framework/spec/check-model-triage.mjs --write   regenerate framework/spec/fixtures/model-triage.json from the engine
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../core/model-triage.mjs';
import { MODEL_POLICY } from '../core/model-policy.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/model-triage.json');
const AT = '2026-11-23T12:00:00Z';
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

// ------------------------------------------------------------------ inputs

const WORK = [
  { name: 'a contract path', work: { text: 'Change how it is stored', files: ['framework/spec/GATE.md'] } },
  { name: 'a contract word', work: { text: 'Add a field to the plan schema', files: ['apps/console-web/plugins/x/a.mjs'] } },
  { name: 'clearly simple work', work: { text: 'Rename the tab label', files: ['apps/ui/a.tsx'] } },
  { name: 'nothing says either way', work: { text: 'Add a button to the page', files: ['apps/ui/a.tsx'] } },
  { name: 'a CI fix by kind', work: { lane: 'lander-fix', kind: 'ci-red', text: 'CI is red on the PR' } },
  { name: 'a CI fix by words', work: { text: 'Main is red: find the failing check' } },
  { name: 'a merge clash by kind', work: { lane: 'lander-fix', kind: 'clash-main', text: 'main no longer merges' } },
  { name: 'a second try', work: { text: 'Rename the tab label', priorFailures: 1, current: 'Opus' } },
  { name: 'blast radius at the limit', work: { text: 'Tidy the helper', files: ['apps/x/helper.mjs'], dependents: 10 } },
  { name: 'blast radius under the limit', work: { text: 'Tidy the helper', files: ['apps/x/helper.mjs'], dependents: 9 } },
  { name: 'blast radius not measured', work: { text: 'Tidy the helper', files: ['apps/x/helper.mjs'], dependents: null } },
  { name: 'size by files', work: { text: 'Tidy the labels', files: ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7', 'a/8'] } },
  { name: 'size by lines', work: { text: 'Tidy the labels', lines: 400 } },
  { name: 'minutes are off by default', work: { text: 'Tidy the labels', minutes: 30 } },
  { name: 'three areas', work: { text: 'Tidy the labels', files: ['apps/console-web/plugins/a/x', 'apps/console-web/plugins/b/x', 'deploy/lander/x'] } },
  { name: 'an architecture word', work: { text: 'Tidy every plugin so the labels match' } },
  { name: 'the splitter said Fable', work: { text: 'Tidy the labels', suggested: 'Fable', suggestedBy: 'splitter' } },
  { name: 'the splitter said Opus', work: { text: 'Add a button to the page', suggested: 'Opus', suggestedBy: 'splitter' } },
  { name: 'an older record said Opus', work: { text: 'Add a button to the page', suggested: 'Opus' } },
  { name: 'a Fable word', work: { text: 'Audit the dispatcher' } },
  { name: 'a pin beats a contract', work: { text: 'Change the schema', files: ['framework/spec/GATE.md'], pin: { model: 'Opus', by: 'Brett' } } },
  { name: 'a step that names its model', work: { text: '[Fable] Rename the tab label' } },
  { name: 'a build-wide model', work: { text: 'Change the schema', buildPin: { model: 'opus', by: 'Claude settings' } } },
  { name: 'a pin beats the build-wide model', work: { text: 'Rename', pin: 'Fable', buildPin: { model: 'opus' } } },
  { name: 'hand: the request is a floor', work: { lane: 'hand', text: 'Rename the tab label', requested: 'claude-fable-5-2' } },
  { name: 'hand: the gate raises a low request', work: { lane: 'hand', text: 'Change the builds store schema', requested: 'opus' } },
  { name: 'hand: the brief names its model', work: { lane: 'hand', title: 'Hand build: tidy (Earl, Fable)', text: 'Rename the labels', requested: 'opus' } },
  { name: 'emergency: the same rules', work: { lane: 'emergency', text: 'Rename the banner label' } },
  { name: 'the designer rule does not cover the hand lane', work: { lane: 'hand', text: 'Add a button', suggested: 'Opus', suggestedBy: 'splitter' } },
];
const HELD = [
  { name: 'a raise is held', work: { text: 'Change the schema', files: ['framework/spec/GATE.md'], current: 'Opus' } },
  { name: 'a first assignment is held at the suggestion', work: { text: 'Fix CI', suggested: 'Opus' } },
  { name: 'nothing to hold', work: { text: 'Rename the tab label' } },
  { name: 'an override is never held', work: { text: 'Rename', pin: { model: 'Fable', by: 'Brett' }, current: 'Opus' } },
  { name: 'hand: held at the request', work: { lane: 'hand', text: 'Change the schema', requested: 'opus' } },
];
const EDITS = [
  { op: 'rule', id: 'size', settings: { files: 3, lines: 0 } },
  { op: 'rule', id: 'simple-work', enabled: false },
  { op: 'rule', id: 'ci-fix', model: 'opus', lanes: ['lander-fix'] },
  { op: 'rule', id: 'contracts', settings: { paths: 'framework/spec/, docs/*.md', phrases: ['schema'] } },
  { op: 'rule', id: 'designer', settings: { keepOpus: false } },
  { op: 'move', id: 'simple-work', to: 0 },
  { op: 'defaults', model: 'opus', handRequest: 'pin', briefWords: false },
  { op: 'enabled', enabled: false },
  { op: 'reset' },
  // refused
  { op: 'rule', id: 'nope', enabled: true },
  { op: 'rule', id: 'size', settings: { files: -1 } },
  { op: 'rule', id: 'size', settings: { files: 2.5 } },
  { op: 'rule', id: 'size', settings: { words: 3 } },
  { op: 'rule', id: 'size', model: 'sonnet' },
  { op: 'rule', id: 'size', lanes: ['moon'] },
  { op: 'rule', id: 'size' },
  { op: 'move', id: 'size', to: 99 },
  { op: 'defaults', model: 'haiku' },
  { op: 'defaults', handRequest: 'maybe' },
  { op: 'enabled', enabled: 'yes' },
  { op: 'explode' },
];
const SAYS = ['Model: Fable', '**Model:** opus', 'Tidy the docs. Model: Fable', '[Opus] Rename it', 'Please run this build on Fable.', 'Pinned to Opus.', 'Hand build: Gates UI (Earl, Fable)', 'Fix (Opus)',
  'The gate decides which model each step runs on (Opus, Fable, ...)', 'A brief that says Fable wins', 'Model: Opus or Fable', 'Model: Fable\nRun it on Opus', 'It goes to Fable instead of Opus', ''];
const PATHS = [['framework/spec/GATE.md', 'framework/spec/'], ['framework/specs/x', 'framework/spec/'], ['a/b/plan.schema.json', '*.schema.json'], ['plugin/schema.json', '*/schema.json'], ['schema.json', '*/schema.json'],
  ['framework/cli/builds-store.mjs', 'framework/cli/builds-store'], ['apps/x/y.ts', 'framework/'], ['./framework/core/a.mjs', 'framework/core/']];
const AREAS = ['apps/console-web/plugins/sample/web/a.tsx', 'apps/console-web/server/x.py', 'framework/core/a.mjs', 'deploy/lander/run.mjs', 'README.md', 'services/axf-data/x', ''];

const withEdits = (edits) => edits.reduce((cfg, e) => T.applyEdit(cfg, e, { at: AT, by: 'check' }).config, T.defaultConfig());
const TUNED = withEdits(EDITS.slice(0, 7));
const pick = (d) => ({ model: d.model, rule: d.rule, why: d.why, lane: d.lane, facts: d.facts, ...(d.held ? { held: true, wanted: d.wanted } : {}), ...(d.from ? { from: d.from } : {}) });

const fixture = {
  $axf: 'model-triage-fixture@1',
  registry: T.REGISTRY,
  defaults: T.defaultConfig(),
  decisions: WORK.map((c) => ({ ...c, decision: pick(T.decide(c.work, null, { at: AT })) })),
  held: HELD.map((c) => ({ ...c, decision: pick(T.decide(c.work, null, { at: AT, approvalRequired: true })) })),
  tuned: { config: TUNED, decisions: WORK.map((c) => ({ name: c.name, decision: pick(T.decide(c.work, TUNED, { at: AT })) })) },
  off: WORK.slice(0, 6).concat(WORK.slice(20, 22)).map((c) => ({ name: c.name, decision: pick(T.decide(c.work, withEdits([{ op: 'enabled', enabled: false }]), { at: AT })) })),
  edits: (() => { let cfg = T.defaultConfig(); return EDITS.map((edit) => { const r = T.applyEdit(cfg, edit, { at: AT, by: 'check' }); cfg = r.config; return { edit, errors: r.errors, rev: r.config.rev, what: r.entry?.what ?? '' }; }); })(),
  norm: [null, {}, { rules: [{ id: 'size', settings: { files: 'x', lines: 10 } }, { id: 'ghost' }, { id: 'size', enabled: false }], defaults: { model: 'sonnet', handRequest: 'x' } }, { enabled: false, rules: [{ id: 'simple-work', model: 'fable', lanes: ['hand', 'moon'] }] }].map((raw) => ({ raw, config: T.normConfig(raw) })),
  says: SAYS.map((text) => ({ text, model: T.explicitModel(text) })),
  paths: PATHS.map(([path, pattern]) => ({ path, pattern, match: T.pathMatches(path, pattern) })),
  areas: AREAS.map((path) => ({ path, area: T.areaOf(path) })),
  normDecision: [T.decide(WORK[0].work, null, { at: AT }), { model: 'Sonnet', rule: 'x' }, { model: 'fable', rule: 'size', why: 'w', lane: 'moon', held: true, wanted: 'opus', suggested: 'Opus', suggestedBy: 'splitter', facts: { files: 2, junk: 1 } }, null].map((d) => T.normDecision(d)),
};

if (process.argv.includes('--write')) { writeFileSync(FIX, `${JSON.stringify(fixture, null, 1)}\n`); console.log(`wrote ${FIX}`); process.exit(0); }

// ------------------------------------------------------------------ checks

let fx = null;
t('the fixture is the engine\'s output (run with --write after an engine change)', () => { fx = JSON.parse(readFileSync(FIX, 'utf8')); assert.deepEqual(fx, JSON.parse(JSON.stringify(fixture))); });
const by = (list) => Object.fromEntries(list.map((c) => [c.name, c.decision]));
t('each rule fires on its own measure and names itself', () => {
  const d = by(fixture.decisions);
  for (const [name, model, rule] of [['a contract path', 'Fable', 'contracts'], ['a contract word', 'Fable', 'contracts'], ['clearly simple work', 'Opus', 'simple-work'], ['a CI fix by kind', 'Fable', 'ci-fix'], ['a CI fix by words', 'Fable', 'ci-fix'],
    ['a merge clash by kind', 'Fable', 'merge-clash'], ['a second try', 'Fable', 'second-try'], ['blast radius at the limit', 'Fable', 'blast-radius'], ['blast radius under the limit', 'Opus', 'simple-work'], ['blast radius not measured', 'Opus', 'simple-work'],
    ['size by files', 'Fable', 'size'], ['size by lines', 'Fable', 'size'], ['minutes are off by default', 'Opus', 'simple-work'], ['three areas', 'Fable', 'cross-cutting'], ['an architecture word', 'Fable', 'cross-cutting'],
    ['the splitter said Fable', 'Fable', 'designer'], ['the splitter said Opus', 'Opus', 'designer'], ['a Fable word', 'Fable', 'fable-words'], ['emergency: the same rules', 'Opus', 'simple-work']]) {
    assert.deepEqual([d[name].model, d[name].rule], [model, rule], name);
  }
  assert.equal(d['a second try'].from, 'Opus'); assert.equal(d['size by files'].facts.files, 8); assert.equal(d['three areas'].facts.areas, 3);
});
t('no rule matched: the policy\'s "unsure" model, and a model that only came with an older record never lowers', () => {
  const d = by(fixture.decisions);
  assert.equal(T.DEFAULTS.model, MODEL_POLICY.work.unsure);
  assert.deepEqual([d['nothing says either way'].model, d['nothing says either way'].rule], ['Fable', 'default']);
  assert.deepEqual([d['an older record said Opus'].model, d['an older record said Opus'].rule], ['Fable', 'default']);
});
t('explicit overrides win: a pin, a text that names its model, the build-wide model; a pin beats the build-wide model', () => {
  const d = by(fixture.decisions);
  for (const [name, model] of [['a pin beats a contract', 'Opus'], ['a step that names its model', 'Fable'], ['a build-wide model', 'Opus'], ['a pin beats the build-wide model', 'Fable'], ['hand: the brief names its model', 'Fable']]) assert.deepEqual([d[name].model, d[name].rule], [model, T.OVERRIDE], name);
  assert.match(d['a pin beats a contract'].why, /pinned to Opus by Brett/);
});
t('the hand lane: the launch\'s own model is a floor by default, and the gate raises a request that is too low', () => {
  const d = by(fixture.decisions);
  assert.deepEqual([d['hand: the request is a floor'].model, d['hand: the request is a floor'].rule], ['Fable', T.REQUESTED]);
  assert.deepEqual([d['hand: the gate raises a low request'].model, d['hand: the gate raises a low request'].rule], ['Fable', 'contracts']);
  assert.equal(d['the designer rule does not cover the hand lane'].rule, 'default');
});
t('"Fable upgrades need my approval" on: a raise is held on the lower model and says what the gate wanted', () => {
  const d = by(fixture.held);
  assert.deepEqual(d['a raise is held'], { ...d['a raise is held'], model: 'Opus', rule: 'contracts', held: true, wanted: 'Fable' });
  assert.deepEqual([d['a first assignment is held at the suggestion'].model, d['a first assignment is held at the suggestion'].held], ['Opus', true]);
  assert.equal(d['nothing to hold'].held, undefined); assert.deepEqual([d['an override is never held'].model, d['an override is never held'].held], ['Fable', undefined]);
  assert.deepEqual([d['hand: held at the request'].model, d['hand: held at the request'].wanted], ['Opus', 'Fable']);
});
t('the rules are data: edits change the decisions', () => {
  const d = by(fixture.tuned.decisions);
  assert.deepEqual([d['clearly simple work'].model, d['clearly simple work'].rule], ['Opus', 'default'], 'simple-work is off and the default is Opus');
  assert.deepEqual([d['a CI fix by words'].model, d['a CI fix by words'].rule], ['Fable', 'fable-words'], 'ci-fix covers only the lander lane now');
  assert.deepEqual([d['a CI fix by kind'].model, d['a CI fix by kind'].rule], ['Opus', 'ci-fix'], 'and sends it to Opus');
  assert.deepEqual([d['the splitter said Opus'].model, d['the splitter said Opus'].rule], ['Opus', 'default'], 'keepOpus off: the suggestion only raises');
  assert.notEqual(d['a step that names its model'].rule, T.OVERRIDE, 'briefWords off: a text that names its model is not an override');
  assert.deepEqual([d['hand: the request is a floor'].model, d['hand: the request is a floor'].rule], ['Fable', T.OVERRIDE], 'handRequest = pin');
});
t('the gate off: the default model for every lane, overrides still win', () => {
  const d = by(fixture.off);
  assert.deepEqual([d['a contract path'].model, d['a contract path'].rule], ['Fable', 'default']); assert.match(d['a contract path'].why, /the gate is off/);
  assert.deepEqual([d['a pin beats a contract'].model, d['a pin beats a contract'].rule], ['Opus', T.OVERRIDE]);
});
t('edits are checked: a bad value changes nothing and says why', () => {
  const good = fixture.edits.slice(0, 9); const bad = fixture.edits.slice(9);
  assert.ok(good.every((e) => e.errors.length === 0)); assert.deepEqual(good.map((e) => e.rev), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(bad.every((e) => e.errors.length > 0 && e.rev === 9 && e.what === ''), 'every refused edit names its error and leaves the revision alone');
  assert.deepEqual(TUNED.rules[0].id, 'simple-work'); assert.deepEqual(TUNED.rules.find((r) => r.id === 'contracts').settings.paths, ['framework/spec/', 'docs/*.md']);
});
t('a stored config is made whole: every rule once, unknown ones dropped, bad values back to the starting ones', () => {
  const [none, empty, messy, partial] = fixture.norm.map((x) => x.config);
  assert.deepEqual(none, T.defaultConfig()); assert.deepEqual(empty, T.defaultConfig());
  assert.deepEqual(messy.rules.map((r) => r.id), ['size', ...T.RULE_IDS.filter((x) => x !== 'size')]); assert.deepEqual(messy.rules[0].settings, { lines: 10, files: 8, minutes: 0 }); assert.equal(messy.rules[0].enabled, true);
  assert.deepEqual(messy.defaults, T.DEFAULTS); assert.equal(partial.enabled, false); assert.deepEqual(partial.rules[0].lanes, ['hand']);
});
t('a text names its model only when it says so', () => {
  const m = Object.fromEntries(fixture.says.map((s) => [s.text, s.model]));
  assert.equal(m['Model: Fable'], 'fable'); assert.equal(m['**Model:** opus'], 'opus'); assert.equal(m['Tidy the docs. Model: Fable'], 'fable'); assert.equal(m['[Opus] Rename it'], 'opus');
  assert.equal(m['Please run this build on Fable.'], 'fable'); assert.equal(m['Pinned to Opus.'], 'opus'); assert.equal(m['Hand build: Gates UI (Earl, Fable)'], 'fable'); assert.equal(m['Fix (Opus)'], 'opus');
  for (const talk of ['The gate decides which model each step runs on (Opus, Fable, ...)', 'A brief that says Fable wins', 'Model: Opus or Fable', 'Model: Fable\nRun it on Opus', 'It goes to Fable instead of Opus', '']) assert.equal(m[talk], '', talk);
});
t('path patterns and areas', () => {
  assert.deepEqual(fixture.paths.map((p) => p.match), [true, false, true, true, true, true, false, true]);
  assert.deepEqual(fixture.areas.map((a) => a.area), ['apps/console-web/plugins/sample', 'apps/console-web', 'framework/core', 'deploy/lander', 'README.md', 'services/axf-data', '']);
});
t('a decision as a record: known fields only', () => {
  const [full, blocked, clipped, none] = fixture.normDecision;
  assert.equal(full.model, 'Fable'); assert.equal(full.rule, 'contracts'); assert.equal(full.at, AT); assert.equal(blocked, null); assert.equal(none, null);
  assert.deepEqual(clipped, { model: 'Fable', rule: 'size', why: 'w', lane: 'orchestrator', at: '', held: true, wanted: 'Opus', suggested: 'Opus', suggestedBy: 'splitter', facts: { files: 2 } });
});
t('every rule has its fields, a matcher and a place in the starting order', () => {
  assert.deepEqual(Object.keys(T.RULE_FIELDS).sort(), [...T.RULE_IDS].sort());
  for (const r of T.DEFAULT_RULES) { assert.ok(r.title && r.text && r.lanes.length); for (const f of T.RULE_FIELDS[r.id]) assert.ok(f.key in r.settings, `${r.id}.${f.key}`); }
  for (const id of T.RULE_IDS) assert.ok(fixture.decisions.some((c) => c.decision.rule === id), `the table exercises ${id}`);
});
console.log(`ok model-triage@1: ${n}/${n}`);
