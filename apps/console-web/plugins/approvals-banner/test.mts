// @ts-nocheck: a Node test, not part of the console's build
/** Approvals (veto) banner self-test: the alarm model. node --experimental-strip-types apps/console-web/plugins/approvals-banner/test.mts */
import assert from 'node:assert/strict';
import { ALARM_DEFAULTS, ALARM_KEYS as K, alarmConfig, alarmDue, alarmLength, nativeAlarmConfig, ringingAt, startSeconds, START_AT, TONES, tonesOf, VIBRATIONS, volumeAt } from './web/alarm.ts';

let n = 0;
const t = (name: string, f: () => void) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const cfgOf = (o: Record<string, unknown>) => alarmConfig((k) => o[k]);

t('defaults', () => assert.deepEqual(cfgOf({}), ALARM_DEFAULTS));
t('values clamped', () => {
  const c = cfgOf({ [K.volume]: -5, [K.repeat]: 99, [K.ringSeconds]: '12', [K.louderSeconds]: 'x', [K.repeatGapSeconds]: 1000 });
  assert.deepEqual([c.volume, c.repeat, c.ringSeconds, c.louderSeconds, c.repeatGapSeconds], [0, 10, 12, ALARM_DEFAULTS.louderSeconds, 300]);
});
t('unknown choices fall back', () => {
  const c = cfgOf({ [K.tone]: 'bogus', [K.vibration]: 'bogus', [K.startAt]: 'bogus' });
  assert.deepEqual([c.tone, c.vibration, c.startAt], [ALARM_DEFAULTS.tone, ALARM_DEFAULTS.vibration, ALARM_DEFAULTS.startAt]);
});
t('own sound needs an audio data URL', () => {
  assert.equal(cfgOf({ [K.tone]: 'custom' }).tone, ALARM_DEFAULTS.tone);
  assert.equal(cfgOf({ [K.tone]: 'custom', [K.customSound]: 'data:text/html;base64,PGI+' }).tone, ALARM_DEFAULTS.tone);
  assert.equal(cfgOf({ [K.tone]: 'custom', [K.customSound]: 'data:audio/ogg;base64,T2dnUw==' }).tone, 'custom');
  assert.equal(cfgOf({ [K.tone]: 'custom', [K.customSound]: `data:audio/ogg;base64,${'A'.repeat(1_600_000)}` }).tone, ALARM_DEFAULTS.tone);
});
t('start points', () => {
  assert.deepEqual(START_AT.map((s) => startSeconds({ startAt: s.value })), [Infinity, 60, 30, 10, 0]);
  const c = cfgOf({ [K.startAt]: 'run' });
  assert.equal(alarmDue(c, { secondsLeft: 1 }), false);
  assert.equal(alarmDue(c, { secondsLeft: 0 }), true);
  assert.equal(alarmDue(cfgOf({ [K.startAt]: '60' }), { secondsLeft: 60 }), true);
});
t('quiet when shelved, approved or off', () => {
  const c = cfgOf({ [K.startAt]: 'start' });
  assert.equal(alarmDue(c, { secondsLeft: 80, shelved: true }), false);
  assert.equal(alarmDue(c, { secondsLeft: 80, approvedNow: true }), false);
  assert.equal(alarmDue(cfgOf({ [K.enabled]: false, [K.startAt]: 'start' }), { secondsLeft: 0 }), false);
});
t('rings, gaps, repeats, end', () => {
  const r = { ringSeconds: 4, repeat: 3, repeatGapSeconds: 2 };
  assert.equal(alarmLength(r), 16);
  assert.deepEqual([0, 3.9, 4, 5.9, 6, 10, 12, 15.9, 16].map((s) => ringingAt(r, s)), [true, true, false, false, true, false, true, true, false]);
  assert.equal(ringingAt(r, -1), false);
});
t('gets louder over time, per ring', () => {
  const v = { volume: 100, louder: true, louderSeconds: 4, ringSeconds: 4, repeatGapSeconds: 2 };
  assert.ok(Math.abs(volumeAt(v, 0) - 0.2) < 1e-9);
  assert.ok(Math.abs(volumeAt(v, 2) - 0.6) < 1e-9);
  assert.ok(Math.abs(volumeAt(v, 4) - 1) < 1e-9);
  assert.ok(Math.abs(volumeAt(v, 6) - 0.2) < 1e-9, 'the next ring starts quiet again');
  assert.equal(volumeAt({ ...v, louder: false, volume: 40 }, 0), 0.4);
});
t('phone config', () => {
  const nat = nativeAlarmConfig(cfgOf({ [K.startAt]: 'start', [K.vibration]: 'none', [K.throughSilent]: false }));
  assert.deepEqual([nat.startSeconds, nat.vibration, nat.throughSilent, nat.customSound], [-1, [], false, '']);
  const own = nativeAlarmConfig(cfgOf({ [K.tone]: 'custom', [K.customSound]: 'data:audio/ogg;base64,T2dnUw==' }));
  assert.equal(own.customSound, 'data:audio/ogg;base64,T2dnUw==');
});
t('every built-in tone plays something; every vibration is a list', () => {
  for (const tone of TONES) if (tone.value !== 'custom') assert.ok(tonesOf(tone.value).some(([hz]) => hz > 0), tone.value);
  for (const v of VIBRATIONS) assert.ok(Array.isArray(v.pattern));
});
console.log(`✓ approvals-banner: ${n} checks passed`);
