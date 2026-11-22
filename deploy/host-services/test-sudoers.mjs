#!/usr/bin/env node
/**
 * The sudoers generator writes only what the manifests declare: no ALL, no shell, no stray wildcard, axf-* expanded to
 * the named units, root never the service user, and the committed file is current.
 *   node deploy/host-services/test-sudoers.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../../framework/core/host-services.mjs';
import { loadManifests } from './axf-hostd.mjs';
import { sudoersFor, render, visudoCheck } from './gen-sudoers.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let n = 0; const ok = (s) => { n += 1; console.log(`  ✓ ${s}`); };
const svc = (id, sudo, extra = {}) => H.normManifest({ $axf: 'host-service@1', id, title: id, kind: 'daemon', unit: `axf-${id}.service`, plugin: 'console', runner: `deploy/host-services/workers/${id}.mjs`, sudo, ...extra });

const { manifests, errors } = loadManifests(ROOT);
assert.deepEqual(errors, []);
const blocks = sudoersFor(manifests);
const text = render(blocks);
const lines = text.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('Defaults'));
const declared = new Set(manifests.flatMap((m) => m.sudo.map((s) => s.cmd)));
const units = manifests.filter((m) => !m.cron).flatMap((m) => [m.unit, ...(m.timer ? [m.timer] : [])]);
for (const l of lines) {
  assert.match(l, /^axf-host ALL=\(root\) NOPASSWD: \/\S+/, l);
  const cmd = l.replace(/^axf-host ALL=\(root\) NOPASSWD: /, '');
  assert.ok(!cmd.includes('*'), `no wildcard left: ${l}`);
  assert.ok(declared.has(cmd) || [...declared].some((d) => d.includes('axf-*') && units.some((u) => d.replace('axf-*', u) === cmd)), `declared: ${cmd}`);
}
ok(`${lines.length} lines, every one declared by a manifest (axf-* expanded to ${units.length} named units)`);
assert.ok(!/NOPASSWD: ALL/.test(text) && !/\(ALL\)/.test(text)); ok('no general root rule');
for (const bad of [
  [{ cmd: '/bin/bash -c ls', why: 'x' }, 'bash'], [{ cmd: '/usr/bin/env ls', why: 'x' }, 'env'], [{ cmd: '/usr/bin/docker *', why: 'x' }, 'wildcard'],
  [{ cmd: '/usr/bin/tee /etc/passwd', why: 'x' }, 'tee'], [{ cmd: '/usr/bin/git -C /opt/axf -c core.pager=x log ALL', why: 'x' }, 'ALL'],
]) assert.throws(() => sudoersFor([svc('bad', [bad[0]])]), new RegExp(bad[1]));
ok('shells, env, tee, ALL and free wildcards are refused');
assert.deepEqual(sudoersFor([svc('a', [{ cmd: '/usr/bin/systemctl restart axf-*', why: 'r' }]), svc('b', [])]).flatMap((b) => b.lines), ['axf-host ALL=(root) NOPASSWD: /usr/bin/systemctl restart axf-a.service', 'axf-host ALL=(root) NOPASSWD: /usr/bin/systemctl restart axf-b.service']);
ok('axf-* becomes one line per named unit');
execFileSync(process.execPath, [join(ROOT, 'deploy/host-services/gen-sudoers.mjs'), '--check'], { stdio: 'inherit' });
ok('committed sudoers.d/axf-host is current');
const T = mkdtempSync(join(tmpdir(), 'axf-sudoers-'));
try {
  writeFileSync(join(T, 'f'), text);
  const v = visudoCheck(join(T, 'f'));
  assert.ok(v.ok, v.message); ok(v.message);
} finally { rmSync(T, { recursive: true, force: true }); }
console.log(`✓ sudoers: ${n} checks`);
