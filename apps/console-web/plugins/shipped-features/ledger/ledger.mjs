#!/usr/bin/env node
/**
 * Shipped features ledger CLI.
 *
 *   ledger.mjs import [--repo amberx-axf|axhub|all]   backfill: builds journal, merged PRs, early commits, seed
 *   ledger.mjs sync                                    new build events + deploy log (what the console timer runs)
 *   ledger.mjs list [--status s,s] [--json]            features (newest planned first)
 *   ledger.mjs show <feature id> [--json]              one feature with its edits, prompts and history
 *   ledger.mjs export csv|md|json [--view '<json>']    the grid's rows (feature-ledger@1 exportRows)
 *   ledger.mjs stats                                   counts per table and per status
 *   ledger.mjs seed-draft                              the PRs and builds an AI pass should split (stdout, JSON)
 *   ledger.mjs migrate                                 apply pending migrations
 */
import * as L from '../../../../../framework/core/feature-ledger.mjs';
import * as D from './db.mjs';
import { importAll, importJournal, importPrs } from './importers.mjs';

const args = process.argv.slice(2); const cmd = args[0] || 'stats';
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? true : null; };
const json = args.includes('--json');
const db = D.openDb();

async function main() {
  if (cmd === 'migrate') { console.log(JSON.stringify(D.migrateDb(db))); return 0; }
  if (cmd === 'import') {
    const r = flag('repo'); const repos = !r || r === 'all' || r === true ? ['amberx-axf', 'axhub'] : [L.normRepo(r)];
    const report = await importAll(db, { repos, log: (l) => console.error(l) });
    if (json) console.log(JSON.stringify(report)); else console.log(JSON.stringify(D.counts(db)));
    return 0;
  }
  if (cmd === 'sync') {
    const { deliver } = await import('../../../../../framework/cli/build-hooks.mjs');
    const out = { hooks: await deliver({ only: 'shipped-features' }) };
    if (!D.counts(db).events_seen) out.journal = await importJournal(db);
    try { out.prs = await importPrs(db, 'amberx-axf', { max: 300 }); } catch (e) { out.prs = `skipped: ${e.message}`; }
    try { const { syncDeploys } = await import('./live.mjs'); out.deploys = await syncDeploys(db); } catch (e) { out.deploys = `skipped: ${e.message}`; }
    console.log(JSON.stringify(out)); return 0;
  }
  if (cmd === 'list') {
    const st = typeof flag('status') === 'string' ? flag('status').split(',') : [];
    const fs = D.listFeatures(db).filter((f) => !st.length || st.includes(f.status)).sort((a, b) => (b.plannedAt || '').localeCompare(a.plannedAt || ''));
    if (json) console.log(JSON.stringify(fs)); else for (const f of fs) console.log(`${L.STATUS_LABEL[f.status].padEnd(9)} ${(f.plugin || f.app || '-').padEnd(20)} ${f.name.slice(0, 90)}${f.editCount ? `  (edited ×${f.editCount})` : ''}`);
    return 0;
  }
  if (cmd === 'show') {
    const f = D.getFeature(db, args[1] || ''); if (!f) { console.error('no such feature'); return 1; }
    const out = { feature: f, edits: D.listEdits(db, f.id), prompts: f.prompts.map((p) => D.getPrompt(db, p.id)).filter(Boolean), history: D.featureHistory(db, f.id).map((h) => ({ rev: h.rev, at: h.at, why: h.why, status: h.doc.status })) };
    console.log(json ? JSON.stringify(out) : JSON.stringify(out, null, 1)); return 0;
  }
  if (cmd === 'export') {
    const kind = args[1] || 'csv'; const led = D.ledger(db);
    if (kind === 'json') { console.log(JSON.stringify(led)); return 0; }
    const ctx = { prompts: led.prompts, edits: led.edits, prs: led.prs, builds: led.builds };
    const view = L.normView(typeof flag('view') === 'string' ? JSON.parse(flag('view')) : {});
    const rows = L.exportRows(L.sortFeatures(L.filterFeatures(led.features, view, ctx), view.sort));
    console.log(kind === 'md' ? L.toMarkdown(rows) : L.toCsv(rows)); return 0;
  }
  if (cmd === 'stats') {
    const by = {}; for (const f of D.listFeatures(db)) by[f.status] = (by[f.status] || 0) + 1;
    const ebe = {}; for (const e of D.listEdits(db)) ebe[e.status] = (ebe[e.status] || 0) + 1;
    console.log(JSON.stringify({ schema: D.schemaVersion(db), file: D.dbFile(), counts: D.counts(db), features: by, edits: ebe, since: D.getMeta(db, 'since'), importedAt: D.getMeta(db, 'imported_at') }, null, 1)); return 0;
  }
  if (cmd === 'seed-draft') {
    const led = D.ledger(db);
    console.log(JSON.stringify({ instructions: 'Split each PR or build below into the individual user-visible features it shipped. Answer feature-ledger@1 seed JSON: { features: [{ name, description, type, app, plugin, repo, prs: [{repo, number}], builds: [{id, profile}], mergedAt }] }. Keep names short; one feature per thing a user can see or use.', prs: led.prs.filter((p) => p.state === 'merged').map((p) => ({ repo: p.repo, number: p.number, title: p.title, body: p.body.slice(0, 1500), files: p.files.slice(0, 40), mergedAt: p.mergedAt })), builds: led.builds.map((b) => ({ id: b.id, profile: b.profile, title: b.title, pr: b.pr })) })); return 0;
  }
  console.error('usage: ledger.mjs import|sync|list|show|export|stats|seed-draft|migrate'); return 2;
}
main().then((c) => process.exit(c), (e) => { console.error(e.stack || e.message); process.exit(1); });
