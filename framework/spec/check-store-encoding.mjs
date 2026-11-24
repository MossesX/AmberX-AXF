#!/usr/bin/env node
/**
 * Store transport and encoding (deep audit, repair part B). One check per finding; each fails when its fix is undone.
 *
 *   B4-01  a multi-byte character that straddles a chunk boundary stays whole: readText, data-call.mjs over a real
 *          pipe (a write far over 64 KB), serve.mjs request bodies (a plugin's stdin reader: its own test); clip() never cuts an emoji in half;
 *          the one-off repair puts lost characters back from the journal
 *   S5-01  a field this checkout's code does not know survives a read-change-write (store, build, step), and a
 *          checkout older than the store is refused
 *   B4-07  the journal holds a diff per change with a full copy every N revisions; history and restore rebuild the
 *          record; old parts are gzipped and still read; no journal part is tracked in git
 *   B4-09  the store's header describes the cutover (the export itself: check-builds-store-data.mjs)
 *
 *   node framework/spec/check-store-encoding.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'axf-store-encoding-'));
Object.assign(process.env, { AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILD_PROFILE: 'all' });
for (const k of ['AXF_BUILDS_EXPORT', 'AXF_BUILDS_JOURNAL_FULL', 'AXF_DATA_URL', 'AXF_DATA_CALL_SYNC']) delete process.env[k];

const { clip, readText } = await import('../core/clip.mjs');
const JC = await import('../plan/builds-journal-core.mjs');
const io = await import('../cli/builds-store.mjs');
const hooks = await import('../cli/build-hooks.mjs');

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } };
const BAD = '�';
// 3-byte and 4-byte characters with an ASCII lead, so chunk boundaries fall inside characters at every offset
const big = (bytes) => { const unit = 'a→é…“”🙂·'; return unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit))); };
const storeFile = process.env.AXF_BUILDS_STORE;
const journalDir = join(dir, 'store.journal');
const rawStore = () => JSON.parse(readFileSync(storeFile, 'utf8'));
const journalLines = () => readdirSync(journalDir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => readFileSync(join(journalDir, f), 'utf8').split('\n').filter(Boolean));
const reset = () => { rmSync(storeFile, { force: true }); rmSync(journalDir, { recursive: true, force: true }); rmSync(join(dir, 'store.origins.json'), { force: true }); };
const run = (file, args, input, env = {}) => new Promise((done, fail) => {
  const p = spawn(process.execPath, [file, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const out = []; p.stdout.on('data', (c) => out.push(c)); p.on('error', fail); p.on('close', () => done(Buffer.concat(out).toString('utf8')));
  p.stdin.on('error', () => {}); p.stdin.end(input);
});

try {
  // ------------------------------------------------------------------ B4-01
  await t('B4-01 readText: a character split across two chunks is decoded whole', async () => {
    const text = big(4096); const bytes = Buffer.from(text, 'utf8');
    for (const cut of [1, 2, 3, 7, 1000, 1001, 1002, 1003]) {
      const chunks = []; for (let i = 0; i < bytes.length; i += cut) chunks.push(bytes.subarray(i, i + cut));
      assert.equal(await readText((async function* gen() { yield* chunks; })()), text, `chunks of ${cut} byte(s)`);
    }
    // the bug itself, so this check is known to bite: decoding chunk by chunk does destroy characters
    let naive = ''; for (let i = 0; i < bytes.length; i += 7) naive += bytes.subarray(i, i + 7);
    assert.ok(naive.includes(BAD), 'chunk-by-chunk decoding makes U+FFFD');
  });

  await t('B4-01 data-call.mjs: a 200 KB+ write with multi-byte characters across every 64 KB boundary arrives byte for byte', async () => {
    const got = [];
    const srv = createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => { got.push({ method: req.method, url: req.url, body: Buffer.concat(c) }); res.writeHead(200, { 'content-type': 'application/json', etag: '"e1"' }); res.end(JSON.stringify({ ns: 'builds', path: 'encoding-test.json', kind: 'record', rev: 1, etag: 'e1' })); }); });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const text = big(300 * 1024);
      assert.ok(Buffer.byteLength(text) > 4 * 65536, 'the payload crosses several pipe chunks');
      const reqText = JSON.stringify({ op: 'put', key: 'builds/encoding-test.json', data: { text } });
      const out = await run(join(ROOT, 'framework/cli/data-call.mjs'), [], reqText, { AXF_DATA_URL: `http://127.0.0.1:${srv.address().port}`, AXF_DATA_TOKEN: 'tok' });
      const put = got.find((r) => r.method === 'PUT');
      assert.ok(put, `axf-data got the write (data-call answered: ${out.slice(0, 200)})`);
      assert.ok(!put.body.includes(Buffer.from(BAD, 'utf8')), 'no U+FFFD in what was sent on');
      assert.ok(JSON.parse(put.body.toString('utf8')).text === text, 'the text is the same, character for character');
      assert.ok(Buffer.from(JSON.parse(put.body.toString('utf8')).text, 'utf8').equals(Buffer.from(text, 'utf8')), 'and byte for byte');
    } finally { srv.close(); }
  });

  await t('B4-01 serve.mjs: a request body sent in pieces that split a character is read whole', async () => {
    const { startBuildServer } = await import('../cli/serve.mjs');
    const server = startBuildServer({ port: 0, token: '', log: () => {} });
    await new Promise((ok) => (server.listening ? ok() : server.once('listening', ok)));
    try {
      const name = 'no-such-app-→é🙂…-end';
      const body = Buffer.from(JSON.stringify({ dir: name }), 'utf8');
      for (let cut = body.indexOf(Buffer.from('→')) + 1; cut < body.indexOf(Buffer.from('-end')); cut += 1) {
        const text = await new Promise((done, fail) => {
          const req = request({ host: '127.0.0.1', port: server.address().port, path: '/validate', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => done(Buffer.concat(c).toString('utf8'))); });
          req.on('error', fail); req.setNoDelay?.(true);
          // two writes, far enough apart to arrive as two chunks, the cut inside a character
          req.write(body.subarray(0, cut)); setTimeout(() => req.end(body.subarray(cut)), 40);
        });
        assert.ok(!text.includes(BAD), `cut at byte ${cut}: no U+FFFD (${text.slice(0, 120)})`);
        assert.ok(text.includes(name), `cut at byte ${cut}: the name came through whole (${text.slice(0, 160)})`);
      }
    } finally { server.close(); }
  });

  await t('B4-01 framework stdin readers decode once, never chunk by chunk', () => {
    for (const f of ['framework/cli/data-call.mjs', 'framework/spec/check-builds-store-data.mjs']) {
      assert.ok(!/for await \(const \w+ of process\.stdin\) \w+ \+= \w+/.test(readFileSync(join(ROOT, f), 'utf8')), `${f}: no \`text += chunk\` on stdin`);
    }
  });

  await t('B4-01 clip: a cut never leaves half an emoji', () => {
    assert.equal(clip('ab🙂cd', 3), 'ab');
    assert.equal(clip('ab🙂cd', 4), 'ab🙂');
    assert.equal(clip('abc', 10), 'abc'); assert.equal(clip('abc', 2), 'ab'); assert.equal(clip(null, 2), ''); assert.equal(clip('🙂', 1), '');
    for (let i = 0; i < 12; i += 1) assert.ok(!Buffer.from(clip('🙂→🙂é🙂', i), 'utf8').toString('utf8').includes(BAD), `cut at ${i}`);
    assert.ok(Buffer.from('ab🙂'.slice(0, 3), 'utf8').toString('utf8').includes(BAD), 'a plain slice does');
  });

  // ------------------------------------------------------------------ S5-01
  await t('S5-01 pass-through: fields this checkout does not know survive a read-change-write (store, build, step)', () => {
    reset();
    io.withStore((s) => { s.builds.push({ id: 'keeper', title: 'Keeper', status: 'pending', profile: 'all', steps: [{ id: 's1', text: 'one' }, { id: 's2', text: 'two' }] }, { id: 'other', title: 'Other', status: 'pending', profile: 'all', steps: [] }); return s; }, { by: 'test', action: 'add' });
    // a newer release wrote these
    const raw = rawStore();
    raw.fromTheFuture = { a: 1 };
    const k = raw.builds.find((b) => b.id === 'keeper');
    k.planningV2 = [{ text: 'a step Brett wrote', body: 'the real instructions' }]; k.futureFlag = false;
    k.steps[1].futureStepField = { minutes: 15 };
    writeFileSync(storeFile, JSON.stringify(raw));
    // this checkout reads it, …
    const read = io.loadStore().builds.find((b) => b.id === 'keeper');
    assert.deepEqual(read.planningV2, k.planningV2, 'a read keeps it');
    // … changes the build that carries them, another build, and replaces the record wholesale
    io.withStore((s) => { const b = s.builds.find((x) => x.id === 'keeper'); b.title = 'Keeper, ticked'; b.steps[0].done = true; return s; }, { by: 'test', action: 'tick' });
    io.withStore((s) => { s.builds.find((x) => x.id === 'other').title = 'Other, changed'; return s; }, { by: 'test', action: 'other' });
    io.withStore((s) => { const i = s.builds.findIndex((x) => x.id === 'keeper'); const { planningV2, futureFlag, ...rest } = s.builds[i]; s.builds[i] = { ...rest, detail: 'rebuilt by a writer that never saw the new fields', steps: rest.steps.map(({ futureStepField, ...x }) => x) }; return s; }, { by: 'test', action: 'rebuild' });
    const after = rawStore(); const b = after.builds.find((x) => x.id === 'keeper');
    assert.equal(b.title, 'Keeper, ticked'); assert.equal(b.detail, 'rebuilt by a writer that never saw the new fields');
    assert.deepEqual(b.planningV2, k.planningV2, 'the build field is still there');
    assert.equal(b.futureFlag, false, 'a false value too');
    assert.deepEqual(b.steps.find((x) => x.id === 's2').futureStepField, { minutes: 15 }, 'the step field is still there');
    assert.deepEqual(after.fromTheFuture, { a: 1 }, 'the store field is still there');
    // a field the code knows is not treated as unknown: the sandbox tag is derived from the id, never taken from the record
    const forged = rawStore(); forged.builds.find((x) => x.id === 'other').demo = true; writeFileSync(storeFile, JSON.stringify(forged));
    assert.equal(io.loadStore().builds.find((x) => x.id === 'other').demo, undefined, 'a known field is still normalised');
  });

  await t('S5-01 planning: a Pipeline 2.0 build keeps the plan\'s steps through later writes', async () => {
    reset();
    const P2 = await import('../core/pipeline-status.mjs');
    const planning = [{ text: 'Design the page' }, { text: 'Wire the API → store' }];
    io.withStore((s) => { s.builds.push({ id: 'planned', title: 'Planned', status: 'pending', flow: P2.FLOW, profile: 'all', planning, steps: [] }); return s; }, { by: 'test', action: 'send' });
    io.withStore((s) => { s.builds.find((x) => x.id === 'planned').notes.push({ text: 'a later tick', at: new Date().toISOString() }); return s; }, { by: 'test', action: 'note' });
    assert.deepEqual(rawStore().builds.find((x) => x.id === 'planned').planning.map((p) => p.text), planning.map((p) => p.text));
  });

  await t('S5-01 schema version: a write stamps it; a checkout older than the store is refused and writes nothing', () => {
    reset();
    io.withStore((s) => { s.builds.push({ id: 'v1', title: 'v1', status: 'pending', profile: 'all', steps: [] }); return s; }, { by: 'test', action: 'add' });
    assert.equal(rawStore().storeVersion, io.STORE_VERSION, 'stamped');
    const newer = { ...rawStore(), storeVersion: io.STORE_VERSION + 1 };
    writeFileSync(storeFile, JSON.stringify(newer));
    const bytes = readFileSync(storeFile, 'utf8'); const lines = journalLines().length;
    assert.throws(() => io.withStore((s) => { s.builds[0].title = 'written by old code'; return s; }, { by: 'test', action: 'old' }), (e) => e instanceof io.StoreTooNew && e.code === 'stale_checkout' && /pull main/.test(e.message));
    assert.equal(readFileSync(storeFile, 'utf8'), bytes, 'the store is untouched');
    assert.equal(journalLines().length, lines, 'nothing journalled');
    assert.equal(io.loadStore().builds[0].title, 'v1', 'reading a newer store still works');
    // the same store at this checkout's version is writable again
    writeFileSync(storeFile, JSON.stringify({ ...newer, storeVersion: io.STORE_VERSION }));
    io.withStore((s) => { s.builds[0].title = 'ok'; return s; }, { by: 'test', action: 'ok' });
    assert.equal(rawStore().builds[0].title, 'ok');
  });

  // ------------------------------------------------------------------ B4-07
  await t('B4-07 journal: a tick of a build with a 30 KB brief is a small diff; a full copy every N revisions', () => {
    reset(); process.env.AXF_BUILDS_JOURNAL_FULL = '4';
    const detail = 'd'.repeat(7000); const brief = `Settings → Appearance ${'brief '.repeat(4500)}end`;
    io.withStore((s) => { s.builds.push({ id: 'heavy', title: 'Heavy', detail, status: 'pending', profile: 'all', origin: { said: 'do it', brief, at: new Date().toISOString() }, steps: [{ id: 's1', text: 'one' }, { id: 's2', text: 'two' }, { id: 's3', text: 'three' }] }); return s; }, { by: 'test', action: 'add' });
    const want = [JSON.parse(JSON.stringify(io.loadStore().builds.find((b) => b.id === 'heavy')))];
    const edits = [(b) => { b.steps[0].done = true; }, (b) => { b.notes.push({ text: 'note one', at: new Date().toISOString() }); }, (b) => { b.steps.push({ id: 's4', text: 'four' }); b.steps.reverse(); }, (b) => { b.notes.push({ text: 'note two →', at: new Date().toISOString() }); b.title = 'Heavier'; }, (b) => { b.steps = b.steps.filter((x) => x.id !== 's2'); }, (b) => { b.detail = 'short now'; }];
    for (const edit of edits) { const r = io.withStore((s) => { edit(s.builds.find((b) => b.id === 'heavy')); return s; }, { by: 'test', action: 'edit' }); want.push(JSON.parse(JSON.stringify(r.store.builds.find((b) => b.id === 'heavy')))); }
    const lines = journalLines(); assert.equal(lines.length, edits.length + 1);
    const items = lines.map((l) => JSON.parse(l).builds[0]);
    assert.ok(items[0].after && Buffer.byteLength(lines[0]) > 30000, 'the add is a full copy');
    assert.ok(items[1].diff && !items[1].after && !items[1].before, 'a tick is a diff');
    assert.ok(Buffer.byteLength(lines[1]) < 2000, `a tick's line is small (${Buffer.byteLength(lines[1])} bytes; the build is ${Buffer.byteLength(lines[0])})`);
    assert.deepEqual(items[2].diff.append.notes.map((x) => x.text), ['note one'], 'a new note is journalled as the note, not the whole list');
    assert.deepEqual(items.map((x) => !!x.after), want.map((b) => b.rev === 1 || b.rev % 4 === 0), 'a full copy at every 4th revision of the build');
    // history rebuilds every revision exactly as the store held it
    const h = io.journalOf('heavy');
    assert.deepEqual(h.slice(1).map((x) => x.buildRev), want.slice(1).map((b) => b.rev));
    assert.equal(h[0].op, 'add'); assert.equal(h[0].after.origin.brief, brief);
    h.forEach((x, i) => { if (!i) return; const { defaultSteps, ...w } = want[i]; const { defaultSteps: d2, ...got } = x.after; assert.deepEqual(JSON.parse(JSON.stringify(got)), w, `revision ${x.buildRev}`); });
    // restore from a revision that is stored as a diff
    const rev = h[2]; assert.ok(items[2].diff);
    io.restoreBuild('heavy', rev.rev, 'test');
    const back = io.loadStore().builds.find((b) => b.id === 'heavy');
    assert.equal(back.title, 'Heavy'); assert.deepEqual(back.notes.map((x) => x.text), ['note one']); assert.equal(back.origin.brief, brief);
    delete process.env.AXF_BUILDS_JOURNAL_FULL;
  });

  await t('B4-07 journal: a diff whose base is missing is reported broken, never guessed; replay (build-hooks) reads diffs', () => {
    const lines = journalLines().map((l) => JSON.parse(l));
    const cut = lines.filter((e, i) => i !== 1); // the first diff is gone: the second has no base
    const h = JC.expandHistory(cut, 'heavy');
    assert.equal(h[1].broken, true); assert.equal(h[1].after, null);
    assert.ok(h.slice(2).some((x) => x.after && !x.broken), 'the walk picks up at the next full copy');
    // a write held whole and as a diff (two versions of the code wrote two copies) counts once
    const whole = JC.expandJournal(lines); const twice = JC.expandJournal([...lines, ...whole]);
    assert.deepEqual(twice.map((e) => e.rev), whole.map((e) => e.rev));
    assert.ok(whole.every((e) => e.builds.every((b) => b.after && !b.diff)), 'every item rebuilt');
    const ev = hooks.journalEvents(journalDir);
    assert.ok(Array.isArray(ev) && ev.length > 0, 'events from a journal of diffs');
    // the writer never makes such a diff itself: a record changed outside the journal is journalled whole next time
    const raw = rawStore(); raw.builds.find((b) => b.id === 'heavy').title = 'edited behind the journal'; writeFileSync(storeFile, JSON.stringify(raw));
    io.withStore((s) => { s.builds.find((b) => b.id === 'heavy').notes.push({ text: 'after the edit', at: new Date().toISOString() }); return s; }, { by: 'test', action: 'tick' });
    io.withStore((s) => { s.builds.find((b) => b.id === 'heavy').notes.push({ text: 'and one more', at: new Date().toISOString() }); return s; }, { by: 'test', action: 'tick' });
    const [full, diff] = journalLines().slice(-2).map((l) => JSON.parse(l).builds[0]);
    assert.ok(full.after && full.after.title === 'edited behind the journal', 'whole after an edit behind the journal');
    assert.ok(diff.diff && !diff.after, 'a diff again after that');
    assert.ok(io.journalOf('heavy').every((x) => x.after && !x.broken), 'every revision can be rebuilt');
  });

  await t('B4-07 journal: parts older than 30 days are gzipped, byte for byte, and still read', () => {
    const before = io.journalOf('heavy').map((x) => JSON.stringify(x));
    const part = readdirSync(journalDir).find((f) => f.endsWith('.jsonl')); const plain = readFileSync(join(journalDir, part));
    assert.equal(io.rotateJournal({ apply: true }).rotated.length, 0, 'a fresh part stays');
    const old = new Date(Date.now() - 31 * 86400000); utimesSync(join(journalDir, part), old, old);
    assert.equal(io.rotateJournal({ apply: false }).rotated.length, 1, 'dry run names it');
    assert.ok(existsSync(join(journalDir, part)), 'and writes nothing');
    const r = io.rotateJournal({ apply: true });
    assert.equal(r.rotated.length, 1); assert.ok(r.rotated[0].gzBytes < r.rotated[0].bytes / 5, 'much smaller');
    assert.ok(!existsSync(join(journalDir, part)) && existsSync(join(journalDir, `${part}.gz`)));
    assert.ok(gunzipSync(readFileSync(join(journalDir, `${part}.gz`))).equals(plain), 'the same bytes');
    assert.deepEqual(io.journalOf('heavy').map((x) => JSON.stringify(x)), before, 'history reads the rotated part');
    assert.equal(statSync(join(journalDir, `${part}.gz`)).size, io.journalParts()[part.slice(0, -6)].size);
  });

  await t('B4-07 no journal part is tracked in git (the folder is ignored)', () => {
    let tracked = null;
    try { tracked = execFileSync('git', ['ls-files', '--', '_claude/builds/journal'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch { /* not a git checkout */ }
    if (tracked) assert.deepEqual(tracked, []);
    assert.ok(/^_claude\/builds\/journal\/$/m.test(readFileSync(join(ROOT, '.gitignore'), 'utf8')), 'ignored');
  });

  // ------------------------------------------------------------------ B4-01: the one-off repair
  await t('B4-01 repair: characters lost to U+FFFD come back from the newest clean journal revision', () => {
    reset();
    const brief = `Open Settings → Appearance, then “UI Review · Screenshots”… ${'x'.repeat(200)} done 🙂 end`;
    io.withStore((s) => { s.builds.push({ id: 'hurt', title: 'Hurt', status: 'pending', profile: 'all', origin: { said: 'fix it', brief, at: new Date().toISOString() }, steps: [{ id: 's1', text: 'Move A → B' }, { id: 's2', text: 'plain' }] }, { id: 'lost', title: 'Lost', status: 'pending', profile: 'all', steps: [{ id: 's1', text: 'never clean' }] }); return s; }, { by: 'test', action: 'add' });
    io.withStore((s) => { s.builds.find((b) => b.id === 'hurt').notes.push({ text: 'ticked', at: new Date().toISOString() }); return s; }, { by: 'test', action: 'tick' });
    // the transport bug: the stored record (not the journal) lost characters, and the text was edited since
    const raw = rawStore(); const hurt = raw.builds.find((b) => b.id === 'hurt');
    hurt.origin.brief = `${brief.replace('→', BAD.repeat(3)).replace('·', BAD.repeat(2)).replace('🙂', BAD.repeat(4))} (edited later)`;
    hurt.steps[0].text = `Move A ${BAD.repeat(3)} B`;
    raw.builds.find((b) => b.id === 'lost').steps[0].text = `was ${BAD.repeat(3)} always damaged here`;
    writeFileSync(storeFile, JSON.stringify(raw)); rmSync(join(dir, 'store.origins.json'), { force: true });
    const dry = io.repairMojibakeNow({ apply: false });
    assert.deepEqual(dry.builds.map((b) => b.id).sort(), ['hurt', 'lost']); assert.equal(dry.fixed, 4); assert.equal(dry.left, 1);
    assert.ok(JSON.stringify(rawStore()).includes(BAD), 'the dry run writes nothing');
    const r = io.repairMojibakeNow({ apply: true });
    assert.equal(r.fixed, 4);
    const fixed = io.loadStore().builds.find((b) => b.id === 'hurt');
    assert.equal(fixed.origin.brief, `${brief} (edited later)`, 'only the lost characters changed; the later edit stays');
    assert.equal(fixed.steps[0].text, 'Move A → B');
    assert.ok(io.loadStore().builds.find((b) => b.id === 'lost').steps[0].text.includes(BAD), 'with no clean copy the text is left alone and reported');
    assert.equal(io.journalOf('hurt').at(-1).action, 'repair-mojibake', 'the repair is a journalled write');
    assert.equal(JC.repairText(`a ${BAD}${BAD} b`, ['x a é b y', 'a Z b']).text, 'a é b', 'the newest clean copy with a non-ASCII character there wins');
  });

  // ------------------------------------------------------------------ B4-09
  await t('B4-09 the store\'s header describes the cutover, not store.json as "the store"', () => {
    const head = readFileSync(join(ROOT, 'framework/cli/builds-store.mjs'), 'utf8').split('*/')[0];
    assert.ok(!/store\.json\s+the store \(repo file/.test(head), 'the old line is gone');
    assert.ok(/on axf-data/.test(head) && /Postgres/.test(head) && /orchestrator\.json export in the repo is no longer rewritten/.test(head));
  });

  console.log(`store transport and encoding: ${n} checks passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
