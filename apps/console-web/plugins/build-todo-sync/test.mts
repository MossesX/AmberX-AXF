// @ts-nocheck: a Node test, not part of the console's build
// Pure part of the Build to-do sync web plugin: node --experimental-strip-types apps/console-web/plugins/build-todo-sync/test.mts (or npx -y tsx …)
import assert from 'node:assert/strict';
import { askLine, cleanName, groupBuilds, parseFrame, promptCandidates, since, statusLine, type MirroredBuild, type NameRow } from './web/core.ts';

let n = 0; const t = (name: string, fn: () => void) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const NOW = Date.parse('2026-11-04T18:00:00Z');
const b = (id: string, place: string, displayName = id): MirroredBuild => ({ id, displayName, title: id, category: place, area: '', nameReview: false, status: 'pending', place, profiles: ['main-framework'], steps: 3, done: 1, next: '', updatedAt: '' });

t('groupBuilds: categories A→Z, then Done, then Archive; builds by name', () => {
  const g = groupBuilds([b('z', 'Done'), b('a', 'Plugin', 'Zed'), b('b', 'Plugin', 'Alpha'), b('c', 'Archive'), b('d', 'App')]);
  assert.deepEqual(g.map((x) => x.place), ['App', 'Plugin', 'Done', 'Archive']); assert.deepEqual(g[1]!.builds.map((x) => x.displayName), ['Alpha', 'Zed']);
});
t('since', () => { assert.equal(since('', NOW), ''); assert.equal(since('2026-11-04T17:59:40Z', NOW), 'just now'); assert.equal(since('2026-11-04T17:40:00Z', NOW), '20 min ago'); assert.equal(since('2026-11-04T10:00:00Z', NOW), '8 h ago'); assert.equal(since('2026-10-30T18:00:00Z', NOW), '5 d ago'); });
t('parseFrame takes only our frames', () => { assert.equal(parseFrame('{"$axf":"build-todo-sync@1","type":"synced"}')?.type, 'synced'); assert.equal(parseFrame({ $axf: 'other', type: 'x' }), null); assert.equal(parseFrame('nope'), null); });
t('askLine', () => { assert.match(askLine({ id: 'x', kind: 'ticked', build: 'b', step: 'u', stepId: 's2', item: 'i', at: '', state: 'open', title: '' }), /ticked step s2 of b/); assert.match(askLine({ id: 'x', kind: 'unticked', build: 'b', step: 'u', stepId: '', item: 'i', at: '', state: 'open', title: '' }), /unticked step u of b .* Reopen/); });
t('promptCandidates: fresh, unreviewed, not yet prompted, newest first; off = none', () => {
  const row = (id: string, createdAt: string, status = 'pending'): NameRow => ({ id, title: id, displayName: id, category: 'Feature', area: '', status, source: 'console', createdAt, profiles: [], suggested: { displayName: id, category: 'Feature', why: '', confidence: 'low' } });
  const rows = [row('old', '2026-11-04T10:00:00Z'), row('new', '2026-11-04T17:55:00Z'), row('newer', '2026-11-04T17:58:00Z'), row('done', '2026-11-04T17:59:00Z', 'complete')];
  assert.deepEqual(promptCandidates(rows, new Set(), { now: NOW }).map((r) => r.id), ['newer', 'new']);
  assert.deepEqual(promptCandidates(rows, new Set(['newer']), { now: NOW }).map((r) => r.id), ['new']);
  assert.deepEqual(promptCandidates(rows, new Set(), { now: NOW, autoPrompt: false }), []);
});
t('cleanName trims and caps', () => { assert.equal(cleanName('  Build   to-do  sync '), 'Build to-do sync'); assert.equal(cleanName('x'.repeat(60)).length, 48); assert.equal(cleanName('   '), ''); });
t('statusLine', () => {
  const base = { enabled: true, control: true, lastSync: '2026-11-04T17:58:00Z', lastOk: true, lastError: '', lastSummary: { builds: 4, groups: 2, ops: 0, adds: 0, sets: 0, removes: 0, drift: 0 } };
  assert.deepEqual(statusLine(base, NOW), { tone: 'success', text: 'Synced 2 min ago · 4 build list(s)' });
  assert.equal(statusLine({ ...base, control: false }, NOW).tone, 'danger'); assert.equal(statusLine({ ...base, enabled: false }, NOW).tone, 'warning');
  assert.equal(statusLine({ ...base, lastOk: false, lastError: 'boom' }, NOW).text, 'Last sync failed 2 min ago: boom'); assert.equal(statusLine({ ...base, lastSync: '' }, NOW).text, 'Not synced yet');
});
console.log(`build-todo-sync web core: ${n} checks passed`);
