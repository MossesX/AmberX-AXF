#!/usr/bin/env node
/**
 * build-chat@1 (framework/core/build-chat.mjs): a build or a codebase change told as a chat log.
 *   node framework/spec/check-build-chat.mjs
 */
import assert from 'node:assert/strict';
import * as c from '../core/build-chat.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

// what the old hook stored: the whole brief squeezed onto one line
const FLAT = '# Build: changes-chat-log (Current profile) **Name:** Changes as chat log - **Category:** Feature. Model: Opus. '
  + '## What Brett said (verbatim, Nov 4 2026, with a desktop screenshot) "This needs to be displayed like the chat log." Screenshot: an entry. '
  + '## Do - In the Codebase changes plugin, render an entry like the chat log. - **Brett** bubble(s): his words. '
  + 'Watch live: Brett can watch the screen you are changing. Agent cap: heavy steps share a lock. '
  + 'Model switches (Brett, Nov 3 2026): a downgrade is fine.';

const BRIEF = [
  '# Build: demo', '', 'Make the thing.', '', '## Brett said (verbatim)', 'Source: voice · At: 2026-11-03T14:05:00Z', '> Build the thing now.', '',
  '## Addendum 1 (Brett, Nov 4 2026 (chat))', '> Also make it blue.', '', '## Do', '- one', '- two', '',
  'Watch live: run axf focus.', '', 'Agent cap: heavy steps share a lock.',
].join('\n');

t('reflow puts headings, bullets and session rules back on their own lines', () => {
  const r = c.reflow(FLAT);
  assert.match(r, /\n## Do\n- In the Codebase/);
  assert.match(r, /\n\nWatch live:/);
  assert.match(r, /\n\nAgent cap:/);
  assert.match(r, /\n\nModel switches/);
  assert.match(r, /^# Build: changes-chat-log \(Current profile\)\n\*\*Name:\*\*/);
  assert.equal(c.reflow('a\nb'), 'a\nb', 'text with lines stays as it is');
});

t('splitBrief takes out his words and the session rules', () => {
  const s = c.splitBrief(FLAT);
  assert.equal(s.said[0].text, 'This needs to be displayed like the chat log.');
  assert.equal(s.said[0].verbatim, true);
  assert.deepEqual(s.rules.map((r) => r.title), ['Watch live', 'Agent cap', 'Model switches']);
  assert.doesNotMatch(s.body, /Watch live|Agent cap|Model switches|What Brett said|# Build/);
  assert.match(s.body, /## Do/);
  assert.match(s.body, /^Screenshot: an entry\./m, 'notes after his quote stay in the brief');
});

t('a brief with the said block and an addendum gives two Brett messages', () => {
  const s = c.splitBrief(BRIEF);
  assert.deepEqual(s.said.map((x) => [x.kind, x.text]), [['said', 'Build the thing now.'], ['addendum', 'Also make it blue.']]);
  assert.equal(s.body.startsWith('Make the thing.'), true);
});

t('timeline: Brett, Amber, started, steps, commits, PR, result, closed, oldest first', () => {
  const m = c.timeline({
    brief: BRIEF, createdAt: '2026-11-04T10:00:00Z', startedAt: '2026-11-04T10:00:05Z',
    steps: [
      { text: 'second', state: 'done', startedAt: '2026-11-04T10:20:00Z', finishedAt: '2026-11-04T10:30:00Z' },
      { text: 'first', state: 'done', startedAt: '2026-11-04T10:01:00Z', finishedAt: '2026-11-04T10:10:30Z', checks: ['a', 'b'] },
      { text: 'later', state: 'queued' },
    ],
    result: { state: 'done', summary: 'All done', commits: [{ sha: 'abcdef1' }], at: '2026-11-04T11:00:00Z' },
    pr: '#12', closed: { at: '2026-11-04T12:00:00Z', by: 'brett' },
  });
  assert.deepEqual(m.map((x) => `${x.role}:${x.kind}`), ['brett:said', 'brett:addendum', 'amber:brief', 'system:started', 'agent:step', 'agent:step', 'agent:commits', 'agent:pr', 'agent:result', 'system:closed', 'agent:step']);
  const steps = m.filter((x) => x.kind === 'step');
  assert.deepEqual(steps.map((x) => x.text), ['first', 'second', 'later'], 'steps by time; not started ones last');
  assert.equal(steps[0].took, 570_000);
  assert.equal(steps[0].checks, 2);
  assert.equal(c.tookText(steps[0].took), '9m 30s');
  assert.deepEqual(c.stepCounts(m), { steps: 3, done: 2, failed: 0, running: 0 });
});

t('a recorded origin wins over the brief block', () => {
  const m = c.timeline({ origin: { said: 'Exact words', at: '2026-11-01T09:00:00Z', source: 'voice', verbatim: true, addenda: [] }, brief: BRIEF });
  const b = m.filter((x) => x.role === 'brett');
  assert.deepEqual(b.map((x) => x.text), ['Exact words']);
  assert.equal(b[0].source, 'voice');
});

t('builds-store steps ({text, done, doneAt}) read as done / queued', () => {
  const m = c.timeline({ steps: [{ text: 'a', done: true, doneAt: '2026-11-04T10:00:00Z' }, { text: 'b', done: false }] });
  assert.deepEqual(m.filter((x) => x.kind === 'step').map((x) => x.state), ['done', 'queued']);
});

t('empty input gives no messages', () => { assert.deepEqual(c.timeline({}), []); assert.deepEqual(c.timeline(), []); });

console.log(`\nbuild-chat: ${n} checks passed`);
