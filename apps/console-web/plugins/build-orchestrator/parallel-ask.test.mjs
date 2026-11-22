// Self-test: node apps/console-web/plugins/build-orchestrator/parallel-ask.test.mjs
// Per-build parallel override when filing (Nov 13 2026: "split into N parallel"): the filing form's choices and request
// body, the table row's parallelParts / parallelRole and when its picker shows, and that the console sends exactly
// what the REST routes (pipeline/request, pipeline/parallel) and the CLI take.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as orch from './web/orchestrator-core.mjs';
import * as T from './web/status-table-core.mjs';
import { normParallelParts } from '../../../../framework/core/build-pipeline.mjs';
import { splitSettingsFor, normSettings } from './pipeline-core.mjs';

const PLUGIN = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(PLUGIN, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('choices: Split settings, one build, then 2..12 parallel', () => {
  const c = orch.parallelChoices();
  assert.deepEqual(c.slice(0, 2).map((x) => x.value), ['default', 'off']);
  assert.deepEqual(c.slice(2).map((x) => x.value), ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  assert.equal(orch.parallelChoices(4).length, 5);
  assert.equal(orch.parallelChoices(99).length, 13, 'capped at 12');
});

t('parallelParts 0/1/N ↔ choice value', () => {
  assert.equal(orch.parallelAskOf(0), 'default'); assert.equal(orch.parallelAskOf(undefined), 'default');
  assert.equal(orch.parallelAskOf(1), 'off'); assert.equal(orch.parallelAskOf(3), '3'); assert.equal(orch.parallelAskOf('5'), '5'); assert.equal(orch.parallelAskOf(40), '12');
  assert.equal(orch.parallelAskLabel(0), 'settings'); assert.equal(orch.parallelAskLabel('off'), 'one build'); assert.equal(orch.parallelAskLabel(3), '3 parts');
  // every value maps back onto what build-pipeline@1 stores
  for (const { value } of orch.parallelChoices()) {
    const stored = value === 'default' ? 0 : value === 'off' ? 1 : normParallelParts(value);
    assert.equal(orch.parallelAskOf(stored), value);
  }
});

t('request body: parallel only when it beats the settings', () => {
  assert.deepEqual(orch.requestBody({ title: '  Skins  ' }), { title: 'Skins', queue: true });
  assert.deepEqual(orch.requestBody({ title: 'Skins', parallel: '3', priority: 'P1', said: 'split it', queue: false }), { title: 'Skins', queue: false, said: 'split it', priority: 'P1', parallel: '3' });
  assert.equal(orch.requestBody({ title: 'x', parallel: 'off' }).parallel, 'off');
  assert.equal(orch.requestBody({ title: 'x', parallel: 'default' }).parallel, undefined);
  assert.equal(orch.requestBody({ title: 'x', priority: 'P9' }).priority, undefined);
});

t('a filed ask wins over the Split settings (s1 engine)', () => {
  const off = normSettings({ parallelSplit: 'off' });
  const r = splitSettingsFor({ id: 'x', pipeline: { parallelParts: 3 } }, off);
  assert.equal(r.exact, 3); assert.equal(r.source, 'build'); assert.equal(r.settings.parallelSplit, 'ask');
  assert.equal(splitSettingsFor({ id: 'x', pipeline: { parallelParts: 1 } }, normSettings({ parallelSplit: 'auto' })).settings.parallelSplit, 'off');
});

t('table row carries the ask and the role; the picker shows only before building', () => {
  const base = { id: 'skins', title: 'Skins', flow: 'pipeline-2', status: 'pending', steps: [] };
  const r = T.buildRow({ ...base, pipeline: { parallelParts: 4 } });
  assert.equal(r.parallelParts, 4); assert.equal(r.parallelRole, '');
  assert.equal(T.canAskParallel(r), true);
  assert.equal(T.buildRow(base).parallelParts, 0);
  assert.equal(T.canAskParallel(T.buildRow({ ...base, status: 'building' })), false);
  assert.equal(T.canAskParallel(T.buildRow({ ...base, pipeline: { parallel: { role: 'lead', parts: ['a', 'b'] } } })), false);
  assert.equal(T.buildRow({ ...base, pipeline: { parallel: { role: 'part', lead: 'skins', part: 1, of: 2 } } }).parallelRole, 'part');
});

t('the console calls the REST routes the server has, with the values it accepts', () => {
  const server = read('server/__init__.py');
  assert.match(server, /@router\.post\("\/pipeline\/request"\)[\s\S]*parallel=body\.get\("parallel"\)/);
  assert.match(server, /@router\.post\("\/pipeline\/parallel"\)/);
  const table = read('web/StatusTable.tsx'); const form = read('web/file-build.tsx'); const index = read('web/index.tsx');
  assert.match(table, /'pipeline\/request'/); assert.match(table, /'pipeline\/parallel', \{ id: r\.id, parts: v \}/);
  assert.match(table, /<FileBuildForm /); assert.match(table, /T\.canAskParallel\(r\) && <ParallelAsk /);
  assert.match(form, /label="Split into"/); assert.match(form, /data-help="file-build"/);
  assert.match(index, /'build-orchestrator\.file-build'/); assert.match(index, /'build-orchestrator\.parallel'/);
  // every choice value passes the server's _parallel_arg: 2-12, off or default
  for (const { value } of orch.parallelChoices()) assert.ok(['off', 'default'].includes(value) || (Number(value) >= 2 && Number(value) <= 12), value);
});

t('help covers the new controls', () => {
  const targets = new Set(JSON.parse(read('help.json')).data.entries.map((e) => e.target));
  for (const k of ['file-build', 'split-into', 'file-the-build', 'parallel-ask', 'parallel-split-this-build']) assert.ok(targets.has(k), k);
});

console.log(`✓ parallel-ask: ${n} checks`);
