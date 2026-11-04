#!/usr/bin/env node
/**
 * Session sync CLI test (sync.mjs): two sessions on a scratch link + scratch builds store, racing for the same area;
 * approval of a new account; request-work → offers (whole build + steps split out of a running build); accept makes the
 * child build and the assignedTo projections; step done; take-back; inbox and the hook (context + claim guard); the
 * sync file; the commit check; consistency. Zero tokens, no git push (AXF_SYNC_PUBLISH=0), no live (AXF_BUILDS_LIVE=0).
 *   node apps/console-web/plugins/session-sync/test.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bcore from '../../../../framework/plan/builds-store-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const CLI = join(HERE, 'sync.mjs');
const T = mkdtempSync(join(tmpdir(), 'axf-session-sync-'));
let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };

const store = bcore.emptyStore();
store.builds.push(
  bcore.normBuild({ id: 'foo', title: 'Foo plugin', status: 'pending', profiles: ['main-framework'], steps: [{ id: 's1', text: 'Foo one', estimate: '20 min', files: ['apps/console-web/plugins/foo/**'] }, { id: 's2', text: 'Foo two', estimate: '20 min' }] }),
  bcore.normBuild({ id: 'big', title: 'Big build', status: 'running', profiles: ['main-framework'], touches: ['kernel'], steps: [{ id: 's1', text: 'A', done: true }, { id: 's2', text: 'B', estimate: '30 min' }, { id: 's3', text: 'C', estimate: '20 min', files: ['framework/spec/X.md'] }, { id: 's4', text: 'D', estimate: '20 min', files: ['apps/console-web/src/views/D.tsx'] }] }),
);
writeFileSync(join(T, 'store.json'), JSON.stringify(store));
const base = { ...process.env, AXF_SESSION_LINK_FILE: join(T, 'link.json'), AXF_BUILDS_STORE: join(T, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_SYNC_PUBLISH: '0', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'main-framework', AXF_BUILDS_EXPORT: '0', AXF_CONSOLE_ROOT: 'off' };
delete base.AXF_APPROVER; delete base.AXF_APPROVER_VIA;
const who = { A: { AXF_SESSION: 's-brett', AXF_ACCOUNT: 'brett', AXF_AGENT: 'rio', AXF_SESSION_ME_FILE: join(T, 'meA.json') }, B: { AXF_SESSION: 's-two', AXF_ACCOUNT: 'acct2', AXF_AGENT: 'paulie', AXF_SESSION_ME_FILE: join(T, 'meB.json') } };
const run = (w, args, { input, env = {} } = {}) => { const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: ROOT, encoding: 'utf8', input, env: { ...base, ...who[w], ...env } }); const line = r.stdout.trim().split('\n').pop() || ''; try { return { ...JSON.parse(line), _code: r.status, _err: r.stderr }; } catch { return { ok: false, _code: r.status, _err: r.stderr, _out: r.stdout }; } };
const readStore = () => JSON.parse(readFileSync(join(T, 'store.json'), 'utf8'));

try {
  let r = run('A', ['join']); check('A joins as primary', r.ok && r.role === 'primary' && r.becamePrimary, JSON.stringify(r).slice(0, 300));
  r = run('B', ['join']); check('B (new account) joins as secondary, waits for approval', r.ok && r.role === 'secondary' && r.needsApproval, JSON.stringify(r).slice(0, 300));
  r = run('A', ['approve-account', 'acct2']); check('a session (even the primary) cannot approve an account', r.ok === false && r.code === 'owner', JSON.stringify(r).slice(0, 200));
  r = run('A', ['op', 'approve-account', '{"account":"acct2"}'], { env: { AXF_SESSION_SYNC_CALLER: JSON.stringify({ session: 'console-brett', account: 'brett', agent: 'rio', brett: true }) } }); check('Brett\'s click approves it', r.ok && r.sessions?.includes('s-two'), JSON.stringify(r).slice(0, 200));
  r = run('A', ['claim', '--area', 'kernel', '--build', 'big', '--step', 's2']); check('A claims the kernel area', r.ok && r.claim?.area === 'kernel');
  r = run('B', ['claim', '--paths', 'framework/core/engines/x.mjs']); check('B racing for a kernel path is told who holds it', r.ok === false && r.code === 'claimed' && r.by?.agent === 'rio', JSON.stringify(r).slice(0, 200));
  r = run('B', ['claim', '--paths', 'apps/console-web/plugins/foo/**', '--reason', 'plugin']); check('B claims the foo plugin paths', r.ok && r.claim?.paths?.[0] === 'apps/console-web/plugins/foo/**');
  r = run('B', ['offer', 'foo']); check('a secondary cannot offer', r.ok === false && r.code === 'secondary' && /secondary sessions can't/.test(r.message));
  r = run('B', ['replan']); check('a secondary cannot replan', r.ok === false && r.code === 'secondary');
  r = run('B', ['request-work', '--minutes', '60']); check('request-work offers foo (whole) and big s3 (split out)', r.ok && r.offers?.some((o) => o.build === 'foo' && o.mode === 'whole') && r.offers?.some((o) => o.build === 'big' && o.mode === 'steps-new-build' && o.steps?.join() === 's3'), JSON.stringify(r.offers).slice(0, 400));
  const ofoo = r.offers.find((o) => o.build === 'foo').id; const obig = r.offers.find((o) => o.build === 'big').id;
  r = run('A', ['offers']); check('the primary sees the open offers', r.ok && r.offers.length === 2);
  r = run('B', ['respond', ofoo, 'reject']); check('reject needs a reason', r.ok === false && /needs a reason/.test(r.message));
  r = run('B', ['respond', ofoo, 'accept']); check('B accepts foo: queued assignment, store patched', r.ok && r.assignment?.status === 'queued' && r.store?.ok, JSON.stringify(r).slice(0, 300));
  check('foo carries assignedTo in the store', readStore().builds.find((b) => b.id === 'foo')?.assignedTo?.session === 's-two');
  r = run('B', ['respond', obig, 'accept']); check('B accepts big s3 as a new build', r.ok && r.assignment?.parent === 'big' && r.assignment?.steps?.join() === 's3');
  const st = readStore(); const child = st.builds.find((b) => b.parent === 'big');
  check('the child build exists in the store, running, with the step and its origin', !!child && child.status === 'running' && child.steps.length === 1 && child.steps[0].id === 's3' && child.steps[0].origin?.build === 'big', JSON.stringify(child).slice(0, 300));
  check('the parent step shows withHelper', st.builds.find((b) => b.id === 'big')?.steps.find((s) => s.id === 's3')?.withHelper === child?.id);
  r = run('B', ['status']); check('B\'s state is scoped and managed by the orchestrator', r.ok && r.scoped && r.managedBy === 'orchestrator' && r.builds?.every((b) => b.managedBy === 'orchestrator') && r.builds?.some((b) => b.id === 'foo'));
  r = run('A', ['status']); check('A\'s state is not scoped and lists the helper', r.ok && !r.scoped && r.helpers?.some((h) => h.id === 's-two'));
  const aid = r.assignments.find((a) => a.parent === 'big').id;
  r = run('B', ['step', aid, 's3', 'started']); check('step started → working', r.ok && r.assignment?.status === 'working');
  r = run('B', ['step', aid, 's3', 'done']); check('step done → done, replan reaction', r.ok && r.assignment?.status === 'done' && r.reaction?.decision === 'replan');
  r = run('A', ['inbox']); check('A\'s inbox has B\'s lines, not its own', r.ok && r.lines.some((l) => /paulie took foo/.test(l.text)) && !r.lines.some((l) => /rio claimed/.test(l.text)), JSON.stringify(r.lines?.map((l) => l.text)).slice(0, 400));
  r = run('A', ['inbox']); check('the cursor moved: nothing new', r.ok && r.lines.length === 0);
  r = run('A', ['take-back', 'foo', '--reason', 'need it now']); check('the primary takes foo back (queued, no confirm needed)', r.ok && r.assignment?.status === 'taken-back' && r.store?.changed?.includes('foo'));
  check('foo lost its assignedTo in the store', !readStore().builds.find((b) => b.id === 'foo')?.assignedTo);
  r = run('B', ['take-back', 'foo']); check('a secondary cannot take back', r.ok === false && r.code === 'secondary');
  r = run('A', ['replan', '--dry-run']); check('replan dry run previews an order', r.ok && r.dryRun && Array.isArray(r.order) && r.order[0] === 'big');
  r = run('A', ['claim-job', 'Foo Plugin', '--branch', 'claude/foo-acct2']); check('claim-job matches the queued build by title and takes it off the queue', r.ok && r.match === 'foo' && r.how === 'title' && readStore().builds.find((b) => b.id === 'foo').status === 'running', JSON.stringify(r).slice(0, 300));
  r = run('A', ['claim-job', 'Something nobody planned', '--branch', 'claude/stray']); check('claim-job registers unregistered work with a warning', r.ok && r.registered === 'something-nobody-planned' && /warning/.test(r.warning));
  r = run('A', ['sync']); check('sync writes the file', r.ok && existsSync(join(ROOT, r.path)) && r.sessions === 2 && r.published === null, JSON.stringify(r).slice(0, 300));
  const md = readFileSync(join(ROOT, '_claude/sync/amberx-axf.md'), 'utf8'); const doc = JSON.parse(readFileSync(join(ROOT, '_claude/sync/amberx-axf.json'), 'utf8'));
  check('the sync file names both sessions, the claims and the work', doc.$axf === 'handoff@1' && doc.sessions.length === 2 && doc.claims.length >= 2 && doc.work.running.some((b) => b.id === 'big') && /## Who is on/.test(md) && /paulie/.test(md));
  r = run('A', ['consistency']); check('every store agrees with the link', r.ok && r.drift === 0, JSON.stringify(r));
  r = run('A', ['check-commit', '--files', 'framework/core/engines/x.mjs,apps/console-web/plugins/foo/a.ts']); check('A\'s commit outside its claims is refused and names the holder', r.ok === false && r.outside.join() === 'apps/console-web/plugins/foo/a.ts' && r.claimedBy[0]?.agent === 'paulie');
  r = run('B', ['check-commit', '--files', 'apps/console-web/plugins/foo/a.ts']); check('B\'s commit inside its claim passes', r.ok);
  r = run('B', ['check-commit', '--files', 'framework/core/a.ts', '--ci']); check('--ci reads the sync file: a branch no session owns passes with a note', r.ok && /belongs to no synced session|inside/.test(r.why));
  const hook = (w, ev) => { const x = spawnSync(process.execPath, [CLI, 'hook'], { cwd: ROOT, encoding: 'utf8', input: JSON.stringify(ev), env: { ...base, ...who[w] } }); return x.stdout; };
  let out = hook('B', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(ROOT, 'framework/core/engines/y.mjs') } });
  check('the hook blocks an edit in an area the other session holds', /"decision":"block"/.test(out) && /claimed by rio/.test(out), out.slice(0, 200));
  out = hook('B', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(ROOT, 'apps/console-web/plugins/foo/web/index.tsx') } });
  check('the hook lets an edit inside the session\'s own claim through', !/"decision":"block"/.test(out));
  run('A', ['send', 'hey paulie, the schema is in', '--build', 'big']);
  out = hook('B', { hook_event_name: 'UserPromptSubmit' });
  check('the hook delivers the channel at the next step', /Sessions channel/.test(out) && /hey paulie/.test(out), out.slice(0, 300));
  out = hook('A', { hook_event_name: 'SessionStart' });
  check('SessionStart says who you are and points at the sync file', /you are rio/.test(out) && /Sync file/.test(out), out.slice(0, 300));
  r = run('B', ['end', '--summary', 'done for today']); check('ending a helper releases its claims', r.ok && r.released.length === 1);
  r = run('A', ['status']); check('the ended session shows ended', r.sessions.find((s) => s.id === 's-two')?.status === 'ended');
  out = hook('A', { hook_event_name: 'UserPromptSubmit' }); check('enforcement idles when nobody else is live', !/block/.test(run('A', ['check-commit', '--files', 'anything.ts']).why) && run('A', ['check-commit', '--files', 'anything.ts']).ok);
  const r2 = spawnSync(process.execPath, [CLI, 'join', '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...base, AXF_SESSION_SYNC_ON: '0', AXF_SESSION_ME_FILE: join(T, 'meC.json'), AXF_ACCOUNT: 'c' } });
  check('AXF_SESSION_SYNC_ON=0 still joins (the switch only turns enforcement off)', /"ok":true/.test(r2.stdout));
  r = run('A', ['hooks', 'status', '--settings', join(T, 'settings.json')]); check('hooks status on a fresh file: not installed', r.ok && !r.installed);
  r = run('A', ['hooks', 'install', '--settings', join(T, 'settings.json')]); const s = JSON.parse(readFileSync(join(T, 'settings.json'), 'utf8'));
  check('hooks install writes the four events with the PreToolUse matcher', r.ok && s.hooks.PreToolUse[0].matcher === 'Edit|Write|MultiEdit|NotebookEdit' && Object.keys(s.hooks).length === 4);
  r = run('A', ['hooks', 'remove', '--settings', join(T, 'settings.json')]); check('hooks remove leaves nothing', r.ok && r.removed === 4 && !JSON.parse(readFileSync(join(T, 'settings.json'), 'utf8')).hooks.PreToolUse);
} finally {
  rmSync(T, { recursive: true, force: true });
  rmSync(join(ROOT, '_claude/sync/amberx-axf.json'), { force: true }); rmSync(join(ROOT, '_claude/sync/amberx-axf.md'), { force: true });
}
console.log(`${fails ? '✗' : '✓'} session-sync CLI: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
