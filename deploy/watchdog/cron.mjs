#!/usr/bin/env node
/**
 * Pipeline 2.0 schedules (pipeline-watchdog@2), one source for every line. deploy/install-console.sh runs `install`.
 *
 *   /etc/cron.d/axf-orchestrator-tick   every minute   layer 1: the orchestrator tick (replaces the old axf-pipeline tick)
 *   /etc/cron.d/axf-watchdog-l2         every minute   layer 2: deploy/watchdog/layer2.mjs run
 *   /etc/cron.d/axf-watchdog-audits     :17 and :47    the store audits, nice 19 (deploy/watchdog/audits.mjs run)
 *   axf-watchdog-l3.timer (systemd)     every 2 min    layer 3: deploy/watchdog/layer3.mjs run. systemd, not cron, so a
 *                                                     dead cron daemon is caught (layer 3 restarts it). No systemd: a
 *                                                     cron line instead.
 * Retired, removed on every install so a deploy never brings them back:
 *   /etc/cron.d/axf-pipeline   the old dispatcher tick (it also fired the build-rules checks that hogged the box)
 *   /etc/cron.d/axf-auto-land  the old push-banner lander (the server auto-lander and the 2.0 lander replace it)
 *   /etc/cron.d/axf-watchdog   the old recovery watchdog (its slot filling ran the old pipeline tick)
 * Each line runs under its own flock and a timeout, and does nothing once its script is gone.
 *
 *   node deploy/watchdog/cron.mjs install [--dir /opt/axf] [--json] · remove · status [--json] · print
 * Tests: AXF_WATCHDOG2_CRON_DIR, AXF_WATCHDOG2_SYSTEMD_DIR, AXF_WATCHDOG2_NO_SYSTEMCTL=1.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './layer2.mjs';

const SELF = fileURLToPath(import.meta.url);
export const ORCH_TICK = 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs';
export const RETIRED = Object.freeze(['axf-pipeline', 'axf-auto-land', 'axf-watchdog']);
export const cronDir = (env = process.env) => env.AXF_WATCHDOG2_CRON_DIR || '/etc/cron.d';
export const systemdDir = (env = process.env) => env.AXF_WATCHDOG2_SYSTEMD_DIR || '/etc/systemd/system';
const hasSystemd = (env) => env.AXF_WATCHDOG2_NO_SYSTEMCTL !== '1' && existsSync('/run/systemd/system');

const line = (dir, { min, lock, timeout, script, args, log, nice = false }) =>
  `${min} root S=${dir}/${script}; [ -f $S ] && cd ${dir} && flock -n /run/${lock}.lock timeout ${timeout} ${nice ? 'nice -n 19 ' : ''}node $S ${args} >> /var/log/${log}.log 2>&1`;

/** name → file text. */
export function cronTexts(dir = REPO, env = process.env) {
  const head = (what) => `# ${what}\n# Written by deploy/watchdog/cron.mjs install (deploy/install-console.sh); edit that file, not this one.\n`;
  const out = {
    'axf-orchestrator-tick': `${head('Pipeline 2.0 layer 1: the orchestrator tick, every minute.')}${line(dir, { min: '* * * * *', lock: 'axf-orchestrator-tick', timeout: 600, script: ORCH_TICK, args: 'tick', log: 'axf-orchestrator-tick' })}\n`,
    'axf-watchdog-l2': `${head('Pipeline 2.0 layer 2: the watchdog pass, every minute (stuck statuses, dead sessions, usage limits).')}${line(dir, { min: '* * * * *', lock: 'axf-watchdog-l2', timeout: 300, script: 'deploy/watchdog/layer2.mjs', args: 'run', log: 'axf-watchdog-l2' })}\n`,
    'axf-watchdog-audits': `${head('Pipeline 2.0 store audits: verify, model-gate audit, build-origin; one at a time, low priority, main checkout only.')}${line(dir, { min: '17,47 * * * *', lock: 'axf-watchdog-audits', timeout: 2400, script: 'deploy/watchdog/audits.mjs', args: 'run', log: 'axf-watchdog-audits', nice: true })}\n`,
  };
  if (!hasSystemd(env)) out['axf-watchdog-l3'] = `${head('Pipeline 2.0 layer 3 (no systemd here): checks layers 1 and 2 are alive and restarts them.')}${line(dir, { min: '*/2 * * * *', lock: 'axf-watchdog-l3', timeout: 300, script: 'deploy/watchdog/layer3.mjs', args: 'run', log: 'axf-watchdog-l3' })}\n`;
  return out;
}

export function systemdTexts(dir = REPO) {
  return {
    'axf-watchdog-l3.service': `# Pipeline 2.0 layer 3: checks the orchestrator tick and the layer-2 watchdog are alive, restarts them, alerts only
# when it cannot heal. Written by deploy/watchdog/cron.mjs install.
[Unit]
Description=AXF watchdog layer 3: keep the pipeline tick and the watchdog alive

[Service]
Type=oneshot
WorkingDirectory=${dir}
Environment=AXF_ACTOR=watchdog
ExecStart=/usr/bin/env node ${dir}/deploy/watchdog/layer3.mjs run
StandardOutput=append:/var/log/axf-watchdog-l3.log
StandardError=append:/var/log/axf-watchdog-l3.log
TimeoutStartSec=5min
Nice=5
`,
    'axf-watchdog-l3.timer': `# Runs axf-watchdog-l3.service every 2 minutes. Written by deploy/watchdog/cron.mjs install.
[Unit]
Description=AXF watchdog layer 3, every 2 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
`,
  };
}

const systemctl = (...a) => spawnSync('systemctl', a, { encoding: 'utf8', timeout: 30000 });

export function install({ dir = REPO, env = process.env } = {}) {
  const cd = cronDir(env); mkdirSync(cd, { recursive: true });
  const done = { written: [], removed: [], systemd: false };
  for (const [name, text] of Object.entries(cronTexts(dir, env))) {
    const f = join(cd, name);
    let cur = ''; try { cur = readFileSync(f, 'utf8'); } catch { /* new */ }
    if (cur !== text) { writeFileSync(f, text, { mode: 0o644 }); done.written.push(name); }
  }
  for (const name of RETIRED) { const f = join(cd, name); if (existsSync(f)) { rmSync(f, { force: true }); done.removed.push(name); } }
  if (hasSystemd(env)) {
    const sd = systemdDir(env); mkdirSync(sd, { recursive: true });
    let changed = false;
    for (const [name, text] of Object.entries(systemdTexts(dir))) {
      const f = join(sd, name); let cur = ''; try { cur = readFileSync(f, 'utf8'); } catch { /* new */ }
      if (cur !== text) { writeFileSync(f, text); changed = true; done.written.push(name); }
    }
    if (changed) systemctl('daemon-reload');
    systemctl('enable', '--now', 'axf-watchdog-l3.timer');
    rmSync(join(cd, 'axf-watchdog-l3'), { force: true });
    done.systemd = true;
  }
  return done;
}

export function remove({ env = process.env } = {}) {
  const removed = [];
  for (const name of [...Object.keys(cronTexts(REPO, { ...env, AXF_WATCHDOG2_NO_SYSTEMCTL: '1' }))]) { const f = join(cronDir(env), name); if (existsSync(f)) { rmSync(f); removed.push(name); } }
  if (hasSystemd(env)) { systemctl('disable', '--now', 'axf-watchdog-l3.timer'); for (const n of Object.keys(systemdTexts())) rmSync(join(systemdDir(env), n), { force: true }); systemctl('daemon-reload'); }
  return removed;
}

/** What is installed: each wanted file present and current, each retired one gone. */
export function status({ dir = REPO, env = process.env } = {}) {
  const want = cronTexts(dir, env);
  const files = Object.fromEntries(Object.entries(want).map(([n, t]) => { let cur = null; try { cur = readFileSync(join(cronDir(env), n), 'utf8'); } catch { /* missing */ } return [n, cur == null ? 'missing' : cur === t ? 'ok' : 'differs']; }));
  const retired = RETIRED.filter((n) => existsSync(join(cronDir(env), n)));
  let timer = 'n/a';
  if (hasSystemd(env)) timer = String(systemctl('is-active', 'axf-watchdog-l3.timer').stdout || '').trim() || 'unknown';
  return { files, retiredPresent: retired, l3Timer: timer, ok: Object.values(files).every((v) => v === 'ok') && !retired.length && (timer === 'n/a' || timer === 'active') };
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0] || 'status'; const json = argv.includes('--json');
  const di = argv.indexOf('--dir'); const dir = di >= 0 ? resolve(argv[di + 1]) : REPO;
  const out = (v, t) => console.log(json ? JSON.stringify(v, null, 1) : t);
  if (cmd === 'install') { const r = install({ dir }); return out(r, `watchdog schedules: ${r.written.length ? `wrote ${r.written.join(', ')}` : 'up to date'}${r.removed.length ? `; removed retired ${r.removed.join(', ')}` : ''}${r.systemd ? '; layer 3 on the systemd timer' : '; layer 3 on cron'}`); }
  if (cmd === 'remove') { const r = remove(); return out(r, `removed ${r.join(', ') || 'nothing'}`); }
  if (cmd === 'print') return console.log(Object.entries({ ...cronTexts(dir), ...systemdTexts(dir) }).map(([n, t]) => `== ${n}\n${t}`).join('\n'));
  if (cmd === 'status') { const s = status({ dir }); if (!s.ok) process.exitCode = 1; return out(s, `${Object.entries(s.files).map(([n, v]) => `${n}: ${v}`).join('\n')}\nlayer 3 timer: ${s.l3Timer}${s.retiredPresent.length ? `\nretired still present: ${s.retiredPresent.join(', ')}` : ''}`); }
  console.error('usage: cron.mjs install [--dir d]|remove|status|print [--json]'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((e) => { console.error(`watchdog cron: ${e.message || e}`); process.exitCode = 1; });
