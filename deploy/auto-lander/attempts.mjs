#!/usr/bin/env node
/**
 * attempts — the auto-lander's per-attempt log (auto-lander-attempt@1, framework/spec/AUTO-LANDER.md).
 *
 * One append-only JSONL file per build:
 *
 *   <data>/auto-lander/attempts/<build>.jsonl
 *
 * where <data> is the project's shared data folder on the hub (/projects/amberx-axf/_data, framework/cli/persist.mjs).
 * AXF_AUTO_LANDER_DIR points the whole auto-lander data folder elsewhere (tests, a dry run).
 *
 * An attempt is written twice: once when it starts (result `started`) and once when it ends (same build, kind, n and
 * `at`, the final result). Reading folds the lines by that key, last line wins, so a crash between the two leaves a
 * `started` record that the engine later counts as a `timeout`. Every line is validated against auto-lander@1 before
 * it is written; a bad record is refused (error code `invalid`), never half-written.
 *
 *   node deploy/auto-lander/attempts.mjs list <build> [--kind clash|red-ci|land]   the attempts, oldest first
 *   … count <build>                                                                 per kind: attempts, ok, failures …
 *   … builds                                                                        every build with a log
 *   … dir                                                                           where the logs are
 *   --json on any command prints JSON.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AL from '../../framework/core/auto-lander.mjs';
import { persistRoot } from '../../framework/cli/persist.mjs';

const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/** The auto-lander's data folder: AXF_AUTO_LANDER_DIR, else <shared data>/auto-lander, else ~/.axf/auto-lander. */
export function dataDir() {
  if (process.env.AXF_AUTO_LANDER_DIR) return resolve(process.env.AXF_AUTO_LANDER_DIR);
  const root = persistRoot();
  return root ? join(root, 'auto-lander') : join(homedir(), '.axf', 'auto-lander');
}
export const attemptsDir = () => join(dataDir(), 'attempts');

/** The log file of one build (the id is checked: no paths, no dots up front). */
export function fileFor(build) {
  if (!BUILD_ID.test(String(build || ''))) throw Object.assign(new Error(`not a build id: ${build}`), { code: 'invalid' });
  return join(attemptsDir(), `${build}.jsonl`);
}

const keyOf = (a) => `${a.kind}#${a.n}#${a.at}`;

/** Errors in one record against auto-lander-attempt@1 (empty = valid). */
export function errorsOf(record) {
  const out = AL.attemptErrors(record);
  const x = record && typeof record === 'object' ? record : {};
  const allowed = new Set(['$axf', 'build', 'kind', 'n', 'account', 'session', 'branch', 'head', 'pr', 'result', 'log', 'at', 'endedAt']);
  for (const k of Object.keys(x)) if (!allowed.has(k)) out.push(`attempt.${k} is not a field of ${AL.ATTEMPT_FRAME}`);
  if (typeof x.log === 'string' && x.log.length > AL.LOG_MAX) out.push(`attempt.log is at most ${AL.LOG_MAX} characters`);
  if (x.build && !BUILD_ID.test(x.build)) out.push('attempt.build is a build id');
  return out;
}

/** Append one record (validated). Returns the normalised record as written. */
export function append(record) {
  const rec = { ...AL.normAttempt(record), $axf: AL.ATTEMPT_FRAME };
  const errs = errorsOf({ ...record, $axf: AL.ATTEMPT_FRAME, log: rec.log, endedAt: rec.endedAt });
  if (errs.length) throw Object.assign(new Error(`invalid attempt: ${errs.join('; ')}`), { code: 'invalid', errors: errs });
  const f = fileFor(rec.build);
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, `${JSON.stringify(rec)}\n`);
  return rec;
}

/** Every line of a build's log, parsed (bad lines skipped and counted). */
export function readLines(build) {
  const f = fileFor(build);
  if (!existsSync(f)) return { lines: [], bad: 0 };
  let bad = 0; const lines = [];
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (AL.attemptErrors(j).length) bad += 1; else lines.push(AL.normAttempt(j)); } catch { bad += 1; }
  }
  return { lines, bad };
}

/** The attempts of a build, folded (last line per build/kind/n/at wins), oldest first; `kind` filters. */
export function list(build, { kind = '' } = {}) {
  const m = new Map();
  for (const a of readLines(build).lines) m.set(keyOf(a), a);
  const all = [...m.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.n - y.n);
  return kind ? all.filter((a) => a.kind === kind) : all;
}

/** Counts per kind: { clash: { attempts, ok, failed, timeout, skipped, started, failures }, … , total }. */
export function count(build) {
  const out = {}; let total = 0;
  for (const k of AL.KINDS) out[k] = { attempts: 0, ok: 0, failed: 0, timeout: 0, skipped: 0, started: 0, failures: 0 };
  for (const a of list(build)) {
    const c = out[a.kind]; c.attempts += 1; c[a.result] += 1; total += 1;
    if (AL.FAILURES.includes(a.result)) c.failures += 1;
  }
  return { ...out, total };
}

/** The next attempt number for a kind (dense, 1-based, over every line ever written for it). */
export const nextN = (build, kind) => list(build, { kind }).reduce((m, a) => Math.max(m, a.n), 0) + 1;

/** Start an attempt: a `started` record. Returns it (the key to end it with). */
export function start(build, kind, fields = {}) {
  const at = fields.at || new Date().toISOString();
  return append({ ...fields, build, kind, n: fields.n || nextN(build, kind), result: 'started', at, endedAt: '' });
}

/** End an attempt (the record start returned) with a result and a log excerpt. */
export function end(started, result, { log = '', at = new Date().toISOString(), head = '' } = {}) {
  if (result === 'started') throw Object.assign(new Error('an attempt ends with ok, failed, timeout or skipped'), { code: 'invalid' });
  return append({ ...started, result, log: String(log || '').slice(-AL.LOG_MAX), endedAt: at, ...(head ? { head } : {}) });
}

/** Record a whole attempt at once (start and end), e.g. a land that was a single call. */
export function record(build, kind, result, fields = {}) {
  const s = start(build, kind, fields);
  return result === 'started' ? s : end(s, result, { log: fields.log || '', at: fields.endedAt || s.at, head: fields.head || '' });
}

/** A hand reset: every counted failure of `kind` (all kinds when empty) is re-written as skipped, with who did it. */
export function reset(build, { kind = '', by = '', at = new Date().toISOString() } = {}) {
  let n = 0;
  for (const a of list(build)) {
    if ((kind && a.kind !== kind) || !(AL.FAILURES.includes(a.result) || a.result === 'started')) continue;
    append({ ...a, result: 'skipped', endedAt: a.endedAt || at, log: `${a.log}${a.log ? '\n' : ''}reset${by ? ` by ${by}` : ''} at ${at}`.slice(-AL.LOG_MAX) });
    n += 1;
  }
  return n;
}

/** Every build that has a log. */
export function builds() {
  const d = attemptsDir();
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).filter((b) => BUILD_ID.test(b)).sort();
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2); const json = args.includes('--json');
  const flag = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : ''; };
  const [cmd = 'builds', id] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--kind'));
  const say = (obj, text) => process.stdout.write(`${json ? JSON.stringify(obj, null, 1) : text}\n`);
  try {
    if (cmd === 'dir') say({ ok: true, dir: attemptsDir() }, attemptsDir());
    else if (cmd === 'builds') { const b = builds(); say({ ok: true, builds: b }, b.join('\n') || '(no attempt logs yet)'); }
    else if (cmd === 'list') {
      if (!id) throw new Error('list <build> [--kind k]');
      const l = list(id, { kind: flag('kind') });
      say({ ok: true, build: id, attempts: l }, l.map((a) => `${a.at}  ${a.kind} #${a.n}  ${a.result}${a.account ? `  ${a.account}` : ''}${a.log ? `  ${a.log.split('\n')[0].slice(0, 100)}` : ''}`).join('\n') || '(none)');
    } else if (cmd === 'count') {
      if (!id) throw new Error('count <build>');
      const c = count(id);
      say({ ok: true, build: id, count: c }, AL.KINDS.map((k) => `${k}: ${c[k].attempts} (${c[k].ok} ok, ${c[k].failures} failed${c[k].started ? `, ${c[k].started} running` : ''})`).join('\n'));
    } else throw new Error(`unknown command ${cmd}`);
  } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(e.code === 'invalid' ? 2 : 1); }
}
