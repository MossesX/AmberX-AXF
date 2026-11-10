// Self-test: node apps/console-web/plugins/build-search/test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionsFor, applyCommand, around, fillAction, matchLine, normalizeAction, normalizeSettings, parseCommand, parseHitId, parseQuery, search, snippet, typeIcon,
} from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0;
const t = (name, fn) => { fn(); n++; process.stdout.write(`✓ ${name}\n`); };

/* ------------------------------------------------------------------ engine */
const docs = [
  { id: 'log:alpha', type: 'log', title: 'Session log · alpha', build: 'alpha', lines: ['start', 'the search bar opens', 'nothing', 'search bar again', 'search BAR third'] },
  { id: 'note:alpha', type: 'note', title: 'Notes · Alpha', build: 'alpha', lines: ['2026-11-10 · queued', 'search bar note'] },
  { id: 'build:beta', type: 'build', title: 'Beta', build: 'beta', lines: ['Title: Beta', 'search only'] },
];

t('words must all be on the line; instances numbered per document', () => {
  const r = search(docs, 'search bar');
  assert.equal(r.total, 4);
  const log = r.groups.find((g) => g.doc === 'log:alpha');
  assert.deepEqual(log.hits.map((h) => [h.n, h.line]), [[1, 2], [2, 4], [3, 5]]);
  assert.equal(log.icon, typeIcon('log'));
  assert.equal(r.groups[0].doc, 'log:alpha', 'most hits first');
  assert.equal(log.hits[0].id, 'log:alpha#2');
});
t('phrase, exclude, regex, type: and build: filters', () => {
  assert.equal(search(docs, '"bar again"').total, 1);
  assert.equal(search(docs, 'search -again').total, 4);
  assert.equal(search(docs, '/b.r\\s+(again|third)/').total, 2);
  assert.equal(search(docs, 'search type:notes').total, 1);
  assert.equal(search(docs, 'search build:beta').total, 1);
  assert.match(parseQuery('/(/').error, /bad pattern/);
});
t('ranges mark every match; snippets keep them aligned', () => {
  const r = matchLine('Search bar and search', parseQuery('search'));
  assert.deepEqual(r, [[0, 6], [15, 21]]);
  const long = `${'x'.repeat(300)}needle${'y'.repeat(300)}`;
  const s = snippet(long, matchLine(long, parseQuery('needle')), 80);
  assert.equal(s.text.slice(s.ranges[0][0], s.ranges[0][1]), 'needle');
});
t('limits: per document and overall, truncated flagged, total still counted', () => {
  const r = search(docs, 'search', { perDoc: 1 });
  assert.equal(r.total, 5);
  assert.ok(r.truncated);
  assert.ok(r.groups.every((g) => g.hits.length === 1));
});
t('hit ids round-trip; around() centres the line', () => {
  assert.deepEqual(parseHitId('log:a-b#12'), { doc: 'log:a-b', line: 12 });
  const a = around({ lines: Array.from({ length: 100 }, (_, i) => `l${i + 1}`) }, 50, 5);
  assert.equal(a.start, 45); assert.equal(a.end, 55); assert.equal(a.lines[a.line - a.start], 'l50');
});
t('AI is off by default and only an explicit command turns it on', () => {
  assert.equal(normalizeSettings({}).ai.enabled, false);
  assert.equal(normalizeSettings({ ai: { enabled: 'yes' } }).ai.enabled, false);
  const on = applyCommand({}, parseCommand('>ai on'));
  assert.equal(on.settings.ai.enabled, true);
  assert.equal(applyCommand(on.settings, parseCommand('ai off')).settings.ai.enabled, false);
});
t('typed commands add and remove sources and actions', () => {
  let s = applyCommand({}, parseCommand('>add source docs docs/**/*.md as doc')).settings;
  assert.deepEqual(s.sources, [{ id: 'docs', name: 'docs', path: 'docs/**/*.md', type: 'doc' }]);
  s = applyCommand(s, parseCommand('>add action Open PR = https://github.com/x/pulls?q={build}')).settings;
  assert.equal(s.actions[0].id, 'open-pr');
  assert.equal(fillAction(s.actions[0].run, { build: 'a b' }), 'https://github.com/x/pulls?q=a%20b');
  assert.ok(actionsFor({ type: 'log', build: 'x' }, s).some((a) => a.id === 'open-pr'));
  assert.ok(!actionsFor({ type: 'file', build: '' }, s).some((a) => a.id === 'open-build'));
  s = applyCommand(s, parseCommand('remove source docs')).settings;
  assert.equal(s.sources.length, 0);
  assert.equal(parseCommand('frobnicate').op, 'error');
  assert.equal(normalizeAction({ label: 'x', run: 'javascript:alert(1)' }), null);
  assert.equal(normalizeAction({ label: 'x', run: 'http://plain' }), null);
  assert.equal(normalizeAction({ label: 'Open', id: 'open', run: 'nav:x' }), null, 'built-in ids are reserved');
});

/* ------------------------------------------------------------------ CLI end to end */
const tmp = mkdtempSync(join(tmpdir(), 'bs-test-'));
try {
  const root = join(tmp, 'builds');
  mkdirSync(join(root, 'gamma'), { recursive: true });
  writeFileSync(join(root, 'gamma', 'gamma.log'), '\u001b[36m▸ Bash: ls\u001b[0m\nfound the needle here\nother\nneedle twice needle\n');
  const ev = (o) => JSON.stringify(o);
  writeFileSync(join(root, 'gamma', 'gamma.jsonl'), [
    ev({ type: 'user', message: { content: 'please find the needle' } }),
    ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking for the needle.' }, { type: 'tool_use', name: 'Grep', input: { pattern: 'needle' } }] } }),
  ].join('\n') + '\n');
  const store = join(tmp, 'store.json');
  writeFileSync(store, JSON.stringify({ builds: [{ id: 'gamma', title: 'Gamma build', notes: [{ text: 'a needle note', at: '2026-11-10T10:00:00Z' }] }] }));
  const reports = join(tmp, 'reports'); mkdirSync(reports);
  writeFileSync(join(reports, 'gamma.md'), '# Gamma\nno match here\n');
  const env = { ...process.env, AXF_BUILD_SEARCH_ROOTS: root, AXF_BUILD_SEARCH_DATA: join(tmp, 'data'), AXF_BUILD_SEARCH_STORE: store, AXF_BUILD_SEARCH_REPORTS: reports };
  const cli = (...a) => JSON.parse(execFileSync('node', [join(HERE, 'search.mjs'), ...a, '--json'], { env, encoding: 'utf8' }).trim().split('\n').pop());

  t('CLI search finds logs (colours stripped), session messages and notes', () => {
    const r = cli('search', 'needle');
    const by = Object.fromEntries(r.groups.map((g) => [g.doc, g]));
    assert.equal(by['log:gamma'].count, 2);
    assert.equal(by['session:gamma'].count, 3);
    assert.equal(by['note:gamma'].count, 1);
    assert.equal(by['log:gamma'].hits[1].n, 2);
    assert.equal(cli('open', 'log:gamma#1').lines[0], '▸ Bash: ls');
  });
  t('CLI open returns the document around the hit with its actions', () => {
    const o = cli('open', 'log:gamma#4', '--context', '1');
    assert.equal(o.line, 4); assert.equal(o.lines[o.line - o.start], 'needle twice needle');
    assert.ok(o.actions.some((a) => a.id === 'open-build'));
  });
  t('session cache grows incrementally', () => {
    writeFileSync(join(root, 'gamma', 'gamma.jsonl'), `${readFileSync(join(root, 'gamma', 'gamma.jsonl'), 'utf8')}${ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'one more needle' }] } })}\n`);
    assert.equal(cli('search', 'needle', '--type', 'session').total, 4);
  });
  t('CLI commands: AI switch, sources, actions; path traversal refused', () => {
    assert.equal(cli('ai').ai.enabled, false);
    assert.equal(cli('ai', 'on').settings.ai.enabled, true);
    assert.equal(cli('ai', 'off').settings.ai.enabled, false);
    cli('source-add', 'extra', reports, '--type', 'doc');
    assert.equal(cli('search', 'Gamma', '--type', 'doc').total, 1);
    assert.equal(cli('run', 'add action PR = https://example.com/{build}').settings.actions.length, 1);
    assert.equal(cli('action-remove', 'pr').settings.actions.length, 0);
    assert.throws(() => cli('open', 'log:../etc#1'));
  });
} finally { rmSync(tmp, { recursive: true, force: true }); }

process.stdout.write(`${n} checks passed\n`);
