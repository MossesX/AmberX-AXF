#!/usr/bin/env node
/**
 * build-assignment — who takes a build or step, and how it got there (assignment@1, framework/core/build-assignment.mjs),
 * on the build's and the step's record in the one builds store. Zero tokens: plain reads and writes, no model call.
 *
 *   node framework/cli/build-assignment.mjs get <build> [step]               the record and the employee column (--json = raw)
 *   … candidates <build> [step] [--skills a,b] [--tools a,b] [--can a,b]      who matches a need (roster agents who may work),
 *                                                                           best first with match % and reasons; the need
 *                                                                           defaults to the step's text against the roster
 *   … apply <build> [step] --payload '<json>' [--from boss|brett|<agent>] [--at iso] [--message id]
 *                                                                           fold one assignment@1 payload into the record
 *                                                                           (ask, claim, candidates, veto, pick, brief);
 *                                                                           refused payloads say why and change nothing
 *   … default-pick <build> [step] [--at iso]                                 the boss's default pick once the 90 s window
 *                                                                           closed (nothing while it is open)
 *   … migrate [--apply]                                                      the column pass over the store: every build and
 *                                                                           step gains assignedEmployee ('' = none); an older
 *                                                                           assignedEmployee stays; new fields stay empty
 *   … missing                                                                builds with open steps and nobody assigned
 *   --json on any command prints JSON.
 *
 * The same commands are what the build-orchestrator plugin's routes and the group chat call (REST /api/control, MCP,
 * `axf build-orchestrator …` through plugin-commands@1, AmberX voice), so the UI is never the only way in.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../core/build-assignment.mjs';
import { normRoster } from '../core/engines/swarm-rules.mjs';
import { loadStore, storeFile, withStore } from './builds-store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const by0 = () => process.env.AXF_AGENT || process.env.AXF_SESSION || process.env.AXF_ACTOR || 'build-assignment';
/** The swarm roster the console ships (capability `agent-roster`); AXF_AGENT_ROSTER points elsewhere. */
const ROSTER_FILE = process.env.AXF_AGENT_ROSTER || join(ROOT, 'apps/console-web/plugins/agent-swarm/agents/roster.json');

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
const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const out = (f, obj, text) => { if (f.json) console.log(JSON.stringify(obj, null, 2)); else console.log(text ?? JSON.stringify(obj, null, 2)); };
const fail = (m) => { console.error(m); process.exit(1); };

const findBuild = (store, id) => store.builds.find((b) => b.id === id && !b.deleted) ?? store.builds.find((b) => b.pendingId && b.pendingId === id && !b.deleted) ?? null;
const findStep = (b, id) => (id ? b.steps.find((s) => s.id === id || s.uid === id) ?? null : null);
/** The build or the step record that carries the assignment. */
function target(store, buildId, stepId) {
  const b = findBuild(store, buildId); if (!b) fail(`no build "${buildId}"`);
  if (!stepId) return { build: b, step: null, rec: b };
  const s = findStep(b, stepId); if (!s) fail(`no step "${stepId}" on ${b.id}`);
  return { build: b, step: s, rec: s };
}
function roster() {
  try { return normRoster(JSON.parse(readFileSync(ROSTER_FILE, 'utf8'))); } catch { return { agents: [], fallback: '' }; }
}
const recordText = (t, r) => {
  const where = t.step ? `${t.build.id} ${t.step.id}` : t.build.id;
  if (!r) return `${where}: nobody assigned (no assignment yet)`;
  const lines = [`${where}: ${r.status || 'none'}${r.assignedEmployee ? ` → ${r.assignedEmployee}` : ''}${r.pickedBy ? ` (picked by ${r.pickedBy})` : ''}`];
  if (!A.needEmpty(r.need)) lines.push(`  need: ${A.needText(r.need)}`);
  if (r.claimedBy) lines.push(`  claimed by ${r.claimedBy} at ${r.claimedAt}${r.vetoDeadline ? `, veto until ${r.vetoDeadline}` : ''}`);
  for (const c of r.candidates) lines.push(`  ${String(c.match).padStart(3)}%  ${c.employee}  ${c.reasons.join(', ')}`);
  for (const b of r.briefs) lines.push(`  ${b.kind} from ${b.by}${b.employee?.name ? ` (${b.employee.name})` : ''} at ${b.at}: ${b.ref}`);
  return lines.join('\n');
};

const f = flags(process.argv.slice(2));
const [cmd, buildId, stepId] = f._;

switch (cmd) {
  case 'get': {
    if (!buildId) fail('usage: get <build> [step]');
    const t = target(loadStore(), buildId, stepId);
    out(f, { build: t.build.id, step: t.step?.id ?? '', assignedEmployee: t.rec.assignedEmployee ?? '', assignment: t.rec.assignment ?? null }, recordText(t, t.rec.assignment ?? null));
    break;
  }
  case 'candidates': {
    if (!buildId) fail('usage: candidates <build> [step] [--skills a,b] [--tools a,b] [--can a,b]');
    const t = target(loadStore(), buildId, stepId);
    const need = { skills: list(f.skills), tools: list(f.tools), capabilities: list(f.can) };
    const r = roster();
    const text = t.step ? `${t.step.title || t.step.text} ${(t.step.files ?? []).join(' ')}` : `${t.build.title} ${t.build.detail}`;
    const c = A.candidatesFor(need, r.agents, { text, fallback: r.fallback });
    out(f, { build: t.build.id, step: t.step?.id ?? '', need: A.normNeed(need), candidates: c }, c.length ? c.map((x) => `${String(x.match).padStart(3)}%  ${x.employee}  ${x.reasons.join(', ')}`).join('\n') : 'nobody matches (no roster, or nothing to go on)');
    break;
  }
  case 'apply': {
    if (!buildId || !f.payload) fail('usage: apply <build> [step] --payload \'<json>\' [--from who] [--at iso] [--message id]');
    let payload; try { payload = JSON.parse(f.payload); } catch { fail('--payload is not JSON'); }
    const at = f.at || new Date().toISOString();
    let result = null;
    withStore((s) => {
      const t = target(s, buildId, stepId);
      payload = { ...payload, buildId: t.build.id, stepId: t.step?.id ?? '' };
      const r = A.apply(t.rec.assignment ?? null, payload, { at, from: f.from || '', messageId: f.message || '' });
      result = { build: t.build.id, step: t.step?.id ?? '', error: r.error, assignment: r.record };
      if (r.error) return s;
      t.rec.assignment = r.record; t.rec.assignedEmployee = r.record.assignedEmployee; t.rec.updatedAt = at;
      if (t.step) t.build.updatedAt = at;
      return s;
    }, { by: f.from || by0(), action: 'assignment', note: `${payload.type} ${A.jobIdOf(buildId, stepId)}` });
    if (result.error) { out(f, result, `refused: ${result.error}`); process.exit(2); }
    out(f, result, recordText({ build: { id: result.build }, step: result.step ? { id: result.step } : null }, result.assignment));
    break;
  }
  case 'default-pick': {
    if (!buildId) fail('usage: default-pick <build> [step] [--at iso]');
    const t = target(loadStore(), buildId, stepId);
    const p = A.defaultPick(t.rec.assignment ?? null, f.at || new Date().toISOString(), { buildId: t.build.id, stepId: t.step?.id ?? '' });
    out(f, { build: t.build.id, step: t.step?.id ?? '', pick: p, vetoLeft: A.vetoLeft(t.rec.assignment ?? null, f.at || new Date().toISOString()) }, p ? `${p.employee} has it by default (pickedBy default)` : (t.rec.assignment?.status === 'veto' ? `veto window open: ${A.vetoLeft(t.rec.assignment, f.at || new Date().toISOString())} s left` : 'nothing to pick'));
    break;
  }
  case 'migrate': {
    // The normalizer is the migration, read from the raw file (a loaded store is already healed): a record with an older
    // assignedEmployee column keeps it and gains the assignment@1 record (status assigned); a record nobody assigned gains
    // nothing (both fields stay absent, so 580 untouched builds are not rewritten or republished). Dry run lists it; --apply
    // writes it through the store (journal, exports, live publish) only when there is something to carry.
    let raw; try { raw = JSON.parse(readFileSync(storeFile(), 'utf8')); } catch (e) { fail(`cannot read ${storeFile()}: ${e.message}`); }
    const plan = { carry: [], already: 0, untouched: 0, odd: [] };
    for (const b of raw.builds ?? []) {
      if (b?.deleted) continue;
      const scan = (rec, where) => {
        const col = typeof rec.assignedEmployee === 'string' ? rec.assignedEmployee : '';
        if (rec.assignment && typeof rec.assignment === 'object') { plan.already += 1; if (col && col !== rec.assignment.assignedEmployee) plan.odd.push(`${where}: column ${col}, record ${rec.assignment.assignedEmployee || 'nobody'} (the record wins)`); }
        else if (col) plan.carry.push(`${where} → ${col}`);
        else plan.untouched += 1;
      };
      scan(b, b.id);
      for (const s of b.steps ?? []) scan(s, `${b.id} ${s.id}`);
    }
    const summary = `${plan.carry.length} record(s) with an older assignedEmployee gain the assignment record; ${plan.already} already carry one; ${plan.untouched} untouched (no fields added until assigned)${plan.odd.length ? `; ${plan.odd.length} column/record mismatch(es)` : ''}.`;
    const lines = [...plan.carry, ...plan.odd];
    if (!f.apply) { out(f, { dryRun: true, ...plan, summary }, `${summary}${lines.length ? `\n${lines.join('\n')}` : ''}\n(dry run: add --apply to write)`); break; }
    if (!plan.carry.length && !plan.odd.length) { out(f, { applied: false, ...plan, summary }, `${summary}\nnothing to write.`); break; }
    const r = withStore((s) => s, { by: by0(), action: 'migrate', note: `assignment@1: ${plan.carry.length} older assignedEmployee column(s) carried into the record` });
    out(f, { applied: true, ...plan, summary, rev: r.rev }, `${summary}\nwritten: store rev ${r.rev}`);
    break;
  }
  case 'missing': {
    const s = loadStore();
    const rows = [];
    for (const b of s.builds) {
      if (b.deleted || ['complete', 'archived', 'built'].includes(b.status)) continue;
      const open = b.steps.filter((x) => !x.done && !x.skip);
      if (!open.length || b.assignedEmployee) continue;
      if (open.every((x) => x.assignedEmployee)) continue;
      rows.push({ id: b.id, status: b.status, openSteps: open.filter((x) => !x.assignedEmployee).map((x) => x.id) });
    }
    out(f, rows, rows.length ? rows.map((r) => `${r.id} (${r.status}): ${r.openSteps.join(', ')}`).join('\n') : 'every open step has an employee');
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
    if (cmd) process.exit(1);
}
