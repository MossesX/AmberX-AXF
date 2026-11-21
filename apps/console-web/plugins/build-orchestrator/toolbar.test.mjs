#!/usr/bin/env node
/**
 * The Builds toolbar (assets/toolbar/build-orchestrator-pipeline.json) is wired and reachable without the UI: the deep
 * link `toolbar:build-orchestrator.pipeline`, its state, and every button pressable through REST
 * (POST /api/console-control/toolbars/build-orchestrator.pipeline/press), MCP (console_control_toolbar), the CLI
 * (`axf console toolbar press build-orchestrator.pipeline <button>`) and voice ("press split now on the builds toolbar").
 * The shared check is framework/spec/check-page-toolbars.mts; this adds what is particular to this page.
 *   node apps/console-web/plugins/build-orchestrator/toolbar.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const dir = join(HERE, 'assets/toolbar');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));
const run = spawnSync('npx', ['-y', 'tsx', join(ROOT, 'framework/spec/check-page-toolbars.mts'), ...files, '--json'], { cwd: ROOT, encoding: 'utf8' });
const out = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
for (const r of out.results) assert.deepEqual(r.errors, [], `${r.file}: ${r.errors.join('; ')}`);

const main = JSON.parse(readFileSync(join(dir, 'build-orchestrator-pipeline.json'), 'utf8'));
const byId = Object.fromEntries(main.data.groups.flatMap((g) => g.items).map((i) => [i.id, i]));
assert.deepEqual(Object.keys(byId).sort(), ['fable', 'pr', 'priority', 'queue', 'relaunch', 'said', 'split', 'status']);
// the buttons that change a build run the orchestrator's own pipeline commands (the same REST / MCP / CLI call)
assert.equal(byId.split.action, 'command:build-orchestrator/pipeline-split');
assert.equal(byId.priority.action, 'command:build-orchestrator/priority-set');
assert.equal(byId.relaunch.action, 'command:build-orchestrator/retry');
assert.ok(byId.relaunch.confirm, 'relaunch asks first');
// the page publishes every key the asset reads
const page = readFileSync(join(HERE, 'web/pipeline.tsx'), 'utf8');
for (const k of ['canQueue', 'canSplit', 'canRaise', 'canRelaunch', 'nextPriority', 'statusFilterCount']) assert.ok(page.includes(k), `pipeline.tsx publishes ${k}`);
console.log(`✓ Builds toolbar: ${out.results.reduce((n, r) => n + r.buttons, 0)} buttons wired and reachable by deep link, REST, MCP, CLI and voice`);
