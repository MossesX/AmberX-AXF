#!/usr/bin/env node
/**
 * Build packager CLI (build-package@1, web/packager-core.mjs). Lists every waiting step, packages the ticked ones into
 * one build, and re-analyzes the queue order. Store writes go through the builds store (one lock, one journal line,
 * live to main). Sending a package to a helper is the server's job (it asks the session-sync capability).
 *
 *   node apps/console-web/plugins/build-orchestrator/packager.mjs candidates [--model Fable] [--json]
 *   … package --json '{"order":[keys…],"name":"…","model":"keep|Fable|Opus","thinking":"high","position":0,"dest":"mine|helper"}'
 *   … preset all-fable [--json]          the keys the "All Fable work" preset ticks (it never sends by itself)
 *   … reanalyze [--apply] [--json]       re-check the active profile's order against its packages (dry run without --apply)
 *   … unpackage <id>                      a package with nothing done goes back to its builds
 *   … mark-sent <id> --json '{…}'         record where a package went (helper, offer id)
 *
 * Plans: the server passes Plan Studio's ready plans in AXF_PACKAGER_PLANS (a JSON file), read through its capability.
 * Model upgrades (Opus → Fable on a step) need Brett: AXF_APPROVER + AXF_APPROVER_VIA, set only by the console server
 * for his own signed-in click (framework/core/model-switch.mjs approverFrom).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './web/packager-core.mjs';
import { approverFrom } from '../../../../framework/core/model-switch.mjs';
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { withStore, loadStore } from '../../../../framework/cli/builds-store.mjs';
import { addPackage, buildsOf, removePackage, reorderProfile } from '../../../../framework/plan/builds-store-core.mjs';

const profile = () => activeProfile().id;
const plans = () => { const f = process.env.AXF_PACKAGER_PLANS; try { return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []; } catch { return []; } };
const profileOrder = (store) => { const o = {}; for (const b of store.builds) for (const [p, i] of Object.entries(b.order ?? {})) (o[p] ??= {})[b.id] = i; return o; };

/** Everything the window needs: candidates, facets, what was left out and why, the profile. */
export function listing(store = loadStore()) {
  const { candidates, skipped } = P.candidates(store.builds, { plans: plans(), profileOrder: profileOrder(store) });
  return { candidates, skipped, facets: P.facets(candidates), profile: profile(), profiles: [...new Set(store.builds.flatMap((b) => b.profiles))].sort(), filter: P.DEFAULT_FILTER, presets: P.PRESETS, thinking: P.THINKING };
}

/** Re-analyze one profile's order against its packages; `apply` writes it (one store write). */
export function reanalyze({ apply = false, by = 'packager' } = {}) {
  const p = profile();
  let res;
  const run = (s) => { const ids = buildsOf(s, p).map((b) => b.id); res = P.reanalyze(s.builds, ids, { now: new Date().toISOString() }); return res; };
  if (!apply) { run(loadStore()); return { ...res, applied: false, profile: p }; }
  withStore((s) => { run(s); return res.moves.length ? reorderProfile(s, p, res.order) : s; }, { by, action: 'packager:reanalyze', note: res?.moves?.map((m) => m.id).join(',') ?? '' });
  return { ...res, applied: res.moves.length > 0, profile: p };
}

/** Package the ticked keys (in order) into one build. Returns { build, log, reanalysis }. */
export function makePackage(req, { by = process.env.AXF_ACTOR || 'packager', env = process.env } = {}) {
  const a = approverFrom(env);
  const approver = a.ok ? { by: a.by, via: a.via } : null;
  const p = profile();
  let out;
  withStore((s) => {
    const { candidates } = P.candidates(s.builds, { plans: plans(), profileOrder: profileOrder(s) });
    const pkg = P.makePackage(candidates, req.order, { ...req, by: approver?.by || by, taken: s.builds.map((b) => b.id) });
    const position = req.position === null || req.position === 'end' ? null : Number.isInteger(req.position) ? req.position : 0;
    const r = addPackage(s, p, pkg, { position, approver });
    out = { build: r.build, log: r.log, upgrades: pkg.upgrades, plans: pkg.marks.filter((m) => m.kind === 'plan-step') };
    return r.store;
  }, { by, action: 'packager:package', note: req.name ?? '' });
  // re-analyze after every package (addendum 1): the new build may have to wait for, or go before, its sources
  out.reanalysis = reanalyze({ apply: true, by });
  return out;
}

export function unpackage(id, { by = process.env.AXF_ACTOR || 'packager' } = {}) {
  let log = [];
  withStore((s) => { const r = removePackage(s, id); log = r.log; return r.store; }, { by, action: 'packager:unpackage', note: id });
  return { log, reanalysis: reanalyze({ apply: true, by }) };
}

/** Record where a package went (the session-sync offer), so every screen shows it. */
export function markSent(id, sent, { by = process.env.AXF_ACTOR || 'packager' } = {}) {
  let build;
  withStore((s) => {
    const b = s.builds.find((x) => x.id === id && !x.deleted); if (!b?.package) throw new Error(`"${id}" is not a package`);
    b.package = { ...b.package, dest: 'helper', sent: { to: String(sent.to ?? ''), offer: String(sent.offer ?? ''), now: sent.now === true, at: new Date().toISOString(), by } };
    b.notes.push({ text: `Sent to ${sent.to || 'a helper'}${sent.now ? ' (do it now)' : ''}${sent.offer ? `, offer ${sent.offer}` : ''}`, at: new Date().toISOString() });
    b.updatedAt = new Date().toISOString(); build = b; return s;
  }, { by, action: 'packager:sent', note: id });
  return { build };
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify({ ok: true, ...o }) : text);
  const [cmd = 'candidates', ...rest] = args;
  const body = () => { const j = rest.find((a) => a.startsWith('{')); return j ? JSON.parse(j) : {}; };
  if (cmd === 'candidates') {
    const l = listing(); const mi = rest.indexOf('--model'); const f = mi >= 0 ? { model: rest[mi + 1] } : {};
    const shown = P.filterCandidates(l.candidates, f);
    return out(l, P.groups(shown).map((g) => `${g.build} (${g.status}) · ${g.items.length} step(s)\n${g.items.map((c) => `  [${c.model}] ${c.key} ${c.text.slice(0, 90)}`).join('\n')}`).join('\n') || 'Nothing waiting.');
  }
  if (cmd === 'preset') { const keys = P.presetKeys(listing().candidates, rest[0] || 'all-fable'); return out({ keys }, `${keys.length} step(s) ticked:\n${keys.join('\n')}`); }
  if (cmd === 'package') { const r = makePackage(body()); return out(r, [...r.log, ...r.reanalysis.moves.map((m) => `moved ${m.id} ${m.from + 1} → ${m.to + 1}: ${m.why}`)].join('\n')); }
  if (cmd === 'reanalyze') { const r = reanalyze({ apply: rest.includes('--apply') }); return out(r, r.moves.length ? r.moves.map((m) => `${r.applied ? 'moved' : 'would move'} ${m.id} ${m.from + 1} → ${m.to + 1}: ${m.why}`).join('\n') : 'Order is right.'); }
  if (cmd === 'unpackage') { const r = unpackage(rest[0]); return out(r, r.log.join('\n')); }
  if (cmd === 'mark-sent') { const r = markSent(rest[0], body()); return out(r, `${rest[0]} marked sent`); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
