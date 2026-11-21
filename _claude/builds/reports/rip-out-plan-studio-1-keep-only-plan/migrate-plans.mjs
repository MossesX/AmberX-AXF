#!/usr/bin/env node
/**
 * One-off (build rip-out-plan-studio-1-keep-only-plan, Nov 21 2026): the plans still in the removed Plan Studio's store
 * (<hub>/_data/plan-studio/plans/*.json) become plans in Plan Studio 2.0's tree, inside one top-level section.
 *
 *   node migrate-plans.mjs <plans folder> [--write]     without --write it only prints what it would add
 *
 * Per plan: title, status, priority and tags as they were (tag `plan-studio-1` added); summary, goal, why, the body and
 * what the tree has no field for (category, owner, links, the old id) in the body; steps as steps (under a section per
 * phase when the plan had phases; done, model and minutes kept); requirements, acceptance, decisions, questions, risks
 * and out-of-scope each as a list; comments as notes. A plan already moved (same old id in a body) is skipped, so a
 * second run adds nothing. The source files are only read. Counts are checked before anything is saved.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as tc from '../../../../apps/console-web/plugins/plan-studio-2/web/tree-core.mjs';
import { load, save, storeDir } from '../../../../apps/console-web/plugins/plan-studio-2/tree.mjs';

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error('usage: migrate-plans.mjs <plans folder> [--write]'); process.exit(2); }
const HOLDER = 'From Plan Studio 1';
const STATUS = { idea: 'idea', draft: 'draft', parked: 'parked', ready: 'draft', building: 'active', done: 'done', dropped: 'parked' };
const LISTS = [['requirements', 'Requirements'], ['acceptance', 'Acceptance'], ['decisions', 'Decisions'], ['questions', 'Open questions'], ['risks', 'Risks'], ['outOfScope', 'Out of scope']];
const marker = (id) => `Plan Studio 1 id: ${id}`;
const textOf = (x) => (typeof x === 'string' ? x : String(x?.text ?? x?.title ?? x?.label ?? '')).trim();
/** A row title is one line of at most 300 characters; anything longer stays whole in the body. */
const titled = (full) => { const one = full.replace(/\s+/g, ' ').trim(); return one.length <= 300 && !full.includes('\n') ? { title: one, body: '' } : { title: `${one.slice(0, 297)}…`, body: full }; };

const plans = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
let s = load();
const before = s.items.length;
const moved = new Set(plans.filter((p) => s.items.some((i) => i.body.includes(marker(p.id)))).map((p) => p.id));
const add = (o) => { const r = tc.add(s, { by: 'plan-studio-1', ...o }); s = r.state; return r.item.id; };
const report = [];
let holder = tc.roots(s).find((i) => i.title === HOLDER)?.id ?? null;

for (const p of plans) {
  if (moved.has(p.id)) { report.push({ id: p.id, skipped: 'already moved' }); continue; }
  holder ??= add({ kind: 'section', parent: null, title: HOLDER, body: 'Plans moved here when the original Plan Studio was removed (Nov 21 2026). Drag them where they belong.' });
  const links = (p.links ?? []).map((l) => `- ${[l.kind, l.label, l.ref ?? l.url].filter(Boolean).join(': ')}`);
  const body = [
    p.summary, p.goal && `Goal: ${p.goal}`, p.why && `Why: ${p.why}`, p.body,
    (p.touches ?? []).length && `Touches: ${p.touches.map(textOf).join(', ')}`,
    links.length && `Links:\n${links.join('\n')}`,
    [p.category && `Category: ${p.category}`, p.owner && `Owner: ${p.owner}`, p.targetDate && `Target date: ${p.targetDate}`, `Created ${String(p.createdAt).slice(0, 10)} by ${p.createdBy || 'unknown'}`, marker(p.id)].filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n\n');
  const plan = add({ kind: 'plan', parent: holder, title: p.title, body, status: STATUS[p.status] ?? 'parked', priority: p.priority, tags: [...(p.tags ?? []), 'plan-studio-1'] });
  const counts = { steps: 0, listItems: 0, comments: 0 };
  const phases = new Map();
  for (const st of p.steps ?? []) {
    const full = textOf(st); if (!full) continue;
    let parent = plan;
    if (st.phase) { if (!phases.has(st.phase)) phases.set(st.phase, add({ kind: 'section', parent: plan, title: String(st.phase) })); parent = phases.get(st.phase); }
    add({ kind: 'step', parent, ...titled(full), model: st.model, minutes: st.minutes });
    if (st.done) s = tc.edit(s, s.items[s.items.length - 1].id, { done: true }).state;
    counts.steps += 1;
  }
  for (const [key, label] of LISTS) {
    const rows = (p[key] ?? []).filter((x) => textOf(x));
    if (!rows.length) continue;
    const list = add({ kind: 'list', parent: plan, title: label });
    for (const x of rows) {
      const t = titled(textOf(x));
      const id = add({ kind: 'item', parent: list, title: t.title, body: [t.body, x.mitigation && `Mitigation: ${x.mitigation}`, x.answer && `Answer: ${x.answer}`].filter(Boolean).join('\n\n') });
      if (x.done) s = tc.edit(s, id, { done: true }).state;
      counts.listItems += 1;
    }
  }
  for (const c of p.comments ?? []) { const full = textOf(c); if (!full) continue; add({ kind: 'note', parent: plan, ...titled(full), by: c.by || 'plan-studio-1' }); counts.comments += 1; }

  // count checks: what the old plan had is what sits under the new one
  const under = tc.descendants(s, plan);
  const want = { steps: (p.steps ?? []).filter((x) => textOf(x)).length, listItems: LISTS.reduce((n, [k]) => n + (p[k] ?? []).filter((x) => textOf(x)).length, 0), comments: (p.comments ?? []).filter((x) => textOf(x)).length };
  const got = { steps: under.filter((i) => i.kind === 'step').length, listItems: under.filter((i) => i.kind === 'item').length, comments: under.filter((i) => i.kind === 'note').length };
  const doneWant = (p.steps ?? []).filter((x) => x.done).length; const doneGot = under.filter((i) => i.kind === 'step' && i.done).length;
  if (JSON.stringify(want) !== JSON.stringify(got) || JSON.stringify(want) !== JSON.stringify(counts) || doneWant !== doneGot) throw new Error(`${p.id}: counts differ, nothing saved: had ${JSON.stringify(want)} (${doneWant} done), tree has ${JSON.stringify(got)} (${doneGot} done)`);
  report.push({ id: p.id, to: plan, title: p.title, status: `${p.status} → ${tc.byId(s, plan).status}`, ...got, stepsDone: doneGot, bodyChars: tc.byId(s, plan).body.length });
}

const addedPlans = report.filter((r) => r.to).length;
if (addedPlans + moved.size !== plans.length) throw new Error(`plan count differs: ${plans.length} in the old store, ${addedPlans} added + ${moved.size} already moved`);
console.log(JSON.stringify({ store: storeDir(), plansInOldStore: plans.length, added: addedPlans, alreadyMoved: moved.size, itemsBefore: before, itemsAfter: s.items.length, write: flag === '--write', plans: report }, null, 1));
if (flag === '--write' && addedPlans) { const out = save(s); if (out.items.length !== s.items.length) throw new Error('the saved tree lost items'); console.log(`saved: ${out.items.length} items, rev ${out.rev}`); }
