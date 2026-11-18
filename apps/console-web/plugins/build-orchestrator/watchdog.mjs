#!/usr/bin/env node
/**
 * Stale-row watchdog (stale-row@1). Brett, Nov 16 2026: "I want a server fucking watchdog on the VPS to do that."
 * Rows that should have left a list stay on it: a build still Queued after its PR merged, a merge-queue entry whose PR
 * landed by a direct merge commit, a UI Review item for a PR that shipped. This runs on the VPS (cron
 * axf-stale-watchdog, every 5 minutes) and cleans them.
 *
 * One run:
 *   1 read every table that is on (watchdog/tables/*: builds store Pending / Queue / Building, the merge queue,
 *     UI Review; the last two through the plugin that provides their capability)
 *   2 gather the facts once for all of them (framework/cli/stale-facts.mjs: origin/main, branch heads, GitHub PR
 *     states through an ETag cache, live sessions)
 *   3 classify every row (framework/core/stale-rows.mjs: keep | complete | remove, with a reason and evidence)
 *   4 unless dry: apply each change in its table, log it, tell AmberX once
 *
 *   node apps/console-web/plugins/build-orchestrator/watchdog.mjs run [--dry-run] [--force] [--cron] [--json] [--by who]
 *        (--cron: the scheduled run; skips when the last run is younger than intervalMin)
 *   … cron install|uninstall|status      the VPS schedule (/etc/cron.d/axf-stale-watchdog)
 *   … status [--json]                    settings, last run, last runs
 *   … log [--limit N] [--kind K] [--action A] [--build B] [--json]   the cleanup log (stale-row-log@1 records)
 *   … settings [--json]                  every setting with its value
 *   … set <key> <value>                  change one setting (enabled, intervalMin, dryRun, tables.<id>, notify)
 *
 * Data (plugin dataDir .axf-console/plugins/build-orchestrator/watchdog/ under AXF_CONSOLE_ROOT, else this checkout;
 * AXF_WATCHDOG_DIR overrides): settings.json, state.json (last run), runs.jsonl (every run), log.jsonl
 * (the cleanup log; log-YYYY-MM.jsonl after the month turns), github-etags.json (the facts gatherer's cache), run.lock.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as stale from '../../../../framework/core/stale-rows.mjs';
import { gatherFacts, factsForRow } from '../../../../framework/cli/stale-facts.mjs';
import * as builds from './watchdog/tables/builds.mjs';
import * as mergeQueue from './watchdog/tables/merge-queue.mjs';
import * as uiReview from './watchdog/tables/ui-review.mjs';
import { REPO, consoleRoot } from './watchdog/providers.mjs';

export const FRAME = 'watchdog-run@1';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const TABLES = Object.freeze([builds, mergeQueue, uiReview]);
export const SCHEMA = JSON.parse(readFileSync(join(HERE, 'watchdog', 'settings.json'), 'utf8'));
export const SETTINGS = SCHEMA.settings;
export const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default])));
const LOCK_STALE_MS = 20 * 60 * 1000;
const RUNS_KEPT = 200;

export const dataDir = () => process.env.AXF_WATCHDOG_DIR || join(consoleRoot(), '.axf-console', 'plugins', 'build-orchestrator', 'watchdog');
const file = (n) => join(dataDir(), n);
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }
const readLines = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

// ------------------------------------------------------------------ settings

/** A value for one setting, checked against the schema; throws a plain message when it doesn't fit. */
export function coerce(key, value) {
  const s = SETTINGS[key]; if (!s) throw new Error(`no watchdog setting "${key}" (${Object.keys(SETTINGS).join(', ')})`);
  if (s.type === 'boolean') {
    if (value === true || value === false) return value;
    const v = String(value).toLowerCase();
    if (['on', 'true', '1', 'yes'].includes(v)) return true;
    if (['off', 'false', '0', 'no'].includes(v)) return false;
    throw new Error(`${key} is on or off`);
  }
  if (s.type === 'integer') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < s.min || n > s.max) throw new Error(`${key} is a whole number from ${s.min} to ${s.max}`);
    return n;
  }
  return value;
}
export function readSettings() {
  const raw = readJson(file('settings.json'), {}) ?? {};
  const out = { ...DEFAULTS };
  for (const k of Object.keys(SETTINGS)) if (raw[k] !== undefined) { try { out[k] = coerce(k, raw[k]); } catch { /* bad value: default */ } }
  return out;
}
/** Change settings (only known keys, each checked). Returns the new settings. */
export function writeSettings(patch, { by = 'cli' } = {}) {
  const cur = readSettings();
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch ?? {})) next[k] = coerce(k, v);
  writeJson(file('settings.json'), { $axf: 'watchdog-settings@1', ...next, updatedAt: new Date().toISOString(), updatedBy: String(by).slice(0, 80) });
  return next;
}
export const tableOn = (settings, id) => settings[`tables.${id}`] !== false;

// ------------------------------------------------------------------ plan

/**
 * Read, gather, classify. Returns { at, tables: [{ id, label, on, available, rows, why? }], verdicts: [{ table, row,
 * action, reason, evidence, line }], changes (the non-keep verdicts), keep, facts: { github, errors } }.
 * opts.read / opts.facts override the reads (tests): read = { <table id>: read options }, facts = a gathered map.
 */
export async function plan(opts = {}) {
  const settings = opts.settings ?? readSettings();
  const tables = [];
  for (const t of TABLES) {
    const on = tableOn(settings, t.TABLE.id);
    if (!on) { tables.push({ id: t.TABLE.id, label: t.TABLE.label, on, available: true, rows: [] }); continue; }
    try {
      const r = await t.read(opts.read?.[t.TABLE.id] ?? {});
      tables.push({ id: t.TABLE.id, label: t.TABLE.label, on, available: r.available !== false, why: r.why, rows: r.rows, wantPrs: r.wantPrs ?? [], builds: r.builds });
    } catch (e) { tables.push({ id: t.TABLE.id, label: t.TABLE.label, on, available: false, why: String(e.message).slice(0, 300), rows: [] }); }
  }
  const storeBuilds = tables.find((t) => t.id === 'builds')?.builds ?? opts.builds ?? (await builds.read(opts.read?.builds ?? {}).catch(() => ({ builds: [] }))).builds;
  const facts = opts.facts ?? await gatherFacts({
    fetch: opts.fetch !== false, github: opts.github !== false,
    wantPrs: tables.flatMap((t) => t.wantPrs ?? []), builds: storeBuilds,
  });
  const verdicts = [];
  for (const t of tables) {
    for (const row of t.rows) {
      const f = factsForRow(row, facts);
      const v = stale.classify(row, f);
      verdicts.push({ table: t.id, row, action: v.action, reason: v.reason, evidence: v.evidence, line: stale.describe(row, v), prState: f.pr?.state ?? null, mergedAt: f.pr?.mergedAt ?? '', mergeCommit: f.pr?.mergeCommit ?? '', prUrl: f.pr?.url ?? '' });
    }
    delete t.builds; delete t.wantPrs;
  }
  const changes = verdicts.filter((v) => v.action !== 'keep');
  return {
    $axf: FRAME, at: new Date().toISOString(),
    tables: tables.map((t) => ({ id: t.id, label: t.label, on: t.on, available: t.available, ...(t.why ? { why: t.why } : {}), rows: t.rows.length })),
    verdicts, changes, keep: verdicts.length - changes.length,
    facts: { github: facts.github ?? null, errors: facts.errors ?? [], main: facts.main?.head ?? '' },
  };
}

// ------------------------------------------------------------------ run

/** One run at a time on this machine: a lock file in the data folder (a run older than 20 min is taken as dead). */
export function takeLock() {
  const l = file('run.lock'); mkdirSync(dirname(l), { recursive: true });
  try { closeSync(openSync(l, 'wx')); writeFileSync(l, `${process.pid} ${new Date().toISOString()}\n`); return () => rmSync(l, { force: true }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - statSync(l).mtimeMs > LOCK_STALE_MS) { rmSync(l, { force: true }); return takeLock(); } } catch { /* gone */ }
    return null;
  }
}

/** Apply the plan's changes (each table's own apply). Filled by the apply step; returns [{ ...verdict, applied, why }]. */
export async function applyChanges(p, ctx) {
  const out = [];
  for (const t of TABLES) {
    const mine = p.changes.filter((v) => v.table === t.TABLE.id);
    if (!mine.length) continue;
    if (typeof t.apply !== 'function') { out.push(...mine.map((v) => ({ ...v, applied: false, why: 'this table has no apply yet' }))); continue; }
    try { out.push(...await t.apply(mine, ctx)); }
    catch (e) { out.push(...mine.map((v) => ({ ...v, applied: false, why: String(e.message).slice(0, 300) }))); }
  }
  return out;
}

/**
 * One run: plan, and unless dry (the flag or the dryRun setting) apply, log and notify. Returns the run record
 * (watchdog-run@1) that state.json and runs.jsonl keep. `force` runs even when the watchdog is off.
 */
export async function run(opts = {}) {
  const settings = readSettings();
  const by = String(opts.by ?? 'watchdog').slice(0, 80);
  const dry = !!opts.dry || settings.dryRun;
  const started = Date.now();
  if (!settings.enabled && !opts.force) return { $axf: FRAME, at: new Date().toISOString(), skipped: 'the watchdog is off', ok: true, dry };
  if (opts.cron && !opts.force) {
    // cron fires every 5 minutes; a longer interval setting makes most of those ticks skip
    const last = Date.parse(readJson(file('state.json'), {})?.last?.at ?? '');
    if (Number.isFinite(last) && Date.now() - last < settings.intervalMin * 60000 - 30000) return { $axf: FRAME, at: new Date().toISOString(), skipped: 'not due yet', ok: true, dry };
  }
  const unlock = takeLock();
  if (!unlock) return { $axf: FRAME, at: new Date().toISOString(), skipped: 'another run is still going', ok: true, dry };
  const rec = { $axf: FRAME, at: new Date().toISOString(), by, dry, ok: false };
  try {
    const p = await plan({ ...opts, settings });
    Object.assign(rec, { tables: p.tables, rows: p.verdicts.length, keep: p.keep, planned: p.changes.length, facts: p.facts });
    const applied = dry ? p.changes.map((v) => ({ ...v, applied: false, why: 'dry run' })) : await applyChanges(p, { by, at: rec.at, ...(opts.applyCtx ?? {}) });
    rec.changes = applied.map((v) => ({ table: v.table, kind: v.row.kind, id: v.row.id, build: v.row.build, pr: v.row.pr, action: v.action, reason: v.reason, applied: !!v.applied, why: v.why ?? '', line: v.line }));
    rec.cleaned = applied.filter((v) => v.applied).length;
    if (!dry && rec.cleaned) {
      // the cleanup log, build notes, one Codebase changes line: none of them may fail the run
      const log = await import('./watchdog/log.mjs');
      rec.logged = log.appendLog(dataDir(), log.recordsOf(applied, { at: rec.at, by }), rec.at);
      try { rec.noted = await log.noteBuilds(applied, { by }); } catch (e) { rec.warnings = [...(rec.warnings ?? []), `build notes: ${String(e.message).slice(0, 200)}`]; }
      try { const c = log.changesLine(rec); if (c.id) rec.changesEntry = c.id; } catch (e) { rec.warnings = [...(rec.warnings ?? []), `codebase changes: ${String(e.message).slice(0, 200)}`]; }
      try { const n = await (await import('./watchdog/notify.mjs')).notifyRun(rec, { enabled: settings.notify, post: opts.post }); rec.notified = n.sent; } catch (e) { rec.warnings = [...(rec.warnings ?? []), `notify: ${String(e.message).slice(0, 200)}`]; }
    }
    rec.ok = true;
    if (opts.afterApply) await opts.afterApply(rec, applied, p);
    return rec;
  } catch (e) {
    rec.error = String(e?.message ?? e).slice(0, 500);
    return rec;
  } finally {
    rec.durationMs = Date.now() - started;
    if (!rec.skipped) saveRun(rec);
    unlock();
  }
}

export function saveRun(rec) {
  writeJson(file('state.json'), { $axf: 'watchdog-state@1', last: rec, lastOk: rec.ok ? rec.at : readJson(file('state.json'), {})?.lastOk ?? '' });
  const f = file('runs.jsonl'); mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, `${JSON.stringify(rec)}\n`);
  const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
  if (lines.length > RUNS_KEPT * 2) writeFileSync(f, `${lines.slice(-RUNS_KEPT).join('\n')}\n`);
}

export const lastRuns = (n = 20) => readLines(file('runs.jsonl')).slice(-n).reverse();

/** Settings, the last run and the last runs: the status the console card, REST, MCP, CLI and voice all show. */
export function status({ runs = 10 } = {}) {
  const st = readJson(file('state.json'), {}) ?? {};
  return { $axf: 'watchdog-status@1', dataDir: dataDir(), settings: readSettings(), schema: SETTINGS, last: st.last ?? null, lastOk: st.lastOk ?? '', running: existsSync(file('run.lock')), runs: lastRuns(runs) };
}

// ------------------------------------------------------------------ CLI

function printRun(r) {
  if (r.skipped) return console.log(`watchdog: skipped (${r.skipped})`);
  if (!r.ok) return console.log(`watchdog: failed: ${r.error}`);
  console.log(`watchdog ${r.dry ? 'dry run' : 'run'} ${r.at} · ${r.rows} rows · ${r.planned} to change · ${r.cleaned} cleaned · ${r.durationMs} ms`);
  for (const t of r.tables ?? []) console.log(`  ${t.on ? (t.available ? '✓' : '!') : '–'} ${t.label}: ${t.on ? `${t.rows} rows` : 'off'}${t.why ? ` (${t.why})` : ''}`);
  if (r.facts?.github) console.log(`  GitHub: ${r.facts.github.requests} requests, ${r.facts.github.notModified} not modified`);
  for (const e of r.facts?.errors ?? []) console.log(`  ! ${e}`);
  for (const c of r.changes ?? []) console.log(`  ${c.applied ? '✓' : r.dry ? '·' : '✗'} ${c.line}${!c.applied && !r.dry && c.why ? ` [${c.why}]` : ''}`);
}

export async function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--by', '--limit', '--kind', '--action', '--build'].includes(argv[i - 1]));
  const [cmd = 'status', ...rest] = pos;
  const out = (o, print) => (json ? console.log(JSON.stringify(o, null, 1)) : print(o));
  if (cmd === 'run' || cmd === 'dry-run') {
    const r = await run({ dry: cmd === 'dry-run' || argv.includes('--dry-run'), force: argv.includes('--force'), cron: argv.includes('--cron'), by: opt('by') ?? 'cli' });
    out(r, printRun); if (!r.ok) process.exitCode = 1; return r;
  }
  if (cmd === 'cron') {
    const cron = await import('./watchdog/cron.mjs');
    const sub = rest[0] ?? 'status';
    const r = sub === 'install' ? cron.install({ force: argv.includes('--force') }) : sub === 'uninstall' ? cron.uninstall() : cron.status();
    return out(r, (o) => console.log(JSON.stringify(o)));
  }
  if (cmd === 'status') {
    return out(status(), (s) => {
      console.log(`watchdog ${s.settings.enabled ? 'on' : 'off'} · every ${s.settings.intervalMin} min${s.settings.dryRun ? ' · dry run only' : ''}${s.running ? ' · running now' : ''}`);
      if (s.last) printRun(s.last); else console.log('no run yet');
    });
  }
  if (cmd === 'settings') return out(readSettings(), (s) => { for (const [k, v] of Object.entries(s)) console.log(`${k.padEnd(20)} ${v}   ${SETTINGS[k].title}`); });
  if (cmd === 'set') {
    const [k, v] = rest; if (!k || v === undefined) throw new Error('usage: set <key> <value>');
    return out(writeSettings({ [k]: v }, { by: opt('by') ?? 'cli' }), (s) => console.log(`${k} = ${s[k]}`));
  }
  if (cmd === 'log') {
    const { readLog } = await import('./watchdog/log.mjs');
    const recs = readLog({ dir: dataDir(), limit: Number(opt('limit')) || 50, kind: opt('kind') ?? '', action: opt('action') ?? '', build: opt('build') ?? '' });
    return out({ records: recs }, (o) => { if (!o.records.length) console.log('the cleanup log is empty'); for (const r of o.records) console.log(`${r.at} ${r.dry ? '(dry) ' : ''}${stale.describe({ kind: r.kind, id: r.rowId }, r)}`); });
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 26).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`watchdog: ${e.message}`); process.exit(2); });
}
