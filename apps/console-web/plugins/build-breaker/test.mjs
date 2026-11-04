// Self-test: node apps/console-web/plugins/build-breaker/test.mjs
// The seed loads and is whole, every ask has an app, filters / sort / group / totals work, the merge keeps unknown
// fields, the CLI works on scratch copies (the repo's seed is never written), and every Build menu entry opens
// something that exists.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as bb from './web/bb-core.mjs';
import * as rq from './web/requests-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const here = new URL('.', import.meta.url).pathname;
const repo = new URL('../../../../', import.meta.url).pathname;
const SEED = join(here, 'data/asks.jsonl');
const seedText = readFileSync(SEED, 'utf8');
const doc = bb.parseJsonl(seedText);
const NOW = Date.parse('2026-10-29T20:00:00-04:00');

// ---- manifest + web entry
t('plugin@1 manifest, lifecycle, model, menus', () => {
  const man = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
  assert.equal(man.id, 'ai.amberx.axf.console.build-breaker');
  assert.equal(man.lifecycle.$axf, 'plugin-lifecycle@1'); assert.equal(man.lifecycle.dataDir, '.axf-console/plugins/build-breaker');
  assert.deepEqual(man.builtWith, { model: 'opus', builtAt: '2026-11-04' });
  assert.equal(man.tabable.view, 'build-breaker');
  for (const f of ['install.mjs', 'uninstall.mjs', 'hooks.mjs', 'asks.mjs']) assert.ok(existsSync(join(here, f)), f);
  const web = readFileSync(join(here, 'web/index.tsx'), 'utf8');
  assert.match(web, /parent: 'plugins'/); assert.match(web, /PluginLifecyclePanel/); assert.match(web, /contextExtras\.set\('\*:build-breaker'/);
  const menu = readFileSync(join(here, 'web/menu.ts'), 'utf8'); assert.match(menu, /menu: 'builds'/); assert.match(menu, /nav:build-breaker/);
});

// ---- the data
t('seed loads: build-asks@1 header + every ask', () => {
  assert.equal(doc.$axf, 'build-asks@1'); assert.equal(doc.skipped, 0);
  assert.ok(doc.asks.length >= 390, `${doc.asks.length} asks`);
  assert.ok(doc.apps.length > 5 && doc.plugins.length > 5);
  assert.deepEqual(bb.checkDoc(doc), []);
});
t('every ask has an app the file knows, plugin asks a known plugin, a date and a known status', () => {
  const apps = new Set(doc.apps.map((a) => a.id)), plugins = new Set(doc.plugins.map((p) => p.id));
  for (const a of doc.asks) {
    assert.ok(apps.has(a.app), `${a.id}: app ${a.app}`);
    if (a.plugin) assert.ok(plugins.has(a.plugin), `${a.id}: plugin ${a.plugin}`);
    assert.ok(bb.askTime(a) > 0, `${a.id}: date`);
    assert.notEqual(bb.statusInfo(a.status).bucket, 'other', `${a.id}: status ${a.status}`);
    assert.ok(a.title.length <= 80, `${a.id}: title one line`);
  }
});
t('round trip keeps unknown fields', () => {
  const again = bb.parseJsonl(bb.toJsonl(doc));
  assert.deepEqual(again.asks, doc.asks); assert.deepEqual(again.gaps, doc.gaps); assert.deepEqual(again.sources, doc.sources);
  const odd = bb.parseJsonl(`${JSON.stringify({ $axf: 'build-asks@1', extra: 1, apps: [{ id: 'x', name: 'X', more: true }], plugins: [] })}\n${JSON.stringify({ id: 'a', app: 'x', title: 'A', askedAt: '2026-10-01T10:00:00Z', status: 'built', future: { y: 2 } })}\nnot json\n`);
  assert.equal(odd.extra, 1); assert.equal(odd.apps[0].more, true); assert.deepEqual(odd.asks[0].future, { y: 2 }); assert.equal(odd.skipped, 1);
  assert.equal(bb.parseAny(JSON.stringify({ ...doc })).asks.length, doc.asks.length);
});

// ---- filters, sort, group, totals
t('search matches title, plain text and his own words (every word)', () => {
  const quoted = doc.asks.find((a) => a.quote && a.quote.split(/\s+/).some((w) => w.length > 6 && !a.title.toLowerCase().includes(w.toLowerCase())));
  const word = quoted.quote.split(/\s+/).find((w) => w.length > 6 && !quoted.title.toLowerCase().includes(w.toLowerCase())).replace(/[^\p{L}\p{N}-]/gu, '');
  assert.ok(bb.filterAsks(doc.asks, { q: word }).some((a) => a.id === quoted.id));
  const r = bb.filterAsks(doc.asks, { q: 'feature matrix' });
  assert.ok(r.length > 0 && r.every((a) => bb.searchText(a).includes('feature') && bb.searchText(a).includes('matrix')));
  assert.equal(bb.filterAsks(doc.asks, { q: 'zzzz-no-such-thing' }).length, 0);
});
t('status (multi), model and date filters', () => {
  const two = bb.filterAsks(doc.asks, { statuses: ['pending', 'held'] });
  assert.ok(two.length > 0 && two.every((a) => ['pending', 'held'].includes(a.status)));
  assert.equal(two.length, doc.asks.filter((a) => a.status === 'pending' || a.status === 'held').length);
  const fable = bb.filterAsks(doc.asks, { models: ['fable'] });
  assert.ok(fable.length > 0 && fable.every((a) => bb.normModel(a.model) === 'Fable'));
  const week = bb.filterAsks(doc.asks, { range: '7' }, NOW);
  assert.ok(week.length > 0 && week.length < doc.asks.length && week.every((a) => bb.askTime(a) >= NOW - 7 * 86400000));
  assert.equal(bb.filterAsks(doc.asks, { range: 'all' }, NOW).length, doc.asks.length);
  const day = bb.filterAsks(doc.asks, { from: '2026-10-21', to: '2026-10-21' });
  assert.ok(day.length > 0 && day.every((a) => bb.dayKey(a) === '2026-10-21'));
});
t('sort: newest first by default, oldest, title, cost', () => {
  const s = bb.sortAsks(doc.asks);
  for (let i = 1; i < s.length; i++) assert.ok(bb.askTime(s[i - 1]) >= bb.askTime(s[i]));
  const o = bb.sortAsks(doc.asks, 'oldest'); assert.ok(bb.askTime(o[0]) <= bb.askTime(o[o.length - 1]));
  const ti = bb.sortAsks(doc.asks, 'title'); assert.ok(ti[0].title.localeCompare(ti[ti.length - 1].title) <= 0);
  const c = bb.sortAsks(doc.asks, 'cost'); assert.ok((c[0].costUsd ?? 0) >= (c[c.length - 1].costUsd ?? 0));
  assert.equal(bb.sortAsks(doc.asks, 'status').length, doc.asks.length);
});
t('group-by keeps every ask once; status groups in registry order', () => {
  for (const g of bb.GROUPS) { const gs = bb.groupAsks(doc.asks, g.id); assert.equal(gs.reduce((k, x) => k + x.asks.length, 0), doc.asks.length, g.id); }
  const st = bb.groupAsks(doc.asks, 'status').map((g) => g.id);
  assert.deepEqual(st, bb.STATUSES.map((s) => s.id).filter((id) => st.includes(id)));
});
t('totals add up (buckets, models, minutes, dollars)', () => {
  const tt = bb.totals(doc.asks);
  assert.equal(Object.values(tt.buckets).reduce((a, b) => a + b, 0), doc.asks.length);
  assert.equal(Object.values(tt.models).reduce((a, b) => a + b.asks, 0), doc.asks.length);
  assert.ok(Math.abs(Object.values(tt.models).reduce((a, b) => a + b.cost, 0) - tt.cost) < 0.01);
  assert.equal(tt.minutes, doc.asks.reduce((a, x) => a + (Number(x.minutes) || 0), 0));
  assert.equal(tt.buckets.built, doc.asks.filter((a) => a.status === 'built').length);
});
t('All tab: app grids (no plugin) + plugin grids show every ask exactly once', () => {
  const apps = bb.sections(doc, doc.asks.filter((a) => !a.plugin), 'app'), plugins = bb.sections(doc, doc.asks, 'plugin');
  const ids = [...apps, ...plugins].flatMap((s) => s.asks.map((a) => a.id));
  assert.equal(ids.length, doc.asks.length); assert.equal(new Set(ids).size, doc.asks.length);
  assert.equal(bb.sections(doc, doc.asks, 'app').reduce((k, s) => k + s.asks.length, 0), doc.asks.length);
});
t('refs, links and formatting', () => {
  assert.deepEqual(bb.refFor({ sources: ['chat:x', 'pending:abc', 'orchestrator:windows-terminal s9-s11'] }), { kind: 'orchestrator', id: 'windows-terminal' });
  assert.deepEqual(bb.refFor({ sources: ['hub-pending:push-banner'] }), { kind: 'pending', id: 'push-banner' });
  assert.deepEqual(bb.refFor({ sources: ['changes:chg-20261021-34507ed28e'] }), { kind: 'change', id: 'chg-20261021-34507ed28e' });
  assert.equal(bb.refFor({ sources: ['chat:x'] }), null);
  assert.ok(doc.asks.filter((a) => bb.refFor(a)).length > 100);
  assert.equal(bb.prUrl(170), 'https://github.com/MossesX/AmberX-AXF/pull/170'); assert.equal(bb.prUrl(null), '');
  assert.equal(bb.fmtMinutes(150), '2h 30m'); assert.equal(bb.fmtMinutes(45), '45m'); assert.equal(bb.fmtCost(8.4), '$8.40'); assert.equal(bb.fmtCost(1234.5, { whole: true }), '$1,235');
  assert.equal(bb.statusInfo('waiting-pull').icon, 'download'); assert.equal(bb.statusInfo('done').id, 'built');
});
t('merge: newer updatedAt wins, mirror-only asks kept, unknown fields kept', () => {
  const seed = { $axf: 'build-asks@1', apps: [{ id: 'x', name: 'X' }], plugins: [], asks: [{ id: 'a', status: 'pending', updatedAt: '2026-10-29T10:00:00Z' }, { id: 'b', status: 'planned' }] };
  const mirror = { $axf: 'build-asks@1', apps: [{ id: 'y', name: 'Y' }], plugins: [], asks: [{ id: 'a', status: 'built', updatedAt: '2026-10-29T09:00:00Z' }, { id: 'b', status: 'built', updatedAt: '2026-10-29T11:00:00Z', keep: 1 }, { id: 'c', status: 'pending' }] };
  const m = bb.mergeDocs(seed, mirror);
  assert.deepEqual(m.asks.map((a) => [a.id, a.status]), [['a', 'pending'], ['b', 'built'], ['c', 'pending']]);
  assert.equal(m.asks[1].keep, 1); assert.deepEqual(m.apps.map((a) => a.id), ['x', 'y']);
});

// ---- the CLI, on scratch copies
t('asks.mjs add | set-status | list | check on scratch copies; the repo seed is untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-test-'));
  const seed = join(dir, 'seed.jsonl'), mirror = join(dir, 'mirror', 'asks.jsonl');
  copyFileSync(SEED, seed);
  const env = { ...process.env, AXF_BUILD_BREAKER_SEED: seed, AXF_BUILD_BREAKER_MIRROR: mirror };
  const cli = (...a) => JSON.parse(execFileSync('node', [join(here, 'asks.mjs'), ...a, '--json'], { env, encoding: 'utf8' }).trim().split('\n').pop());
  const added = cli('add', '--title', 'Test ask from the self-test', '--app', 'console-web', '--minutes', '30', '--model', 'fable', '--quote', 'make it so');
  assert.ok(added.ok); assert.equal(added.ask.model, 'Fable'); assert.equal(added.ask.costUsd, 8.25); assert.equal(added.ask.status, 'pending');
  const set = cli('set-status', added.ask.id, 'waiting-push', '--branch', 'claude/x', '--pr', '9');
  assert.equal(set.ask.status, 'waiting-push'); assert.equal(set.ask.pr, 9);
  const list = cli('list', '--status', 'waiting-push');
  assert.ok(list.asks.some((a) => a.id === added.ask.id));
  assert.ok(cli('check').ok);
  assert.ok(existsSync(mirror));
  assert.equal(bb.parseJsonl(readFileSync(seed, 'utf8')).asks.length, doc.asks.length + 1);
  const bad = (() => { try { execFileSync('node', [join(here, 'asks.mjs'), 'add', '--title', 'x', '--app', 'nope', '--json'], { env, encoding: 'utf8', stdio: 'pipe' }); return null; } catch (e) { return JSON.parse(String(e.stdout).trim()); } })();
  assert.equal(bad?.ok, false); assert.match(bad.error, /unknown app/);
  assert.equal(readFileSync(SEED, 'utf8'), seedText);
});

// ---- the requests ledger (request@1): every source, dedupe, reversals, queue, history, CLI
const RQ_NOW = '2026-11-04T12:00:00.000Z';
const store = [
  { id: 'alpha', title: 'Alpha build', status: 'running', profiles: ['current'], order: { current: 2 }, createdAt: '2026-11-03T10:00:00Z', branch: 'claude/alpha', pr: '#301', // theme-ok: a PR number, not a colour
    origin: { said: 'Build me the alpha thing with every bell and whistle', source: 'voice', at: '2026-11-03T10:00:00Z', addenda: [{ said: 'Also make it blue please, wicked blue', at: '2026-11-03T11:00:00Z', source: 'voice' }] },
    notes: [{ text: 'Assigned: Ping Paulie', at: '2026-11-03T10:01:00Z' }], steps: [{ id: 's1', text: 'Do one', model: 'Opus', done: true, doneAt: '2026-11-03T12:00:00Z' }, { id: 's2', text: 'Do two', model: 'Opus' }] },
  { id: 'beta', title: 'Beta build', status: 'pending', profiles: ['current'], order: { current: 1 }, createdAt: '2026-11-03T09:00:00Z', origin: { said: '' }, steps: [] },
  { id: 'gamma', title: 'Gamma build', status: 'complete', profiles: ['current'], order: { current: 3 }, createdAt: '2026-11-02T09:00:00Z', mergedAt: '2026-11-02T20:00:00Z', origin: { said: 'Gamma please' }, steps: [] },
];
const brief = '# Build: beta (Current profile) - the beta\n\n## What Brett said (verbatim, Nov 4 2026, voice)\n"I want beta lists, separate ones, not filters."\n\n## ADDENDUM 1 (Brett, voice) - OVERRIDES the above\nBrett: "Actually, no, never mind. Leave it as filters."\n';
const memo = '## Nov 3 2026 - queued after the feature freeze\n- **Detach settings** (Brett, voice: "I want to be able to detach settings interfaces."): pop out.\n- **Main tabs** (Brett, voice: "Give the main viewing area a tab group."): tabs.\n\n## Name it Patches (Brett, Nov 3 2026, voice)\nBrett said (verbatim): "From now on, AXHub is going to be referenced by patches."\n\n## Update 2 (Brett, Nov 3 2026, voice) - SUPERSEDES the section above\n- axHub stays **axHub**. ("I ain\'t gonna risk breaking it.")\n';
const src = {
  builds: store, roster: [{ id: 'paulie', name: 'Ping Paulie' }],
  slots: { running: [{ name: 'alpha', session: 'axf-alpha--paulie', startedAt: '2026-11-04T11:00:00Z' }], queue: [{ name: 'beta', state: 'waiting', position: 1 }] },
  costs: [{ buildRef: { kind: 'orchestrator', id: 'alpha' }, actual: { costUsd: 4.5 } }, { buildRef: { kind: 'orchestrator', id: 'alpha' }, estimate: { costUsd: 2 } }],
  briefs: [{ folder: 'beta', text: brief }], plans: [{ id: 'clipx', title: 'ClipX', status: 'parked', createdAt: '2026-10-30T18:00:00Z' }],
  bugs: [{ id: 'bug-1', title: 'Rows do not open', said: 'The rows do not open when I tap them', status: 'open', createdAt: '2026-11-04T08:00:00Z' }],
  memory: [{ file: 'follow-ups.md', text: memo, kind: 'follow-up' }],
  threads: rq.parseThreads('| Thread | State |\n| Gamma (Current `gamma`, Opus; Brett Nov 2 voice: "Gamma please"): done | done |\n| Watch it (Current `watch-it`; Brett Nov 3 voice: "Let me watch it live"): x | working |'),
  asks: [{ id: 'old-one', title: 'Old ask', quote: 'An old thing I asked for long ago', askedAt: '2026-10-20T10:00:00Z', status: 'built', sources: ['chat:x'] }, { id: 'alpha-ask', title: 'Alpha', quote: '', askedAt: '2026-11-03T10:00:00Z', status: 'in-progress', sources: ['orchestrator:alpha'] }],
};
const reqs = rq.assemble(src, rq.emptyLedger(), RQ_NOW);
const R = (id) => reqs.find((r) => r.id === id);
t('request@1: builds, addenda, briefs, plans, bugs, memory, threads and old asks all become requests', () => {
  for (const id of ['build:alpha', 'build:alpha:addendum-1', 'build:beta', 'build:beta:brief-addendum-1', 'build:gamma', 'plan:clipx', 'bug:bug-1', 'ask:old-one', 'thread:watch-it']) assert.ok(R(id), id);
  for (const r of reqs) { assert.equal(r.$axf, 'request@1'); assert.ok(rq.KIND_IDS.includes(r.kind), r.id); assert.ok(rq.STATUSES.some((s) => s.id === r.status), `${r.id} ${r.status}`); }
  assert.ok(!R('ask:alpha-ask'), 'an old ask naming a build joins that build');
  assert.ok(R('build:alpha').where.some((w) => w.kind === 'ask' && w.id === 'alpha-ask'));
  assert.equal(reqs.filter((r) => r.kind === 'follow-up' && r.id.startsWith('memory:follow-ups:')).length, 4);
});
t('verbatim words, where it lives, queue, slot, agent, PR, cost, steps', () => {
  const a = R('build:alpha');
  assert.equal(a.said, 'Build me the alpha thing with every bell and whistle'); assert.equal(a.verbatim, true); assert.equal(a.source, 'voice');
  assert.equal(a.status, 'running'); assert.deepEqual(a.queue, { list: 'current', position: 2, of: 2 }); assert.equal(a.slot.state, 'running');
  assert.equal(a.agent, 'Ping Paulie'); assert.equal(a.agentId, 'paulie'); assert.equal(a.pr, '#301'); assert.equal(a.costUsd, 6.5); assert.equal(a.costEstimated, true); // theme-ok: a PR number, not a colour
  assert.deepEqual([a.steps.done, a.steps.total, a.steps.next], [1, 2, 's2']);
  assert.ok(a.where.some((w) => w.kind === 'step' && w.id === 'alpha#s2'));
  const ad = R('build:alpha:addendum-1'); assert.equal(ad.kind, 'addendum'); assert.equal(ad.parent, 'build:alpha'); assert.equal(ad.said, 'Also make it blue please, wicked blue');
  const b = R('build:beta'); assert.equal(b.said, 'I want beta lists, separate ones, not filters.', 'brief words fill a build without them');
  assert.equal(b.queue.position, 1); assert.equal(b.slot.state, 'waiting');
  assert.equal(R('build:gamma').status, 'merged'); assert.equal(R('build:gamma').queue, null);
  assert.equal(R('plan:clipx').status, 'idea'); assert.equal(R('bug:bug-1').status, 'queued'); assert.equal(R('ask:old-one').status, 'merged');
});
t('reversals: "never mind" reverses the ask; SUPERSEDES marks the earlier memory ask superseded', () => {
  assert.equal(R('build:beta').reversedBy, 'build:beta:brief-addendum-1');
  const sup = reqs.find((r) => r.id.startsWith('memory:follow-ups:name-it-patches'));
  assert.equal(sup.status, 'superseded'); assert.ok(sup.supersededBy.startsWith('memory:follow-ups:axhub-stays'));
  assert.ok(R(sup.supersededBy).supersedes.includes(sup.id));
  const p = rq.parseBrief('# Build: x\n\n## Addendum 1 (Brett, voice) - overrides s2\n"Use Opus for s2"\n', 'x');
  assert.equal(p.addenda[0].reverses, false); assert.equal(p.addenda[0].overrides, true);
});
t('dedupe: the same words in two places are one request', () => {
  const dup = rq.assemble({ ...src, memory: [{ file: 'f.md', text: '## Ask (Brett, Nov 3 2026, voice)\nBrett said (verbatim): "Build me the alpha thing with every bell and whistle"\n', kind: 'follow-up' }] }, rq.emptyLedger(), RQ_NOW);
  assert.equal(dup.filter((r) => rq.sameText(r.said) === rq.sameText('Build me the alpha thing with every bell and whistle')).length, 1);
  assert.ok(dup.find((r) => r.id === 'build:alpha').where.some((w) => w.kind === 'memory'));
});
t('ledger: captured requests, sticky drops, links, notes; live progress beats a stale manual status', () => {
  const { id, record } = rq.captureRecord({ said: 'Turn the banner purple', kind: 'setting', source: 'voice', by: 'Amber' }, RQ_NOW);
  let L = rq.patchLedger(rq.emptyLedger(), id, record, { by: 'Amber', now: RQ_NOW });
  L = rq.patchLedger(L, 'build:gamma', { status: 'live' }, { now: RQ_NOW });
  L = rq.patchLedger(L, 'build:alpha', { status: 'queued', link: { kind: 'bug', id: 'bug-1' }, note: 'watch the colours' }, { now: RQ_NOW });
  const out = rq.assemble(src, L, RQ_NOW);
  const c = out.find((r) => r.id === id); assert.equal(c.kind, 'setting'); assert.equal(c.said, 'Turn the banner purple'); assert.equal(c.capturedBy, 'Amber'); assert.equal(c.status, 'queued');
  assert.equal(out.find((r) => r.id === 'build:gamma').status, 'live');
  const a = out.find((r) => r.id === 'build:alpha'); assert.equal(a.status, 'running'); assert.ok(a.where.some((w) => w.kind === 'bug')); assert.equal(a.notes[0].text, 'watch the colours');
  assert.throws(() => rq.captureRecord({}), /words/);
});
t('history: status and place-in-line changes are recorded once', () => {
  let { ledger } = rq.recordChanges(reqs, rq.emptyLedger(), RQ_NOW);
  const moved = rq.assemble({ ...src, builds: store.map((b) => (b.id === 'beta' ? { ...b, status: 'built' } : b)) }, ledger, RQ_NOW);
  const r2 = rq.recordChanges(moved, ledger, '2026-11-04T13:00:00Z');
  assert.ok(r2.changed.includes('build:beta'));
  assert.ok(r2.ledger.records['build:beta'].history.some((h) => /Queued → Built/.test(h.text)));
  assert.deepEqual(rq.recordChanges(moved, r2.ledger, '2026-11-04T14:00:00Z').changed, []);
});
t('filters, sort, group, summary, fingerprint', () => {
  assert.ok(rq.filterRequests(reqs, { open: true }).every(rq.isOpen));
  assert.deepEqual(rq.filterRequests(reqs, { kinds: ['bug'] }).map((r) => r.id), ['bug:bug-1']);
  assert.equal(rq.filterRequests(reqs, { q: 'wicked blue' })[0].id, 'build:alpha:addendum-1');
  assert.equal(rq.sortRequests(reqs.filter((r) => r.queue && r.kind === 'build'), 'queue')[0].id, 'build:alpha', 'running first');
  assert.ok(rq.groupRequests(reqs, 'build').some((g) => g.id === 'alpha' && g.items.length >= 2));
  const s = rq.summarize(reqs); assert.equal(s.total, reqs.length); assert.ok(s.open > 0 && s.running >= 1);
  assert.notEqual(rq.fingerprint(reqs), rq.fingerprint(reqs.map((r) => (r.id === 'build:beta' ? { ...r, status: 'built' } : r))));
  assert.equal(rq.age('2026-11-04T11:00:00Z', Date.parse(RQ_NOW)), '1h');
});
t('requests.mjs list | get | add | update | link | capture | summary on scratch files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rq-'));
  writeFileSync(join(dir, 'store.json'), JSON.stringify({ builds: Object.fromEntries(store.map((b) => [b.id, b])) }));
  const env = { ...process.env, AXF_REQUESTS_STORE: join(dir, 'store.json'), AXF_REQUESTS_LEDGER: join(dir, 'ledger.json'), AXF_REQUESTS_NO_HUB: '1', AXF_REQUESTS_BUILDS_DIR: '', AXF_REQUESTS_CHANGES: '', AXF_REQUESTS_BUGS: '', AXF_REQUESTS_THREADS: '', AXF_REQUESTS_MEMORY: '', AXF_REQUESTS_PLANS: '', AXF_REQUESTS_SLOTS: '', AXF_REQUESTS_ASKS: '' };
  const cli = (...a) => JSON.parse(execFileSync('node', [join(here, 'requests.mjs'), ...a, '--json'], { env, encoding: 'utf8' }).trim().split('\n').pop());
  assert.equal(cli('list').count, 4);
  assert.equal(cli('get', 'bell', 'whistle').request.id, 'build:alpha');
  const add = cli('add', '--said', 'Hire a new crew member called Polo', '--kind', 'crew', '--by', 'Amber', '--source', 'voice');
  assert.equal(add.request.kind, 'crew');
  cli('update', add.request.id, '--status', 'dropped', '--note', 'changed my mind');
  cli('link', 'beta', 'pr', '#999'); // theme-ok: a PR number, not a colour
  cli('capture', '--build', 'beta', '--by', 'paulie');
  const got = cli('get', add.request.id).request; assert.equal(got.status, 'dropped'); assert.equal(got.notes[0].text, 'changed my mind');
  const beta = cli('get', 'beta').request; assert.ok(beta.where.some((w) => w.kind === 'pr' && w.id === '#999')); assert.ok(beta.history.some((h) => /Launched by paulie/.test(h.text))); // theme-ok: a PR number, not a colour
  const sum = cli('summary'); assert.equal(sum.total, 5); assert.ok(sum.items.length >= 1);
  assert.equal(cli('sync').summary.total, 5);
});

// ---- the Build context submenu only lists things that exist
t('every Build menu entry opens a real view or action', () => {
  const src = readFileSync(join(here, 'web/buildMenu.ts'), 'utf8');
  const core = JSON.parse(src.match(/CORE_VIEWS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const actions = [...src.matchAll(/action: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(actions.length >= 13);
  const pluginsDir = join(repo, 'apps/console-web/plugins');
  const code = readdirSync(pluginsDir).filter((d) => !d.startsWith('_') && existsSync(join(pluginsDir, d, 'web'))).flatMap((d) => readdirSync(join(pluginsDir, d, 'web')).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(join(pluginsDir, d, 'web', f), 'utf8'))).join('\n');
  for (const a of actions) {
    if (a.startsWith('nav:')) { const v = a.slice(4); assert.ok(core.includes(v) || new RegExp(`views: \\{[^}]*['"\\[]${v}['"\\]]|const VIEW = '${v}'`).test(code), `view ${v}`); }
    else assert.ok(code.includes(`rt.actions.register('${a}'`), `action ${a}`);
  }
});

console.log(`build-breaker: ${n} checks passed`);
