// @ts-nocheck: a Node test, not part of the console's build
/** Decision dialog self-test (pure rules): node --experimental-strip-types apps/console-web/plugins/decision-dialog/test.mts */
import assert from 'node:assert/strict';
import { matchButton, nextPopup, parseAnswer, place } from './web/queue.ts';

let n = 0;
const t = (name: string, f: () => void) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const d = (id: string, extra = {}) => ({ id, status: 'waiting', popup: true, buttons: [{ id: 'approve' }, { id: 'reject' }, { id: 'changes' }], ...extra });
// newest first, as the server lists them
const items = [d('c'), d('b'), d('a')];

t('the oldest new one pops up first', () => assert.equal(nextPopup(items, new Set(), null), 'a'));
t('already popped up: the next one', () => assert.equal(nextPopup(items, new Set(['a']), null), 'b'));
t('one on screen blocks while still waiting', () => assert.equal(nextPopup(items, new Set(), 'b'), null));
t('one on screen that was answered does not block', () => assert.equal(nextPopup([d('c'), d('a')], new Set(['b']), 'b'), 'a'));
t('another dialog open: wait', () => assert.equal(nextPopup(items, new Set(), null, true), null));
t('Later / switched off: no pop-up', () => assert.equal(nextPopup([d('a', { popup: false })], new Set(), null), null));
t('counter and neighbours', () => {
  assert.deepEqual(place(items, 'b'), { at: 2, of: 3, prev: 'c', next: 'a' });
  assert.deepEqual(place(items, 'c'), { at: 1, of: 3, prev: null, next: 'b' });
  assert.deepEqual(place(items, 'a'), { at: 3, of: 3, prev: 'b', next: null });
});
t('voice: pick option N', () => {
  assert.deepEqual(parseAnswer('pick option 2'), { button: 'pick', option: '2' });
  assert.deepEqual(parseAnswer('Choose the second one'), { button: 'pick', option: '2' });
  assert.deepEqual(parseAnswer('option three.'), { button: 'pick', option: '3' });
  assert.equal(parseAnswer('pick something'), null);
});
t('voice: approve / reject / changes / later', () => {
  assert.deepEqual(parseAnswer('approve it'), { button: 'approve' });
  assert.deepEqual(parseAnswer('approve now'), { button: 'approve-now' });
  assert.deepEqual(parseAnswer('reject'), { button: 'reject' });
  assert.deepEqual(parseAnswer('deny'), { button: 'deny' });
  assert.deepEqual(parseAnswer('request changes: bigger buttons'), { button: 'changes', note: 'bigger buttons' });
  assert.deepEqual(parseAnswer('later'), { button: 'later' });
  assert.equal(parseAnswer('what time is it'), null);
});
t('deny and reject stand in for each other', () => {
  assert.equal(matchButton(d('x'), 'deny'), 'reject');
  assert.equal(matchButton({ buttons: [{ id: 'approve-now' }, { id: 'deny' }] }, 'approve'), 'approve-now');
  assert.equal(matchButton({ buttons: [{ id: 'approve' }] }, 'shelve'), null);
});
console.log(`decision-dialog web: ${n} checks passed`);
