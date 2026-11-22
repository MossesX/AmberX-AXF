#!/usr/bin/env node
/**
 * Brett's ask, checked end to end (Nov 13 2026): "orchestrator settings needs a collapsible section for split, with all
 * the splitting options, and one option splits it so it runs multiple parallel builds simultaneously to speed it up".
 *   1. Settings → Plugins → Build orchestrator has one collapsible Split section.
 *   2. It holds the splitting options, the parallel split among them, and every key it saves is one the REST route takes.
 *   3. The parallel option really runs several builds at the same time: a request is cut into part builds that the
 *      dispatcher lets run together once the shared contract step is done, and the integration step waits for them all.
 *   node apps/console-web/plugins/build-orchestrator/split-ask.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './pipeline-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

const split = read('web/split-settings.tsx');
const par = read('web/parallel-split-fields.tsx');
const index = read('web/index.tsx');
const server = read('server/__init__.py');
const help = JSON.parse(read('help.json')).data.entries;
const manifest = read('plugin.json');

t('1. one collapsible Split section, its own settings panel holding the parallel split fields', () => {
  assert.match(split, /<details className="pd-add oc-split" id=\{SPLIT_SECTION_ID\}/);
  assert.match(index, /title: 'Split'.*<SplitSettings api=\{pipeApi\} open><ParallelSplitFields api=\{pipeApi\} \/><\/SplitSettings>/);
});

t('2. the splitting options are in it and every key saved is accepted by POST /pipeline/settings', () => {
  const saved = [...`${split}\n${par}`.matchAll(/save\(\{ (\w+):/g)].map((m) => m[1]);
  for (const k of ['splitProvider', 'parallelSplit', 'parallelMax', 'parallelContract', 'parallelIntegrate']) assert.ok(saved.includes(k), `the Split section saves ${k}`);
  const allowed = /allowed = \{([^}]*)\}/s.exec(server)?.[1] ?? '';
  for (const k of saved) assert.ok(allowed.includes(`"${k}"`), `POST /pipeline/settings accepts ${k}`);
  // the mode list in the UI is exactly the engine's
  const modes = [...par.matchAll(/\{ value: '(\w+)', label: /g)].map((m) => m[1]).sort();
  assert.deepEqual(modes, ['ask', 'auto', 'off']);
  for (const m of modes) assert.equal(P.normSettings({ parallelSplit: m }).parallelSplit, m);
  // the UI's range for max parts is the engine's clamp, and the default is 4
  const [lo, hi] = /min: (\d+), max: (\d+)/.exec(par).slice(1).map(Number);
  assert.equal(P.normSettings({ parallelMax: lo - 1 }).parallelMax, lo); assert.equal(P.normSettings({ parallelMax: hi + 1 }).parallelMax, hi);
  assert.equal(P.normSettings().parallelMax, 4);
  // reachable without the UI: the settings tool names the parallel keys
  assert.match(manifest, /parallelSplit \(auto[^"]*parallelMax[^"]*parallelContract[^"]*parallelIntegrate/);
  for (const k of ['parallel-split', 'max-parallel-parts', 'shared-contract-step-first', 'integration-step-last']) assert.ok(help.some((e) => e.target === k), `help entry ${k}`);
});

const settings = P.normSettings({ parallelSplit: 'auto', parallelMax: 3 });
const build = { id: 'speed-it-up', title: 'Speed it up', detail: 'Three independent screens', steps: [], status: 'pending' };
const answer = JSON.stringify({
  steps: [{ text: 'Do it all as one build', model: 'Opus', estimate: '10 min' }],
  parallel: {
    contract: 'Write the shared routes and names first',
    parts: ['alpha', 'beta', 'gamma'].map((x) => ({ title: `Screen ${x}`, steps: [{ text: `Build screen ${x}`, model: 'Opus', estimate: '10 min' }] })),
    integration: 'Merge the three parts, test them together, PR',
  },
});

t('3. the parallel option cuts a request into part builds that run at the same time', () => {
  assert.match(P.splitPrompt(build, undefined, settings), /Parallel split \(on, up to 3 parts\)/, 'the splitter is asked for parts');
  const parsed = P.parseSplit(answer, undefined, settings);
  assert.equal(parsed.error, ''); assert.equal(parsed.parallel.parts.length, 3);
  const ids = ['speed-it-up-p1', 'speed-it-up-p2', 'speed-it-up-p3'];
  const ps = P.parallelSteps(build, parsed.parallel, settings, undefined, ids);
  assert.equal(ps.children.length, 3, 'three part builds');
  assert.equal(ps.lead[0].phase, 'Contract'); assert.equal(ps.lead.at(-1).phase, 'Integration');
  const lead = { ...build, status: 'queued', steps: ps.lead.map((s) => ({ ...s, done: false })), pipeline: { parallel: { ...ps.parallel, contractStep: 's1', integrationStep: ps.lead.at(-1).id } } };
  const parts = ps.children.map((c) => ({ id: c.id, status: 'queued', steps: c.steps.map((s) => ({ ...s, done: false })), pipeline: { parallel: c.parallel } }));
  const all = () => [lead, ...parts];
  // the parts wait for the shared contract, then every one of them may start: they run simultaneously
  for (const p of parts) assert.match(P.parallelWait(p, all()), /shared contract/);
  lead.steps[0].done = true;
  for (const p of parts) assert.equal(P.parallelWait(p, all()), '', `${p.id} may run alongside the others`);
  // the integration step waits until every part has finished, then merges them
  assert.match(P.parallelWait(lead, all()), /integration waits for parts speed-it-up-p1, speed-it-up-p2, speed-it-up-p3/);
  parts.forEach((p) => { p.status = 'complete'; p.steps.forEach((s) => { s.done = true; }); });
  assert.equal(P.parallelWait(lead, all()), '');
});

t('3b. off keeps one build; "split into N parallel" on one build beats the setting', () => {
  assert.doesNotMatch(P.splitPrompt(build, undefined, P.normSettings({ parallelSplit: 'off' })), /Parallel split/);
  assert.equal(P.parseSplit(answer, undefined, P.normSettings({ parallelSplit: 'off' })).parallel, null);
  const eff = P.splitSettingsFor({ ...build, detail: 'please split into 2 parallel builds' }, P.normSettings({ parallelSplit: 'off' }));
  assert.equal(eff.exact, 2); assert.equal(eff.settings.parallelSplit, 'ask');
});

console.log(`✓ split-ask: Brett's ask holds (${n} checks): collapsible Split section, every split option, parallel builds at the same time`);
