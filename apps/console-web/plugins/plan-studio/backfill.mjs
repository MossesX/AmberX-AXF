#!/usr/bin/env node
/**
 * Plans for builds already started (build-plan@1). Plain code, no model. Each build gets its record if it has none, its
 * words and addenda from its brief, its steps ticked from the evidence, and its plan. Run it again any time: it only adds.
 *
 *   node apps/console-web/plugins/plan-studio/backfill.mjs --map <file.json> [--dry-run]
 *
 * The map is a JSON list: { dir, build, create?, into?, status?, plan? }
 *   dir     the folder in /root/axf-builds (AXF_BUILDS_DIR) with its .brief.md
 *   build   the build's id in the store
 *   create  make the record from the brief when it has none
 *   into    this run was a follow-up: record its words as an addendum on `build`
 *   status  set this status (only for a record made here: the launcher could not see how it ended)
 *   plan    adopt this existing plan instead of making a new one
 *
 * A step counts as done when: the build is built or merged (built = all its steps done, by definition), or the journal
 * shows it ticked and only a stale copy took the tick back (never an undo through the orchestrator), or a progress file or
 * report ticks it (`- [x] s3`, `s3 done`). Ticks land in the store; the plan follows.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadStore, withStore, journalDir } from '../../../../framework/cli/builds-store.mjs';
import { addAddendumTo, capture } from '../../../../framework/cli/build-origin.mjs';
import { recordFromBrief } from '../../../../framework/cli/build-plan.mjs';
import { findBuild } from '../../../../framework/plan/builds-store-core.mjs';
import { planForBuild } from './plans.mjs';

const ROOT = process.env.AXF_BUILDS_DIR || '/root/axf-builds';
const words = (t) => String(t ?? '').replace(/^\[(Fable|Opus|Sonnet)\]\s*/i, '').trim();

/** Steps the journal shows done and that no orchestrator undo took back: step text → doneAt. */
export function journalTicks(id, lines) {
  const out = new Map();
  for (const l of lines) {
    if (!l.includes(id)) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    const e = (j.builds ?? []).find((x) => x.id === id);
    if (!e?.after?.steps) continue;
    for (const s of e.after.steps) if (s.done && !out.has(words(s.text))) out.set(words(s.text), s.doneAt || j.at);
    if (j.action === 'orchestrator:step') for (const s of e.before?.steps ?? []) if (s.done && e.after.steps.some((x) => x.uid === s.uid && !x.done)) out.delete(words(s.text));
  }
  return out;
}
/** Step ids a progress file or report ticks. */
export function textTicks(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/^\s*-\s*\[x\]\s*(?:\*\*)?(s\d+)\b/gim)) out.add(m[1]);
  for (const m of String(text).matchAll(/\b(s\d+)\b[^\n]{0,20}\b(?:done|complete|ticked)\b/gi)) out.add(m[1]);
  return out;
}
function evidenceFiles(dir, ids) {
  const out = [];
  for (const base of [join(ROOT, dir), process.cwd()]) for (const name of ids) for (const f of [`_claude/builds/progress/${name}.md`, `_claude/builds/reports/${name}.md`]) if (existsSync(join(base, f))) out.push(readFileSync(join(base, f), 'utf8'));
  return out;
}
function journalLines() {
  const d = journalDir();
  return readdirSync(d).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => readFileSync(join(d, f), 'utf8').split('\n').filter(Boolean));
}

async function main(argv) {
  const map = JSON.parse(readFileSync(argv[argv.indexOf('--map') + 1], 'utf8'));
  const dry = argv.includes('--dry-run');
  const lines = journalLines();
  const report = [];
  for (const e of map) {
    const brief = e.dir && existsSync(join(ROOT, e.dir, '.brief.md')) ? readFileSync(join(ROOT, e.dir, '.brief.md'), 'utf8') : '';
    const had = findBuild(loadStore(), e.build);
    if (dry && !had) { report.push({ build: e.build, note: 'would make the record' }); continue; }
    if (!had && e.create) recordFromBrief(`# Build: ${e.build}\n${brief}`, { name: e.dir, by: 'backfill' });
    if (!findBuild(loadStore(), e.build)) { report.push({ build: e.build, note: 'no record' }); continue; }
    if (!dry && e.into) {
      const b = findBuild(loadStore(), e.build);
      if (!(b.origin?.addenda ?? []).some((a) => a.said === e.into)) addAddendumTo(e.build, { said: e.into, summary: e.summary, steps: e.steps, source: 'voice', verbatim: e.verbatim !== false, by: 'backfill' });
    } else if (!dry && brief) capture({ briefText: brief, build: e.build, name: e.dir, by: 'backfill' });
    const b = findBuild(loadStore(), e.build);
    const finished = ['built', 'complete'].includes(e.status ?? b.status);
    const fromLog = journalTicks(b.id, lines);
    const fromText = new Set(evidenceFiles(e.dir, [b.id, e.dir]).flatMap((t) => [...textTicks(t)]));
    const ticks = b.steps.filter((s) => !s.done && !s.addendum && (finished || fromLog.has(words(s.text)) || fromText.has(s.id)));
    const subs = finished ? b.steps.filter((s) => !s.done && s.parent) : [];
    report.push({ build: b.id, status: e.status ?? b.status, steps: b.steps.length, was: b.steps.filter((s) => s.done).length, ticks: ticks.length + subs.length, journal: fromLog.size, text: fromText.size });
    if (dry) continue;
    const at = new Date().toISOString();
    withStore((s) => {
      const r = findBuild(s, b.id);
      if (e.status && !had) r.status = e.status;
      for (const t of [...ticks, ...subs]) { const x = r.steps.find((y) => y.uid === t.uid); x.done = true; x.doneAt = fromLog.get(words(t.text)) || r.builtAt || at; x.note = x.note || 'Ticked by the backfill from the build\'s evidence.'; x.updatedAt = at; }
      for (const p of r.steps.filter((x) => x.addendum)) { const kids = r.steps.filter((x) => x.parent === p.id); if (kids.length && kids.every((x) => x.done || x.skip)) { p.done = true; p.doneAt = p.doneAt || at; } }
      if (ticks.length || subs.length) r.updatedAt = at;
      return s;
    }, { by: 'orchestrator', action: 'orchestrator:backfill', note: b.id });
    const pl = planForBuild(b.id, { by: 'backfill', planId: e.plan ?? '' });
    report[report.length - 1].plan = pl.plan?.id ?? pl.error ?? '';
  }
  for (const r of report) console.log(JSON.stringify(r));
}

if (process.argv[1]?.endsWith('backfill.mjs')) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
