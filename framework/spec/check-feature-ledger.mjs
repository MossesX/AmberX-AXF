#!/usr/bin/env node
/**
 * feature-ledger@1 conformance (Brett, Nov 4 2026: "Where's the list of features that can be sorted, and when they
 * went live?"). Pure core replayed against its fixture + the schema snapshots.
 *   node framework/spec/check-feature-ledger.mjs            check
 *   node framework/spec/check-feature-ledger.mjs --write    regenerate fixtures/feature-ledger.json's expected outputs
 *
 *   1. fixture replay: normalisation, validators (field names), lifecycle (transitions, events, build → status),
 *      merge (never loses a date, build, PR or prompt), edits (count / being edited / removed), live dates from the
 *      deploy log, migration from version 0, grouping / sort / filter / search / export projections
 *   2. the registry snapshot (schemas/feature-ledger.json) and JSON Schemas (schemas/json/feature*.schema.json,
 *      ledger-*.schema.json, prompt.schema.json) match the module (run `node framework/cli/axf.mjs schemas`)
 *   3. invariants a port can rely on: one lifecycle shared by features and edits, cancelled never comes back,
 *      a feature with no live date never sorts first on "newest live", hidden groups stay out of every view
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/feature-ledger.mjs';
import * as D from '../core/deploy-log.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/feature-ledger.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = '2026-11-04T22:00:00Z';

// ------------------------------------------------------------------ inputs (the fixture's `in`), expected outputs are generated with --write and replayed
const IN = {
  features: {
    full: { name: 'Shipped grid', description: 'Three-level grid', type: 'ui', app: 'console', plugin: 'shipped-features', builds: [{ id: 'shipped-features-r2', profile: 'angel' }], prs: [{ repo: 'MossesX/AmberX-AXF', number: 330 }], prompts: [{ id: 'p-shipped-features-r2-0', passage: 'list of features' }], status: 'building', plannedAt: '2026-11-04T21:00:00Z', model: 'Opus', agent: 'gina', session: 'Main', createdAt: NOW },
    merged: { name: 'Deploy log', type: 'infra', prs: [331], status: 'in-pr', mergedAt: '2026-11-04T23:00:00Z', mergeCommit: 'deadbeef1234', plannedAt: '2026-11-04T20:00:00Z' },
    liveOld: { name: 'Banner ticker', app: 'console', plugin: 'whats-shipped', status: 'merged', mergedAt: '2026-11-03T10:00:00Z', liveAt: { console: '2026-11-03T12:00:00Z', site: { at: '2026-11-03T13:00:00Z', guessed: true } }, prs: [260], edits: ['e-1', 'e-2'], lastEditAt: '2026-11-04T08:00:00Z', plannedAt: '2026-11-02T09:00:00Z' },
    cancelled: { name: 'Repo checklist', type: 'chore', status: 'cancelled', plannedAt: '2026-11-04T14:00:00Z' },
    loose: { title: ' Loose Title ', status: 'Done', type: 'bug', repo: 'MossesX/axHub', builds: ['axhub-thing'], live: 'x', createdAt: 'nope' },
    nameless: { description: 'no name' },
    axhub: { name: 'Veto countdown', repo: 'axhub', status: 'live', liveAt: { axhub: '2026-10-30T15:00:00Z' }, mergedAt: '2026-10-30T14:00:00Z', prs: [{ repo: 'axhub', number: 44 }], plannedAt: '2026-10-30T10:00:00Z' },
  },
  edits: {
    ok: { feature: 'f-shipped-features-shipped-grid', summary: 'Added CSV export', build: 'grid-export', status: 'building', at: '2026-11-05T02:00:00Z', kind: 'changed' },
    landed: { feature: 'f-whats-shipped-banner-ticker', summary: 'Ticker shows counts per state', pr: 262, status: 'merged', at: '2026-11-04T08:00:00Z', mergedAt: '2026-11-04T09:00:00Z' },
    removal: { feature: 'f-whats-shipped-banner-ticker', summary: 'Ticker retired', kind: 'removed', commit: 'abc1234', status: 'live', at: '2026-11-06T00:00:00Z', liveAt: { console: '2026-11-06T01:00:00Z' } },
    nothing: { feature: 'f-x', summary: 'Changed it' },
    empty: { summary: '' },
  },
  prs: { ok: { repo: 'amberx-axf', number: 330, title: 'Shipped features', mergedAt: '2026-11-05T00:00:00Z', mergeCommit: 'deadbeef1234', build: 'shipped-features-r2' }, open: { repo: 'axhub', number: 45, title: 'x' }, bad: { repo: 'axhub' } },
  prompts: { origin: { build: 'shipped-features-r2', said: "Where's the list of features that can be sorted, and when they went live?", at: '2026-11-04T12:00:00Z', source: 'voice', verbatim: true }, paraphrased: { build: 'old-build', index: 1, said: 'make the thing', mayBeParaphrased: true }, bad: { said: 'x' } },
  origin: { said: 'Make a database of features.', at: '2026-11-04T13:00:00Z', source: 'voice', verbatim: true, addenda: [{ said: 'Just AmberX and axHub.', at: '2026-11-04T15:00:00Z', source: 'voice' }, { said: '' }] },
  deploys: [
    { target: 'console', sha: 'aaaaaaa', at: '2026-11-04T22:30:00Z', who: 'update' },
    { target: 'console', sha: 'bbbbbbb', at: '2026-11-05T01:00:00Z', who: 'update' },
    { target: 'console', sha: 'ccccccc', at: '2026-11-05T03:00:00Z', who: 'update', state: 'failed' },
    { target: 'site', sha: 'ddddddd', at: '2026-11-05T02:00:00Z', who: 'cron', guessed: true },
    { target: 'Console', sha: 'bad', at: 'nope' },
  ],
  // which deploy commits contain which merge commits (git's answer, handed in as a table)
  contains: { 'bbbbbbb|deadbeef1234': true, 'ccccccc|deadbeef1234': true, 'ddddddd|deadbeef1234': true },
  statusFromBuild: [{ status: 'pending' }, { status: 'pending', pr: '12' }, { status: 'running' }, { status: 'built', pr: '330' }, { status: 'running', pr: '330' }, { status: 'complete', mergedAt: '2026-11-05T00:00:00Z' }, { status: 'failed' }, { status: 'failed', pr: '330' }, { status: 'blocked' }, { status: 'waiting' }, { status: 'complete', live: true }, { status: 'archived' }, { status: 'archived', mergedAt: '2026-11-05T00:00:00Z' }, { status: 'running', deleted: true }, {}],
  isoTimes: ['2026-11-05T02:00:00+02:00', '2026-11-05T02:00:00-05:00', '2026-11-05T02:00:00Z', '2026-11-05T02:00', '2026-11-05', '2026-11-05T02:00:00.250+00:00', 'Nov 5', '', 20261105],
  mergeLedgersEdits: [
    { version: 1, edits: [{ id: 'e-1', feature: 'f-a', summary: 'First copy', build: 'b1', commit: 'abc1234', status: 'building', at: '2026-11-05T02:00:00Z', files: ['a.ts'] }] },
    { version: 1, edits: [{ id: 'e-1', feature: 'f-a', summary: 'First copy', build: '', commit: '', pr: 7, status: 'merged', at: '2026-11-05T03:00:00Z', mergedAt: '2026-11-05T04:00:00Z', files: ['b.ts'], liveAt: { console: '2026-11-05T05:00:00Z' } }] },
  ],
  oddVersions: [{ version: '0.5', features: [{ name: 'Half', app: 'console', live: '2026-10-20T00:00:00Z' }] }, { version: 7, features: [{ name: 'Future', app: 'console' }], extra: true }, { version: -3, features: [{ name: 'Negative', app: 'console' }] }],
  transitions: [['planned', 'queued'], ['planned', 'live'], ['queued', 'planned'], ['in-pr', 'building'], ['building', 'in-pr'], ['merged', 'building'], ['planned', 'cancelled'], ['merged', 'cancelled'], ['live', 'removed'], ['queued', 'removed'], ['cancelled', 'queued'], ['removed', 'live'], ['live', 'live']],
  events: [['planned', 'queued'], ['queued', 'building'], ['building', 'pr-opened'], ['in-pr', 'pr-closed'], ['in-pr', 'merged'], ['merged', 'deployed'], ['live', 'deployed'], ['cancelled', 'merged'], ['live', 'cancelled'], ['merged', 'removed'], ['planned', 'nonsense']],
  views: {
    default: {},
    byBuild: { by: 'build', sort: { by: 'name', dir: 'asc' } },
    byDay: { by: 'day' }, byType: { by: 'type' }, byRepo: { by: 'repo' }, byApp: { by: 'app' }, byPlugin: { by: 'plugin' }, flat: { by: 'flat', sort: { by: 'editCount' } },
    hideCompleted: { hideCompleted: true }, hidePending: { hidePending: true }, showCancelled: { hideCancelled: false }, onlyCancelled: { statuses: ['cancelled'] },
    statuses: { statuses: ['live', 'in-pr'] }, hasEdits: { hasEdits: true }, noEdits: { hasEdits: false }, beingEdited: { beingEdited: true }, editStatus: { editStatus: 'merged' },
    searchPrompt: { search: 'sorted' }, searchPr: { search: '#331' }, searchName: { search: 'ticker' }, liveYes: { live: 'yes' }, liveNo: { live: 'no' }, range: { from: '2026-11-04T00:00:00Z', to: '2026-11-04T23:59:59Z', sort: { by: 'mergedAt' } }, app: { app: 'console' }, type: { type: 'infra' }, repo: { repo: 'axhub' },
    bogus: { by: 'nope', sort: { by: 'nope', dir: 'sideways' }, hideCancelled: 'yes', statuses: ['x', 'live'], hasEdits: 'maybe' },
  },
};

// ------------------------------------------------------------------ run the module over the inputs
function run() {
  const out = {};
  out.features = Object.fromEntries(Object.entries(IN.features).map(([k, v]) => [k, L.normFeature(v, { now: NOW })]));
  out.validateFeature = Object.fromEntries(Object.entries(IN.features).map(([k, v]) => [k, L.validateFeature(v).errors.map((e) => e.field)]));
  out.edits = Object.fromEntries(Object.entries(IN.edits).map(([k, v]) => [k, L.normEdit(v, { now: NOW })]));
  out.validateEdit = Object.fromEntries(Object.entries(IN.edits).map(([k, v]) => [k, L.validateEdit(v).errors.map((e) => e.field)]));
  out.prs = Object.fromEntries(Object.entries(IN.prs).map(([k, v]) => [k, L.normPr(v)]));
  out.validatePr = Object.fromEntries(Object.entries(IN.prs).map(([k, v]) => [k, L.validatePr(v).errors.map((e) => e.field)]));
  out.prompts = Object.fromEntries(Object.entries(IN.prompts).map(([k, v]) => [k, L.normPrompt(v)]));
  out.validatePrompt = Object.fromEntries(Object.entries(IN.prompts).map(([k, v]) => [k, L.validatePrompt(v).errors.map((e) => e.field)]));
  out.promptsFromOrigin = L.promptsFromOrigin('shipped-features-r2', IN.origin, 'angel');
  out.statusFromBuild = IN.statusFromBuild.map((b) => L.statusFromBuild(b));
  out.isoTimes = IN.isoTimes.map((v) => [L.iso(v), D.iso(v)]);
  out.mergeLedgersEdits = L.mergeLedgers(IN.mergeLedgersEdits[0], IN.mergeLedgersEdits[1], NOW).edits;
  out.oddVersions = IN.oddVersions.map((d) => { const m = L.migrate(d, NOW); return { version: m.version, features: m.features.map((f) => [f.name, f.status, f.firstLiveAt]) }; });
  out.deploysSortedAcrossOffsets = D.sortDeploys([{ target: 'console', sha: 'aaaaaaa', at: '2026-11-05T03:00:00+02:00' }, { target: 'console', sha: 'bbbbbbb', at: '2026-11-05T01:30:00Z' }]).map((d) => [d.sha, d.at]);
  out.transitions = IN.transitions.map(([a, b]) => L.canTransition(a, b));
  out.events = IN.events.map(([s, e]) => L.advance(s, e));
  const contains = new Map(Object.entries(IN.contains));
  out.deploys = D.sortDeploys(IN.deploys); out.deploySkipped = D.parseLog(IN.deploys.map((d) => JSON.stringify(d)).join('\n')).skipped;
  out.latestPerTarget = Object.fromEntries(Object.entries(D.latestPerTarget(IN.deploys)).map(([k, v]) => [k, v.id]));
  out.liveAt = D.liveAt(IN.deploys, 'deadbeef1234', contains);
  const merged = L.withLive(out.features.merged, IN.deploys, contains); out.withLive = merged;
  out.mergeFeature = L.mergeFeature({ ...IN.features.liveOld, description: 'newer text', liveAt: { console: { at: '2026-11-03T12:30:00Z', guessed: true } }, builds: [{ id: 'whats-new-banner', role: 'added' }] }, { ...IN.features.liveOld, builds: [{ id: 'whats-new-banner', profile: 'urgent', role: 'changed' }, 'ticker-fix'], prompts: ['p-whats-new-banner-0'], status: 'in-pr', plannedAt: '2026-11-01T00:00:00Z' });
  out.mergeKeepsVerbatimDates = L.mergeFeature({ name: 'x', app: 'a', mergedAt: '2026-11-02T00:00:00Z', mergedAtGuessed: true }, { name: 'x', app: 'a', mergedAt: '2026-11-02T05:00:00Z' }).mergedAt;
  const grid = out.features.full; const e1 = out.edits.ok;
  out.applyEdit = L.applyEdit(grid, e1, NOW);
  out.applyRemoval = L.applyEdit(out.features.liveOld, IN.edits.removal, NOW).status;
  out.refreshEdits = L.refreshEdits(out.applyEdit, [{ ...IN.edits.ok, status: 'merged' }]);
  out.migrate = L.migrate({ features: [{ name: 'Old', app: 'console', live: '2026-10-20T00:00:00Z' }], prs: [IN.prs.ok], prompts: [IN.prompts.origin], deploys: IN.deploys.slice(0, 1), since: '' }, NOW);
  out.mergeLedgers = L.mergeLedgers({ version: 1, features: [IN.features.full], prompts: [IN.prompts.paraphrased] }, { version: 1, features: [{ ...IN.features.full, status: 'in-pr', prs: [330, 332] }, IN.features.axhub], prompts: [{ ...IN.prompts.paraphrased, verbatim: true, mayBeParaphrased: false }] }, NOW);
  const all = [grid, merged, L.applyEdit(out.features.liveOld, IN.edits.landed, NOW), out.features.cancelled, out.features.axhub, out.features.loose];
  const ctx = { prompts: [L.normPrompt({ ...IN.prompts.origin, id: 'p-shipped-features-r2-0' })], edits: [L.normEdit(IN.edits.landed), L.normEdit(IN.edits.ok)], prs: [L.normPr(IN.prs.ok)], builds: [L.normBuildRecord({ id: 'shipped-features-r2', profile: 'angel', title: 'Shipped features' })] };
  out.views = Object.fromEntries(Object.entries(IN.views).map(([k, v]) => { const fs = L.filterFeatures(all, v, ctx); return [k, { view: L.normView(v), features: L.sortFeatures(fs, L.normView(v).sort).map((f) => f.id), groups: L.groupFeatures(fs, v, ctx).map((g) => ({ key: g.key, label: g.label, count: g.count, counts: g.counts, liveAt: g.liveAt, record: g.record ? (g.record.key ?? g.record.id) : null })) }]; }));
  out.chips = all.map((f) => ({ id: f.id, status: L.statusChip(f), edited: L.editedChip(f) }));
  out.saidBlock = L.saidBlock(grid, ctx.prompts);
  out.export = L.exportRows(all.slice(0, 3)); out.csv = L.toCsv(out.export); out.markdown = L.toMarkdown(out.export);
  return out;
}
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'feature-ledger@1', note: 'Generated by framework/spec/check-feature-ledger.mjs --write; `in` are the inputs, `out` what the reference module answers. Every port replays `in` and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ invariants
t('one lifecycle: features and edits share STATUSES; cancelled / removed never come back', () => {
  for (const s of L.STATUSES) { assert.equal(L.normEdit({ feature: 'f', summary: 's', status: s }).status === s || ['merged', 'live'].includes(L.normEdit({ feature: 'f', summary: 's', status: s }).status), true); }
  for (const s of L.STATUSES) { assert.equal(L.canTransition('cancelled', s), s === 'cancelled'); assert.equal(L.canTransition('removed', s), s === 'removed'); }
  assert.deepEqual([...L.PENDING_STATUSES, ...L.COMPLETED_STATUSES, 'cancelled'].sort(), [...L.STATUSES].sort());
});
t('build → status mapping covers every builds@1 status', () => { for (const s of ['pending', 'running', 'waiting', 'blocked', 'failed', 'built', 'complete', 'archived']) assert.ok(L.STATUSES.includes(L.statusFromBuild({ status: s }).status)); });
t('build → status reads a build the way build-hook@1 does: pending = planned, archived without a merge = cancelled, a merge wins, failed with a PR = in PR (stalled)', () => {
  const s = actual.statusFromBuild.map((x) => `${x.status}${x.stalled ? '!' : ''}`);
  assert.deepEqual(s, ['planned', 'planned', 'building', 'in-pr', 'in-pr', 'merged', 'building!', 'in-pr!', 'queued!', 'queued', 'live', 'cancelled', 'merged', 'cancelled', 'planned']);
});
t('ISO times with a UTC offset fold to Z (both modules agree), so dates compare as text; anything else is kept or refused', () => {
  assert.deepEqual(actual.isoTimes.map(([a]) => a), ['2026-11-05T00:00:00Z', '2026-11-05T07:00:00Z', '2026-11-05T02:00:00Z', '2026-11-05T02:00', '2026-11-05', '2026-11-05T02:00:00.250Z', '', '', '']);
  for (const [a, b] of actual.isoTimes) assert.equal(a, b);
  assert.deepEqual(actual.deploysSortedAcrossOffsets, [['aaaaaaa', '2026-11-05T01:00:00Z'], ['bbbbbbb', '2026-11-05T01:30:00Z']]);
});
t('merging ledgers: two copies of one edit keep the build, commit, PR, files, live date and the later status', () => {
  const [e] = actual.mergeLedgersEdits; assert.equal(actual.mergeLedgersEdits.length, 1);
  assert.equal(e.build, 'b1'); assert.equal(e.commit, 'abc1234'); assert.equal(e.pr, 7); assert.deepEqual(e.files, ['a.ts', 'b.ts']); assert.equal(e.status, 'live'); assert.equal(e.at, '2026-11-05T02:00:00Z'); assert.equal(e.mergedAt, '2026-11-05T04:00:00Z');
});
t('migration never crashes on an odd version: a fraction rounds down, a newer or negative version is read as current, nothing is dropped', () => {
  assert.deepEqual(actual.oddVersions.map((m) => m.version), [1, 1, 1]); assert.deepEqual(actual.oddVersions[0].features, [['Half', 'live', '2026-10-20T00:00:00Z']]); assert.equal(actual.oddVersions[1].features.length, 1); assert.equal(actual.oddVersions[2].features.length, 1);
});
t('normalisation is idempotent', () => { for (const f of Object.values(actual.features)) if (f) assert.deepEqual(L.normFeature(f), f); for (const e of Object.values(actual.edits)) if (e) assert.deepEqual(L.normEdit(e), e); });
t('a live date makes the status live, a merge commit alone makes it merged, never backwards', () => {
  assert.equal(actual.withLive.status, 'live'); assert.equal(actual.features.merged.status, 'merged');
  assert.equal(L.normFeature({ name: 'x', app: 'a', status: 'cancelled', mergedAt: '2026-11-01T00:00:00Z' }).status, 'cancelled');
});
t('live comes from the first successful deploy containing the merge commit, per target; failed deploys never count', () => {
  assert.equal(actual.liveAt.console.deploy, 'd-console-1793840400-bbbbbbb'); assert.equal(actual.liveAt.site.guessed, true); assert.equal(actual.withLive.firstLiveAt, '2026-11-05T01:00:00Z');
  assert.equal(D.firstContaining(IN.deploys, 'console', 'deadbeef1234', () => false), null);
});
t('merge never loses a date, build, PR, prompt or edit, and exact dates beat guessed ones', () => {
  const m = actual.mergeFeature; assert.equal(m.plannedAt, '2026-11-01T00:00:00Z'); assert.equal(m.liveAt.console.at, '2026-11-03T12:00:00Z'); assert.equal(m.liveAt.console.guessed, false);
  assert.deepEqual(m.builds.map((b) => `${b.profile}:${b.id}:${b.role}`).sort(), ['urgent:whats-new-banner:changed', ':ticker-fix:added'].sort()); assert.equal(m.prompts.length, 1); assert.equal(m.edits.length, 2); assert.equal(m.status, 'live'); assert.equal(m.description, 'newer text');
  assert.equal(actual.mergeKeepsVerbatimDates, '2026-11-02T05:00:00Z');
});
t('edits: count, being edited while pending, removal ends the feature', () => {
  assert.equal(actual.applyEdit.editCount, 1); assert.equal(actual.applyEdit.beingEdited, true); assert.equal(actual.refreshEdits.beingEdited, false); assert.equal(actual.applyRemoval, 'removed');
  assert.equal(L.applyEdit(actual.features.full, actual.edits.ok, NOW).editCount, 1, 'the same edit twice counts once');
});
t('the default view: by PR, newest live first, cancelled hidden, nothing else hidden', () => {
  const v = actual.views.default; assert.equal(v.view.by, 'pr'); assert.deepEqual(v.view.sort, { by: 'liveAt', dir: 'desc' }); assert.ok(!v.features.includes(actual.features.cancelled.id));
  assert.ok(v.features.indexOf(actual.features.axhub.id) < v.features.indexOf(actual.features.full.id), 'a feature with no live date sorts after live ones');
  assert.ok(actual.views.showCancelled.features.includes(actual.features.cancelled.id)); assert.deepEqual(actual.views.onlyCancelled.features, [actual.features.cancelled.id]);
});
t('hide completed / hide pending split every feature between them', () => {
  const all = new Set(actual.views.showCancelled.features); const hc = new Set(actual.views.hideCompleted.features); const hp = new Set(actual.views.hidePending.features);
  for (const id of all) if (id !== actual.features.cancelled.id) assert.equal(hc.has(id) !== hp.has(id), true, id);
});
t('search looks inside prompts, PR numbers and names; edit filters work', () => {
  assert.deepEqual(actual.views.searchPrompt.features, [actual.features.full.id]); assert.deepEqual(actual.views.searchPr.features, [actual.features.merged.id]); assert.ok(actual.views.searchName.features.includes(actual.features.liveOld.id));
  assert.ok(actual.views.hasEdits.features.every((id) => id === actual.features.liveOld.id)); assert.ok(!actual.views.noEdits.features.includes(actual.features.liveOld.id)); assert.deepEqual(actual.views.editStatus.features, [actual.features.liveOld.id]);
});
t('every grouping has the same three-level shape and every feature lands in a group', () => {
  for (const k of ['default', 'byBuild', 'byDay', 'byType', 'byRepo', 'byApp', 'byPlugin', 'flat']) { const v = actual.views[k]; assert.equal(v.groups.reduce((s, g) => s + g.count, 0) >= v.features.length, true, k); for (const g of v.groups) assert.ok(g.label && g.key, k); }
  assert.equal(actual.views.default.groups.find((g) => g.key === 'amberx-axf#330').record, 'amberx-axf#330'); assert.equal(actual.views.byBuild.groups.find((g) => g.key === 'angel:shipped-features-r2').label, 'Shipped features'); assert.equal(actual.views.flat.groups.length, 1);
});
t('a bogus view falls back to the defaults field by field', () => { const v = actual.views.bogus.view; assert.equal(v.by, 'pr'); assert.deepEqual(v.sort, { by: 'liveAt', dir: 'desc' }); assert.equal(v.hideCancelled, true); assert.deepEqual(v.statuses, ['live']); assert.equal(v.hasEdits, null); });
t('chips: guessed dates carry ~, stalled is said, edited chip counts', () => {
  assert.equal(L.statusChip({ status: 'live', liveAt: { site: { at: '2026-11-05T02:00:00Z', guessed: true } } }).label, '~Live'); assert.equal(L.statusChip({ status: 'building', stalled: true }).tone, 'warn');
  const c = actual.chips.find((x) => x.id === actual.features.liveOld.id); assert.equal(c.edited.count, 3); assert.match(c.edited.label, /^Edited ×3/);
});
t('the said block keeps his words whole and marks the passage', () => { assert.equal(actual.saidBlock.length, 1); assert.deepEqual(actual.saidBlock[0].highlight, [12, 28]); assert.equal(actual.saidBlock[0].verbatim, true); });
t('migration: version 0 → 1 keeps every record, maps `live` onto liveAt and finds `since`', () => { const m = actual.migrate; assert.equal(m.version, 1); assert.equal(m.features[0].status, 'live'); assert.equal(m.prs.length, 1); assert.equal(m.prompts.length, 1); assert.equal(m.deploys.length, 1); assert.equal(m.since, '2026-11-04T12:00:00Z'); });
t('merging ledgers: same id merges, verbatim prompt beats paraphrased, every feature kept', () => { const m = actual.mergeLedgers; assert.equal(m.features.length, 2); assert.equal(m.features[0].prs.length, 2); assert.equal(m.prompts[0].verbatim, true); });
t('validators name the field', () => {
  assert.deepEqual(actual.validateFeature.nameless, ['name', 'app']); assert.deepEqual(actual.validateEdit.nothing, ['build']); assert.deepEqual(actual.validateEdit.empty, ['feature', 'summary', 'build']); assert.deepEqual(actual.validatePr.bad, ['number']); assert.deepEqual(actual.validatePrompt.bad, ['verbatim']);
  assert.match(L.rejection(L.validateFeature({}).errors), /^name is missing/);
});
t('export: CSV and Markdown carry the same cells, dates marked', () => { assert.equal(actual.csv.split('\n').length, 4); assert.equal(actual.markdown.split('\n').length, 5); assert.match(actual.csv, /console: 2026-11-05T01:00:00Z/); });

// ------------------------------------------------------------------ snapshots
t('schemas/feature-ledger.json matches REGISTRY (run axf schemas)', () => assert.ok(same(JSON.parse(rd('framework/schemas/feature-ledger.json')), L.REGISTRY)));
t('schemas/deploy-log.json matches deploy-log REGISTRY (run axf schemas)', () => assert.ok(same(JSON.parse(rd('framework/schemas/deploy-log.json')), D.REGISTRY)));
for (const [name, schema] of Object.entries({ ...L.jsonSchemas(), ...D.jsonSchemas() })) t(`schemas/json/${name} is current (run axf schemas)`, () => assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), schema)));
t('PORTING.md lists the contract', () => assert.match(rd('framework/spec/PORTING.md'), /feature-ledger@1/));

console.log(`check-feature-ledger: ${n} checks passed`);
