#!/usr/bin/env node
/**
 * Checks queue-log@1 (framework/plan/queue-log-core.mjs) and session-archive@1 (framework/plan/session-archive-core.mjs),
 * then runs the recorders end to end on a scratch data folder: tool writes are logged with who/why, outside edits are
 * caught, a transcript becomes a session with per-prompt costs, the cost record links prompts to builds.
 *   node framework/spec/check-queue-log.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as q from '../plan/queue-log-core.mjs';
import * as sa from '../plan/session-archive-core.mjs';
import { costUsd } from '../cli/model-pricing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let ok = 0;
const check = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };

console.log('queue-log: moves');
check(q.moves(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']).length === 0, 'same order → no moves');
const m1 = q.moves(['a', 'b', 'c', 'd', 'e'], ['d', 'a', 'b', 'c', 'e']);
check(m1.length === 1 && m1[0].id === 'd' && m1[0].from === 4 && m1[0].to === 1, 'one item to the top is one move, not four');
check(q.moves(['a', 'b', 'c'], ['c', 'b', 'a']).length === 2, 'a full reversal = n-1 moves');
check(q.moves(['a', 'b'], ['b', 'x', 'a']).every((m) => m.id !== 'x'), 'added items are not moves');

console.log('queue-log: pending diff');
const p0 = { items: [{ id: 'a', title: 'A', model: 'Fable', status: 'pending', notes: [], subPrompts: [{ text: 's1' }] }, { id: 'b', title: 'B', model: 'Opus', status: 'pending', notes: [], subPrompts: [] }] };
const p1 = { items: [{ id: 'b', title: 'B', model: 'Opus', status: 'complete', notes: [{ text: 'built on Opus' }], subPrompts: [] }, { id: 'a', title: 'A2', model: 'Opus', status: 'pending', estimate: '2 h', notes: [], subPrompts: [{ text: 's1', done: true }, { text: 's2' }] }, { id: 'c', title: 'C', model: 'Sonnet', status: 'pending', notes: [], subPrompts: [] }] };
const ev = q.diff('pending', q.snapshotOf('pending', p0), q.snapshotOf('pending', p1));
const ops = ev.map((e) => `${e.op}:${e.id}`);
for (const want of ['added:c', 'moved:b', 'status:b', 'note-added:b', 'title:a', 'model:a', 'estimate:a', 'step-done:a', 'step-added:a']) check(ops.includes(want), `pending diff has ${want}`);
check(!ops.includes('moved:a'), 'only the item that moved is a move');
check(q.diff('pending', null, q.snapshotOf('pending', p1)).length === 0, 'a first sighting is the baseline (nothing logged)');
const rm = q.diff('pending', q.snapshotOf('pending', p1), q.snapshotOf('pending', { items: p1.items.slice(0, 2) }));
check(rm.length === 1 && rm[0].op === 'removed' && rm[0].snapshot?.title === 'C', 'a removal keeps what was removed');

console.log('queue-log: queue diff');
const q0 = { order: ['x.a', 'x.b', 'x.c'], steps: { 'x.a': { completedAt: '' } } };
const q1 = { order: ['x.c', 'x.a', 'x.b'], dirty: true, steps: { 'x.a': { completedAt: '2026-10-21T00:00:00Z' }, 'x.b': { rework: { reasons: ['dep rebuilt'] }, estimate: '1 h', steps: [{ text: 'one' }] } } };
const qe = q.diff('queue', q.snapshotOf('queue', q0), q.snapshotOf('queue', q1), { 'x.c': 'Step C' });
const qops = qe.map((e) => `${e.op}:${e.id}`);
for (const want of ['moved:x.c', 'completed:x.a', 'rework:x.b', 'estimate:x.b', 'step-added:x.b', 'dirty:']) check(qops.includes(want), `queue diff has ${want}`);
check(qe.find((e) => e.op === 'moved').title === 'Step C', 'queue epics are named from the plan');

console.log('queue-log: plan diff + browsing');
const f0 = { features: [{ id: 'f1', title: 'F1', status: 'planned', model: 'opus', dependsOn: ['a'] }] };
const f1 = { features: [{ id: 'f1', title: 'F1', status: 'built', model: 'fable', dependsOn: ['a', 'b'] }, { id: 'f2', title: 'F2', status: 'planned', dependsOn: [] }] };
const fe = q.diff('plan', q.snapshotOf('plan', f0), q.snapshotOf('plan', f1));
check(['status', 'model', 'deps', 'added'].every((o) => fe.some((e) => e.op === o)), 'plan diff: status, model, deps, added');
check(fe.find((e) => e.op === 'deps').added.join() === 'b', 'deps diff names what was added');
const batches = [{ id: 'q-1', at: '2026-10-21T10:00:00Z', source: 'tool', by: 'console', surface: 'console', reason: 'MCP first', events: qe }, { id: 'q-2', at: '2026-10-21T11:00:00Z', source: 'outside', by: 'unknown', events: ev }];
const flat = q.flatten(batches);
check(flat[0].batch === 'q-2' && flat.at(-1).batch === 'q-1', 'flattened newest first');
check(q.filterEvents(flat, { groups: ['structure'] }).every((e) => ['added', 'removed', 'moved'].includes(e.op)), 'group filter');
check(q.filterEvents(flat, { source: 'outside' }).length === ev.length, 'source filter');
check(q.filterEvents(flat, { q: 'mcp first' }).length === qe.length, 'search finds the why');
check(q.itemHistory(flat, 'x.c').length >= 1, 'item history');
check(q.summarize(flat).sources.outside === ev.length, 'summary counts outside changes');
check(/moved #3 → #1/.test(q.describe(qe.find((e) => e.op === 'moved'))), 'describe a move');
check(q.cleanMeta({ by: 'x'.repeat(200), surface: 'Bad Surface!', changeId: 'nope', reason: ' why ' }).reason === 'why' && !q.cleanMeta({ surface: 'Bad Surface!' }).surface, 'meta is cleaned');

console.log('session-archive: transcript');
const L = (o) => JSON.stringify({ sessionId: 's1', cwd: '/root/AmberX-AXF', entrypoint: 'cli', version: '2.1.300', userType: 'external', ...o });
const transcript = [
  L({ type: 'user', timestamp: '2026-10-21T10:00:00Z', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>Build the thing with key sk-ant-api03-abcdefghijklmnop' }] } }),
  L({ type: 'assistant', timestamp: '2026-10-21T10:00:05Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 }, content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/root/AmberX-AXF/apps/console-web/plugins/build-manager/web/ui.tsx' } }, { type: 'tool_use', name: 'Bash', input: { command: 'node apps/console-web/plugins/codebase-changes/changes.mjs step chg-20261021-aaaaaaaaaa "x" --state running' } }] } }),
  L({ type: 'assistant', timestamp: '2026-10-21T10:00:06Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 }, content: [{ type: 'text', text: 'Done.' }] } }),
  L({ type: 'user', timestamp: '2026-10-21T10:00:07Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'listing chg-20261015-bbbbbbbbbb' }] } }),
  L({ type: 'user', timestamp: '2026-10-21T10:05:00Z', origin: { kind: 'human' }, message: { role: 'user', content: 'And now the docs' } }),
  L({ type: 'assistant', timestamp: '2026-10-21T10:06:00Z', message: { id: 'm2', model: 'claude-sonnet-4-6', usage: { input_tokens: 5, output_tokens: 50 }, content: [{ type: 'text', text: 'Docs written.' }] } }),
  JSON.stringify({ type: 'ai-title', aiTitle: 'Thing builder', sessionId: 's1' }),
  JSON.stringify({ type: 'cost-state', sessionId: 's1', totalCostUSD: 0.05 }),
].join('\n');
const rec = sa.parseTranscript(transcript, { host: 'srv1837178', via: 'moshi', pricing: { costUsd }, toRepoPath: (p) => p.replace('/root/AmberX-AXF/', '') });
check(rec.id === 'cc-s1' && rec.project === 'amberx-axf' && rec.title === 'Thing builder', 'id, project, title');
check(rec.system.surface === 'vps-claude-code' && rec.system.via === 'moshi' && rec.system.appVersion === '2.1.300', 'system: surface, via, version');
check(rec.totals.prompts === 2 && rec.prompts[0].text.includes('[hidden]') && !rec.prompts[0].text.includes('sk-ant'), 'two prompts, secret hidden, reminder stripped');
check(rec.prompts[0].tokens.output === 120, 'a streamed message counts once (last usage wins)');
check(rec.prompts[0].files[0] === 'apps/console-web/plugins/build-manager/web/ui.tsx', 'edited files as repo paths');
check(rec.prompts[0].changeIds.join() === 'chg-20261021-aaaaaaaaaa', 'change entries the prompt worked on (tool results not scanned)');
check(rec.prompts[0].costUsd > 0 && rec.totals.reportedUsd === 0.05, 'priced per prompt; Claude Code’s own total kept');
check(rec.models.includes('claude-sonnet-4-6') && rec.prompts[1].model === 'claude-sonnet-4-6', 'models per prompt');

console.log('session-archive: chats, features, cost record');
const chat = sa.fromChat({ id: 'c1', title: 'Hub auth', project: 'axhub', messages: [{ role: 'human', text: 'hi', chars: 4000 }, { role: 'assistant', text: 'x', chars: 8000, toolChars: 4000 }, { role: 'human', text: 'next chg-20261021-cccccccccc' }, { role: 'assistant', text: 'ok' }] }, { pricing: { costUsd } });
check(chat.id === 'ai-c1' && chat.source === 'claude-ai' && chat.totals.costEstimated && chat.totals.prompts === 2, 'a chat is estimated, two prompts');
check(chat.prompts[1].tokens.input > chat.prompts[0].tokens.input, 'each turn re-reads the chat so far');
check(chat.prompts[0].tokens.output === 3000, 'full lengths (chars, toolChars) drive the estimate');
const cat = [{ key: 'plugin:build-manager', id: 'build-manager', paths: ['apps/console-web/plugins/build-manager'] }, { key: 'pending:lib-mcp', id: 'lib-mcp', paths: [] }];
sa.attachFeatures(rec, cat, { 'chg-20261021-aaaaaaaaaa': 'other:thing' });
check(rec.prompts[0].features.includes('plugin:build-manager') && rec.prompts[0].features.includes('other:thing'), 'features from files and change entries');
const cr = sa.costRecord([rec, chat], { 'chg-20261021-aaaaaaaaaa': { title: 'The thing', buildRef: { kind: 'other', id: 'thing' }, estimate: { costUsd: 0.001 } } });
const thing = cr.builds.find((b) => b.build === 'other:thing');
check(thing && thing.prompts === 2 && thing.costUsd === sa.totalsOf(rec).costUsd, 'a later prompt without its own entry carries to the last one named');
check(thing.overUsd > 0, 'cost against the estimate');
check(cr.builds.some((b) => b.build === '(not linked)'), 'unlinked prompts are a bucket of their own');
const cr2 = sa.costRecord([], { 'chg-20261001-dddddddddd': { title: 'Old', buildRef: { kind: 'pending', id: 'old' }, estimate: { costUsd: 12 } } });
check(cr2.builds[0].build === 'pending:old' && cr2.builds[0].costUsd === 12 && cr2.changes[0].source === 'build-log' && cr2.totals.fromLogUsd === 12, 'build-log entries without sessions count with their estimate');
const sums = sa.aggregate([sa.summary(rec), sa.summary(chat)]);
check(sums.totals.sessions === 2 && sums.groups.project.axhub.sessions === 1 && sums.totals.estimatedUsd === chat.totals.costUsd, 'aggregate by project, estimated part');
check(sa.filterSessions([sa.summary(rec), sa.summary(chat)], { q: 'moshi' }).length === 1, 'search covers how it was reached');

console.log('recorders end to end (scratch data)');
const D = mkdtempSync(join(tmpdir(), 'qlog-'));
mkdirSync(join(D, 'framework/plan'), { recursive: true });
for (const f of ['pending.json', 'build-queue.json', 'plan.json']) cpSync(join(ROOT, 'framework/plan', f), join(D, 'framework/plan', f));
const env = { ...process.env, AXF_DATA_DIR: D, AXF_QUEUE_SURFACE: 'cli', AXF_QUEUE_BY: 'check', CLAUDE_CODE_SESSION_ID: '', AXF_CHANGES_HOME: join(D, 'nochanges') };
const rpc = (op, args) => JSON.parse(execFileSync(process.execPath, [join(ROOT, 'framework/cli/engine-rpc.mjs'), op, JSON.stringify(args)], { env, input: '' }).toString().trim().split('\n').pop());
rpc('queue-log', {});
check(rpc('pending-act', { change: { action: 'add', title: 'Log check item', model: 'Opus', reason: 'checking the log' } }).ok, 'a pending add through engine-rpc');
const pf = join(D, 'framework/plan/pending.json');
const pj = JSON.parse(readFileSync(pf, 'utf8')); pj.items.reverse(); writeFileSync(pf, JSON.stringify(pj));
const v = rpc('queue-log', {});
const add = v.events.find((e) => e.op === 'added' && e.title === 'Log check item');
check(add && add.reason === 'checking the log' && add.by === 'check' && add.surface === 'cli' && add.source === 'tool', 'the add is logged with who, where and why');
check(v.events.some((e) => e.source === 'outside' && e.op === 'moved'), 'a hand edit is caught as an outside change');
const why = rpc('queue-log-why', { id: v.events.find((e) => e.source === 'outside').batch, reason: 'reordered by hand', by: 'check' });
check(why.ok && why.batch.reason === 'reordered by hand', 'the why can be added afterwards');
const tf = join(D, 't.jsonl'); writeFileSync(tf, transcript);
execFileSync(process.execPath, [join(ROOT, 'framework/cli/session-archive.mjs'), 'ingest', tf, '--host', 'srv1837178'], { env });
const sv = rpc('session-archive', {});
check(sv.ok && sv.sessions.length === 1 && sv.sessions[0].system.host === 'srv1837178', 'a transcript is archived and listed');
check(rpc('session-show', { id: 'cc-s1' }).session.prompts.length === 2, 'one session with its prompts');
check(rpc('session-costs', {}).totals.costUsd > 0, 'the cost record');

console.log(`\n${ok} checks passed`);
