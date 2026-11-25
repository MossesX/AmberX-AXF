#!/usr/bin/env node
/**
 * CI check (build approval-pass-covers-every-call, s11; axHub decision 120): walks every real plugin command that
 * asks for a confirm token (console_terminal_sessions_stop and the rest) and fails when an active `covers: all`
 * pass, the console's own or the one axHub sends, still answers confirmation_required. A command the plugin marks
 * irreversible keeps its confirm unless the pass includes irreversible calls.
 *
 *   node apps/console-web/plugins/plugin-commands/test-pass-walk.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AXF_PLUGIN_COMMANDS_DATA_DIR = mkdtempSync(join(tmpdir(), 'pc-walk-'));
const { plan, registry } = await import('./commands.mjs');

const reg = registry({ apps: ['console-web'] });
const pass = { id: 'walk-all', scope: 'all', covers: 'all', state: 'active', expiresAt: new Date(Date.now() + 600000).toISOString() };
const walked = []; const leaks = [];
for (const p of reg.plugins) {
  if (p.app !== 'console-web' || p.enabled === false) continue;
  for (const c of p.commands) {
    if (!c.confirm || c.kind === 'read') continue;
    // fill required input with placeholders: the gate decides before any input reaches the plugin
    const req = c.input?.required ?? []; const props = c.input?.properties ?? {};
    const input = Object.fromEntries(req.map((k) => [k, props[k]?.type === 'number' || props[k]?.type === 'integer' ? 1 : props[k]?.type === 'boolean' ? true : 'x']));
    const cmd = { op: 'act', target: 'plugins.commands', path: `${p.folder}/${c.id}`, action: 'run', input };
    walked.push(cmd.path);
    for (const opts of [{ pass }, { passes: [pass] }]) {
      const r = plan(cmd, { reg, ...opts });
      if (r.code === 'confirmation_required' && c.irreversible !== true) leaks.push(`${cmd.path} (${'pass' in opts ? 'axHub pass' : 'console pass'})`);
    }
  }
}
assert.deepEqual(leaks, [], 'a covers-all pass must lift every plugin confirm');
assert.ok(walked.includes('console-terminal/sessions-stop'), 'the walk reached console_terminal_sessions_stop');
console.log(`✓ pass walk — ${walked.length} confirm commands run at once under a covers-all pass`);
