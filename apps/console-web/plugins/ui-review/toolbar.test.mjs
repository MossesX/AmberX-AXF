#!/usr/bin/env node
/**
 * UI Review's page toolbars (assets/toolbar/ui-review-queue.json, ui-review-shots.json) are wired and reachable without
 * the UI: deep links `toolbar:ui-review.queue` / `toolbar:ui-review.shots`, their state, and every button through REST
 * (POST /api/console-control/toolbars/<id>/press), MCP (console_control_toolbar), the CLI (`axf console toolbar press`)
 * and voice ("press send to review on the screenshots toolbar"). Approve and Reject are person-only: never a button here.
 *   node apps/console-web/plugins/ui-review/toolbar.test.mjs
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

const items = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).data.groups.flatMap((g) => g.items);
const queue = items('ui-review-queue.json'), shots = items('ui-review-shots.json');
assert.deepEqual(queue.map((i) => i.id).sort(), ['choices', 'compare', 'group-by', 'pr']);
assert.deepEqual(shots.map((i) => i.id).sort(), ['compare', 'group-by', 'rename', 'send']);
// person-only decisions are never a toolbar command (console-control: approve / deny are never commands)
for (const i of [...queue, ...shots]) assert.ok(!/approve|reject|decide|choices-choose|approve-look/.test(`${i.id} ${i.action}`), `${i.id} must not decide`);
console.log(`✓ UI Review toolbars: ${out.results.reduce((n, r) => n + r.buttons, 0)} buttons wired and reachable by deep link, REST, MCP, CLI and voice; no approve / reject`);
