// @ts-nocheck: a Node test, not part of the console's build
// Self-test for What's new's pure part: node --experimental-strip-types apps/console-web/plugins/whats-shipped/test.mts
import assert from 'node:assert/strict';
import * as c from './web/core.ts';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n += 1; console.log(`  ✓ ${name}`); };
const now = new Date(2026, 10, 3, 15, 0, 0).getTime(); // Nov 3 2026, 15:00 local
const at = (daysAgo: number, h = 10) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const app = (id: string, label: string, kind: c.FeedApp['kind'] = 'app'): c.FeedApp => ({ id, label, kind });
const item = (id: string, mergedAt: string, extra: Partial<c.FeedItem> = {}): c.FeedItem => ({
  id, title: `Feature ${id}`, summary: '', details: [], build: null, apps: [], where: '', mergedAt, deployed: true, deployedAt: '',
  pr: null, branch: '', sha: '', report: '', filesKnown: true, ...extra,
});
const items = [
  item('a', at(0), { build: { id: 'theme-editor', title: 'Theme Editor', profile: 'urgent' }, apps: [app('app:console-web', 'Dev Console'), app('plugin:theme-editor', 'Theme Editor', 'plugin')] }),
  item('b', at(1), { build: { id: 'dock', title: 'Dock engine', profile: 'urgent' }, apps: [app('framework', 'Framework', 'framework')], summary: 'Split and float panes' }),
  item('c', at(4), { build: { id: 'theme-editor', title: 'Theme Editor', profile: 'urgent' }, apps: [app('app:console-web', 'Dev Console')] }),
  item('d', at(20), { pr: { number: 77, url: '' } }),
];

console.log("whats-shipped pure part");
t('date buckets: today, yesterday, this week, older', () => {
  assert.deepEqual(items.map((i) => c.dateBucket(i.mergedAt, now).label), ['Today', 'Yesterday', 'This week', 'Older']);
  assert.equal(c.dateBucket('nope', now).label, 'Older');
});
t('group by date: in date order, items newest first', () => {
  const g = c.groupItems([...items].reverse(), 'date', now);
  assert.deepEqual(g.map((x) => x.label), ['Today', 'Yesterday', 'This week', 'Older']);
});
t('group by build: newest build first, no build last', () => {
  const g = c.groupItems(items, 'build', now);
  assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.id).join('')]), [['Theme Editor', 'ac'], ['Dock engine', 'b'], ['No build on record', 'd']]);
});
t('group by app: an item shows under each app it touched; none = Other, last', () => {
  const g = c.groupItems(items, 'app', now);
  assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.id).join('')]), [['Dev Console', 'ac'], ['Theme Editor', 'a'], ['Framework', 'b'], ['Other', 'd']]);
});
t('search: every word must match, across title, summary, build, apps and PR', () => {
  assert.deepEqual(c.search(items, 'split panes').map((i) => i.id), ['b']);
  assert.deepEqual(c.search(items, 'theme dev').map((i) => i.id), ['a', 'c']);
  assert.deepEqual(c.search(items, '#77').map((i) => i.id), ['d']);
  assert.equal(c.search(items, '  ').length, 4);
});
t('read marks: unread, mark read, cap keeps live ids first', () => {
  const r = c.readSet(['a', 5, 'zz']);
  assert.deepEqual(c.unread(items, r).map((i) => i.id), ['b', 'c', 'd']);
  const many = Array.from({ length: c.MAX_READ + 10 }, (_, i) => `old-${i}`);
  const out = c.markRead(new Set(many), ['b'], items.map((i) => i.id));
  assert.equal(out.length, c.MAX_READ);
  assert.equal(out[0], 'b');
});
t('new since last visit', () => {
  assert.equal(c.isNewSince(items[0], at(1, 12)), true);
  assert.equal(c.isNewSince(items[1], at(1, 12)), false);
  assert.equal(c.isNewSince(items[0], ''), false);
});
t('ticker steps through unread titles, wraps, shortens', () => {
  const r = c.readSet(['a']);
  assert.deepEqual([0, 1, 2, 3].map((k) => c.tickerText(items, r, k)), ['Feature b', 'Feature c', 'Feature d', 'Feature b']);
  assert.equal(c.tickerText(items, c.readSet(items.map((i) => i.id)), 5), 'Feature a');
  assert.equal(c.tickerText([], new Set(), 0), "What's new");
  const long = [item('x', at(0), { title: 'x'.repeat(80) })];
  assert.equal(c.tickerText(long, new Set(), 0).length, 48);
});
t('widget asset: framework status widget, unread count in the label, opens the panel', () => {
  const a = c.statusAsset(items, c.readSet(['a']), 0);
  assert.equal(a.type, 'status');
  assert.equal(a.data.counter, c.COUNTER);
  assert.equal(a.data.onLabel, '3 new · Feature b');
  assert.equal(a.data.link, 'whats-shipped.open');
  assert.equal(c.statusAsset(items, c.readSet(items.map((i) => i.id)), 0).data.offLabel, "What's new · Feature a");
  assert.equal(c.statusAsset([], new Set(), 0, true).data.onLabel, "What's new · What's new …");
});
t('paint: registers, counts unread, attaches on the right or takes it off', () => {
  const log: string[] = [];
  const badges: Record<string, number> = {};
  const host: c.BannerHost = {
    registry: { register: (raw) => { log.push(`reg ${(raw as { id: string }).id}`); } },
    setBadge: (k, v) => { badges[k] = v; },
    attachToBanner: (a) => { log.push(`attach ${a.type}:${a.id}@${a.at}/${a.origin}`); },
    detachFromBanner: (k) => { log.push(`detach ${k}`); },
  };
  c.paintWhatsNew(host, items, c.readSet(['a']), 0, true);
  c.paintWhatsNew(host, items, new Set(), 0, false);
  assert.deepEqual(log, ['reg shipped', `attach status:shipped@right/${c.ID}`, 'reg shipped', 'detach status:shipped']);
  assert.equal(badges[c.COUNTER], 4);
});
t('ago', () => {
  assert.equal(c.ago(new Date(now - 30_000).toISOString(), now), 'just now');
  assert.equal(c.ago(new Date(now - 3 * 3600_000).toISOString(), now), '3h ago');
  assert.equal(c.ago(new Date(now - 2 * 86_400_000).toISOString(), now), '2d ago');
  assert.equal(c.ago('x', now), '');
});
console.log(`all ${n} checks passed`);
