#!/usr/bin/env node
// build-origin@1 — what Brett said that started a build (Nov 3 2026). Pure core + the real CLI and store on a temp store.
//   node framework/spec/check-build-origin.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as o from '../core/build-origin.mjs';
import * as c from '../plan/builds-store-core.mjs';
import * as m from '../plan/builds-merge-core.mjs';
import * as pending from '../plan/pending-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const WORDS = 'All the build entries, like wherever it shows a build in the build manager, pending, all that, I need it to show the prompt, what I said, the verbatim prompt that kicked it off, that initiated it.';
const BRIEF = `# Build: demo-build (Current profile)

## Brett said (verbatim)
Source: voice · At: 2026-11-03T14:05:00Z · Session: conv-123 · Link: https://claude.ai/chat/conv-123
> ${WORDS}

## Build
- s1 do the thing

## Addendum 1 (Brett, Nov 4 2026 (chat))
> Also put it on the Crew rows.
`;

// ------------------------------------------------------------------ parsing a brief
t('the "Brett said (verbatim)" block is read word for word, with its meta line', () => {
  const p = o.parseBrief(BRIEF);
  assert.equal(p.said, WORDS); assert.equal(p.verbatim, true); assert.equal(p.hasBlock, true);
  assert.equal(p.source, 'voice'); assert.equal(p.at, '2026-11-03T14:05:00Z'); assert.equal(p.session, 'conv-123'); assert.equal(p.link, 'https://claude.ai/chat/conv-123');
});
t('addenda are parsed in order with their date and source', () => {
  const p = o.parseBrief(BRIEF);
  assert.equal(p.addenda.length, 1); assert.equal(p.addenda[0].said, 'Also put it on the Crew rows.'); assert.equal(p.addenda[0].at, '2026-11-04'); assert.equal(p.addenda[0].source, 'chat');
});
t('an older brief falls back to the first announced quote, marked from the brief', () => {
  const p = o.parseBrief(`# Build: x\n\nBrett, Nov 3 2026 (voice), verbatim: "${WORDS}"\nAssigned agent: Joey.`);
  assert.equal(p.said, WORDS); assert.equal(p.from, 'brief'); assert.equal(p.hasBlock, false); assert.equal(p.at, '2026-11-03'); assert.equal(p.source, 'voice');
});
t('fromText: times are not the colon after his name; launch chores are not his ask', () => {
  assert.equal(o.fromText('Brett (Oct 26 2026 12:40): everything from today goes into Refactor.').said, 'everything from today goes into Refactor.');
  assert.equal(o.fromText('Brett, Nov 3 (voice): **Ping Paulie** (book on his card).'), null);
  assert.equal(o.fromText("Brett's rule: something long enough here"), null);
});
t('strict mode keeps only announced or quoted words', () => {
  assert.equal(o.fromText('Some text. Brett notes: who said it, the message, when.', { strict: true }), null);
  assert.ok(o.fromText('Brett said: "Make the menus scroll when they run off the screen."', { strict: true }));
});
t('saidBlock round-trips through parseBrief', () => {
  const b = `${o.saidBlock({ said: WORDS, source: 'chat', at: '2026-11-03T10:00:00Z' })}\n\n## Build\nx`;
  const p = o.parseBrief(b); assert.equal(p.said, WORDS); assert.equal(p.source, 'chat'); assert.ok(o.briefHasSaid(b)); assert.ok(!o.briefHasSaid('# Build: y\nno block'));
});

// ------------------------------------------------------------------ merging never loses his words
const real = { said: WORDS, at: '2026-11-03', source: 'voice', verbatim: true, addenda: [{ said: 'A', at: '2026-11-04' }] };
const back = { said: 'a paraphrase of it', verbatim: false, from: 'detail', brief: 'BRIEF', addenda: [{ said: 'B', at: '2026-11-05' }] };
t('mergeOrigin: verbatim beats backfilled, empty fields filled, addenda unioned in order', () => {
  for (const [a, b] of [[real, back], [back, real]]) {
    const x = o.mergeOrigin(a, b);
    assert.equal(x.said, WORDS); assert.equal(x.verbatim, true); assert.equal(x.brief, 'BRIEF'); assert.deepEqual(x.addenda.map((y) => y.said), ['A', 'B']);
  }
  assert.equal(o.mergeOrigin(null, real).said, WORDS); assert.equal(o.mergeOrigin(real, undefined).said, WORDS); assert.equal(o.mergeOrigin(null, null), null);
});
t('normOrigin: nothing in it = null; source names are folded', () => {
  assert.equal(o.normOrigin({}), null); assert.equal(o.normOrigin({ said: 'x', source: 'claude-ai-voice' }).source, 'voice'); assert.equal(o.normOrigin({ said: 'x', source: 'text' }).source, 'chat');
});
t('addAddendum appends once', () => {
  let x = o.addAddendum(real, { said: 'C', at: '2026-11-06' }); x = o.addAddendum(x, { said: 'C', at: '2026-11-06' });
  assert.deepEqual(x.addenda.map((y) => y.said), ['A', 'C']); assert.throws(() => o.addAddendum(real, { said: ' ' }));
});
t('subtitle + originText', () => {
  assert.equal(o.subtitle({ said: 'first line\nsecond' }), 'first line'); assert.ok(o.subtitle({ said: 'x'.repeat(300) }, 50).endsWith('…'));
  assert.match(o.originText(back), /may be paraphrased/); assert.match(o.originText(real), /Addendum 1/);
});

// ------------------------------------------------------------------ the store keeps it
const rec = (extra = {}) => c.normBuild({ id: 'b1', title: 'B1', profiles: ['current'], order: { current: 0 }, steps: [{ id: 's1', text: 'x', model: 'Opus' }], ...extra });
t('normBuild keeps origin, and leaves it out when there is none (byte-stable stores)', () => {
  assert.equal(rec({ origin: real }).origin.said, WORDS); assert.ok(!('origin' in rec()));
});
t('an orchestrator write without origin (older code, a projection) never drops it', () => {
  const s = { ...c.emptyStore(), builds: [rec({ origin: real })] };
  const proj = c.projectOrchestrator(s, 'current'); assert.equal(proj.builds[0].origin.said, WORDS);
  delete proj.builds[0].origin; proj.builds[0].title = 'renamed';
  const next = c.absorbOrchestrator(s, 'current', proj);
  assert.equal(next.builds[0].origin.said, WORDS); assert.equal(next.builds[0].title, 'renamed');
});
t('pending items carry it both ways; a pending add with `said` records his words', () => {
  const s = { ...c.emptyStore(), builds: [rec({ origin: real })] };
  const pp = c.projectPending(s, 'current'); assert.equal(pp.items[0].origin.said, WORDS);
  const r = pending.apply(pp, { action: 'add', title: 'New one', said: WORDS, source: 'console' });
  const next = c.absorbPending(s, 'current', r.state);
  const added = next.builds.find((b) => b.title === 'New one'); assert.equal(added.origin.said, WORDS); assert.equal(added.origin.verbatim, true);
  assert.equal(next.builds.find((b) => b.id === 'b1').origin.said, WORDS);
});
t('mergeBuild (live publish, git merge): the copy without origin never wins it away', () => {
  const a = rec({ origin: real, updatedAt: '2026-11-03T10:00:00Z' }); const b = { ...rec({ updatedAt: '2026-11-03T11:00:00Z' }), title: 'newer' };
  const x = m.mergeBuild(a, b); assert.equal(x.title, 'newer'); assert.equal(x.origin.said, WORDS);
  const { store } = m.mergeStores({ ...c.emptyStore(), builds: [b] }, { ...c.emptyStore(), builds: [a] }); assert.equal(store.builds[0].origin.said, WORDS);
});
t('validateStore accepts builds with origin', () => assert.deepEqual(c.validateStore({ ...c.emptyStore(), builds: [rec({ origin: real })] }).errors, []));

// ------------------------------------------------------------------ the CLI on a temp store (no live publish)
const dir = mkdtempSync(join(tmpdir(), 'axf-origin-'));
const storeF = join(dir, 'store.json');
const env = { ...process.env, AXF_BUILDS_STORE: storeF, AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0', AXF_BUILDS_DIR: join(dir, 'builds') };
writeFileSync(storeF, JSON.stringify({ ...c.emptyStore(), builds: [rec(), c.normBuild({ id: 'demo-build', title: 'Demo', profiles: ['current'], order: { current: 1 }, detail: 'Brett, Oct 30 2026 (voice): make every list show what I asked for please.' })] }));
const cli = (...a) => JSON.parse(execFileSync('node', [join(ROOT, 'framework/cli/build-origin.mjs'), ...a, '--json'], { env, encoding: 'utf8' }).trim().split('\n').pop());
const cliFails = (...a) => { try { execFileSync('node', [join(ROOT, 'framework/cli/build-origin.mjs'), ...a, '--json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return null; } catch (e) { return JSON.parse(String(e.stdout).trim().split('\n').pop()); } };
t('set records his words; a different verbatim quote is refused (addendum instead)', () => {
  assert.equal(cli('set', 'b1', '--said', WORDS, '--source', 'voice').origin.said, WORDS);
  const r = cliFails('set', 'b1', '--said', 'other words'); assert.equal(r.ok, false); assert.match(r.error, /never replaced/);
  assert.equal(cli('addendum', 'b1', '--said', 'Also the Crew rows.').origin.addenda.length, 1);
  assert.equal(cli('get', 'b1').origin.said, WORDS);
});
t('capture: a launch brief lands on its build with the brief and the addenda', () => {
  const bf = join(dir, 'brief.md'); writeFileSync(bf, BRIEF);
  const r = cli('capture', '--brief', bf, '--name', 'demo-build', '--by', 'janitor-joey');
  assert.equal(r.build, 'demo-build'); assert.equal(r.warn, '');
  const g = cli('get', 'demo-build').origin; assert.equal(g.said, WORDS); assert.equal(g.by, 'janitor-joey'); assert.equal(g.brief, BRIEF); assert.equal(g.addenda.length, 1); assert.equal(g.session, 'conv-123');
});
t('capture of a brief that belongs to no build records nothing', () => {
  const bf = join(dir, 'other.md'); writeFileSync(bf, '# Build: nope\n\nno words');
  const r = cli('capture', '--brief', bf, '--name', 'nope'); assert.equal(r.build, null); assert.match(r.warn, /no "## Brett said/);
});
t('the sidecar heals a store rewritten by older code that dropped the field', () => {
  const raw = JSON.parse(readFileSync(storeF, 'utf8')); for (const b of raw.builds) delete b.origin; writeFileSync(storeF, JSON.stringify(raw));
  assert.equal(cli('get', 'b1').origin.said, WORDS); assert.equal(cli('get', 'demo-build').origin.addenda.length, 1);
});
t('backfill: words from the detail, marked may be paraphrased; real words are left alone', () => {
  writeFileSync(storeF, JSON.stringify({ ...c.emptyStore(), builds: [rec({ id: 'old', detail: 'Brett, Oct 30 2026 (voice): make every list show what I asked for please.' }), rec({ id: 'has', origin: real, steps: [{ id: 's1', text: 'y', model: 'Opus' }] })] }));
  writeFileSync(join(dir, 'store.origins.json'), '{}');
  const dry = cli('backfill'); assert.equal(dry.found, 1); assert.equal(dry.builds[0].id, 'old'); assert.equal(dry.builds[0].verbatim, false); assert.equal(dry.builds[0].from, 'detail');
  assert.equal(cli('get', 'old').origin, null, 'dry run writes nothing');
  assert.equal(cli('backfill', '--apply').changed, 1);
  const g = cli('get', 'old').origin; assert.equal(g.said, 'make every list show what I asked for please.'); assert.equal(g.verbatim, false); assert.equal(g.at, '2026-10-30');
  // his real words later replace the backfilled ones
  assert.equal(cli('set', 'old', '--said', WORDS).origin.said, WORDS); assert.equal(cli('get', 'old').origin.verbatim, true);
});
t('a brief file in the builds folder backfills its build', () => {
  mkdirSync(join(dir, 'builds', 'nob'), { recursive: true }); writeFileSync(join(dir, 'builds', 'nob', '.brief.md'), BRIEF);
  writeFileSync(storeF, JSON.stringify({ ...c.emptyStore(), builds: [rec({ id: 'nob' })] })); writeFileSync(join(dir, 'store.origins.json'), '{}');
  cli('backfill', '--apply'); const g = cli('get', 'nob').origin; assert.equal(g.said, WORDS); assert.equal(g.verbatim, true); assert.equal(g.from, ''); assert.equal(g.brief, BRIEF);
});

console.log(`build-origin: ${n} checks passed`);
