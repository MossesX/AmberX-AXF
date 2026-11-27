/**
 * The watchdog's cleanup log and the notes it leaves.
 *
 *   log.jsonl              every action the watchdog applied (or decided, on a dry run) as one stale-row-log@1 record
 *                          (framework/schemas/stale-row.json), appended, never edited; rotated monthly: when the
 *                          month turns, the file becomes log-YYYY-MM.jsonl and a new log.jsonl starts
 *   build notes            each applied row that names a build gets a note on that build (builds-store, one write)
 *   Codebase changes       one closed entry per run that cleaned something (the plugin providing service:axf.changes@1)
 *
 * AXF_WATCHDOG_CHANGES=off skips the Codebase changes line (tests).
 */
import * as DF from '../../../../../framework/core/data-files.mjs';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import * as stale from '../../../../../framework/core/stale-rows.mjs';
import { consoleRoot, entryOf, providerOf } from './providers.mjs';

export const LOG = 'log.jsonl';
const month = (iso) => String(iso ?? '').slice(0, 7);
// data-store@1: the cleanup log is rows on axf-data (framework/core/data-files.mjs), one per record.
const readLines = (f) => { try { return (DF.readTextSync(f, '') ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/** Rotate log.jsonl to log-<YYYY-MM>.jsonl when its first record is from an earlier month than `now`. */
export function rotate(dir, now = new Date().toISOString()) {
  const f = join(dir, LOG);
  if (!existsSync(f)) return '';
  const first = readFileSync(f, 'utf8').split('\n', 1)[0];
  let m = ''; try { m = month(JSON.parse(first).at); } catch { return ''; }
  if (!m || m >= month(now)) return '';
  let to = join(dir, `log-${m}.jsonl`); let n = 1;
  while (existsSync(to)) to = join(dir, `log-${m}-${++n}.jsonl`);
  renameSync(f, to);
  return to;
}

/** The records for the applied (or, dry, decided) changes of a run; each checked against stale-row-log@1. */
export function recordsOf(results, { at, by = 'watchdog', dry = false } = {}) {
  const out = [];
  for (const v of results) {
    if (!dry && !v.applied) continue;
    const rec = stale.logRecord(v.row, v, { at, by, dry, note: v.why || (v.status ? `status ${v.status}` : '') });
    if (stale.validateRecord(rec).ok) out.push({ ...rec, table: v.table });
  }
  return out;
}

/** Append records to the cleanup log (rotating first). Returns how many were written. */
export function appendLog(dir, records, now = new Date().toISOString()) {
  if (!records.length) return 0;
  rotate(dir, now); // only a log that is still a local file has months to rotate
  for (const r of records) DF.appendJsonlSync(join(dir, LOG), r);
  return records.length;
}

/** The newest records first, across the current file and the monthly archives. filter: { kind, action, build, dry }. */
export function readLog({ dir, limit = 50, kind = '', action = '', build = '' } = {}) {
  const base = dir ?? logDir();
  const files = [LOG, ...DF.listSync(base).filter((f) => /^log-\d{4}-\d{2}(-\d+)?\.jsonl$/.test(f)).sort().reverse()];
  const out = [];
  for (const f of files) {
    const recs = readLines(join(base, f)).reverse();
    for (const r of recs) {
      if ((kind && r.kind !== kind) || (action && r.action !== action) || (build && r.build !== build)) continue;
      out.push(r); if (out.length >= limit) return out;
    }
  }
  return out;
}
/** The watchdog data folder (the same as watchdog.mjs dataDir()). */
export const logDir = () => process.env.AXF_WATCHDOG_DIR || join(consoleRoot(), '.axf-console', 'plugins', 'build-orchestrator', 'watchdog');

/**
 * A note on every build an applied list row points at (merge queue, UI Review; the builds table writes its own notes
 * in its apply). One store write. Returns the build ids noted.
 */
export async function noteBuilds(results, { by = 'watchdog', withStore } = {}) {
  const mine = results.filter((v) => v.applied && v.table !== 'builds' && v.row.build);
  if (!mine.length) return [];
  const ws = withStore ?? (await import('../../../../../framework/cli/builds-store.mjs')).withStore;
  const noted = [];
  ws((s) => {
    const now = new Date().toISOString();
    for (const v of mine) {
      const b = (s.builds ?? []).find((x) => x.id === v.row.build && !x.deleted);
      if (!b) continue;
      b.notes = Array.isArray(b.notes) ? b.notes : [];
      b.notes.push({ text: `Watchdog: ${v.line}`.slice(0, 2000), at: now });
      b.updatedAt = now; noted.push(b.id);
    }
    return s;
  }, { by, action: 'stale-watchdog-note', note: `${mine.length} note(s)` });
  return [...new Set(noted)];
}

/** One Codebase changes entry for a run that cleaned something: opened, given its result and closed (log, not banner). */
export function changesLine(run) {
  if (process.env.AXF_WATCHDOG_CHANGES === 'off' || !run.cleaned) return { skipped: true };
  const cli = entryOf(providerOf('axf.changes@1'), ['changes.mjs']);
  if (!cli) return { skipped: true, why: 'no plugin provides service:axf.changes@1' };
  const lines = (run.changes ?? []).filter((c) => c.applied).map((c) => c.line);
  const title = `Stale-row watchdog cleaned ${run.cleaned} row${run.cleaned === 1 ? '' : 's'}`;
  const call = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000 });
  const o = call(['open', title, '--kind', 'fix', '--asked', 'VPS watchdog run (cron axf-build-watchdog)', '--surface', 'vps', '--json']);
  let id = ''; try { id = JSON.parse(o.stdout).id ?? ''; } catch { id = String(o.stdout ?? '').trim().split('\n').pop() ?? ''; }
  if (!id) return { ok: false, why: String(o.stderr ?? '').slice(0, 200) };
  call(['result', id, '--state', 'done', '--summary', lines.join('\n').slice(0, 4000)]);
  call(['close', id]);
  return { ok: true, id };
}
