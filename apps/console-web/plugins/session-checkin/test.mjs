#!/usr/bin/env node
// Self-test for the session check-in plugin (CI: node apps/console-web/plugins/session-checkin/test.mjs).
// Uses a throwaway folder for the settings files and the archive; never touches the repo's own .claude/.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';

const dir = mkdtempSync(join(tmpdir(), 'axf-checkin-'));
const run = (args, input) => spawnSync(process.execPath, args, { input, encoding: 'utf8', env: { ...process.env, AXF_DATA_DIR: join(dir, 'data'), CLAUDE_PROJECT_DIR: L.REPO_ROOT } });
try {
  // a fake clone with someone else's hook already in .claude/settings.json
  const clone = join(dir, 'clone');
  mkdirSync(join(clone, 'apps/console-web/plugins/session-checkin'), { recursive: true });
  writeFileSync(join(clone, L.REL_CHECKIN), '');
  mkdirSync(join(clone, '.claude'));
  const other = { type: 'command', command: 'claude-sync start' };
  writeFileSync(join(clone, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { SessionStart: [{ matcher: 'startup', hooks: [other] }] } }));
  const inst = (action, extra = {}) => JSON.parse(run([join(L.PLUGIN_DIR, 'install.mjs'), '--json', JSON.stringify({ action, target: 'shared', dir: clone, ...extra })]).stdout.trim());

  assert.equal(inst('install').ok, true);
  assert.equal(inst('install', { config: { sources: ['startup', 'resume'] } }).ok, true); // reinstall = replace, not duplicate
  let s = JSON.parse(readFileSync(join(clone, '.claude/settings.json'), 'utf8'));
  assert.equal(s.hooks.SessionStart.length, 2, 'ours + the existing hook');
  assert.deepEqual(s.hooks.SessionStart[0].hooks[0], other, 'existing hook kept as it was');
  assert.equal(s.hooks.SessionStart[1].matcher, 'startup|resume');
  assert.ok(s.hooks.SessionEnd[0].hooks[0].command.includes(L.HOOK_MARK));
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] });
  assert.equal(inst('status').targets.shared.installed, true);
  assert.equal(inst('uninstall').changed, true);
  s = JSON.parse(readFileSync(join(clone, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(s, { permissions: { allow: ['Bash(ls)'] }, hooks: { SessionStart: [{ matcher: 'startup', hooks: [other] }] } }, 'uninstall restores the file');
  assert.equal(inst('install', { target: 'user' }).ok, false, 'the user target is never installed from the console');

  // archive: write, scrub, list, end
  const rec = { id: 'test-1', claudeSessionId: 's-1', startedAt: '2026-10-18T10:00:00.000Z', location: { answer: 'vps', detected: 'vps' }, repo: { slug: 'MossesX/AmberX-AXF', ok: true, behind: 2 }, model: { picked: 'opus' }, effort: { picked: 'high' }, notes: 'ghp_secret', apiKey: 'nope' };
  assert.match(run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'log'], JSON.stringify(rec)).stdout, /logged: test-1/);
  const list = JSON.parse(run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'list', '--json']).stdout);
  const row = list.sessions.find((r) => r.id === 'test-1');
  assert.equal(row.status, 'flag', 'behind origin is flagged');
  const got = JSON.parse(run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'get', 'test-1', '--json']).stdout);
  assert.equal(got.notes, '[removed]'); assert.equal(got.apiKey, undefined);
  run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'end'], JSON.stringify({ session_id: 's-1', reason: 'exit' }));
  assert.ok(JSON.parse(run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'get', 'test-1', '--json']).stdout).end?.at, 'end hook stamps the record');

  // detect prints the check-in; resume is ignored with the default config
  const out = run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'detect', '--no-fetch'], JSON.stringify({ session_id: 'x', source: 'startup' })).stdout;
  assert.match(out, /SESSION CHECK-IN/); assert.match(out, /Round 1:/); assert.match(out, /1\. Location/);
  assert.equal(run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'detect', '--no-fetch'], JSON.stringify({ source: 'resume' })).stdout, '');
  // memory files open read-only and never outside the memory folders
  assert.notEqual(run([join(L.PLUGIN_DIR, 'checkin.mjs'), 'open', '../../etc/passwd']).status, 0);
  assert.match(L.repoSlug('http://user:tok@127.0.0.1:9/git/MossesX/AmberX-AXF'), /^MossesX\/AmberX-AXF$/);
  console.log('session-checkin: all checks passed');
} finally { rmSync(dir, { recursive: true, force: true }); }
