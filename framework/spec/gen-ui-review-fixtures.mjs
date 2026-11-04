import { writeFileSync } from 'node:fs';
import { validateItem, validateGroup } from '../core/ui-review-schema.mjs';
const T = '2026-11-01T08:20:00Z';
const good = { $axf: 'ui-review-item@1', id: 'r-20261101-breakroom', name: 'Breakroom phone check', group: { id: 'g-20261101-breakroom-check', name: 'Breakroom check - Nov 1 8:20 AM' },
  createdAt: T, kind: 'review', source: 'headless', submittedBy: { type: 'build', id: 'claude/review-schema' }, app: 'Console', screen: 'Breakroom', viewport: 'phone',
  files: { before: [{ src: 'items/r-20261101-breakroom/before-phone.png', viewport: 'phone' }], after: [{ src: 'items/r-20261101-breakroom/after-phone.png', viewport: 'phone' }] }, status: 'pending', pr: 412, build: { id: 'review-schema', step: 's2' }, note: 'Spacing fixed' };
const shot = { ...good, id: 's-20261101-live', name: 'Live capture of Settings', kind: 'screenshot', source: 'watch-live', screen: '/settings', viewport: 'desktop', files: { before: [], after: [{ src: 'shots/live-desktop.png' }] } };
delete shot.status;
const w = (o, k) => { const c = structuredClone(o); delete c[k]; return c; };
const set = (o, patch) => ({ ...structuredClone(o), ...patch });
const items = {
  'valid review item': good,
  'valid screenshot': shot,
  'every source is accepted (claude-voice)': set(good, { source: 'claude-voice', submittedBy: { type: 'session', id: 'voice-1' } }),
  'missing name': w(good, 'name'),
  'blank name': set(good, { name: '   ' }),
  'name is a file name': set(good, { name: 'after-phone.png' }),
  'name looks like an id': set(good, { name: 'r-20261101-ab12' }),
  'missing createdAt': w(good, 'createdAt'),
  'createdAt not ISO': set(good, { createdAt: 'yesterday' }),
  'createdAt date only': set(good, { createdAt: '2026-11-01' }),
  'missing group': w(good, 'group'),
  'group without a name': set(good, { group: { id: 'g-1' } }),
  'unknown kind': set(good, { kind: 'design' }),
  'unknown source': set(good, { source: 'cli' }),
  'missing submittedBy': w(good, 'submittedBy'),
  'submittedBy without a type': set(good, { submittedBy: { id: 'x' } }),
  'missing app': w(good, 'app'),
  'missing screen': w(good, 'screen'),
  'bad viewport': set(good, { viewport: 'watch' }),
  'no screenshots': set(good, { files: { before: [], after: [] } }),
  'file without src': set(good, { files: { after: [{ name: 'x' }] } }),
  'review item without status': w(good, 'status'),
  'old status word (waiting) is not stored': set(good, { status: 'waiting' }),
  'screenshot with a status': set(shot, { status: 'approved' }),
  'pr not a number': set(good, { pr: 'abc' }),
  'wrong $axf': set(good, { $axf: 'review-item@1' }),
  'empty object': {},
};
const groups = {
  'valid group': { $axf: 'ui-review-group@1', id: 'g-20261101-breakroom-check', name: 'Breakroom check - Nov 1 8:20 AM', createdAt: T, source: 'claude-chat', submittedBy: { type: 'user', id: 'brett' } },
  'group missing name': { $axf: 'ui-review-group@1', id: 'g-1', createdAt: T, source: 'console' },
  'group missing createdAt': { $axf: 'ui-review-group@1', id: 'g-1', name: 'Settings pass', source: 'console' },
  'group unknown source': { $axf: 'ui-review-group@1', id: 'g-1', name: 'Settings pass', createdAt: T, source: 'api' },
};
const out = { $about: 'ui-review-item@1 / ui-review-group@1 conformance: every validator (framework/core/ui-review-schema.mjs, the ui-review server) reports these fields. Regenerate only on purpose.', items: {}, groups: {} };
for (const [k, v] of Object.entries(items)) { const r = validateItem(v); out.items[k] = { item: v, ok: r.ok, errors: r.errors.map((e) => e.field) }; }
for (const [k, v] of Object.entries(groups)) { const r = validateGroup(v); out.groups[k] = { group: v, ok: r.ok, errors: r.errors.map((e) => e.field) }; }
writeFileSync(new URL('./fixtures/ui-review-item.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
for (const [k, v] of Object.entries(out.items)) console.log(k.padEnd(45), v.ok, v.errors.join(','));
for (const [k, v] of Object.entries(out.groups)) console.log(k.padEnd(45), v.ok, v.errors.join(','));
