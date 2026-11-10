#!/usr/bin/env node
/**
 * claude-headless.sh resource limits (console speed, Nov 10 2026): every headless session runs low-priority, and as
 * root with systemd it runs in its own scope under axfbuild.slice with memory and swap caps. Runs build_limits() from
 * the real script in isolation; never starts a session.
 *
 *   node deploy/claude-headless-limits.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, 'claude-headless.sh'), 'utf8');
const fn = src.match(/^limit_cmd=\(\)\nbuild_limits\(\) \{[\s\S]*?\n\}$/m)?.[0];

let n = 0, failed = 0;
const ok = (cond, what) => { n += 1; if (!cond) { failed += 1; console.log(`  FAIL ${what}`); } };

ok(!!fn, 'build_limits() is defined in claude-headless.sh');
ok(/"\$\{limit_cmd\[@\]\}" bash "\$HERE\/claude-headless\.sh" --inner/.test(src), 'the tmux session runs the inner run through the limits');
ok(/nohup "\$\{limit_cmd\[@\]\}" bash -c/.test(src), 'the no-tmux fallback runs through the limits too');

const limits = (env = {}) => {
  const r = spawnSync('bash', ['-c', `set -uo pipefail\nsession=axf-limit-test\n${fn}\nbuild_limits\nprintf '%s\\n' "\${limit_cmd[@]}"`],
    { env: { ...process.env, ...env }, encoding: 'utf8' });
  ok(r.status === 0, `build_limits exits 0 (${r.stderr})`);
  return r.stdout.split('\n').filter(Boolean);
};

if (fn) {
  const on = limits({ AXF_BUILD_LIMITS: 'on', AXF_BUILD_MEM_MAX: '3G' });
  ok(on.join(' ').includes('nice -n 10') && on.join(' ').includes('ionice -c2 -n7'), `sessions run under nice/ionice (${on.join(' ')})`);
  const systemd = process.getuid?.() === 0 && spawnSync('sh', ['-c', 'command -v systemd-run && test -d /run/systemd/system']).status === 0;
  if (systemd) {
    const line = on.join(' ');
    ok(line.startsWith('systemd-run') && line.includes('--slice=axfbuild.slice'), 'as root with systemd: a scope under axfbuild.slice');
    ok(line.includes('MemoryMax=3G') && line.includes('MemorySwapMax=') && line.includes('CPUWeight=20'), 'memory, swap and CPU caps (env overrides apply)');
  } else {
    ok(!on.includes('systemd-run'), 'without root/systemd: no scope, nice/ionice only');
  }
  ok(limits({ AXF_BUILD_LIMITS: 'off' }).length === 0, 'AXF_BUILD_LIMITS=off runs the session unwrapped');
}

console.log(`claude-headless limits: ${n - failed}/${n} checks passed`);
process.exit(failed ? 1 : 0);
