#!/usr/bin/env node
/**
 * gen-sudoers — the sudo whitelist of the host services, built only from the commands the manifests declare
 * (deploy/host-services/services/*.json → `sudo`). Never a general root rule: every line is one absolute program with
 * fixed arguments, run as root by the limited account (axf-host), with no password.
 *
 *   node deploy/host-services/gen-sudoers.mjs                 write deploy/host-services/sudoers.d/axf-host, check it
 *   node deploy/host-services/gen-sudoers.mjs --check         fail when the committed file is not what the manifests give (CI)
 *   node deploy/host-services/gen-sudoers.mjs --only a,b      only these services (+ host-api), printed (the installer's --only)
 *   node deploy/host-services/gen-sudoers.mjs --out FILE      write FILE instead (the installer writes /etc/sudoers.d/axf-host)
 *   node deploy/host-services/gen-sudoers.mjs --print         print to stdout
 *   … --root DIR                                               the checkout when it is not /opt/axf (manifests name /opt/axf)
 *
 * Rules on top of the manifest schema:
 *   - the one wildcard allowed is a unit name `axf-*`: it is expanded to every unit and timer the manifests name, so
 *     `systemctl restart axf-*` becomes one line per named unit (never a pattern in the file);
 *   - any other `*`, the word ALL, a relative program, shell syntax or a program that hands out a shell or writes
 *     arbitrary files (sh, bash, env, node, python, su, sudo, tee, cp, mv, chmod, chown, editors…) is refused;
 *   - the file is checked with `visudo -c -f` when visudo is on the machine (it is on the VPS; CI without it says so).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../../framework/core/host-services.mjs';
import { loadManifests } from './axf-hostd.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const OUT = join(ROOT, 'deploy/host-services/sudoers.d/axf-host');

/** Programs that would turn a whitelist line into a general root rule. */
export const REFUSED_PROGRAMS = new Set(['sh', 'bash', 'dash', 'zsh', 'fish', 'env', 'node', 'nodejs', 'python', 'python3', 'perl', 'ruby', 'php', 'su', 'sudo', 'doas', 'tee', 'cp', 'mv', 'dd', 'chmod', 'chown', 'chgrp', 'ln', 'install', 'rsync', 'vi', 'vim', 'nano', 'less', 'more', 'find', 'xargs', 'awk', 'sed', 'nsenter', 'unshare', 'chroot', 'setpriv', 'runuser', 'crontab', 'visudo', 'passwd', 'useradd', 'usermod', 'mount', 'tar']);

/** The lines for a set of manifests, or throws with every reason a line was refused. */
export function sudoersFor(manifests, { root = '/opt/axf' } = {}) {
  // Cron schedules have no unit; an adopted unit may be started or restarted (its Auto fix) but never stopped from here.
  const withUnit = manifests.filter((m) => !m.cron);
  const units = [...new Set(withUnit.flatMap((m) => [m.unit, ...(m.timer ? [m.timer] : [])]))].sort();
  const adopted = new Set(withUnit.filter((m) => m.adopted).flatMap((m) => [m.unit, ...(m.timer ? [m.timer] : [])]));
  const refused = [];
  const blocks = [];
  for (const m of manifests) {
    if (m.user === 'root') { refused.push(`${m.id}: runs as root`); continue; }
    const lines = [];
    for (const s of m.sudo) {
      const why = `${m.id}: "${s.cmd}"`;
      const prog = s.cmd.split(' ')[0];
      if (!prog.startsWith('/')) { refused.push(`${why} — the program must be an absolute path`); continue; }
      if (prog.includes('*')) { refused.push(`${why} — no wildcard in the program path`); continue; }
      if (REFUSED_PROGRAMS.has(basename(prog))) { refused.push(`${why} — ${basename(prog)} would be a general root rule`); continue; }
      if (/(^|\s)ALL(\s|$)/.test(s.cmd)) { refused.push(`${why} — ALL is never allowed`); continue; }
      if (/[;&|<>`$\\\n"']/.test(s.cmd)) { refused.push(`${why} — shell syntax`); continue; }
      if (s.as !== 'root' && !H.SUDO_AS.includes(s.as)) { refused.push(`${why} — runs as ${s.as}`); continue; }
      const args = s.cmd.split(' ').slice(1);
      const wild = args.filter((a) => a.includes('*'));
      if (wild.some((a) => a !== 'axf-*')) { refused.push(`${why} — the only wildcard is a unit name axf-* (expanded to the named units)`); continue; }
      const stops = args[0] === 'stop';
      const expanded = wild.length ? units.filter((u) => !(stops && adopted.has(u))).map((u) => s.cmd.replace('axf-*', u)) : [s.cmd];
      for (const c of expanded) { const cmd = root === '/opt/axf' ? c : c.split('/opt/axf').join(root); lines.push(`${m.user} ALL=(${s.as}) NOPASSWD: ${cmd}`); }
    }
    if (lines.length) blocks.push({ id: m.id, why: m.sudo.map((s) => s.why), lines: [...new Set(lines)] });
  }
  if (refused.length) throw new Error(`sudoers refused:\n  ${refused.join('\n  ')}`);
  return blocks;
}

export function render(blocks) {
  const out = [
    '# /etc/sudoers.d/axf-host — the host services\' sudo whitelist (host-service@1, framework/spec/HOST-SERVICES.md).',
    '# GENERATED by deploy/host-services/gen-sudoers.mjs from the `sudo` lists in deploy/host-services/services/*.json.',
    '# Do not edit: change the manifest and re-run the generator. One absolute program with fixed arguments per line;',
    '# the only wildcard a manifest may use (a unit name axf-*) is expanded here to the named units.',
    'Defaults:axf-host !requiretty, env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"',
    '',
  ];
  for (const b of blocks) {
    out.push(`# ${b.id}`);
    out.push(...b.lines);
    out.push('');
  }
  return out.join('\n');
}

/** `visudo -c -f FILE` → { ok, checked, message }. */
export function visudoCheck(file) {
  const bin = ['/usr/sbin/visudo', '/usr/bin/visudo', '/sbin/visudo'].find((p) => existsSync(p));
  if (!bin) return { ok: true, checked: false, message: 'visudo not installed here: syntax not checked (the installer checks it on the VPS)' };
  try { execFileSync(bin, ['-c', '-f', file], { stdio: 'pipe' }); return { ok: true, checked: true, message: 'visudo: parsed OK' }; } catch (e) { return { ok: false, checked: true, message: String(e.stderr || e.stdout || e.message).trim() }; }
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : ''; };
  const { manifests, errors } = loadManifests(ROOT);
  if (errors.length) { console.error(`manifests:\n  ${errors.join('\n  ')}`); process.exit(1); }
  const only = argv.includes('--only') ? new Set(['host-api', ...String(arg('--only') || '').split(',').map((s) => s.trim()).filter(Boolean)]) : null;
  if (only) for (const id of only) if (!manifests.some((m) => m.id === id)) { console.error(`unknown service ${id}`); process.exit(1); }
  let text;
  try { text = render(sudoersFor(manifests.filter((m) => !only || only.has(m.id)), { root: arg('--root') || '/opt/axf' })); } catch (e) { console.error(e.message); process.exit(1); }
  if (argv.includes('--check')) {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('deploy/host-services/sudoers.d/axf-host is stale: run node deploy/host-services/gen-sudoers.mjs'); process.exit(1); }
    const v = visudoCheck(OUT);
    if (!v.ok) { console.error(v.message); process.exit(1); }
    console.log(`✓ sudoers: ${text.split('\n').filter((l) => l.startsWith('axf-host ')).length} lines, current (${v.message})`);
    return;
  }
  if (argv.includes('--print')) { process.stdout.write(text); return; }
  const out = arg('--out') || OUT;
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.new`;
  writeFileSync(tmp, text);
  chmodSync(tmp, 0o440);
  const v = visudoCheck(tmp);
  if (!v.ok) { console.error(`visudo refused ${tmp}:\n${v.message}`); process.exit(1); }
  execFileSync('mv', ['-f', tmp, out]);
  console.log(`wrote ${out} (${v.message})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
