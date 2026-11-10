#!/usr/bin/env node
/**
 * Nightly console deploy (Brett, Nov 2026: "Schedule a console build and deploy every night at 2 a.m.").
 *
 * /etc/cron.d/axf-console-nightly runs this every minute (cron here has no time zone of its own, and the time is a
 * setting). It does nothing until Brett's clock reaches the set time, then once that night: if code on main changed
 * since the last deploy (`_claude/` status commits don't count) it runs deploy/install-console.sh under the same lock
 * as the 5-minute updater, logs to AXF_NIGHTLY_LOG, and raises a console alert with the result.
 *
 * Settings (Claude settings, Settings → Plugins → Claude): nightly.enabled, nightly.time.
 *
 *   node deploy/console-nightly.mjs run            what cron runs
 *   node deploy/console-nightly.mjs status         the state file and whether tonight's run is due
 *   node deploy/console-nightly.mjs run --dry-run  says what it would do, deploys nothing
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TIME_ZONE = 'America/New_York';
export const DEFAULT_TIME = '02:00';
/** After the set time a missed night still runs (a busy lock, a reboot), but not at breakfast. */
export const WINDOW_MIN = 180;
/** flock's exit code when the updater holds the lock. */
const LOCK_BUSY = 75;

/** Local date + minutes since midnight in the zone. */
export function zoneClock(now, tz = TIME_ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Minutes since midnight for "HH:MM", or the default for anything else. */
export function timeMinutes(v) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof v === 'string' ? v : '') ?? /^(\d\d):(\d\d)$/.exec(DEFAULT_TIME);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Should tonight's run start? Once per local day, inside the window after the set time. */
export function nightlyDue({ now, enabled, time, lastDay, tz = TIME_ZONE }) {
  if (enabled === false) return { due: false, why: 'off in Claude settings (nightly.enabled)' };
  const { day, minutes } = zoneClock(now, tz);
  const at = timeMinutes(time);
  if (lastDay === day) return { due: false, why: `already ran for ${day}`, day };
  if (minutes < at || minutes >= at + WINDOW_MIN) return { due: false, why: `outside the window (${time ?? DEFAULT_TIME} ${tz})`, day };
  return { due: true, why: 'due', day };
}

/** Files that make a rebuild worth it: everything but the live status data. */
export const codeChanged = (files) => files.some((f) => f && !f.startsWith('_claude/') && f !== 'tracker.json' && f !== '.axf-queue.log');

const dir = () => process.env.DIR || join(HERE, '..');
const stateFile = () => process.env.AXF_NIGHTLY_STATE || join(dir(), '.axf-console', 'nightly.json');
const logFile = () => process.env.AXF_NIGHTLY_LOG || '/root/axf-builds/nightly-deploy.log';
const git = (...a) => execFileSync('git', ['-C', dir(), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const readState = () => { try { return JSON.parse(readFileSync(stateFile(), 'utf8')); } catch { return {}; } };
const writeState = (s) => { mkdirSync(dirname(stateFile()), { recursive: true }); writeFileSync(stateFile(), `${JSON.stringify(s, null, 1)}\n`); };

async function settings() {
  // The live values (hub first); a read that fails leaves the defaults, so a broken read never cancels the deploy.
  try {
    const m = await import(pathToFileURL(join(dir(), 'apps/console-web/plugins/claude-settings/core.mjs')).href); // axf-plugin:claude-settings
    const doc = m.readDoc();
    const specs = m.loadRegistry().settings;
    const value = (key) => { const spec = specs.find((x) => x.key === key); return spec ? m.valueOf(spec, doc) : undefined; };
    return { enabled: value('nightly.enabled'), time: value('nightly.time') };
  } catch { return {}; }
}

/** A console alert (the bell + banner), through the running console; never fails the run. */
function alert(ok, title, detail) {
  const body = JSON.stringify({ source: 'nightly-deploy', key: 'nightly-deploy', severity: ok ? 'success' : 'error', title, body: detail });
  const name = process.env.NAME || 'axf-console';
  spawnSync('docker', ['exec', '-i', name, 'sh', '-c', 'curl -s -m 10 -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:7090/api/alerts >/dev/null'], { input: body, timeout: 20_000 });
}

function changedSince(last) {
  git('fetch', '-q', 'origin', 'main');
  const head = git('rev-parse', 'origin/main');
  if (!last) return { head, changed: true };
  return { head, changed: head !== last && codeChanged(git('diff', '--name-only', last, head).split('\n')) };
}

async function run(dry) {
  const st = readState();
  const s = await settings();
  const d = nightlyDue({ now: new Date(), enabled: s.enabled, time: s.time, lastDay: st.lastDay });
  if (!d.due) { if (dry) console.log(`not due: ${d.why}`); return 0; }
  const { head, changed } = changedSince(st.lastSha);
  if (!changed) {
    writeState({ ...st, lastDay: d.day, lastResult: 'skipped', lastRunAt: new Date().toISOString() });
    if (!dry) alert(true, 'Nightly deploy skipped', `Main has no code change since ${String(st.lastSha).slice(0, 8)}.`);
    console.log(`${d.day}: main unchanged since the last deploy, nothing to do`);
    return 0;
  }
  if (dry) { console.log(`would deploy ${head.slice(0, 8)}`); return 0; }
  // The 5-minute updater's lock: a build in progress means this minute passes and the next one tries again.
  const r = spawnSync('flock', ['-n', '-E', String(LOCK_BUSY), '/run/axf-console-update.lock', 'sh', '-c', `bash "${dir()}/deploy/install-console.sh" >> "${logFile()}" 2>&1`], { env: { ...process.env, DIR: dir() }, timeout: 3_600_000 });
  if (r.status === LOCK_BUSY) return 0;
  const ok = r.status === 0;
  writeState({ ...st, lastDay: d.day, lastSha: ok ? head : st.lastSha, lastResult: ok ? 'deployed' : 'failed', lastRunAt: new Date().toISOString() });
  alert(ok, ok ? 'Nightly deploy done' : 'Nightly deploy failed', ok ? `Console rebuilt from ${head.slice(0, 8)}.` : `The installer exited ${r.status}. Log: ${logFile()}`);
  console.log(`${d.day}: ${ok ? 'deployed' : 'FAILED'} ${head.slice(0, 8)}`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2] ?? 'status';
  if (cmd === 'run') process.exit(await run(process.argv.includes('--dry-run')));
  const st = readState();
  const s = await settings();
  console.log(JSON.stringify({ ...st, settings: s, now: nightlyDue({ now: new Date(), enabled: s.enabled, time: s.time, lastDay: st.lastDay }) }, null, 1));
}
