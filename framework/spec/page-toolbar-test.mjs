/**
 * The shared body of every plugin's page toolbar test (`plugins/<folder>/toolbar.test.mjs`): run
 * check-page-toolbars.mts on the plugin's toolbar assets (contract, page scope, every button bound and wired, drawn by
 * its page, reachable by deep link, REST, MCP, CLI and voice), then check the buttons each asset ships.
 *
 *   import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
 *   pageToolbarTest(import.meta.url, { 'plan-studio-plans.json': ['new', 'park', …] }, { forbid: /approve/ });
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function pageToolbarTest(testUrl, expect, { forbid = null, label = '' } = {}) {
  const dir = join(dirname(fileURLToPath(testUrl)), 'assets', 'toolbar');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of Object.keys(expect)) assert.ok(files.includes(f), `assets/toolbar/${f} exists`);
  const run = spawnSync('npx', ['-y', 'tsx', join(ROOT, 'framework/spec/check-page-toolbars.mts'), ...files.map((f) => join(dir, f)), '--json'], { cwd: ROOT, encoding: 'utf8' });
  const at = run.stdout.indexOf('{');
  assert.ok(at >= 0, `check-page-toolbars ran: ${run.stderr.slice(-400)}`);
  const out = JSON.parse(run.stdout.slice(at));
  for (const r of out.results) assert.deepEqual(r.errors, [], `${r.file}: ${r.errors.join('; ')}`);
  for (const [f, ids] of Object.entries(expect)) {
    const items = JSON.parse(readFileSync(join(dir, f), 'utf8')).data.groups.flatMap((g) => g.items);
    assert.deepEqual(items.map((i) => i.id).sort(), [...ids].sort(), `${f}: its buttons`);
    if (forbid) for (const i of items) assert.ok(!forbid.test(`${i.id} ${i.action}`), `${f}: ${i.id} must not be a toolbar command`);
  }
  const n = out.results.reduce((s, r) => s + r.buttons, 0);
  console.log(`✓ ${label || out.results.map((r) => r.settingsId).join(', ')}: ${n} buttons wired and reachable by deep link, REST, MCP, CLI and voice`);
  return out.results;
}
