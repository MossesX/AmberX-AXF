#!/usr/bin/env node
/**
 * The console server in a sandbox, for the console test suite: the live console's own image (axf-console:latest) runs
 * the real `main:app` of a checkout copy, on an internal Docker network (no route out: no axHub, no phone pushes, no
 * GitHub), as an unprivileged copy that can't touch the live console's data.
 *
 *   node scripts/suite/sandbox.mjs up   --root <checkout copy> [--name axf-suite-before] [--image axf-console:latest]
 *   node scripts/suite/sandbox.mjs down [--name axf-suite-before]
 *   node scripts/suite/sandbox.mjs copy --ref <git ref> --to <dir>     (git archive of the ref + this app's dist/)
 *
 * `up` prints {"url": "http://<container ip>:7090", "name": …} once /api/health answers. The copy must have
 * apps/console-web/dist built (the server serves it at /).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../..');
const NET = 'axf-suite-net';
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();

export function copyRef(ref, to) {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: APP, encoding: 'utf8' }).trim();
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const tar = spawnSync('sh', ['-c', `git -C "${repo}" archive "${ref}" | tar -x -C "${to}"`], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error(`git archive ${ref} failed`);
  const dist = join(APP, 'dist');
  if (existsSync(dist)) cpSync(dist, join(to, 'apps/console-web/dist'), { recursive: true });
}

export async function up({ root, name = 'axf-suite-before', image = 'axf-console:latest', port = 7090 }) {
  root = resolve(root);
  if (!existsSync(join(root, 'apps/console-web/server/main.py'))) throw new Error(`${root} is not a checkout`);
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  if (spawnSync('docker', ['network', 'inspect', NET], { stdio: 'ignore' }).status !== 0) docker('network', 'create', '--internal', NET);
  docker('run', '-d', '--name', name, '--network', NET, '--cpus', '2', '--memory', '3g',
    '-v', `${root}:/axf`, '-v', `${HERE}:/suite:ro`,
    '-e', 'AXF_ROOT=/axf', '-e', 'AXF_STATE=/axf/.axf-console/state.json', '-e', `PORT=${port}`,
    '-e', 'AXF_APPEARANCE_HUB=off', '-e', 'AXF_CONSOLE_DIST=/axf/apps/console-web/dist', '-e', 'PYTHONPATH=/axf/framework/python:/suite',
    '-e', 'AXF_WATCHDOG_HOST=request', '-e', 'DISABLE_AUTOUPDATER=1',
    '--entrypoint', '/usr/bin/tini', image, '--', 'sh', '-c', `cd /axf/apps/console-web/server && exec uvicorn sbx_app:app --host 0.0.0.0 --port ${port} --log-level warning`);
  const ip = docker('inspect', name, '--format', `{{(index .NetworkSettings.Networks "${NET}").IPAddress}}`);
  const url = `http://${ip}:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${url}/api/health`)).status < 500) return { url, name }; } catch { /* starting */ }
    if (docker('inspect', name, '--format', '{{.State.Running}}') !== 'true') break;
    await sleep(1000);
  }
  const logs = spawnSync('docker', ['logs', '--tail', '60', name], { encoding: 'utf8' });
  throw new Error(`the sandbox console did not come up on ${url}\n${logs.stdout}${logs.stderr}`);
}

export function down(name = 'axf-suite-before') { spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (cmd === 'up') console.log(JSON.stringify(await up({ root: opt('root'), name: opt('name', 'axf-suite-before'), image: opt('image', 'axf-console:latest') })));
  else if (cmd === 'down') down(opt('name', 'axf-suite-before'));
  else if (cmd === 'copy') copyRef(opt('ref', 'HEAD'), resolve(opt('to')));
  else { console.error('usage: sandbox.mjs up --root <dir> | down | copy --ref <ref> --to <dir>'); process.exit(2); }
}
