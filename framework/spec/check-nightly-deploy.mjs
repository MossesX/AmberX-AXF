#!/usr/bin/env node
/** The nightly console deploy's clock: New York time across daylight saving, once a night, off switch, what counts as code. */
import assert from 'node:assert/strict';
import { codeChanged, nightlyDue, timeMinutes, zoneClock } from '../../deploy/console-nightly.mjs';

let n = 0;
const t = (name, f) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('the clock is New York time on both sides of daylight saving', () => {
  assert.deepEqual(zoneClock(new Date('2026-11-07T07:00:00Z')), { day: '2026-11-07', minutes: 120 }); // EST
  assert.deepEqual(zoneClock(new Date('2026-07-07T06:00:00Z')), { day: '2026-07-07', minutes: 120 }); // EDT
});
t('due at the set time, in the window', () => {
  const at = (iso, o = {}) => nightlyDue({ now: new Date(iso), enabled: true, time: '02:00', lastDay: '', ...o });
  assert.equal(at('2026-11-07T06:59:00Z').due, false, 'a minute early');
  assert.equal(at('2026-11-07T07:00:00Z').due, true, 'on time');
  assert.equal(at('2026-11-07T09:30:00Z').due, true, 'a missed start still runs');
  assert.equal(at('2026-11-07T10:00:00Z').due, false, 'not at breakfast');
  assert.equal(at('2026-11-07T07:00:00Z', { lastDay: '2026-11-07' }).due, false, 'once a night');
  assert.equal(at('2026-11-08T07:00:00Z', { lastDay: '2026-11-07' }).due, true, 'the next night');
});
t('the switch and the time are settings', () => {
  assert.equal(nightlyDue({ now: new Date('2026-11-07T07:00:00Z'), enabled: false, time: '02:00' }).due, false);
  assert.equal(nightlyDue({ now: new Date('2026-11-07T07:00:00Z'), time: '03:30' }).due, false, 'moved later');
  assert.equal(nightlyDue({ now: new Date('2026-11-07T08:30:00Z'), time: '03:30' }).due, true);
  assert.equal(timeMinutes('nonsense'), 120, 'a bad value is the default');
});
t('status commits are not code', () => {
  assert.equal(codeChanged(['_claude/builds/store.json', '_claude/THREADS.md', '']), false);
  assert.equal(codeChanged(['_claude/THREADS.md', 'apps/console-web/src/App.tsx']), true);
});
console.log(`✓ nightly deploy: ${n} checks passed`);
