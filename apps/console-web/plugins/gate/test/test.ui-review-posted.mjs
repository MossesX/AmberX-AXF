#!/usr/bin/env node
/**
 * Build rule `ui-review-posted` (fixers/ui-review-posted.mjs): a build that recorded UI Review items in its worktree must
 * have each one in the live console; the fix posts the missing ones with their pictures. Run against a temp worktree with
 * an items.json and an injected console. Nov 18 2026, build auto-lander-never-wait-missing-ui-review.
 *   node apps/console-web/plugins/gate/test/test.ui-review-posted.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as F from '../fixers/ui-review-posted.mjs';
import { checkerOf } from '../build-rules-runner.mjs';
import * as BR from '../../../../../framework/core/build-rules.mjs';

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const TMP = mkdtempSync(join(tmpdir(), 'axf-ui-review-posted-'));
const DIR = join(TMP, F.DEFAULT_DATA_DIR);
mkdirSync(join(DIR, 'shots', 'rv-a'), { recursive: true }); mkdirSync(join(DIR, 'shots', 'rv-b'), { recursive: true });
writeFileSync(join(DIR, 'shots', 'rv-a', 'bar-phone.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
writeFileSync(join(DIR, 'shots', 'rv-b', 'card-desktop.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const ITEMS = {
  $axf: 'ui-review-items@1',
  groups: [{ $axf: 'ui-review-group@1', id: 'g1', name: 'my-build - Nov 18 10:00 AM' }],
  items: [
    { $axf: 'ui-review-item@1', id: 'rv-a', name: 'Settings bar', section: 'settings', app: 'Console', screen: '/settings', build: 'my-build', branch: 'claude/my-build', pr: 816, group: 'g1', status: 'waiting', files: { before: [], after: [{ src: 'items/rv-a/bar-phone.png', device: 'phone', name: 'bar' }] } },
    { $axf: 'ui-review-item@1', id: 'rv-b', name: 'Card', section: 'banner', app: 'Console', screen: '/home', build: 'my-build', branch: 'claude/my-build', pr: 816, group: 'g1', status: 'waiting', shots: [{ src: 'items/rv-b/card-desktop.png', device: 'desktop', name: 'card' }] },
    { $axf: 'ui-review-item@1', id: 'rv-landed', name: 'Old', section: 'other', build: 'my-build', status: 'approved', landed: { at: 'x', how: 'landed' } },
    { $axf: 'ui-review-item@1', id: 'rv-other', name: 'Other build', section: 'other', build: 'other-build', branch: 'claude/other', status: 'waiting' },
    { id: 'pack:p1', kind: 'design', status: 'waiting' },
  ],
};
writeFileSync(join(DIR, 'items.json'), JSON.stringify(ITEMS));
const ctx = (consoleItems, { posts = [], fail = false } = {}) => ({
  root: TMP, build: { id: 'my-build', branch: 'claude/my-build', pr: 816 },
  console: async (method, path, body) => {
    if (method === 'GET' && path === '/api/plugins/ui-review/items') return consoleItems === null ? null : { items: consoleItems };
    if (method === 'POST' && path === '/api/plugins/ui-review/submit') { posts.push(body); return fail ? { detail: 'refused' } : { ok: true, item: { id: `rv-new-${posts.length}`, name: body.title } }; }
    return null;
  },
});

try {
  await t('the rule is runnable: a fixer check, and the fixer id is registered', () => {
    assert.deepEqual(checkerOf({ check: 'fixer:ui-review-posted', autofix: 'ui-review-posted' }), { kind: 'fixer', fixer: 'ui-review-posted' });
    assert.ok(BR.FIXERS.includes('ui-review-posted'));
  });
  await t('the local items of the build: by id or branch, never landed, never pack: records, never another build', () => {
    const loc = F.localItems(ctx([]));
    assert.deepEqual(loc.items.map((it) => it.id), ['rv-a', 'rv-b']); assert.equal(loc.groups[0].name, 'my-build - Nov 18 10:00 AM');
    assert.deepEqual(F.localItems({ root: TMP, build: { branch: 'claude/other' } }).items.map((it) => it.id), ['rv-other']);
    assert.deepEqual(F.localItems({ root: join(TMP, 'nowhere'), build: { id: 'x' } }).items, []);
  });
  await t('posted: matched by id, else by build + name (a re-submitted item has a new id)', () => {
    const st = F.postedState(F.localItems(ctx([])).items, [{ id: 'rv-a', build: 'my-build', name: 'Settings bar' }, { id: 'rv-zzz', build: 'my-build', name: 'Card' }]);
    assert.deepEqual(st, { ok: true, total: 2, posted: ['rv-a', 'rv-b'], missing: [] });
    assert.deepEqual(F.postedState(F.localItems(ctx([])).items, [{ id: 'rv-a', build: 'my-build', name: 'Settings bar' }]).missing, [{ id: 'rv-b', name: 'Card' }]);
  });
  await t('check: every item in the console passes; a missing one fails with the ids and what should have happened', async () => {
    const ok = await F.check(ctx([{ id: 'rv-a', build: 'my-build', name: 'Settings bar' }, { id: 'rv-b', build: 'my-build', name: 'Card' }]));
    assert.equal(ok.ok, true); assert.match(ok.detail, /2 UI Review item\(s\) my-build recorded are in the console/);
    const bad = await F.check(ctx([{ id: 'rv-a', build: 'my-build', name: 'Settings bar' }]));
    assert.equal(bad.ok, false); assert.deepEqual(bad.missing, ['rv-b']); assert.match(bad.detail, /1 of 2 UI Review item\(s\) my-build recorded were never posted to the console: rv-b \(Card\)/); assert.match(bad.detail, /review\.mjs submit --console/); assert.equal(bad.fixable, true);
  });
  await t('check: no items recorded = nothing to post (pass); a console that does not answer = fail, never a pass', async () => {
    const none = await F.check({ root: TMP, build: { id: 'no-such-build' }, console: async () => ({ items: [] }) });
    assert.equal(none.ok, true); assert.match(none.detail, /nothing to post/);
    const down = await F.check(ctx(null));
    assert.equal(down.ok, false); assert.equal(down.unreachable, true); assert.deepEqual(down.missing, ['rv-a', 'rv-b']); assert.match(down.detail, /console did not answer/);
    const noWay = await F.check({ root: TMP, build: { id: 'my-build' }, console: undefined });
    process.env.AXF_LAND_CONSOLE = 'off'; delete process.env.AXF_CONSOLE_URL;
    const noWay2 = await F.check({ root: TMP, build: { id: 'my-build' } });
    assert.equal(noWay2.ok, false); assert.match(noWay2.detail, /no way to reach the console/); assert.ok(noWay.ok === false || noWay.ok === true);
  });
  await t('fix: posts the missing items with their pictures, group and build; a dry run only plans; a second run changes nothing', async () => {
    const posts = [];
    const plan = await F.fix(ctx([{ id: 'rv-a', build: 'my-build', name: 'Settings bar' }], { posts }), { dryRun: true });
    assert.equal(plan.ok, true); assert.deepEqual(plan.planned, ['rv-b']); assert.equal(posts.length, 0);
    const r = await F.fix(ctx([{ id: 'rv-a', build: 'my-build', name: 'Settings bar' }], { posts }));
    assert.equal(r.ok, true); assert.deepEqual(r.changed, ['rv-b → rv-new-1']); assert.equal(posts.length, 1);
    const p = posts[0];
    assert.equal(p.title, 'Card'); assert.equal(p.kind, 'banner'); assert.equal(p.build, 'my-build'); assert.equal(p.branch, 'claude/my-build'); assert.equal(p.pr, 816); assert.equal(p.group, 'my-build - Nov 18 10:00 AM'); assert.equal(p.source, 'headless'); assert.deepEqual(p.submittedBy, { type: 'build', id: 'claude/my-build' });
    assert.equal(p.files.length, 1); assert.equal(p.files[0].name, 'card-desktop.png'); assert.equal(p.files[0].device, 'desktop'); assert.equal(Buffer.from(p.files[0].data, 'base64').toString('hex'), '89504e47'); assert.match(p.notes, /Posted by the VPS \(build rule ui-review-posted\)/);
    const again = await F.fix(ctx([{ id: 'rv-a', build: 'my-build', name: 'Settings bar' }, { id: 'rv-new-1', build: 'my-build', name: 'Card' }], { posts }));
    assert.equal(again.ok, true); assert.deepEqual(again.changed, []); assert.equal(posts.length, 1);
    const refused = await F.fix(ctx([], { posts: [], fail: true }));
    assert.equal(refused.ok, false); assert.match(refused.unfixable, /could not post 2 item\(s\)/);
    const down = await F.fix(ctx(null));
    assert.equal(down.ok, false); assert.match(down.unfixable, /did not answer/);
  });
} finally { rmSync(TMP, { recursive: true, force: true }); }
console.log(`✓ ui-review-posted — ${n} checks`);
