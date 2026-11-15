#!/usr/bin/env node
/**
 * Auto-lander control (build auto-lander-controls-in-the-gate-plugin, Brett Nov 15 2026). The one implementation behind
 * the console's Auto-lander tab, the REST routes (capability auto-lander@1), MCP plugin commands, `axf lander …` and
 * voice. Rules: auto-lander-core.mjs. Data: the push banner's data folder (land.mjs settings().dataDir):
 *   config.json                 autoLander { enabled, mode } (next to the queue's own keys)
 *   auto-lander-runs.jsonl      one auto-lander-run@1 per cron run, append-only, trimmed to the last RUNS_KEEP
 *   auto-lander-status.json     the last run + the settings (auto-lander-status@1)
 * The landing line is the merge queue's line (merge-queue.json + merge-queue-control.json); its actions are the queue's
 * own commands (merge-queue.mjs queueControl), so a move or a skip here is the same as one in the push banner.
 *
 *   node …/land/auto-lander.mjs status | line | runs [--limit n] [--json]
 *   … on | off | mode <serial|merge-queue>
 *   … move-up | move-down | land-now <pr> | skip <pr> --why "…" | unskip <pr>
 *   land-now also starts a run at once under the cron's lock (/run/axf-auto-land.lock); a held lock = reason `locked`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './auto-lander-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }

export const LOCK = process.env.AXF_LAND_LOCK || '/run/axf-auto-land.lock';
export const configFile = (s) => join(s.dataDir, 'config.json');
export const runsFile = (s) => join(s.dataDir, 'auto-lander-runs.jsonl');
export const statusFile = (s) => join(s.dataDir, 'auto-lander-status.json');
/** The console's Auto fix asks the host for the cron line back by writing this; the host doctor runs cron-heal. */
export const healFile = (s) => join(s.dataDir, 'auto-lander-cron-heal.json');

export const readConfigDoc = (s) => readJson(configFile(s), {}) || {};
export const readLanderOf = (s) => A.readLander(readConfigDoc(s));

/** Write one setting (enabled | mode). The cron reads it at the start of its next run. */
export function setSetting(s, key, value) {
  const c = A.setLander(readConfigDoc(s), key, value);
  // one switch: the queue's own on/off follows it, so the push banner's settings show the same thing
  if (key === 'enabled') c.mergeQueue = value;
  writeJson(configFile(s), { $axf: 'push-banner-config@1', ...c });
  const st = status(s);
  writeJson(statusFile(s), st);
  return st;
}

export function readRuns(s, limit = 50) {
  let text = ''; try { text = readFileSync(runsFile(s), 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* a torn line */ } }
  return out.slice(-Math.max(1, limit));
}

/** Append a run record; the log is rewritten to the last `keep` once it holds twice that. */
export function recordRun(s, rec, keep = A.RUNS_KEEP) {
  mkdirSync(s.dataDir, { recursive: true });
  appendFileSync(runsFile(s), `${JSON.stringify(rec)}\n`);
  const all = readRuns(s, keep * 2 + 1);
  if (all.length > keep * 2) { const t = `${runsFile(s)}.tmp-${process.pid}`; writeFileSync(t, all.slice(-keep).map((r) => JSON.stringify(r)).join('\n') + '\n'); renameSync(t, runsFile(s)); }
  const st = status(s, rec);
  writeJson(statusFile(s), st);
  return st;
}

const queueOf = (s) => readJson(join(s.dataDir, 'merge-queue.json'), {}) || {};
const queueCtlOf = (s) => readJson(join(s.dataDir, 'merge-queue-control.json'), {}) || {};
export const lineOf = (s) => A.line(queueOf(s), queueCtlOf(s));

export function status(s, last) {
  const runs = readRuns(s, 20);
  return A.statusOf({ lander: readLanderOf(s), last: last || runs[runs.length - 1] || null, runs, line: lineOf(s).filter((r) => !r.skipped) });
}

/**
 * A line action through the merge queue's own command (merge-queue.mjs queueControl, imported lazily so this file
 * stays cheap for status reads). `confirm` must be true for skip and land-now.
 */
export async function act(s, action, pr, { why = '', confirm = false, runNow = startRun } = {}) {
  const spec = A.LINE_ACTIONS[action];
  if (!spec) throw new Error(`unknown action ${action}`);
  if (spec.confirm && !confirm) throw new Error(`${action} needs confirm`);
  const c = A.lineAction(lineOf(s), action, pr, { why });
  const { queueControl } = await import('./merge-queue.mjs');
  queueControl(s, c.cmd, c.pr, { why: c.why || '', to: c.to ?? 0 });
  const started = action === 'land-now' ? runNow(s) : null;
  return { ok: true, action, pr: c.pr, ...(started ? { run: started } : {}), line: lineOf(s), status: status(s) };
}

/**
 * Start one run now under the cron's lock (detached; the cron line's own command). A held lock is not an error: the
 * running round picks the new order up; it is recorded as a `locked` run.
 */
export function startRun(s) {
  const at = new Date().toISOString();
  const probe = spawnSync('flock', ['-n', LOCK, 'true'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    const rec = A.runRecord({ startedAt: at, finishedAt: at, mode: readLanderOf(s).mode, enabled: readLanderOf(s).enabled, locked: true });
    recordRun(s, rec);
    return { started: false, reason: 'locked' };
  }
  const child = spawn('flock', ['-n', LOCK, 'timeout', '900', process.execPath, join(HERE, 'land.mjs'), 'run'], { cwd: s.repo, detached: true, stdio: 'ignore', env: { ...process.env, AXF_LAND_REPO: s.repo } });
  child.unref();
  return { started: true, at };
}

/**
 * Host side (root; deploy/console-doctor.sh runs it every 15 minutes): put /etc/cron.d/axf-auto-land back when it is
 * missing or the console asked for it (healFile). Returns { present, healed }.
 */
export function cronHeal(s, { cronDir = '/etc/cron.d', dir = s.repo } = {}) {
  const f = join(cronDir, A.CRON_NAME);
  const asked = existsSync(healFile(s));
  let present = existsSync(f); let healed = false;
  if (!present || asked) {
    writeFileSync(f, `# installed by auto-lander.mjs cron-heal (deploy/install-console.sh writes the same line)\n${A.cronLine(dir)}\n`, { mode: 0o644 });
    present = true; healed = true;
  }
  if (asked) rmSync(healFile(s), { force: true });
  return { present, healed };
}

// ------------------------------------------------------------------ CLI

const say = {
  status: (st) => `auto-lander ${st.enabled ? 'on' : 'off'} · ${st.mode}${st.lastRunAt ? ` · last run ${st.lastRunAt} ${st.result}` : ' · no run yet'}${st.landing ? ` · landing #${st.landing.pr} ${st.landing.title}` : ''}${st.reason ? ` · ${st.reasonText}` : ''} · ${st.inLine} in line`,
  row: (r) => `${r.skipped ? 'skipped ' : String(r.position).padEnd(8)} #${r.pr} ${r.state.padEnd(8)} ci ${r.ci.padEnd(8)} ${r.build || r.title}${r.why ? ` · ${r.why}` : ''}`,
  run: (r) => `${r.finishedAt || r.startedAt} ${r.result.padEnd(8)} ${r.mode}${r.landing ? ` #${r.landing.pr}` : ''}${r.merged?.length ? ` landed ${r.merged.map((n) => `#${n}`).join(', ')}` : ''}${r.reason ? ` · ${r.reason}` : ''}`,
};

export async function main(argv, { s } = {}) {
  const json = argv.includes('--json'); const confirm = argv.includes('--confirm') || argv.includes('--yes');
  const args = argv.filter((a) => !['--json', '--confirm', '--yes'].includes(a));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] || '' : ''; };
  const [cmd = 'status', ...rest] = args;
  if (!s) s = (await import('./land.mjs')).settings();
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'status') { const st = status(s); return print(st, say.status(st)); }
  if (cmd === 'line') { const rows = lineOf(s); return print({ line: rows }, rows.map(say.row).join('\n') || 'the landing line is empty'); }
  if (cmd === 'runs') { const runs = readRuns(s, Number(opt('limit')) || 20); return print({ runs }, runs.map(say.run).join('\n') || 'no runs yet'); }
  if (cmd === 'on' || cmd === 'off') { const st = setSetting(s, 'enabled', cmd === 'on'); return print(st, say.status(st)); }
  if (cmd === 'enabled') { const v = rest[0]; if (!['true', 'false', 'on', 'off'].includes(v)) throw new Error('enabled true|false'); const st = setSetting(s, 'enabled', v === 'true' || v === 'on'); return print(st, say.status(st)); }
  if (cmd === 'cron-heal') { const r = cronHeal(s); return print(r, r.healed ? `reinstalled /etc/cron.d/${A.CRON_NAME}` : `/etc/cron.d/${A.CRON_NAME} is in place`); }
  if (cmd === 'mode') { const st = setSetting(s, 'mode', rest[0]); return print(st, say.status(st)); }
  if (cmd === 'move') { const d = (rest[1] || 'up').toLowerCase(); if (!['up', 'down'].includes(d)) throw new Error('move <pr> up|down'); return main([`move-${d}`, rest[0], ...(json ? ['--json'] : [])], { s }); }
  if (A.LINE_ACTIONS[cmd]) {
    const r = await act(s, cmd, rest[0], { why: opt('why'), confirm: confirm || !A.LINE_ACTIONS[cmd].confirm });
    return print(r, `${cmd} #${r.pr}${r.run ? (r.run.started ? ' · run started' : ` · run not started (${r.run.reason})`) : ''}`);
  }
  throw new Error('usage: axf lander status | line | runs [--limit n] | on | off | mode <serial|merge-queue> | move <pr> up|down | move-up|move-down|unskip <pr> | skip <pr> --why "…" --confirm | land-now <pr> --confirm [--json]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
