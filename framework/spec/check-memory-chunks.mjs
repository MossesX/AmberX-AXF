#!/usr/bin/env node
/**
 * Checks the chunked memory store (memory-chunks@1) and the session-start loader (memory-load@1):
 * chunking rules (one chunk per Status entry / decision / thread row, ### blocks whole, docs per section, long
 * sections split, live log left out, stable ids), the index, build/check/diff on a scratch repo, and which builds
 * the orchestrator reports at session start (started in the last 24 h, stopped unfinished).
 *
 *   node framework/spec/check-memory-chunks.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build, buildChunks, chunkFile, diff, indexText, sources, titleOf, dateOf, MAX_CHUNK } from '../cli/memory-chunks.mjs';
import { recentUnfinished, startedAt, STALE_MS, text as loadText } from '../cli/memory-load.mjs';

let n = 0, fails = 0;
const check = (ok, what, detail = '') => { n++; if (!ok) { fails++; console.log(`FAIL ${what}${detail ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}` : ''}`); } };

// ---- chunking rules
const status = '# Status\n\nIntro line.\n\n## Status\n\n- **Feature one (Nov 1 2026):** a\n  continued line\n- **Feature two (Nov 2 2026):** b\n\n## Later\n\n- one\n- two\n';
const cs = chunkFile('_claude/memory/STATUS.md', status);
check(cs.some((c) => c.title === 'Feature one (Nov 1 2026)' && c.text.includes('continued line')), 'status: one chunk per entry, continuation kept', cs.map((c) => c.title));
check(cs.find((c) => c.title === 'Feature one (Nov 1 2026)')?.date === '2026-11-01', 'status: date read from the entry');
check(cs.find((c) => c.title.startsWith('Feature one'))?.text.startsWith('## Status'), 'entry chunks carry their section heading');
check(cs.some((c) => c.id === 'memory-status/status-intro' || c.id === 'memory-status/status'), 'intro chunk', cs.map((c) => c.id));

const threads = '# Threads\n\nRead it.\n\n## Active\n\n| Thread | State |\n| Alpha | working |\n|---|---|\n| Beta | done |\n\n## To carry on\n\n### Alpha\n\n- Asked: x\n- Left: y\n\n## Live build log\n\n- 12:00 a\n- 12:01 b\n';
const ts = chunkFile('_claude/THREADS.md', threads);
check(ts.some((c) => c.title === 'Alpha') && ts.some((c) => c.title === 'Beta'), 'threads: one chunk per row', ts.map((c) => c.title));
check(!ts.some((c) => c.title === 'Thread' || /^\|---/.test(c.title)), 'threads: header and stray separator are not rows');
check(ts.find((c) => c.title === 'Beta')?.text.includes('| Thread | State |'), 'rows carry the table header');
const carry = ts.filter((c) => c.section === 'Alpha');
check(carry.length === 1 && carry[0].text.includes('Asked: x') && carry[0].text.includes('Left: y'), '### blocks stay whole', carry);
check(!ts.some((c) => c.text.includes('12:00 a')), 'live build log left out (orchestrator data)');

const doc = '# Doc\n\n## A\n\n- x\n- y\n\n## B\n\ntext\n';
const ds = chunkFile('_claude/memory/docs/doc.md', doc);
check(ds.map((c) => c.title).join('|') === 'A|B', 'docs: one chunk per section, bullets not split, heading-only sections dropped', ds.map((c) => c.title));
const long = `## Big\n\n${Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}\n`).join('\n')}`;
const ls = chunkFile('_claude/memory/docs/big.md', long);
check(ls.length > 1 && ls.every((c) => c.text.length <= MAX_CHUNK * 1.3), 'long sections are split', ls.map((c) => c.text.length));
const fence = '## Code\n\n```\n## not a heading\n- not a bullet\n```\n';
check(chunkFile('_claude/memory/docs/f.md', fence).length === 1, 'headings inside code fences do not split');
const dup = chunkFile('_claude/memory/decisions.md', '## X\n\n- **Same:** a\n- **Same:** b\n');
check(dup[0].id !== dup[1].id && dup[1].id.endsWith('-2'), 'repeated titles get distinct ids', dup.map((c) => c.id));
check(titleOf('| My thread (x) | working |') === 'My thread (x)', 'row title = first cell');
check(dateOf('2026-11-03 and Nov 9 2026') === '2026-11-09', 'named dates win over ISO dates');

// ---- scratch repo: sources, build, check
const dir = mkdtempSync(join(tmpdir(), 'axf-chunks-'));
const put = (rel, t) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), t); };
put('CLAUDE.md', '# Root\n\n@_claude/rules/RULES.md\n@~/hub/CLAUDE.md\n');
put('_claude/rules/RULES.md', '# Rules\n\n## Rules\n\n- **One:** a\n- **Two:** b\n');
put('_claude/THREADS.md', threads);
put('_claude/memory/STATUS.md', status);
put('_claude/memory/docs/doc.md', doc);
put('_claude/handoff/context/CLAUDE.md', '# old kit\n');
const src = sources(dir);
check(src[0] === 'CLAUDE.md' && src[1] === '_claude/rules/RULES.md', 'sources: CLAUDE.md then its imports', src);
check(!src.some((s) => s.startsWith('_claude/handoff/')), 'sources: the deleted handoff kit never comes back');
check(diff(dir).current === false, 'check: missing store is behind');
const r = build(dir);
check(r.count === buildChunks(dir).length && existsSync(join(dir, '_claude/chunks/INDEX.md')) && existsSync(join(dir, '_claude/chunks/index.json')), 'build writes chunks + INDEX.md + index.json', r);
check(diff(dir).current === true, 'check: current after build');
const idx = readFileSync(join(dir, '_claude/chunks/INDEX.md'), 'utf8');
check(idx.split('\n').filter((l) => l.startsWith('- `')).length === r.count, 'INDEX.md: one line per chunk');
check(idx.split('\n').filter((l) => l.startsWith('- `')).every((l) => l.length < 200), 'INDEX.md lines stay short');
put('_claude/memory/STATUS.md', status.replace('Feature two', 'Feature deux'));
const d2 = diff(dir);
check(!d2.current && d2.added.length === 1 && d2.removed.length === 1, 'a changed entry = one chunk added, one removed', d2);
build(dir);
check(!existsSync(join(dir, '_claude/chunks/memory-status/feature-two-nov-2-2026.md')), 'build removes stale chunks');
check(readFileSync(join(dir, '_claude/chunks/memory-status/feature-one-nov-1-2026.md'), 'utf8').startsWith('<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines='), 'chunk header names its source and lines');
check(indexText([]).includes('0 chunks'), 'empty index');
rmSync(dir, { recursive: true, force: true });

// ---- session-start loader
const now = Date.parse('2026-11-08T12:00:00Z');
const h = (x) => new Date(now - x * 3600e3).toISOString();
const store = { builds: [
  { id: 'stopped', title: 'Stopped', status: 'running', updatedAt: h(3), steps: [{ id: 's1', done: true, doneAt: h(5), model: 'Opus', text: 'a' }, { id: 's2', done: false, model: 'Fable', text: 'next thing' }], branch: 'claude/x', pr: '#1' },
  { id: 'live', title: 'Live', status: 'running', updatedAt: new Date(now - STALE_MS / 2).toISOString(), steps: [{ id: 's1', done: true, doneAt: h(1) }, { id: 's2', done: false }] },
  { id: 'old', title: 'Old', status: 'blocked', updatedAt: h(30), steps: [{ id: 's1', done: true, doneAt: h(40) }, { id: 's2', done: false }] },
  { id: 'built', title: 'Built', status: 'built', updatedAt: h(2), steps: [{ id: 's1', done: true, doneAt: h(2) }] },
  { id: 'never', title: 'Never', status: 'pending', updatedAt: h(1), steps: [{ id: 's1', done: false }] },
  { id: 'failed', title: 'Failed', status: 'failed', updatedAt: h(20), steps: [] },
  { id: 'gone', title: 'Gone', status: 'running', deleted: true, updatedAt: h(3), steps: [{ id: 's1', done: true, doneAt: h(3) }] },
] };
const ru = recentUnfinished(store, { now });
check(ru.map((b) => b.id).join(',') === 'stopped,failed', 'loader: started in 24 h + stopped unfinished only (not live, old, built, never started, deleted)', ru.map((b) => b.id));
check(ru[0].next?.id === 's2' && ru[0].next.model === 'Fable' && ru[0].done === 1 && ru[0].total === 2, 'loader: next step + progress', ru[0]);
check(recentUnfinished(store, { now, hours: 48 }).some((b) => b.id === 'old'), 'loader: window is configurable');
check(Number.isNaN(startedAt({ status: 'pending', steps: [] })), 'a pending build without a branch never started');
const t = loadText({ hours: 24, builds: ru.map((b) => ({ ...b, chunks: ['threads/alpha'] })), index: { file: '_claude/chunks/INDEX.md', count: 3, sources: 2 }, current: false });
check(t.includes('`stopped`') && t.includes('next s2 [Fable]') && t.includes('`threads/alpha`') && t.includes('behind their sources'), 'loader text', t);
check(loadText({ hours: 24, builds: [], index: null, current: null }).includes('No build started'), 'loader text: nothing to resume');

console.log(`${fails ? `${fails} of ${n} failed` : `check-memory-chunks: ${n} checks passed`}`);
process.exitCode = fails ? 1 : 0;
