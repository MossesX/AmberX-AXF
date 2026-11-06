#!/usr/bin/env node
/**
 * build-progress — a running build's progress file (build-progress@1, framework/core/build-progress.mjs). Zero tokens,
 * no git, no network, no builds-store lock: a session records a step and carries straight on (Brett, Nov 6 2026: "never
 * stops to update the console"). The reconciler folds the file into the builds store; the console reads it on demand.
 *
 *   node framework/cli/build-progress.mjs step <stepId> running|done|skipped|failed [--note "…"] [--commit sha]
 *   … status running|blocked|failed|stopped|done [--note "…"]
 *   … note "<text>"                       a line for whoever looks next (what you are doing, what is odd)
 *   … link [--branch b] [--pr n] [--session s] [--agent a] [--worktree dir]
 *   … show [id]                           the file as text (--json = the object)
 *   … path [id]                           where the file is
 *   … init <id>                           seed it from the build's record (the orchestrator does this on registration)
 *   … fold [id] [--apply]                 what folding it into the builds store would change (--apply = do it)
 *   … list                                every progress file, one line each
 *   … check [id]                          validate (exit 1 on problems)
 *
 * The build is AXF_BUILD_ID (the headless launcher exports it) unless `--build <id>` names it.
 * Files: <dir>/<build id>.json, dir = AXF_PROGRESS_DIR, else <scratch>/build-progress under AXF_DATA_DIR, else the live
 * console checkout's .axf-console/build-progress (AXF_LIVE_ROOT, /opt/axf, AXF_ROOT in the console container), else this
 * checkout's. One dir for every worktree, so the console and the reconciler find a build's file by its id alone.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bp from '../core/build-progress.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function progressDir() {
  if (process.env.AXF_PROGRESS_DIR) return process.env.AXF_PROGRESS_DIR;
  const scratch = process.env.AXF_DATA_DIR;
  if (scratch && scratch !== 'off') return join(scratch, 'build-progress');
  for (const root of [process.env.AXF_LIVE_ROOT, '/opt/axf', process.env.AXF_ROOT]) {
    if (root && existsSync(join(root, '.axf-console'))) return join(root, '.axf-console', 'build-progress');
  }
  return join(REPO_ROOT, '.axf-console', 'build-progress');
}

export const progressFile = (id) => {
  if (!bp.validId(id)) throw new Error(`not a build id: ${id || '(none)'} (set AXF_BUILD_ID or pass --build <id>)`);
  return join(progressDir(), `${id}.json`);
};

export function readProgress(id) {
  const f = progressFile(id);
  if (!existsSync(f)) return null;
  try { return bp.normalize(JSON.parse(readFileSync(f, 'utf8')), id); } catch { return null; }
}

export function writeProgress(p) {
  const dir = progressDir();
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); try { chmodSync(dir, 0o1777); } catch { /* not ours */ } }
  const f = progressFile(p.build); const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2) + '\n'); renameSync(tmp, f);
  try { chmodSync(f, 0o666); } catch { /* not ours */ }
  return f;
}

/** Read, change, write: one atomic rename, no lock (one session per build writes it). */
export function update(id, change, now = new Date().toISOString()) {
  return writeProgress(bp.apply(readProgress(id) ?? { build: id }, { ...change, build: id }, now));
}

/** The registration hook: seed (or refresh the steps of) the file for a builds@1 record. Never throws. */
export function ensureFor(build) {
  try {
    if (!build?.id || !bp.validId(build.id)) return '';
    return writeProgress(bp.seed(build, readProgress(build.id)));
  } catch { return ''; }
}

export function listProgress() {
  const dir = progressDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
    try { return bp.normalize(JSON.parse(readFileSync(join(dir, n), 'utf8')), n.slice(0, -5)); } catch { return null; }
  }).filter(Boolean);
}

function flags(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--apply') f[a.slice(2)] = true;
    else if (a.startsWith('--')) { f[a.slice(2)] = argv[i + 1] ?? ''; i += 1; }
    else f._.push(a);
  }
  return f;
}

function text(p) {
  const lines = [`${p.title || p.build} (${p.build}) — ${bp.summary(p)}`];
  if (p.session || p.agent) lines.push(`session ${p.session || '-'} · agent ${p.agent || '-'}`);
  if (p.branch || p.pr) lines.push(`branch ${p.branch || '-'}${p.pr ? ` · PR ${p.pr}` : ''}`);
  for (const s of p.steps) lines.push(`${{ done: '[x]', running: '[>]', skipped: '[-]', failed: '[!]' }[s.state] ?? '[ ]'} ${s.id} ${s.text}${s.note ? ` — ${s.note}` : ''}`);
  for (const n of p.notes.slice(-5)) lines.push(`note ${n.at.slice(0, 16)}: ${n.text}`);
  return lines.join('\n');
}

async function main(argv) {
  const f = flags(argv);
  const [cmd = 'show', ...rest] = f._;
  const idArg = () => f.build || rest[0] || process.env.AXF_BUILD_ID || '';
  const sessionId = () => f.build || process.env.AXF_BUILD_ID || '';
  const out = (o, t) => console.log(f.json ? JSON.stringify(o, null, 2) : t);
  switch (cmd) {
    case 'step': {
      const [step, state] = rest; if (!step || !state) throw new Error('usage: step <stepId> running|done|skipped|failed [--note …]');
      const id = sessionId(); update(id, { step, state, note: f.note, commit: f.commit, text: f.text });
      return out(readProgress(id), `${id} ${step} ${state}`);
    }
    case 'status': { const id = sessionId(); update(id, { status: rest[0], note: f.note }); return out(readProgress(id), `${id} → ${rest[0]}`); }
    case 'note': { const id = sessionId(); update(id, { note: rest.join(' ') || f.note }); return out(readProgress(id), `${id}: noted`); }
    case 'link': { const id = sessionId(); update(id, { branch: f.branch, pr: f.pr, session: f.session, agent: f.agent, worktree: f.worktree }); return out(readProgress(id), `${id}: linked`); }
    case 'path': return console.log(progressFile(idArg()));
    case 'show': { const p = readProgress(idArg()); if (!p) { console.log(`no progress file for ${idArg()} (${progressFile(idArg())})`); return 1; } return out(p, text(p)); }
    case 'list': { const all = listProgress(); return out(all, all.map((p) => `${p.build.padEnd(48)} ${bp.summary(p)}`).join('\n') || `no progress files in ${progressDir()}`); }
    case 'check': {
      const files = idArg() ? [idArg()] : listProgress().map((p) => p.build); let bad = 0;
      for (const id of files) { const raw = JSON.parse(readFileSync(progressFile(id), 'utf8')); const e = bp.validate(raw); if (e.length) { bad += 1; console.log(`${id}: ${e.join('; ')}`); } }
      console.log(`${files.length - bad}/${files.length} progress file(s) valid`); return bad ? 1 : 0;
    }
    case 'init': {
      const { loadStore } = await import('./builds-store.mjs');
      const b = loadStore().builds.find((x) => x.id === idArg()); if (!b) throw new Error(`no build ${idArg()}`);
      return console.log(ensureFor(b));
    }
    case 'fold': {
      const { foldAll } = await import('./builds-reconcile.mjs');
      const r = await foldAll({ only: idArg() || '', apply: !!f.apply });
      return out(r, r.length ? r.map((c) => `${c.id}: ${c.why.join('; ')}`).join('\n') + (f.apply ? '' : '\n(dry run: --apply to write)') : 'nothing to fold');
    }
    default: throw new Error(`unknown command ${cmd} (step | status | note | link | show | path | init | fold | list | check)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(typeof c === 'number' ? c : 0), (e) => { console.error(`build-progress: ${e.message}`); process.exit(2); });
}
