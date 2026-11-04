// Self-test: npx -y tsx apps/console-web/plugins/plan-studio/test.mjs   (--write regenerates fixtures/plan.json on purpose)
// plan@1 schema + migrations (fixtures), categories, totals, versions + restore, templates, Markdown import/export,
// duplicates, filters/sort/group, bulk, turn-into-build + live progress, catalog discovery + overlay, the CLI and
// store on scratch folders (the repo and the hub are never written), the plain-English parser with fixed model
// replies (no live model), and the voice turn loop with fake speech in/out, mic-lease handoff and undo by voice.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pc from './web/plan-core.mjs';
import * as ai from './web/plan-ai.mjs';
import * as voice from './web/voice.ts';

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const here = new URL('.', import.meta.url).pathname;
const repo = new URL('../../../../', import.meta.url).pathname;
const NOW = '2026-10-30T12:00:00.000Z';
const write = process.argv.includes('--write');

// ---------------------------------------------------------------- manifest + lifecycle
await t('plugin@1 manifest, lifecycle, targets, model, capabilities', () => {
  const m = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
  assert.equal(m.id, 'ai.amberx.axf.console.plan-studio');
  assert.equal(m.lifecycle.$axf, 'plugin-lifecycle@1'); assert.equal(m.lifecycle.dataDir, '.axf-console/plugins/plan-studio');
  assert.deepEqual(m.targets, ['axf-console', 'amberx-droid']);
  assert.deepEqual(m.builtWith, { model: 'opus', builtAt: '2026-10-30' });
  assert.ok(m.provides.includes('service:plans@1')); assert.ok(m.optional.includes('axf.llm@1'));
  for (const f of ['install.mjs', 'uninstall.mjs', 'hooks.mjs', 'plans.mjs', 'catalog.mjs', 'schema/plan.schema.json', 'server/__init__.py']) assert.ok(existsSync(join(here, f)), f);
  const web = readFileSync(join(here, 'web/index.tsx'), 'utf8');
  assert.match(web, /parent: 'plugins'/); assert.match(web, /PluginLifecyclePanel/); assert.match(web, /plan-studio\.capture/);
  assert.match(readFileSync(join(here, 'web/menu.ts'), 'utf8'), /nav:plan-studio/);
  // never another plugin's folder (capabilities only)
  for (const f of readdirSync(join(here, 'web'))) assert.doesNotMatch(readFileSync(join(here, 'web', f), 'utf8'), /plugins\/(?!plan-studio)[a-z-]+\//, f);
  assert.doesNotMatch(readFileSync(join(here, 'plans.mjs'), 'utf8'), /plugins\/build-orchestrator|plugins\/feature-matrix/);
});

// ---------------------------------------------------------------- schema + migrations (fixtures)
const cases = JSON.parse(readFileSync(join(here, 'fixtures/cases.json'), 'utf8'));
const outs = cases.cases.map((c) => ({ name: c.name, output: pc.normalize(c.input, { now: cases.now }) }));
if (write) writeFileSync(join(here, 'fixtures/plan.json'), `${JSON.stringify({ $axf: 'plan-fixtures@1', now: cases.now, cases: outs }, null, 1)}\n`);
await t('fixtures: every case normalizes to its recorded plan@1 (the contract)', () => {
  const want = JSON.parse(readFileSync(join(here, 'fixtures/plan.json'), 'utf8'));
  assert.equal(want.cases.length, outs.length);
  for (const [i, c] of outs.entries()) {
    const strip = (p) => ({ ...p, id: p.id.replace(/-[a-z0-9]{4}$/, '') }); // the loose case gets a random suffix only when it has no id
    assert.deepEqual(strip(c.output), strip(want.cases[i].output), c.name);
  }
});
await t('every fixture output validates; the JSON Schema agrees on the required fields and enums', () => {
  const schema = JSON.parse(readFileSync(join(here, 'schema/plan.schema.json'), 'utf8'));
  for (const c of outs) {
    assert.deepEqual(pc.validate(c.output), [], c.name);
    for (const k of schema.required) assert.ok(k in c.output, `${c.name}: ${k}`);
  }
  assert.deepEqual(schema.properties.status.$ref ? schema.$defs.status.enum : schema.properties.status.enum, pc.STATUS_IDS);
  assert.deepEqual(schema.properties.priority.enum, pc.PRIORITIES);
  assert.deepEqual(schema.properties.links.items.properties.kind.enum, pc.LINK_KINDS);
  assert.deepEqual(schema.properties.steps.items.properties.model.enum, pc.MODELS);
});
await t('migrations: plan@0, pending@1 and loose notes become plan@1; unknown fields survive', () => {
  const [, full, old, pend, loose] = outs.map((o) => o.output);
  assert.equal(full.futureField.kept, true); assert.equal(full.priority, 'P1'); assert.equal(full.category, 'Product > Installer'); assert.deepEqual(full.tags, ['installer', 'sales']);
  assert.equal(full.links[0].kind, 'url'); assert.equal(full.steps[0].model, 'Fable'); assert.equal(full.steps[0].minutes, 25);
  assert.equal(old.title, 'Old draft'); assert.equal(old.status, 'parked'); assert.equal(old.steps[0].minutes, 60); assert.equal(old.steps[0].model, 'Sonnet'); assert.equal(old.category, 'Framework > Docs'); assert.equal(old.migratedFrom, 'plan@0');
  assert.equal(pend.status, 'parked'); assert.equal(pend.steps.length, 2); assert.equal(pend.steps[0].model, 'Fable'); assert.equal(pend.steps[1].done, true); assert.equal(pend.comments[0].text, 'parked for Fable'); assert.ok(pend.links.some((l) => l.ref === 'pending:docs-engine'));
  assert.deepEqual(loose.steps.map((s) => s.text), ['Think', 'Write']); assert.equal(loose.summary, 'Just a thought');
  assert.deepEqual(pc.normalize(full, { now: NOW }), full, 'normalize is idempotent');
});
await t('validate: bad ids, unknown deps and dependency cycles are caught', () => {
  const p = pc.normalize({ id: 'x', title: 'X', steps: [{ id: 'a', text: 'A', dependsOn: ['b'] }, { id: 'b', text: 'B', dependsOn: ['a'] }, { id: 'c', text: 'C', dependsOn: ['zzz'] }] }, { now: NOW });
  const v = pc.validate(p);
  assert.ok(v.some((x) => /circle/.test(x))); assert.ok(v.some((x) => /unknown step zzz/.test(x)));
  assert.ok(pc.validate({ ...p, id: 'Bad Id' }).some((x) => /^id/.test(x)));
  assert.deepEqual(pc.orderSteps([{ id: 'b', dependsOn: ['a'] }, { id: 'a', dependsOn: [] }]).map((s) => s.id), ['a', 'b']);
});

// ---------------------------------------------------------------- totals, categories
await t('effort and cost are summed from the steps (minutes × model price)', () => {
  const p = pc.normalize({ title: 'T', steps: [{ text: 'a', model: 'Fable', minutes: 30 }, { text: 'b', model: 'Opus', estimate: '1 h', done: true }, { text: 'c', model: 'Sonnet', estimate: '15m' }] }, { now: NOW });
  assert.equal(p.effort.minutes, 105); assert.equal(p.effort.left, 45);
  assert.equal(p.cost.usd, Math.round((30 * 0.275 + 60 * 0.14 + 15 * 0.07) * 100) / 100);
  assert.equal(pc.totals(p).progress, 33);
  assert.equal(pc.fmtMinutes(105), '1 h 45 min'); assert.equal(pc.minutesOf('1.5 hours'), 90);
});
await t('categories: add, rename, move, merge, remove; plans follow their category', () => {
  const plans = [pc.normalize({ id: 'a', title: 'A', category: 'Framework > Docs' }), pc.normalize({ id: 'b', title: 'B', category: 'Framework > Docs > Layouts' }), pc.normalize({ id: 'c', title: 'C', category: 'Product' })];
  let paths = pc.withParents(['Framework > Docs > Layouts', 'Product']);
  assert.deepEqual(paths, ['Framework', 'Framework > Docs', 'Framework > Docs > Layouts', 'Product']);
  let r = pc.categoryOp(paths, plans, { op: 'add', parent: 'Product', name: 'Installer' }); paths = r.paths; assert.ok(paths.includes('Product > Installer'));
  r = pc.categoryOp(paths, plans, { op: 'rename', path: 'Framework > Docs', name: 'Documentation' });
  assert.ok(r.paths.includes('Framework > Documentation > Layouts')); assert.deepEqual(r.plans.map((p) => [p.id, p.category]), [['a', 'Framework > Documentation'], ['b', 'Framework > Documentation > Layouts']]);
  r = pc.categoryOp(paths, plans, { op: 'move', path: 'Framework > Docs', into: 'Product' });
  assert.ok(r.paths.includes('Product > Docs > Layouts')); assert.equal(r.plans.find((p) => p.id === 'b').category, 'Product > Docs > Layouts');
  assert.throws(() => pc.categoryOp(paths, plans, { op: 'move', path: 'Framework', into: 'Framework > Docs' }), /inside itself/);
  r = pc.categoryOp(paths, plans, { op: 'merge', path: 'Product', into: 'Framework > Docs' });
  assert.equal(r.plans.find((p) => p.id === 'c').category, 'Framework > Docs'); assert.ok(!r.paths.includes('Product'));
  assert.throws(() => pc.categoryOp(paths, plans, { op: 'remove', path: 'Product' }), /still has plans/);
  assert.ok(!pc.categoryOp(paths, plans, { op: 'remove', path: 'Product > Installer' }).paths.includes('Product > Installer'));
  const tree = pc.categoryTree(paths, plans);
  const fw = tree.find((x) => x.path === 'Framework'); assert.equal(fw.total, 2); assert.equal(fw.children[0].count, 1);
});

// ---------------------------------------------------------------- versions, templates, markdown, duplicates, views
await t('versions: autosaves coalesce, diff + restore never lose history', () => {
  const p1 = pc.normalize({ id: 'v', title: 'V', summary: 'one' }, { now: NOW });
  let h = pc.addVersion(null, p1, { by: 'b', kind: 'save', at: '2026-10-30T12:00:00Z' });
  h = pc.addVersion(h, { ...p1, summary: 'two' }, { by: 'b', kind: 'autosave', at: '2026-10-30T12:01:00Z' });
  h = pc.addVersion(h, { ...p1, summary: 'three' }, { by: 'b', kind: 'autosave', at: '2026-10-30T12:02:00Z' });
  assert.equal(h.versions.length, 2); assert.equal(h.versions[1].plan.summary, 'three');
  h = pc.addVersion(h, { ...p1, summary: 'four' }, { by: 'b', kind: 'autosave', at: '2026-10-30T12:30:00Z' });
  assert.equal(h.versions.length, 3);
  const d = pc.diff(h.versions[0].plan, h.versions[2].plan);
  assert.deepEqual(d, [{ path: 'summary', op: 'changed', from: 'one', to: 'four' }]);
  assert.deepEqual(pc.describeDiff(d), ['~ summary: one → four']);
  const back = pc.restoreVersion(h, 1, { ...p1, version: 7 }); assert.equal(back.summary, 'one'); assert.equal(back.version, 8);
  assert.throws(() => pc.restoreVersion(h, 99), /no version/);
  const steps = pc.diff(pc.normalize({ id: 's', title: 'S', steps: [{ id: 's1', text: 'a' }] }, { now: NOW }), pc.normalize({ id: 's', title: 'S', steps: [{ id: 's1', text: 'a' }, { id: 's2', text: 'b' }] }, { now: NOW }));
  assert.equal(steps[0].op, 'added'); assert.equal(steps[0].to.text, 'b');
});
await t('templates: 7 built in, user templates, fromTemplate / asTemplate', () => {
  assert.deepEqual(pc.BUILT_IN_TEMPLATES.map((x) => x.id), ['feature', 'plugin', 'app', 'product', 'fix', 'research', 'refactor']);
  const p = pc.fromTemplate(pc.BUILT_IN_TEMPLATES[1], { title: 'Plan Studio' }, { now: NOW });
  assert.equal(p.category, 'Console > Plugins'); assert.equal(p.steps.length, 4); assert.equal(p.template, 'plugin'); assert.deepEqual(pc.validate(p), []);
  const mine = pc.asTemplate({ ...p, steps: p.steps.map((s) => ({ ...s, done: true })) }, 'My plugin');
  assert.equal(mine.id, 'my-plugin'); assert.ok(mine.plan.steps.every((s) => !('done' in s))); assert.equal(mine.plan.title, '');
  const all = pc.allTemplates({ items: [mine, { id: 'fix', label: 'Shadow' }] });
  assert.equal(all.length, 8); assert.equal(all.find((x) => x.id === 'fix').builtIn, true);
});
await t('Markdown: export/import round trip is exact; plain Markdown is read by its headings', () => {
  const p = outs[1].output;
  assert.deepEqual(pc.diff(p, pc.fromMarkdown(pc.toMarkdown(p), { now: NOW })), []);
  const md = '# Docs website\n\n**Status:** parked · **Priority:** P1 · **Category:** Framework > Docs\n\n> A site for the docs\n\n## Goal\n\nDocs anyone can read.\n\n## Steps\n\n1. Contract (Fable, 25 min)\n2. [x] Pages (Opus, 1 h)\n- Deploy\n\n## Risks\n\n- Nobody reads it\n\n## Acceptance criteria\n\n- [ ] Loads on a phone\n\n## Background\n\nSome notes.\n';
  const q = pc.fromMarkdown(md, { now: NOW });
  assert.equal(q.title, 'Docs website'); assert.equal(q.status, 'parked'); assert.equal(q.priority, 'P1'); assert.equal(q.category, 'Framework > Docs'); assert.equal(q.summary, 'A site for the docs'); assert.equal(q.goal, 'Docs anyone can read.');
  assert.deepEqual(q.steps.map((s) => [s.text, s.model, s.minutes, s.done]), [['Contract', 'Fable', 25, false], ['Pages', 'Opus', 60, true], ['Deploy', 'Opus', 0, false]]);
  assert.equal(q.risks[0].text, 'Nobody reads it'); assert.equal(q.acceptance[0].text, 'Loads on a phone'); assert.match(q.body, /## Background/);
  assert.deepEqual(pc.outline('# A\n```\n# not\n```\n## B').map((h) => h.text), ['A', 'B']);
});
await t('duplicates, search every field, filters, sort, group, bulk, roadmap', () => {
  const ps = [
    pc.normalize({ id: 'a', title: 'Docs Studio', category: 'Framework > Docs', status: 'parked', priority: 'P2', tags: ['docs'], steps: [{ text: 'Layout engine', model: 'Fable' }], targetDate: '2026-12-01' }, { now: NOW }),
    pc.normalize({ id: 'b', title: 'AmberX installer', category: 'Product > Installer', status: 'ready', priority: 'P1', risks: ['card fees'], targetDate: '2026-11-15' }, { now: NOW }),
    pc.normalize({ id: 'c', title: 'Something else', status: 'idea', priority: 'P3' }, { now: NOW }),
  ];
  assert.deepEqual(pc.duplicates(pc.normalize({ title: 'docs studio' }), ps).map((d) => d.plan.id), ['a']);
  assert.deepEqual(pc.duplicates(pc.normalize({ title: 'The Docs Studio plan' }), ps).map((d) => d.plan.id), ['a']);
  assert.equal(pc.duplicates(pc.normalize({ title: 'Brand new' }), ps).length, 0);
  assert.deepEqual(pc.filterPlans(ps, { q: 'card fees' }).map((p) => p.id), ['b']);
  assert.deepEqual(pc.filterPlans(ps, { q: 'layout engine' }).map((p) => p.id), ['a']);
  assert.deepEqual(pc.filterPlans(ps, { categories: ['Framework'] }).map((p) => p.id), ['a']);
  assert.deepEqual(pc.filterPlans(ps, { statuses: ['ready', 'idea'] }).map((p) => p.id), ['b', 'c']);
  assert.deepEqual(pc.filterPlans(ps, { models: ['Fable'] }).map((p) => p.id), ['a']);
  assert.deepEqual(pc.sortPlans(ps, 'priority').map((p) => p.id), ['b', 'a', 'c']);
  assert.deepEqual(pc.sortPlans(ps, 'target').map((p) => p.id), ['b', 'a', 'c']);
  assert.deepEqual(pc.groupPlans(ps, 'status').map((g) => g.id), ['idea', 'parked', 'ready']);
  assert.equal(pc.groupPlans(ps, 'category').at(-1).label, 'Uncategorized');
  const changed = pc.bulk(ps, ['a', 'c'], { status: 'dropped', addTag: 'later' });
  assert.deepEqual(changed.map((p) => [p.id, p.status, p.tags.includes('later')]), [['a', 'dropped', true], ['c', 'dropped', true]]);
  assert.deepEqual(pc.roadmap(ps).map((l) => l.month), ['2026-11', '2026-12', '']);
  assert.equal(pc.counts(ps).statuses.parked, 1);
});

// ---------------------------------------------------------------- turn into a build
await t('turn into a build: orchestrator add change, links both ways, live progress, done ticks features', () => {
  const p = pc.normalize({ id: 'ship', title: 'Ship it', category: 'Product > Installer', steps: [{ id: 's1', text: 'B', model: 'Opus', minutes: 20, dependsOn: ['s2'] }, { id: 's2', text: 'A', model: 'Fable', minutes: 25 }, { id: 's3', text: 'Done already', done: true }], features: [{ entry: 'app:amberx-droid', feature: 'x', title: 'X', state: 'planned' }], requirements: ['R1'] }, { now: NOW });
  const ch = pc.toBuild(p, { profile: 'angel' });
  assert.equal(ch.action, 'add'); assert.equal(ch.id, 'ship'); assert.equal(ch.category, 'Product');
  assert.deepEqual(ch.steps.map((s) => [s.text, s.model, s.estimate]), [['A', 'Fable', '25 min'], ['B', 'Opus', '20 min']]);
  assert.match(ch.detail, /From Plan Studio plan ship/); assert.match(ch.detail, /Requirements: R1/);
  assert.throws(() => pc.toBuild(pc.normalize({ title: 'x' })), /no steps/);
  const linked = pc.linkBuild(p, { profile: 'angel', id: 'ship' }, NOW);
  assert.equal(linked.status, 'building'); assert.ok(linked.links.some((l) => l.kind === 'build' && l.ref === 'angel:ship'));
  const half = pc.syncBuild(linked, { status: 'in-progress', steps: [{ text: 'A', done: true, doneAt: NOW }, { text: 'B', done: false }], branch: 'claude/x' });
  assert.ok(half.changed); assert.equal(half.plan.build.progress, 50); assert.equal(half.plan.steps.find((s) => s.id === 's2').done, true); assert.equal(half.plan.status, 'building');
  assert.ok(half.plan.links.some((l) => l.kind === 'branch'));
  const done = pc.syncBuild(half.plan, { status: 'complete', steps: [{ text: 'A', done: true }, { text: 'B', done: true }], pr: '200' });
  assert.equal(done.plan.status, 'done'); assert.equal(done.plan.features[0].state, 'have'); assert.ok(done.plan.links.some((l) => l.kind === 'pr' && l.ref === '200'));
  assert.equal(pc.syncBuild(done.plan, { status: 'complete', steps: [{ text: 'A', done: true }, { text: 'B', done: true }], pr: '200' }).changed, false);
});

// ---------------------------------------------------------------- the plain-English AI (rules + fixed model replies)
const catalogFix = [{ key: 'app:amberx-droid', name: 'AmberX', kind: 'app', features: [{ id: 'app-plugin:voice', title: 'AmberX voice', state: 'partial' }] }, { key: 'plugin:build-breaker', name: 'Build Breaker', kind: 'plugin', features: [] }];
const cur = pc.normalize({ id: 'selling', title: 'AmberX Selling It', steps: [{ id: 's1', text: 'Price page', model: 'Opus', minutes: 20 }] }, { now: NOW });
const voicePlan = pc.normalize({ id: 'agent-voice', title: 'Agent voice' }, { now: NOW });
const ctx = { plan: cur, plans: [cur, voicePlan], catalog: catalogFix, now: NOW };
const run = (text, c = ctx) => { const r = ai.rules(text, c); assert.ok(r, `rules understood "${text}"`); return { r, a: ai.applyOps(r.ops, c) }; };
await t('rules: Brett\'s examples become the right edits', () => {
  let { a } = run('add a step for the installer, Opus, 20 minutes');
  assert.deepEqual(a.plan.steps.at(-1), { id: 's2', text: 'Installer', model: 'Opus', minutes: 20, dependsOn: [], done: false, doneAt: '', phase: '' });
  ({ a } = run('move this to Product > Installer and make it P1')); assert.equal(a.plan.category, 'Product > Installer'); assert.equal(a.plan.priority, 'P1');
  ({ a } = run('add a risk: card fees eat the dollar plan')); assert.equal(a.plan.risks[0].text, 'card fees eat the dollar plan');
  ({ a } = run('add a risk: card fees eat the dollar plan and make it P0')); assert.equal(a.plan.risks[0].text, 'card fees eat the dollar plan'); assert.equal(a.plan.priority, 'P0');
  ({ a } = run('new plan: docs website, parked')); assert.equal(a.created[0].title, 'Docs website'); assert.equal(a.created[0].status, 'parked'); assert.equal(a.changed, true);
  ({ a } = run('mark AmberX voice as planned for the Agent voice plan'));
  const f = a.others.get('agent-voice').features[0]; assert.deepEqual([f.entry, f.feature, f.state], ['app:amberx-droid', 'app-plugin:voice', 'planned']);
  ({ a } = run("what's left on AmberX Selling It?")); assert.match(a.answer, /1 of 1 steps left/); assert.equal(a.changed, false);
});
await t('rules: more phrasings (status, steps, tags, dates, owner, links, removals)', () => {
  assert.equal(run('park it').a.plan.status, 'parked');
  assert.equal(run('mark it ready').a.plan.status, 'ready');
  assert.equal(run('step 1 done').a.plan.steps[0].done, true);
  assert.equal(run('make step 1 Fable 30 minutes').a.plan.steps[0].model, 'Fable');
  assert.deepEqual(run('tag it installer, product').a.plan.tags, ['installer', 'product']);
  assert.equal(run('target nov 15').a.plan.targetDate, '2026-11-15');
  assert.equal(run('due 2026-12-01').a.plan.targetDate, '2026-12-01');
  assert.equal(run('assign it to Mosses').a.plan.owner, 'Mosses');
  assert.equal(run('rename it to Selling AmberX').a.plan.title, 'Selling AmberX');
  assert.equal(run('this depends on the Agent voice plan').a.plan.links[0].ref, 'agent-voice');
  assert.equal(run('link it to PR 159').a.plan.links[0].kind, 'pr');
  assert.equal(run('remove step 1').a.plan.steps.length, 0);
  assert.equal(run('out of scope: Android').a.plan.outOfScope[0].text, 'Android');
  assert.equal(run('the goal is people can pay').a.plan.goal, 'people can pay');
  assert.equal(ai.rules('something the rules do not know about rockets', ctx), null);
  assert.equal(run('mark Nonexistent thing as planned').r.ops[0].op, 'ask');
});
await t('model replies (fixed, no live model) are parsed, filtered and applied; the prompt carries the context', async () => {
  const reply = 'Sure!\n```json\n{"ops":[{"op":"add","list":"steps","item":{"text":"Stripe checkout","model":"Opus","minutes":25}},{"op":"set","field":"priority","value":"P1"},{"op":"explode","x":1}],"reply":"Added the checkout step and made it P1."}\n```';
  const r = await ai.interpret('we need people to be able to pay with a card online', ctx, async ({ system, messages }) => {
    assert.match(system, /ONE JSON object/); assert.match(messages[0].content, /AmberX Selling It/); assert.match(messages[0].content, /app:amberx-droid/);
    return reply;
  });
  assert.equal(r.via, 'model'); assert.equal(r.ops.length, 2); assert.equal(r.reply, 'Added the checkout step and made it P1.');
  const a = ai.applyOps(r.ops, ctx); assert.equal(a.plan.steps[1].text, 'Stripe checkout'); assert.equal(a.plan.priority, 'P1');
  assert.deepEqual(ai.parseModelReply('no json here').ops, [{ op: 'answer', text: 'no json here' }]);
  assert.deepEqual(ai.parseModelReply('{"ops":[],"reply":"Which plan?"}').ops, [{ op: 'answer', text: 'Which plan?' }]);
  assert.equal(ai.parseModelReply('{"ops":[{"op":"ask","text":"Which one?"}]}').ops[0].op, 'ask');
  const none = await ai.interpret('something the rules do not know', ctx, null); assert.equal(none.needsAi, true); assert.equal(none.ops[0].op, 'ask');
  assert.throws(() => ai.applyOps([{ op: 'set', field: 'status', value: 'nonsense' }], ctx), /unknown status/);
  assert.ok(ai.isSmall([{ op: 'add' }, { op: 'set' }])); assert.ok(ai.isBig([{ op: 'new-plan' }])); assert.ok(!ai.isBig([{ op: 'add' }]));
  assert.match(ai.speakable({ summary: ['Priority → P1'] }), /Priority → P1/);
});

// ---------------------------------------------------------------- the voice turn loop (fake speech in and out)
const fakeIo = (heard, lease = voice.createLease()) => {
  const said = [], events = [];
  const q = [...heard];
  return { said, events, io: { lease, listen: async () => q.shift() ?? '', speak: async (s) => { said.push(s); }, onEvent: (e) => events.push(e) } };
};
await t('voice: turn after turn until "I\'m done"; undo by voice; repeat', async () => {
  const applied = [];
  const handle = async (h) => { applied.push(h); return { say: `Added ${h}.`, undo: async () => { applied.pop(); return `Took back ${h}.`; } }; };
  const { io, said } = fakeIo(['a risk', 'a step', 'undo that', 'say that again', "I'm done"]);
  const r = await voice.runConversation(io, handle, { greeting: 'Hi.' });
  assert.equal(r.ended, 'done'); assert.equal(r.turns, 5);
  assert.deepEqual(said, ['Hi.', 'Added a risk.', 'Added a step.', 'Took back a step.', 'Took back a step.', 'Okay. Talk soon.']);
  assert.deepEqual(applied, ['a risk']);
});
await t('voice: big edits are confirmed by voice (yes runs it, no drops it)', async () => {
  let ran = 0;
  const handle = async () => ({ say: '', confirm: { question: 'Turn Docs Studio into a build in Angel?', run: async () => { ran += 1; return { say: 'Done, build docs-studio.' }; } } });
  let f = fakeIo(['turn it into a build', 'yes', "that's all"]);
  await voice.runConversation(f.io, handle, { greeting: 'Hi.' });
  assert.equal(ran, 1); assert.deepEqual(f.said.slice(1, 3), ['Turn Docs Studio into a build in Angel?', 'Done, build docs-studio.']);
  f = fakeIo(['turn it into a build', 'no', 'bye']);
  await voice.runConversation(f.io, handle, { greeting: 'Hi.' });
  assert.equal(ran, 1); assert.equal(f.said[2], "Okay, I won't.");
});
await t('voice: mic-lease@1 handoff (busy mic refused; released between turns and at the end; shared global)', async () => {
  const lease = voice.createLease();
  assert.ok(lease.take('dictation'));
  let f = fakeIo(['hello'], lease);
  let r = await voice.runConversation(f.io, async () => ({ say: 'x' }));
  assert.equal(r.ended, 'busy'); assert.match(f.said[0], /Dictation is using the microphone/);
  lease.release('dictation');
  const holders = [];
  lease.on((h) => holders.push(h));
  f = fakeIo(['one', 'bye'], lease);
  f.io.listen = (() => { const q = ['one', 'bye']; return async () => { assert.equal(lease.holder(), 'plan-studio', 'holds the mic while listening'); return q.shift(); }; })();
  f.io.speak = async (s) => { assert.notEqual(lease.holder(), 'plan-studio', 'lets go while speaking'); f.said.push(s); };
  r = await voice.runConversation(f.io, async () => ({ say: 'ok' }));
  assert.equal(r.ended, 'done'); assert.equal(lease.holder(), null);
  assert.ok(holders.filter((h) => h === 'plan-studio').length >= 2);
  const g = {}; const a = voice.micLease(g); assert.equal(voice.micLease(g), a); assert.equal(g.__axfMicLease, a);
  // someone else takes the mic between turns: the conversation ends instead of fighting it
  const l2 = voice.createLease();
  f = fakeIo([], l2);
  f.io.listen = async () => 'first';
  f.io.speak = async (s) => { f.said.push(s); if (s === 'ok') l2.take('notes'); };
  r = await voice.runConversation(f.io, async () => ({ say: 'ok' }), { greeting: 'Hi.' });
  assert.equal(r.ended, 'busy'); assert.match(f.said.at(-1), /taken by something else/);
});
await t('voice: silence ends it; intents', async () => {
  const f = fakeIo(['', '', '']);
  const r = await voice.runConversation(f.io, async () => ({ say: 'x' }), { greeting: 'Hi.', maxSilence: 3 });
  assert.equal(r.ended, 'silence');
  assert.deepEqual(['undo that', 'scratch that', 'yes please', 'nope', "I'm done", "that's all for now", 'say that again', 'add a risk'].map(voice.intentOf), ['undo', 'undo', 'yes', 'no', 'end', 'end', 'repeat', 'say']);
});

// ---------------------------------------------------------------- the CLI + store on scratch folders
const scratch = mkdtempSync(join(tmpdir(), 'plan-studio-'));
const env = { ...process.env, AXF_PLANS_DIR: join(scratch, 'store'), AXF_ORCH_FILE: join(scratch, 'orch.json'), AXF_DATA_DIR: join(scratch, 'data') };
const node = (args) => { let out; try { out = execFileSync('node', args, { env, encoding: 'utf8' }); } catch (e) { out = e.stdout ?? ''; } return JSON.parse(out.trim().split('\n').at(-1)); };
const cli = (...a) => node([join(here, 'plans.mjs'), ...a, '--json']);
const apiCall = (o) => node([join(here, 'plans.mjs'), 'api', JSON.stringify(o)]);
await t('store: seeds load once (the imported parked plans), never over an edit', () => {
  const s = apiCall({ op: 'state' });
  assert.ok(s.ok); assert.equal(s.store, env.AXF_PLANS_DIR); assert.equal(s.onHub, false);
  const seeds = readdirSync(join(here, 'data/plans')).filter((f) => f.endsWith('.json')).length;
  assert.equal(s.plans.length, seeds);
  const docs = s.plans.find((p) => p.id === 'docs-studio');
  assert.ok(docs, 'Docs Studio is there'); assert.equal(docs.status, 'parked'); assert.equal(docs.category, 'Framework > Docs'); assert.equal(docs.steps.length, 15);
  assert.ok(s.plans.some((p) => p.category === 'Product > Installer'));
  for (const p of s.plans) assert.deepEqual(pc.validate(p), [], p.id);
  apiCall({ op: 'save', plan: { ...docs, summary: 'edited' } });
  assert.equal(apiCall({ op: 'get', id: 'docs-studio' }).plan.summary, 'edited');
  apiCall({ op: 'state' });
  assert.equal(apiCall({ op: 'get', id: 'docs-studio' }).plan.summary, 'edited', 'the seed never overwrites');
});
await t('CLI: add (duplicate check), list, show --md, status, import, export, categories', () => {
  const a = cli('add', 'Docs website', '--category', 'Framework > Docs', '--step', 'Contract|Fable|25', '--step', 'Pages|Opus|30');
  assert.ok(a.ok); assert.equal(a.plan.status, 'parked'); assert.equal(a.plan.effort.minutes, 55);
  const dup = cli('add', 'docs website'); assert.equal(dup.ok, false); assert.equal(dup.duplicates[0].id, a.plan.id);
  assert.ok(cli('list', '--q', 'contract').plans.some((p) => p.id === a.plan.id));
  assert.equal(cli('status', a.plan.id, 'ready').plan.status, 'ready');
  const md = execFileSync('node', [join(here, 'plans.mjs'), 'show', a.plan.id, '--md'], { env, encoding: 'utf8' });
  assert.match(md, /^# Docs website/); assert.match(md, /- \[ \] Contract \(Fable, 25 min\)/);
  writeFileSync(join(scratch, 'in.md'), '# Imported thing\n\n## Steps\n\n- One (Opus, 10 min)\n');
  const im = cli('import', join(scratch, 'in.md')); assert.equal(im.imported.length, 1);
  assert.equal(apiCall({ op: 'get', id: im.imported[0] }).plan.status, 'parked', 'imports are parked unless they say');
  const ex = apiCall({ op: 'export', ids: [a.plan.id], format: 'json' }); assert.equal(JSON.parse(ex.text).plans[0].id, a.plan.id);
  const re = apiCall({ op: 'import', text: ex.text }); assert.equal(re.imported[0], a.plan.id, 'a plan@1 JSON comes back as itself');
  assert.ok(cli('categories').tree.some((c) => c.path === 'Framework'));
});
await t('API: versions, restore, delete (history kept), bulk, categories, templates, views', () => {
  const id = apiCall({ op: 'save', plan: { title: 'Versioned', status: 'draft' } }).plan.id;
  apiCall({ op: 'save', plan: { ...apiCall({ op: 'get', id }).plan, summary: 'v2' } });
  const g = apiCall({ op: 'get', id }); assert.equal(g.history.versions.length, 2);
  assert.equal(apiCall({ op: 'restore', id, v: 1 }).plan.summary, '');
  assert.equal(apiCall({ op: 'get', id }).history.versions.at(-1).kind, 'restore');
  apiCall({ op: 'delete', id }); assert.equal(apiCall({ op: 'state' }).plans.some((p) => p.id === id), false);
  assert.equal(apiCall({ op: 'restore', id, v: 2 }).plan.summary, 'v2', 'a deleted plan can be restored from its history');
  const b = apiCall({ op: 'bulk', ids: [id], change: { priority: 'P0', addTag: 'urgent' } }); assert.deepEqual(b.changed, [id]);
  assert.equal(apiCall({ op: 'get', id }).plan.priority, 'P0');
  const c = apiCall({ op: 'category', change: { op: 'add', parent: 'Product', name: 'Pricing' } }); assert.ok(c.categories.paths.includes('Product > Pricing'));
  assert.equal(apiCall({ op: 'category', change: { op: 'remove', path: 'Framework' } }).ok, false);
  const tp = apiCall({ op: 'template-save', template: { label: 'Mine', plan: { status: 'idea' } } }); assert.equal(tp.templates.all.length, 8);
  const v = apiCall({ op: 'view-save', view: { label: 'Urgent', layout: 'board', filter: { priorities: ['P0'] } } }); assert.equal(v.views.items[0].id, 'urgent');
});
await t('API: turn into a build (preview, add to the orchestrator file, link both ways, live progress)', () => {
  const id = apiCall({ op: 'save', plan: { title: 'Buildable', steps: [{ text: 'Do A', model: 'Opus', minutes: 20 }, { text: 'Do B', model: 'Fable', minutes: 30 }] }, force: true }).plan.id;
  const pre = apiCall({ op: 'build', id, profile: 'angel', preview: true }); assert.equal(pre.minutes, 50); assert.equal(existsSync(env.AXF_ORCH_FILE), false, 'preview writes nothing');
  const r = apiCall({ op: 'build', id, profile: 'angel' }); assert.ok(r.ok); assert.equal(r.plan.status, 'building');
  const orch = JSON.parse(readFileSync(env.AXF_ORCH_FILE, 'utf8')); const b = orch.builds.find((x) => x.id === r.build.id);
  assert.equal(b.source, 'plan-studio'); assert.equal(b.steps.length, 2); assert.match(b.notes[0].text, new RegExp(`Plan Studio plan: ${id}`));
  assert.equal(apiCall({ op: 'build', id, profile: 'angel' }).ok, false, 'the same build twice is refused');
  b.steps[0].done = true; writeFileSync(env.AXF_ORCH_FILE, JSON.stringify(orch));
  assert.deepEqual(apiCall({ op: 'sync-builds' }).changed, [id]); assert.equal(apiCall({ op: 'get', id }).plan.build.progress, 50);
  b.steps[1].done = true; b.status = 'complete'; writeFileSync(env.AXF_ORCH_FILE, JSON.stringify(orch));
  apiCall({ op: 'sync-builds' }); assert.equal(apiCall({ op: 'get', id }).plan.status, 'done');
});
await t('API: AI turn with a fixed reply; AI edits recorded in history as "AI, from: …"', () => {
  const id = apiCall({ op: 'save', plan: { title: 'AI target' }, force: true }).plan.id;
  const r = apiCall({ op: 'ai', text: 'add a risk: card fees eat the dollar plan and make it P1', plan: id });
  assert.equal(r.via, 'rules'); assert.equal(r.plan.priority, 'P1');
  const ap = apiCall({ op: 'ai-apply', ops: r.ops, text: 'add a risk: card fees eat the dollar plan and make it P1', plan: id });
  assert.equal(ap.saved[0].risks[0].text, 'card fees eat the dollar plan');
  assert.equal(apiCall({ op: 'get', id }).history.versions.at(-1).note, 'AI, from: add a risk: card fees eat the dollar plan and make it P1');
  const m = apiCall({ op: 'ai', text: 'figure out pricing tiers please', plan: id, reply: '{"ops":[{"op":"add","list":"questions","item":{"text":"How many tiers?"}}],"reply":"Added a question."}' });
  assert.equal(m.via, 'model'); assert.equal(m.plan.questions[0].text, 'How many tiers?');
  const q = apiCall({ op: 'ai', text: 'what is left on AI target?', plan: id }); assert.match(q.say, /no steps yet/);
});
await t('catalog: every plugin, app, library, module and axHub found by discovery; gone marked; plans overlay features', () => {
  const es = apiCall({ op: 'catalog' }).entries;
  const kinds = new Set(es.map((e) => e.kind)); for (const k of ['plugin', 'app', 'library', 'module', 'service']) assert.ok(kinds.has(k), k);
  const pluginDirs = readdirSync(join(repo, 'apps/console-web/plugins')).filter((f) => !f.startsWith('_') && existsSync(join(repo, 'apps/console-web/plugins', f, 'plugin.json')));
  for (const d of pluginDirs) assert.ok(es.some((e) => e.key === `plugin:${d}`), `plugin:${d}`);
  const appDirs = readdirSync(join(repo, 'apps')).filter((f) => existsSync(join(repo, 'apps', f, 'project.manifest.json')));
  for (const d of appDirs) { const name = JSON.parse(readFileSync(join(repo, 'apps', d, 'project.manifest.json'), 'utf8')).name; assert.ok(es.some((e) => e.key === `app:${name}`), `app:${name}`); }
  assert.ok(es.some((e) => e.key === 'service:axhub'));
  const self = es.find((e) => e.key === 'plugin:plan-studio'); assert.ok(self.features.some((f) => f.id === 'provides:view:plan-studio' && f.state === 'have'));
  assert.ok(es.some((e) => e.features.some((f) => f.source === 'tracker')));
  // a key seen before and missing now is "gone"
  const seen = JSON.parse(readFileSync(join(env.AXF_PLANS_DIR, 'catalog-seen.json'), 'utf8'));
  writeFileSync(join(env.AXF_PLANS_DIR, 'catalog-seen.json'), JSON.stringify({ keys: [...seen.keys, 'plugin:removed-thing'] }));
  assert.equal(apiCall({ op: 'catalog' }).entries.find((e) => e.key === 'plugin:removed-thing').status, 'gone');
  // a plan's planned feature shows on the entry; Plan this pre-fills a plan
  const id = apiCall({ op: 'save', plan: { title: 'Breaker grids', status: 'ready' }, force: true }).plan.id;
  apiCall({ op: 'feature', plan: id, entry: 'plugin:build-breaker', feature: '', title: 'Per-app cost chart', state: 'planned' });
  const bb = apiCall({ op: 'catalog' }).entries.find((e) => e.key === 'plugin:build-breaker');
  const f = bb.features.find((x) => x.title === 'Per-app cost chart'); assert.equal(f.state, 'planned'); assert.equal(f.plan, id); assert.ok(bb.plans.includes(id));
  const pf = apiCall({ op: 'plan-feature', entry: 'plugin:build-breaker', feature: f.id, title: f.title }); assert.equal(pf.plan.features[0].entry, 'plugin:build-breaker'); assert.match(pf.plan.category, /^Console > Plugins > /);
  assert.equal(pc.filterCatalog(pc.overlayCatalog([{ key: 'x', kind: 'plugin', name: 'X', description: '', features: [{ id: 'a', title: 'A', state: 'have' }] }], []), { gaps: true }).length, 0);
});
await t('the repo and the hub were not written by any of this', () => {
  assert.equal(existsSync(join(repo, '.axf-console/plugins/plan-studio/plans/docs-website.json')), false);
  assert.ok(!readdirSync(env.AXF_DATA_DIR ?? scratch).includes('plan-studio'));
});

console.log(`plan-studio: ${n} checks passed`);
