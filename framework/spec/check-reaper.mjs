#!/usr/bin/env node
// vps-reaper@1: the VPS cleans up its own ghosts. The plan (pure): a finished `claude -p` is killed and its run handed
// on, a working build is never touched, dead tmux sessions close, ghost slots / heavy locks are freed, leftover test
// servers and stale temp folders go. End to end on real processes: a pass kills a finished fake claude and a leftover
// server, writes the session-end event, frees the ghost slots, logs every action, notes it and sends one FYI, and leaves
// the working build alone.
// node framework/spec/check-reaper.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-reaper-'));
const root = join(tmp, 'builds'); const slotsDir = join(tmp, 'slots'); const hdir = join(tmp, 'headless'); const tmpRoot = join(tmp, 'tmp');
for (const d of [root, slotsDir, hdir, tmpRoot]) mkdirSync(d, { recursive: true });
Object.assign(process.env, { AXF_SLOTS_DIR: slotsDir, AXF_HEADLESS_DIR: hdir, AXF_PIPELINE_WORKTREES: root, AXF_SLOTS_TMUX: 'off', AXF_REAPER_TMP: tmpRoot, AXF_PIPELINE_CONSOLE: 'off', AXF_BUILD_LIMIT: 'off', AXF_SLOTS_HOST: 'test-host' });
const R = await import('../cli/reaper.mjs');

let n = 0; const t = async (name, fn) => { try { await fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const MIN = 60e3;
const now = Date.parse('2026-11-18T12:00:00Z');
const S = { doneGraceMin: 3, idleMin: 20, procGraceMin: 5, serverGraceMin: 20, orphanServerMin: 60, foreignGraceMin: 30, tmpMaxAgeMin: 60, ctxMaxAgeH: 24 };
const claudeP = (over) => ({ ppid: 1, args: ['claude', '-p', '--model', 'opus'], cwdDeleted: false, startMs: now - 60 * MIN, buildEnv: '', sessionEnv: '', sameNs: true, ...over });
const base = (over = {}) => ({ now, root: '/w', host: 'h', self: new Set(), containers: new Set(), procs: [], tmux: [], listeners: new Set(), builds: {}, logs: {}, slots: {}, ended: new Set(), tmp: [], ...over });
const types = (acts) => acts.map((a) => `${a.type}:${a.pid ?? a.session ?? a.id ?? a.path}`).sort();

await t('names: sessions and worktree paths map to their build', () => {
  assert.equal(R.buildOfSession('axf-foo'), 'foo');
  assert.equal(R.buildOfSession('axf-foo-bar--paulie'), 'foo-bar');
  assert.equal(R.buildOfSession('axf-foo--gina-201530'), 'foo');
  assert.equal(R.buildOfSession('axt-console-x'), '');
  assert.equal(R.buildOfPath('/w/foo/apps/x', '/w'), 'foo');
  assert.equal(R.buildOfPath('/w/foo.axhub/src', '/w'), 'foo');
  assert.equal(R.buildOfPath('/opt/axf/apps', '/w'), '');
  assert.ok(R.isClaudePrint(['/usr/bin/claude', '-p'])); assert.ok(!R.isClaudePrint(['claude'])); assert.ok(!R.isClaudePrint(['vite', '-p']));
});

await t('log endings: the last result line with nothing after it means the run is over', () => {
  assert.deepEqual(R.logEnding('▸ Bash: ls\n\x1b[1m■ done\x1b[0m · 3m · 40 turns\nThe report.\nSessionEnd hook failed'), { ended: true, kind: 'done' });
  assert.deepEqual(R.logEnding('■ error_max_turns · 9m\n'), { ended: true, kind: 'error_max_turns' });
  assert.deepEqual(R.logEnding('■ done\n# model claude-opus-5-5 · /w/foo\n▸ Read: a'), { ended: false, kind: '' }, 'a new run started after it');
  assert.deepEqual(R.logEnding('▸ Bash: ls\n  ↳ done'), { ended: false, kind: '' });
});

await t('a finished claude -p (log ends "■ done", idle) is killed; with no wrapper its run is closed as finished', () => {
  const f = base({ procs: [claudeP({ pid: 10, cwd: '/w/foo', sessionEnv: 'axf-foo--joey' })], logs: { foo: { lastWriteMs: now - 10 * MIN, ended: true, kind: 'done', folder: true } } });
  const acts = R.plan(f, S);
  assert.deepEqual(types(acts), ['end-event:axf-foo--joey', 'kill-proc:10']);
  const ev = acts.find((a) => a.type === 'end-event');
  assert.equal(ev.exit, 0); assert.equal(ev.kind, 'phase-done'); assert.equal(ev.build, 'foo');
  assert.match(acts.find((a) => a.type === 'kill-proc').why, /log ended \("■ done"\) 10 min ago/);
  // inside its tmux wrapper: only the kill (the wrapper writes the end and calls the dispatcher itself)
  assert.deepEqual(types(R.plan({ ...f, tmux: [{ name: 'axf-foo--joey', createdMs: now - 70 * MIN, paneClaude: true }] }, S)), ['kill-proc:10']);
  // an end already recorded for that session is not written twice
  assert.deepEqual(types(R.plan({ ...f, ended: new Set(['axf-foo--joey']) }, S)), ['kill-proc:10']);
  // an error result closes as a crash
  assert.equal(R.plan({ ...f, logs: { foo: { ...f.logs.foo, kind: 'error_max_turns' } } }, S).find((a) => a.type === 'end-event').kind, 'crash');
});

await t('a result line with background tasks still running (a CI watch) is waiting, until bgMaxMin', () => {
  const procs = [claudeP({ pid: 20, cwd: '/w/foo', startMs: now - 200 * MIN }), { pid: 21, ppid: 20, args: ['bash', '-c', 'gh run watch 1'], cwd: '/w/foo', startMs: now - 30 * MIN, sameNs: true }, { pid: 22, ppid: 21, args: ['gh', 'run', 'watch', '1'], cwd: '/w/foo', startMs: now - 30 * MIN, sameNs: true }];
  assert.deepEqual(R.plan(base({ procs, logs: { foo: { lastWriteMs: now - 10 * MIN, ended: true, kind: 'done', folder: true } } }), S), []);
  const late = R.plan(base({ procs, logs: { foo: { lastWriteMs: now - 100 * MIN, ended: true, kind: 'done', folder: true } } }), { ...S, bgMaxMin: 90 });
  assert.deepEqual(types(late), ['kill-proc:20', 'kill-proc:21', 'kill-proc:22']);
  assert.equal(late[0].marker, '/w/foo', 'a clean finish: the wrapper is told so');
});

await t('never kills a build that is working', () => {
  const p = claudeP({ pid: 11, cwd: '/w/foo' });
  // ended line but written 1 minute ago: still inside the grace
  assert.deepEqual(R.plan(base({ procs: [p], logs: { foo: { lastWriteMs: now - MIN, ended: true, kind: 'done', folder: true } } }), S), []);
  // a claude that started after the last log write is a new run just starting
  assert.deepEqual(R.plan(base({ procs: [{ ...p, startMs: now - 4 * MIN }], logs: { foo: { lastWriteMs: now - 10 * MIN, ended: true, kind: 'done', folder: true } } }), S), []);
  // a settled build whose session still writes its log
  assert.deepEqual(R.plan(base({ procs: [p], builds: { foo: { status: 'landed' } }, logs: { foo: { lastWriteMs: now - 2 * MIN, ended: false, folder: true } } }), S), []);
  // running build, quiet log: not the reaper's call
  assert.deepEqual(R.plan(base({ procs: [p], builds: { foo: { status: 'running' } }, logs: { foo: { lastWriteMs: now - 90 * MIN, ended: false, folder: true } } }), S), []);
  // young process, this process and its ancestors, another pid namespace, interactive claude, no worktree
  const ended = { foo: { lastWriteMs: now - 10 * MIN, ended: true, kind: 'done', folder: true } };
  assert.deepEqual(R.plan(base({ procs: [{ ...p, startMs: now - 2 * MIN }], logs: ended }), S), []);
  assert.deepEqual(R.plan(base({ procs: [p], self: new Set([11]), logs: ended }), S), []);
  assert.deepEqual(R.plan(base({ procs: [{ ...p, sameNs: false }], logs: ended }), S), []);
  assert.deepEqual(R.plan(base({ procs: [{ ...p, args: ['claude'] }], logs: ended }), S), []);
  assert.deepEqual(R.plan(base({ procs: [{ ...p, cwd: '/opt/axf', buildEnv: 'foo' }], logs: ended }), S), []);
});

await t('orphan claude -p: settled build with no session, or its folder deleted', () => {
  const p = claudeP({ pid: 12, cwd: '/w/foo' });
  const quiet = { foo: { lastWriteMs: now - 45 * MIN, ended: false, folder: true } };
  assert.match(R.plan(base({ procs: [p], builds: { foo: { status: 'landed' } }, logs: quiet }), S)[0].why, /build is landed and its session ended/);
  assert.deepEqual(R.plan(base({ procs: [p], builds: { foo: { status: 'landed' } }, logs: quiet, tmux: [{ name: 'axf-foo', createdMs: now - 60 * MIN, paneClaude: true }] }), S), [], 'its wrapper still runs: the dispatcher ends it');
  assert.match(R.plan(base({ procs: [{ ...p, cwdDeleted: true }], logs: quiet }), S)[0].why, /build folder is gone/);
});

await t('tmux axf-* sessions with no claude left whose run is over are closed; others stay', () => {
  const logs = { foo: { lastWriteMs: now - 10 * MIN, ended: true, kind: 'done', folder: true }, bar: { lastWriteMs: now - 40 * MIN, folder: true }, baz: { lastWriteMs: now - 40 * MIN, folder: true } };
  const tm = [
    { name: 'axf-foo--joey', createdMs: now - 60 * MIN, paneClaude: false },                 // log ended, no end event: close + end event
    { name: 'axf-bar', createdMs: now - 60 * MIN, paneClaude: false, finished: true },        // end line on its pane
    { name: 'axf-baz', createdMs: now - 60 * MIN, paneClaude: false },                        // running build, no claude: not judged here
    { name: 'axf-qux', createdMs: now - 60 * MIN, paneClaude: true },                         // claude running
    { name: 'axt-console-1', createdMs: now - 60 * MIN, paneClaude: false, finished: true },  // a console terminal: never
  ];
  const acts = R.plan(base({ tmux: tm, logs, builds: { baz: { status: 'running' } } }), S);
  assert.deepEqual(types(acts), ['end-event:axf-foo--joey', 'kill-tmux:axf-bar', 'kill-tmux:axf-foo--joey']);
  assert.deepEqual(types(R.plan(base({ tmux: [{ name: 'axf-baz', createdMs: now - 60 * MIN }], logs, builds: { baz: { status: 'complete' } } }), S)), ['kill-tmux:axf-baz']);
});

await t('ghost slots: a host that is gone, a reused pid, a settled build; heavy locks with no owner', () => {
  const at = (m) => new Date(now - m * MIN).toISOString();
  const slots = {
    running: [
      { id: 'hl-rhonda', name: 'rhonda-ci-fix', host: 'efb11ebd1981', pid: 8823, session: 'axf-rhonda-ci-fix', startedAt: at(4 * 24 * 60) },  // the console container was recreated
      { id: 'hl-live-c', name: 'swarm', host: 'c0ffee', pid: 5, startedAt: at(600) },                                                  // its container still runs
      { id: 'hl-young-foreign', name: 'x', host: 'gone1', pid: 5, startedAt: at(5) },                                                   // inside the grace
      { id: 'hl-reused', name: 'old', host: 'h', pid: 300, startedAt: at(300) },                                                        // pid 300 started long after
      { id: 'hl-done', name: 'done-build', build: 'done-build', host: 'h', pid: 301, startedAt: at(120) },                              // build landed, nothing runs
      { id: 'hl-tmux', name: 'live', build: 'live', host: 'h', pid: 302, session: 'axf-live', startedAt: at(120) },                    // its session is alive
    ],
    queue: [],
    heavy: [
      { id: 'hv-dead', label: 'vite build', host: 'h', pid: 999, startedAt: at(30) },
      { id: 'hv-live', label: 'playwright', host: 'h', pid: 303, startedAt: at(30) },
      { id: 'hv-foreign', label: 'x', host: 'gone2', pid: 1, startedAt: at(60) },
    ],
  };
  const procs = [{ pid: 300, ppid: 1, args: ['bash'], cwd: '/', startMs: now - 10 * MIN }, { pid: 301, ppid: 1, args: ['bash'], cwd: '/', startMs: now - 121 * MIN }, { pid: 302, ppid: 1, args: ['bash'], startMs: now - 121 * MIN }, { pid: 303, ppid: 1, args: ['node'], startMs: now - 30 * MIN }];
  const acts = R.plan(base({ slots, procs, containers: new Set(['c0ffee']), tmux: [{ name: 'axf-live', createdMs: now - 120 * MIN, paneClaude: true }], builds: { 'done-build': { status: 'landed' }, live: { status: 'running' } }, logs: { 'done-build': { lastWriteMs: now - 100 * MIN, folder: true } } }), S);
  assert.deepEqual(types(acts), ['drop-slot:hl-done', 'drop-slot:hl-reused', 'drop-slot:hl-rhonda', 'drop-slot:hv-dead', 'drop-slot:hv-foreign']);
  assert.match(acts.find((a) => a.id === 'hl-rhonda').why, /its host efb11ebd1981 is gone/);
  // docker could not say which containers live: foreign entries are left alone
  assert.ok(!R.plan(base({ slots, procs, containers: null }), S).some((a) => a.id === 'hl-rhonda'));
});

await t('test servers: from a worktree with no live session, or orphaned from /tmp; never with a session or claude above', () => {
  const srv = (pid, cwd, over = {}) => ({ pid, ppid: 1, args: ['node', 'vite', 'preview', '--port', String(7000 + pid)], cwd, cwdDeleted: false, startMs: now - 90 * MIN, sameNs: true, ...over });
  const procs = [
    srv(1, '/w/old/apps/console-web'),                        // build ended: kill
    srv(2, '/w/busy/apps/console-web'),                       // its build has a live tmux session
    srv(3, '/w/quiet/apps/console-web'),                      // its build log was written 5 min ago
    srv(4, '/tmp/bwsp-main/apps/console-web', { cwdDeleted: true }), // orphan from a deleted /tmp folder: kill
    srv(5, '/tmp/run'),                                       // /tmp but a claude is above it
    { pid: 50, ppid: 1, args: ['claude', '-p'], cwd: '/tmp', startMs: now - 100 * MIN, sameNs: true },
    srv(6, '/opt/gizmox/app'),                                // a service elsewhere: never
    srv(7, '/w/new/apps/x', { startMs: now - 5 * MIN }),      // still inside the grace
  ];
  procs[4].ppid = 50;
  const acts = R.plan(base({ procs, listeners: new Set([1, 2, 3, 4, 5, 6, 7]), tmux: [{ name: 'axf-busy--joey', createdMs: now - 100 * MIN, paneClaude: true }], logs: { quiet: { lastWriteMs: now - 5 * MIN, folder: true } } }), S);
  assert.deepEqual(types(acts), ['kill-proc:1', 'kill-proc:4']);
});

await t('temp folders: old axf-limit-*, unused old axf-ctx-*, leaked state writes', () => {
  const tmp = [
    { path: '/tmp/axf-limit-a', kind: 'limit', mtimeMs: now - 2 * 60 * MIN },
    { path: '/tmp/axf-limit-b', kind: 'limit', mtimeMs: now - 10 * MIN },
    { path: '/tmp/axf-ctx-a', kind: 'ctx', mtimeMs: now - 48 * 60 * MIN, used: false },
    { path: '/tmp/axf-ctx-b', kind: 'ctx', mtimeMs: now - 48 * 60 * MIN, used: true },
    { path: '/s/state.json.1.tmp', kind: 'state-tmp', mtimeMs: now - 30 * MIN },
  ];
  assert.deepEqual(types(R.plan(base({ tmp }), S)), ['rm:/s/state.json.1.tmp', 'rm:/tmp/axf-ctx-a', 'rm:/tmp/axf-limit-a']);
});

await t('settings are clamped; the summary names what was done and why', () => {
  const s = R.normSettings({ idleMin: 1, doneGraceMin: '7', enabled: 'false', bogus: 1 });
  assert.equal(s.idleMin, 5); assert.equal(s.doneGraceMin, 7); assert.equal(s.enabled, false); assert.ok(!('bogus' in s));
  const sum = R.summarize([{ type: 'kill-proc', what: 'claude -p for foo', why: 'done' }, { type: 'rm', what: '/tmp/x', why: 'old' }, { type: 'end-event', build: 'foo' }]);
  assert.equal(sum.title, 'VPS reaper: 1 ghost cleared, 1 temp item removed');
  assert.match(sum.body, /• claude -p for foo: done/); assert.match(sum.body, /handed to the lander: foo/);
  assert.equal(sum.count, 1);
});

await t('hooks stay off under tests and off the host', async () => {
  assert.equal((await R.reapFirst('test')).why, 'test environment');
  assert.equal(R.reapFirstSync('test').why, 'test environment');
  assert.equal(R.onHost({ AXF_REAPER: 'off' }).ok, false);
});

// ------------------------------------------------------------------ end to end on real processes

const bin = join(tmp, 'bin'); mkdirSync(bin);
writeFileSync(join(bin, 'claude'), '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n'); chmodSync(join(bin, 'claude'), 0o755);
const server = join(bin, 'server.mjs');
writeFileSync(server, "import { createServer } from 'node:http'; createServer((q, s) => s.end('ok')).listen(0, '127.0.0.1');\n");
const wt = (b) => { mkdirSync(join(root, b), { recursive: true }); return join(root, b); };
const kids = [];
const run = (cmd, args, cwd, env = {}) => { const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: 'ignore', detached: true }); kids.push(c); return c; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

await t('end to end: a pass kills the finished claude and the leftover server, frees ghost slots, logs, notes and notifies once; the working build is untouched', async () => {
  const done = run(join(bin, 'claude'), ['-p', '--model', 'opus'], wt('done-build'), { AXF_SESSION: 'axf-done-build--joey', AXF_BUILD_ID: 'done-build' });
  const busy = run(join(bin, 'claude'), ['-p'], wt('busy-build'), { AXF_BUILD_ID: 'busy-build' });
  const srv = run(process.execPath, [server], join(wt('old-build'), '.'));
  mkdirSync(join(tmpRoot, 'axf-limit-old')); utimesSync(join(tmpRoot, 'axf-limit-old'), new Date(Date.now() - 3 * 3600e3), new Date(Date.now() - 3 * 3600e3));
  mkdirSync(join(tmpRoot, 'axf-limit-new'));
  await new Promise((r) => setTimeout(r, 1500));
  // the finished build wrote its result line after it started; the busy one is still writing
  writeFileSync(join(root, 'done-build', 'done-build.log'), '▸ Bash: npm test\n\x1b[1m■ done\x1b[0m · 12m · 80 turns\nAll green.\n');
  writeFileSync(join(root, 'busy-build', 'busy-build.log'), '▸ Bash: npm test\n■ done\nold run\n# model claude-opus-5-5 · busy\n▸ Edit: x\n');
  writeFileSync(join(slotsDir, 'state.json'), JSON.stringify({ $axf: 'agent-slots@1', seq: 3, running: [
    { id: 'hl-ghost', name: 'rhonda-ci-fix', kind: 'headless', priority: 'normal', state: 'running', host: 'efb11ebd1981', pid: 8823, session: 'axf-rhonda-ci-fix', startedAt: new Date(Date.now() - 4 * 86400e3).toISOString() },
  ], queue: [], heavy: [{ id: 'hv-dead', label: 'vite build', host: 'test-host', pid: 2 ** 22 + 7, startedAt: new Date(Date.now() - 600e3).toISOString() }], done: [] }));
  await R.saveSettings({ doneGraceMin: 1, procGraceMin: 1, serverGraceMin: 1, idleMin: 5 });

  const facts = await R.gather();
  // only what this test started is in scope (the machine running it may have real builds)
  const mine = new Set([done.pid, busy.pid, srv.pid]);
  facts.procs = facts.procs.filter((p) => mine.has(p.pid));
  facts.listeners = new Set([...facts.listeners].filter((p) => mine.has(p)));
  assert.ok(facts.listeners.has(srv.pid), 'ss sees the test server');
  facts.containers = new Set(['c0ffee']);
  facts.builds = { 'done-build': { status: 'running' }, 'busy-build': { status: 'landed' }, 'old-build': { status: 'landed' } };
  facts.now = Date.now() + 3 * MIN;   // the log went quiet three minutes ago
  // the busy build's log was "just" written: move it to the shifted clock so it is 1 minute old
  utimesSync(join(root, 'busy-build', 'busy-build.log'), new Date(facts.now - MIN), new Date(facts.now - MIN));
  facts.logs['busy-build'] = R.logFacts('busy-build', { root, hdir });

  const notes = []; const fyis = [];
  const res = await R.run({ by: 'test', facts, note: (s) => { notes.push(s); return 'n-1'; }, notify: (s) => { fyis.push(s); return true; } });
  assert.ok(res.ran);
  assert.deepEqual(types(res.actions), ['drop-slot:hl-ghost', 'drop-slot:hv-dead', 'end-event:axf-done-build--joey', `kill-proc:${done.pid}`, `kill-proc:${srv.pid}`, `rm:${join(tmpRoot, 'axf-limit-old')}`]);
  assert.ok(res.actions.every((a) => a.applied), JSON.stringify(res.actions.filter((a) => !a.applied)));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!alive(done.pid), 'the finished claude is gone');
  const marker = JSON.parse(readFileSync(join(root, 'done-build', '.axf-reaped.json'), 'utf8'));
  assert.equal(marker.kind, 'phase-done'); assert.equal(marker.pid, done.pid);
  assert.ok(!alive(srv.pid), 'the leftover server is gone');
  assert.ok(alive(busy.pid), 'the working build is untouched');
  assert.ok(!existsSync(join(tmpRoot, 'axf-limit-old')) && existsSync(join(tmpRoot, 'axf-limit-new')));
  const st = JSON.parse(readFileSync(join(slotsDir, 'state.json'), 'utf8'));
  assert.deepEqual(st.running, []); assert.deepEqual(st.heavy, []);
  assert.equal(st.done.at(-1).state, 'reaped'); assert.match(st.done.at(-1).why, /host efb11ebd1981 is gone/);
  const ev = readFileSync(join(hdir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
  assert.equal(ev.event, 'session-end'); assert.equal(ev.session, 'axf-done-build--joey'); assert.equal(ev.exit, 0); assert.equal(ev.kind, 'phase-done'); assert.equal(ev.by, 'reaper');
  const log = readFileSync(R.logFile(slotsDir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.length, 6); assert.ok(log.every((l) => l.what && l.why && l.applied));
  assert.equal(notes.length, 1); assert.match(notes[0].title, /4 ghosts cleared, 1 temp item removed/);
  assert.equal(fyis.length, 1); assert.equal(res.notified, true); assert.equal(res.note, 'n-1');

  // a second pass finds nothing left (the busy build stays) and sends nothing
  const again = await R.gather();
  again.procs = again.procs.filter((p) => mine.has(p.pid)); again.listeners = new Set(); again.containers = new Set(['c0ffee']);
  again.builds = facts.builds; again.now = facts.now; again.logs['busy-build'] = facts.logs['busy-build'];
  const res2 = await R.run({ by: 'test', facts: again, note: (s) => { notes.push(s); return 'n-2'; }, notify: (s) => { fyis.push(s); return true; } });
  assert.deepEqual(res2.actions, []); assert.equal(notes.length, 1); assert.equal(fyis.length, 1);

  // dry run: plans, changes nothing
  const srv2 = run(process.execPath, [server], wt('old-build-2'));
  await new Promise((r) => setTimeout(r, 1000));
  const f3 = await R.gather(); f3.procs = f3.procs.filter((p) => p.pid === srv2.pid); f3.listeners = new Set([srv2.pid]); f3.now = Date.now() + 3 * MIN; f3.containers = null;
  const dry = await R.run({ by: 'test', dry: true, facts: f3, note: () => assert.fail('no note on a dry run'), notify: () => assert.fail('no FYI on a dry run') });
  assert.equal(dry.dry, true); assert.deepEqual(types(dry.actions), [`kill-proc:${srv2.pid}`]); assert.ok(alive(srv2.pid));
});

await t('the pass note lands on AmberX\'s "Automatic fixes" list (created when missing), and a temp-only pass sends no FYI', async () => {
  const notesDir = join(tmp, 'notes'); process.env.AXF_AMBERX_NOTES_DIR = notesDir;
  mkdirSync(join(tmpRoot, 'axf-limit-stale'));
  const f = await R.gather(); f.procs = []; f.listeners = new Set(); f.slots = {}; f.now = Date.now() + 2 * 3600e3;
  f.tmp = f.tmp.filter((x) => x.path.startsWith(tmpRoot));
  const res = await R.run({ by: 'test', facts: f, notify: () => assert.fail('temp folders alone are not worth a push') });
  assert.ok(res.note, res.noteError);
  const lists = JSON.parse(readFileSync(join(notesDir, 'lists', 'head.json'), 'utf8')).rows;
  const list = Object.values(lists).find((l) => l.name === R.NOTES_LIST);
  assert.ok(list, 'the Automatic fixes list exists');
  const item = JSON.parse(readFileSync(join(notesDir, 'items', 'head.json'), 'utf8')).rows[res.note];
  assert.equal(item.list, list.id); assert.match(item.title, /VPS reaper: \d+ temp items? removed/); assert.match(item.text, /axf-limit-stale: test temp folder/);
});

for (const c of kids) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
console.log(`✓ vps-reaper@1: ${n} checks`);
