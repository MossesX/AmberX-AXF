// Self-test: node apps/console-web/plugins/build-profiles/cleanup.test.mjs
// Build profiles cleanup helper (web/cleanup-core.mjs): the scan's answer in the shape the panel shows, grouping,
// the plain-words lines, what a one-tap fix and Fix all send, and what the person is told afterwards. Then the files:
// the dialog and action are declared, the panel uses framework controls and asset tokens only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './web/cleanup-core.mjs';

const PLUGIN = dirname(fileURLToPath(import.meta.url));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

// what framework/plan/builds-store-core.mjs cleanupScan answers
const SCAN = {
  ok: true,
  findings: [
    { kind: 'archived-complete', id: 'big-dog', title: 'Big dog', profiles: ['all'], status: 'archived', evidence: 'merged', fixable: true, to: 'landed', why: '' },
    { kind: 'archived-complete', id: 'angel', title: 'Angel', profiles: ['all'], status: 'archived', evidence: 'steps-done', fixable: true, to: 'complete', why: '' },
    { kind: 'archived-complete', id: 'breakroom', title: 'Breakroom', profiles: ['all'], status: 'archived', evidence: 'steps-done', fixable: false, to: '', why: 'no merged PR on record' },
    { kind: 'orphan-profile', id: 'refactor-one', title: 'Refactor one', profiles: ['refactor'], status: 'pending', evidence: 'refactor', fixable: true, to: 'all', why: '' },
  ],
  counts: { 'archived-complete': 3, 'orphan-profile': 1 },
  fixable: 3,
};

t('the scan is read as it comes', () => {
  const s = C.normalizeScan(SCAN);
  assert.equal(s.total, 4); assert.equal(s.fixable, 3);
  assert.deepEqual(s.counts, { 'archived-complete': 3, 'orphan-profile': 1 });
  assert.deepEqual(s.findings[0], { kind: 'archived-complete', id: 'big-dog', title: 'Big dog', profiles: ['all'], status: 'archived', fixable: true, to: 'landed', why: '', evidence: 'merged' });
  assert.equal(s.findings[2].fixable, false); assert.equal(s.findings[2].why, 'no merged PR on record');
});

t('other shapes and junk never throw', () => {
  for (const junk of [null, undefined, 7, 'x', [], {}, { findings: 'no' }, { findings: [null, 3, {}, { title: 'no id' }] }]) assert.deepEqual(C.normalizeScan(junk), { findings: [], counts: {}, fixable: 0, total: 0 });
  // the short shape ({ found: [{ build, profile, why }] }): an archived build with no proof is listed, not fixable
  const s = C.normalizeScan({ found: [{ build: 'angel', profile: 'all' }, { build: 'breakroom', profile: 'all', why: 'no merged PR on record' }] });
  assert.deepEqual(s.findings.map((f) => [f.id, f.kind, f.fixable, f.profiles[0], f.status]), [['angel', 'archived-complete', true, 'all', 'archived'], ['breakroom', 'archived-complete', false, 'all', 'archived']]);
  // the same build listed twice for the same reason is one row; two reasons are two rows
  assert.equal(C.normalizeScan({ findings: [SCAN.findings[0], SCAN.findings[0], { ...SCAN.findings[0], kind: 'orphan-profile' }] }).total, 2);
  assert.equal(C.normalizeScan({ findings: [{ id: 'x'.repeat(500) }] }).findings[0].id.length, 120);
});

t('groups: known kinds first, fixable rows first, then by id', () => {
  const s = C.normalizeScan({ findings: [...SCAN.findings, { kind: 'something-new', id: 'zz', fixable: false, why: 'new rule' }] });
  const g = C.groupFindings(s.findings);
  assert.deepEqual(g.map((x) => [x.kind, x.rows.map((r) => r.id), x.fixable]), [
    ['archived-complete', ['angel', 'big-dog', 'breakroom'], 2],
    ['orphan-profile', ['refactor-one'], 1],
    ['something-new', ['zz'], 0],
  ]);
  assert.equal(g[0].title, 'Archived, but finished'); assert.ok(g[0].hint);
  assert.equal(g[2].title, 'something-new');
  assert.deepEqual(C.groupFindings([]), []);
});

t('plain words for why and what the fix does', () => {
  const [merged, steps, stuck, orphan] = C.normalizeScan(SCAN).findings;
  assert.equal(C.evidenceText(merged), 'its PR merged'); assert.equal(C.fixText(merged), 'archived → landed');
  assert.equal(C.evidenceText(steps), 'every step is done'); assert.equal(C.fixText(steps), 'archived → complete');
  assert.equal(C.fixText(stuck), '');
  assert.equal(C.evidenceText(orphan), 'profile "refactor" is gone'); assert.equal(C.fixText(orphan), 'move to all');
  assert.equal(C.evidenceText({ ...orphan, evidence: 'a, b' }), 'profile "a", "b" is gone');
});

t('headline', () => {
  assert.equal(C.summaryText(C.normalizeScan({})), 'Nothing to clean up.');
  assert.equal(C.summaryText(C.normalizeScan(SCAN)), '3 archived builds are really finished · 1 build is in a profile that no longer exists. 1 needs a look: no proof on record to fix it here.');
  assert.equal(C.summaryText(C.normalizeScan({ findings: [SCAN.findings[0]] })), '1 archived build is really finished.');
  assert.equal(C.summaryText(C.normalizeScan({ findings: [SCAN.findings[2], { ...SCAN.findings[2], id: 'b2' }] })), '2 archived builds are really finished. 2 need a look: no proof on record to fix them here.');
});

t('what a fix sends: only fixable builds, the profile filter when there is one', () => {
  const s = C.normalizeScan(SCAN);
  assert.deepEqual(C.fixRequest(s), { builds: ['big-dog', 'angel', 'refactor-one'] });
  assert.deepEqual(C.fixRequest(s, { ids: ['angel'] }), { builds: ['angel'] });
  assert.deepEqual(C.fixRequest(s, { ids: ['breakroom', 'not-found', 'angel', 'angel'], profile: 'all' }), { builds: ['angel'], profile: 'all' });
  assert.deepEqual(C.fixRequest(C.normalizeScan({})), { builds: [] });
});

t('the fix answer: fixed, refused, left', () => {
  // what profiles.mjs act answers
  const r = C.normalizeFix({ ok: true, report: { fixed: [{ kind: 'archived-complete', id: 'angel', to: 'complete' }], refused: [{ kind: 'archived-complete', id: 'big-dog', to: 'landed', why: 'no merge on record' }] } }, ['angel', 'big-dog']);
  assert.deepEqual(r, { fixed: [{ id: 'angel', kind: 'archived-complete', to: 'complete' }], refused: [{ id: 'big-dog', why: 'no merge on record' }], left: null });
  assert.deepEqual(C.normalizeFix({ fixed: ['angel'], left: 2 }), { fixed: [{ id: 'angel', kind: '', to: '' }], refused: [], left: 2 });
  // an answer that only says it worked: what was asked counts as fixed, minus what it refused
  assert.deepEqual(C.normalizeFix({ ok: true, refused: [{ id: 'b' }] }, ['a', 'b']).fixed.map((f) => f.id), ['a']);
  assert.deepEqual(C.normalizeFix({ ok: false }, ['a']).fixed, []);
  assert.deepEqual(C.normalizeFix({ ok: true, report: { fixed: [] } }, ['a']).fixed, []);
  assert.deepEqual(C.normalizeFix(null), { fixed: [], refused: [], left: null });
});

t('what the person is told', () => {
  assert.deepEqual(C.fixMessage({ fixed: [], refused: [], left: null }), { tone: 'info', text: 'Nothing needed fixing.' });
  assert.deepEqual(C.fixMessage({ fixed: [{ id: 'angel', kind: '', to: 'complete' }], refused: [], left: 0 }), { tone: 'success', text: '1 build fixed: angel is now complete.' });
  assert.deepEqual(C.fixMessage({ fixed: [{ id: 'a', kind: '', to: '' }, { id: 'b', kind: '', to: '' }], refused: [], left: 0 }), { tone: 'success', text: '2 builds fixed.' });
  assert.deepEqual(C.fixMessage({ fixed: [{ id: 'a', kind: '', to: '' }], refused: [{ id: 'b', why: 'no merge on record' }], left: 1 }), { tone: 'warning', text: '1 build fixed. 1 not changed (b: no merge on record).' });
  const many = C.fixMessage({ fixed: [], refused: ['a', 'b', 'c', 'd'].map((id) => ({ id, why: 'kept' })), left: 4 });
  assert.equal(many.tone, 'danger'); assert.ok(many.text.endsWith('c: kept; …).'));
});

t('the plugin declares the helper and the panel stays inside the UI rules', () => {
  const read = (f) => readFileSync(join(PLUGIN, f), 'utf8');
  const manifest = JSON.parse(read('plugin.json'));
  assert.ok(manifest.provides.includes('dialog:build-profiles-cleanup'));
  assert.equal(manifest.id, 'ai.amberx.axf.console.build-profiles');
  const tsx = read('web/cleanup.tsx'); const index = read('web/index.tsx'); const menu = read('web/menu.ts');
  assert.match(tsx, /CLEANUP_DIALOG = 'build-profiles-cleanup'/); assert.match(tsx, /CLEANUP_ACTION = 'build-profiles\.cleanup'/);
  assert.match(index, /registerCleanup\(rt\)/); assert.match(index, /\.\.\.cleanupDialogs/);
  assert.match(menu, /action: 'build-profiles\.cleanup'/);
  assert.ok(!/<button\b|<input\b|<select\b|style=\{/.test(tsx), 'framework controls only, no inline styles');
  // the panel reads and fixes through the plugin's own route only
  assert.deepEqual([...tsx.matchAll(/pluginFetch\(FOLDER, [`']([a-z-]+)/g)].map((m) => m[1]), ['cleanup', 'cleanup']);
  const css = read('web/cleanup.css');
  for (const rule of css.split('\n').filter((l) => l.startsWith('.'))) assert.ok(rule.startsWith('.axp-build-profiles-cleanup'), rule.slice(0, 60));
  assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\d(px|rem|em)\b|var\([^)]*,/i.test(css.replace(/\/\*.*?\*\//gs, '')), 'asset tokens only: no literals, no var() fallbacks');
  const help = JSON.parse(read('help.json'));
  for (const target of ['action:build-profiles.cleanup', 'clean-up-builds', 'review-cleanup', 'fix', 'fix-all', 'scan-again']) assert.ok(help.data.entries.some((e) => e.target === target && !e.draft), `help for ${target}`);
});

console.log(`✓ build-profiles cleanup helper: ${n} checks`);
