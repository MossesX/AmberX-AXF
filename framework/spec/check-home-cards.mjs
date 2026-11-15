#!/usr/bin/env node
/**
 * home-cards@1 conformance: Home follows plugin on/off and is always full (Brett, Nov 15 2026). Replays the golden
 * fixture: disable removes the card and the next-ranked plugin takes its place, re-enable brings it back, an empty
 * selection still fills every slot, pins keep their order, the slot count grows and trims the auto tail, the activity
 * ranking (weights, decay, window, tie-break), validation, and the registry / JSON Schema snapshots.
 *   node framework/spec/check-home-cards.mjs           check
 *   node framework/spec/check-home-cards.mjs --write   regenerate fixtures/home-cards.json's expected outputs and the schemas
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../core/engines/home-cards.mjs';
import * as A from '../core/engines/plugin-activity.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/home-cards.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = (r) => r.cards.map((c) => c.plugin);
const AT = '2026-11-15T12:00:00Z';
const daysAgo = (d) => new Date(Date.parse(AT) - d * 86400000).toISOString();

// ------------------------------------------------------------------ inputs

/** The console's plugin inventory as the Plugin Manager shows it: nine installed, all on. */
const INVENTORY = ['agents', 'build-orchestrator', 'gate', 'llm', 'notes', 'plugin-manager', 'push-banner', 'ui-review', 'voicevault'].map((id) => ({ id, enabled: true }));
const withOff = (...off) => INVENTORY.map((p) => (off.includes(p.id) ? { ...p, enabled: false } : p));
const without = (...gone) => INVENTORY.filter((p) => !gone.includes(p.id));

/** Two weeks of use. Expected scores (window 14 d, half-life 3 d; open 1, action 2, job 3, alert 2): gate 7.7622,
 * build-orchestrator 5.2599, agents 4, notes 1.5, ui-review 0.5, push-banner 0.0496, llm 0 (its only open is 20 days
 * old), plugin-manager 0, voicevault 0. */
const EVENTS = [
  { plugin: 'gate', kind: 'job', at: daysAgo(0) },
  { plugin: 'gate', kind: 'action', at: daysAgo(1), n: 3 },
  { plugin: 'build-orchestrator', kind: 'open', at: daysAgo(0), n: 4 },
  { plugin: 'build-orchestrator', kind: 'alert', at: daysAgo(2) },
  { plugin: 'agents', kind: 'action', at: daysAgo(0), n: 2 },
  { plugin: 'notes', kind: 'open', at: daysAgo(0) },
  { plugin: 'notes', kind: 'open', at: daysAgo(3) },
  { plugin: 'ui-review', kind: 'alert', at: daysAgo(6) },
  { plugin: 'push-banner', kind: 'open', at: daysAgo(13) },
  { plugin: 'llm', kind: 'open', at: daysAgo(20) },
  { plugin: 'Not A Plugin', kind: 'open', at: daysAgo(0) },
  { plugin: 'agents', kind: 'nope', at: daysAgo(0) },
  'junk',
];

/** Brett pinned three: a quiet one (voicevault) stays on Home because he said so. */
const BRETT = { $axf: H.PICKS_FRAME, slots: 6, plugins: ['notes', 'voicevault', 'gate'], at: AT, updatedBy: 'brett' };
/** Picks as a hand or an old store might leave them: a repeat, a bad id, an uninstalled plugin. */
const MESSY = ['notes', 'notes', 'Bad Id', 'ghost', 'gate'];

const IN = { AT, INVENTORY, EVENTS, BRETT, MESSY };

// ------------------------------------------------------------------ outputs

function run() {
  const opts = { at: AT, plugins: INVENTORY.map((p) => p.id) };
  const activity = A.scoreActivity(EVENTS, opts);
  const R = (picks, plugins, extra = {}) => H.resolveHomeCards({ picks, plugins, activity, at: AT, ...extra });
  return {
    registry: H.REGISTRY,
    schemas: H.jsonSchemas(),
    activity,
    ranked: A.rankedIds(activity),
    rankedFromEvents: A.rankedIds(EVENTS, { at: AT }),
    pruned: A.pruneEvents(EVENTS, { at: AT }),
    options: { defaults: A.activityOptions({ at: AT }), clamped: A.activityOptions({ at: AT, windowDays: 0, halfLifeDays: 9999, weights: { open: -1, job: 10 } }) },
    decay: [0, 1, 3, 6, 30, -2].map((d) => [d, A.roundScore(A.decay(d))]),
    shortWindow: A.scoreActivity(EVENTS, { at: AT, windowDays: 7, halfLifeDays: 1, weights: { open: 10 } }),
    resolve: {
      allAuto: R([], INVENTORY),
      pinned: R(BRETT, INVENTORY),
      gateOff: R(BRETT, withOff('gate')),
      gateBackOn: R(BRETT, INVENTORY),
      gateGone: R(BRETT, without('gate')),
      twoOff: R(BRETT, withOff('gate', 'build-orchestrator')),
      fewerSlots: R(BRETT, INVENTORY, { slots: 2 }),
      moreSlots: R(BRETT, INVENTORY, { slots: 12 }),
      quietInstall: H.resolveHomeCards({ picks: [], plugins: INVENTORY, activity: [], slots: 4, at: AT }),
      noInventory: H.resolveHomeCards({ picks: BRETT, at: AT }),
      messy: R(MESSY, INVENTORY, { slots: 3 }),
      scoresAsObject: H.resolveHomeCards({ picks: [], plugins: INVENTORY.map((p) => p.id), activity: Object.fromEntries(activity.map((r) => [r.plugin, r.score])), slots: 3, at: AT }),
    },
    picks: {
      brett: H.normPicks(BRETT, AT),
      messy: H.normPicks(MESSY, AT),
      empty: H.normPicks(null, AT),
      bigSlots: H.normPicks({ slots: 99, plugins: INVENTORY.map((p) => p.id).concat(['extra-one', 'extra-two']) }, AT),
    },
    errors: {
      brett: H.picksErrors(BRETT),
      badPicks: H.picksErrors({ $axf: 'x', slots: 0, plugins: ['Bad Id', 'notes', 'notes'], at: 'yesterday', updatedBy: 7 }),
      goodCards: H.cardsErrors(R(BRETT, INVENTORY)),
      badCards: H.cardsErrors({ $axf: H.CARDS_FRAME, at: AT, slots: 2, cards: [{ plugin: 'notes', mode: 'auto', rank: 1, score: 1 }, { plugin: 'notes', mode: 'stuck', rank: 1, score: -1 }, 'x'], dropped: [{ plugin: 'gate', why: 'tired' }], short: 1 }),
      goodActivity: activity.flatMap((r) => H.isPluginId(r.plugin) ? A.activityErrors(r) : ['bad id']),
      badActivity: A.activityErrors({ $axf: 'nope', plugin: 'Bad', at: 'x', window: { days: 0 }, counts: { open: -1 }, score: 'high' }),
      goodEvent: A.eventErrors(EVENTS[1]),
      badEvent: A.eventErrors({ $axf: 'x', plugin: '', kind: 'click', at: 'now', n: 0 }),
      normEvents: EVENTS.map((e) => A.normEvent(e, AT)),
    },
  };
}
const actual = run();
if (WRITE) {
  writeFileSync(FIX, `${JSON.stringify({ $axf: H.SCHEMA, note: 'Generated by framework/spec/check-home-cards.mjs --write; every port replays `in` (an inventory, an event log, picks) and must answer `out`.', in: IN, out: actual }, null, 1)}\n`);
  for (const [name, s] of Object.entries(actual.schemas)) writeFileSync(join(ROOT, 'framework/schemas/json', name), `${JSON.stringify(s, null, 2)}\n`);
  writeFileSync(join(ROOT, 'framework/schemas/home-cards.json'), `${JSON.stringify(actual.registry, null, 2)}\n`);
  console.log(`wrote ${FIX} + schemas`);
}
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ the ranking

t('the ranking: weights × n × decay inside the window, score desc then id asc, zero records for quiet plugins', () => {
  assert.deepEqual(actual.ranked, ['gate', 'build-orchestrator', 'agents', 'notes', 'ui-review', 'push-banner', 'llm', 'plugin-manager', 'voicevault']);
  assert.deepEqual(actual.activity.map((r) => r.score), [7.7622, 5.2599, 4, 1.5, 0.5, 0.0496, 0, 0, 0]);
  assert.deepEqual(actual.activity[0].counts, { open: 0, action: 3, job: 1, alert: 0 });
  assert.equal(actual.activity.find((r) => r.plugin === 'llm').counts.open, 0, 'a 20-day-old open is outside the 14-day window');
  assert.deepEqual(actual.rankedFromEvents, ['gate', 'build-orchestrator', 'agents', 'notes', 'ui-review', 'push-banner'], 'without a plugin list only plugins seen in the window rank');
  assert.equal(actual.pruned.length, 9, 'the prune drops the stale open, the bad id, the unknown kind and junk');
  assert.ok(actual.pruned.every((e) => e.$axf === H.EVENT_FRAME && A.eventErrors(e).length === 0));
});
t('decay: 1 now, ½ at one half-life, ¼ at two, future counts as now; options clamp to the registry ranges', () => {
  assert.deepEqual(actual.decay, [[0, 1], [1, 0.7937], [3, 0.5], [6, 0.25], [30, 0.001], [-2, 1]]);
  assert.deepEqual(actual.options.defaults, { at: AT, windowDays: 14, halfLifeDays: 3, weights: { open: 1, action: 2, job: 3, alert: 2 }, plugins: [] });
  assert.deepEqual(actual.options.clamped, { at: AT, windowDays: 1, halfLifeDays: 365, weights: { open: 1, action: 2, job: 10, alert: 2 }, plugins: [] });
  assert.deepEqual(actual.shortWindow.map((r) => r.plugin), ['build-orchestrator', 'notes', 'gate', 'agents', 'ui-review'], 'settings change the order: opens weigh 10, a 1-day half-life, a 7-day window');
  assert.deepEqual(actual.shortWindow.map((r) => r.score), [40.5, 11.25, 6, 4, 0.0313]);
});

// ------------------------------------------------------------------ the resolver

const r = actual.resolve;
t('an empty selection still fills every slot, with the most active plugins', () => {
  assert.deepEqual(ids(r.allAuto), ['gate', 'build-orchestrator', 'agents', 'notes', 'ui-review', 'push-banner']);
  assert.ok(r.allAuto.cards.every((c, i) => c.mode === 'auto' && c.rank === i + 1));
  assert.deepEqual([r.allAuto.short, r.allAuto.dropped], [0, []]);
});
t('pins keep Brett\'s order, then the free slots fill by rank', () => {
  assert.deepEqual(ids(r.pinned), ['notes', 'voicevault', 'gate', 'build-orchestrator', 'agents', 'ui-review']);
  assert.deepEqual(r.pinned.cards.map((c) => c.mode), ['pinned', 'pinned', 'pinned', 'auto', 'auto', 'auto']);
  assert.equal(r.pinned.cards[1].score, 0, 'a quiet pinned plugin still holds its slot');
});
t('disable removes the card and the next-ranked plugin takes its place', () => {
  assert.deepEqual(ids(r.gateOff), ['notes', 'voicevault', 'build-orchestrator', 'agents', 'ui-review', 'push-banner']);
  assert.deepEqual(r.gateOff.dropped, [{ plugin: 'gate', why: 'disabled' }]);
  assert.equal(r.gateOff.short, 0);
  assert.deepEqual(ids(r.twoOff), ['notes', 'voicevault', 'agents', 'ui-review', 'push-banner', 'llm'], 'two off: both replaced, nothing auto for a disabled plugin either');
  assert.deepEqual(ids(r.gateGone), ids(r.gateOff));
  assert.deepEqual(r.gateGone.dropped, [{ plugin: 'gate', why: 'uninstalled' }]);
});
t('re-enable brings the card back in its place; the stand-in drops off the end', () => {
  assert.deepEqual(r.gateBackOn, r.pinned);
  assert.ok(!ids(r.gateBackOn).includes('push-banner'));
});
t('slot count changes: fewer trims the auto tail then overflows pins; more grows the tail and reports the shortfall', () => {
  assert.deepEqual(ids(r.fewerSlots), ['notes', 'voicevault']);
  assert.deepEqual(r.fewerSlots.dropped, [{ plugin: 'gate', why: 'overflow' }]);
  assert.deepEqual(ids(r.moreSlots), ['notes', 'voicevault', 'gate', 'build-orchestrator', 'agents', 'ui-review', 'push-banner', 'llm', 'plugin-manager']);
  assert.deepEqual([r.moreSlots.slots, r.moreSlots.short], [12, 3], 'nine plugins, twelve slots: three honestly short, never a gap in between');
});
t('a quiet install with no picks and no activity still fills Home (id order)', () => {
  assert.deepEqual(ids(r.quietInstall), ['agents', 'build-orchestrator', 'gate', 'llm']);
  assert.deepEqual(ids(r.noInventory), []);
  assert.deepEqual(r.noInventory.dropped.map((d) => d.why), ['uninstalled', 'uninstalled', 'uninstalled']);
  assert.equal(r.noInventory.short, 6);
});
t('messy picks: duplicates, bad ids and uninstalled plugins are reported, never shown', () => {
  assert.deepEqual(ids(r.messy), ['notes', 'gate', 'build-orchestrator']);
  assert.deepEqual(r.messy.dropped, [{ plugin: 'notes', why: 'duplicate' }, { plugin: 'Bad Id', why: 'invalid' }, { plugin: 'ghost', why: 'uninstalled' }]);
  assert.deepEqual(ids(r.scoresAsObject), ['gate', 'build-orchestrator', 'agents'], 'scores as { id: score } and the inventory as ids work the same');
});
t('the resolver is deterministic', () => assert.deepEqual(H.resolveHomeCards({ picks: BRETT, plugins: INVENTORY, activity: actual.activity, at: AT }), r.pinned));
t('every resolved doc validates', () => { for (const [k, doc] of Object.entries(r)) assert.deepEqual(H.cardsErrors(doc), [], k); });

// ------------------------------------------------------------------ picks + validation

t('normPicks: valid ids once each in order, slots clamped, up to 24', () => {
  assert.deepEqual(actual.picks.brett, BRETT);
  assert.deepEqual(actual.picks.messy, { $axf: H.PICKS_FRAME, slots: 6, plugins: ['notes', 'ghost', 'gate'], at: AT });
  assert.deepEqual(actual.picks.empty, { $axf: H.PICKS_FRAME, slots: 6, plugins: [], at: AT });
  assert.equal(actual.picks.bigSlots.slots, 24);
  assert.equal(actual.picks.bigSlots.plugins.length, 11);
  for (const p of Object.values(actual.picks)) assert.deepEqual(H.picksErrors(p), []);
});
t('validators: good docs pass, bad ones name every fault', () => {
  const E = actual.errors;
  assert.deepEqual([E.brett, E.goodCards, E.goodActivity, E.goodEvent], [[], [], [], []]);
  assert.equal(E.badPicks.length, 6);
  assert.ok(E.badCards.length >= 6, E.badCards.join('; '));
  assert.equal(E.badActivity.length, 9, 'frame, id, at, window, four counters, score');
  assert.equal(E.badEvent.length, 5);
  assert.deepEqual(E.normEvents.slice(-3), [null, null, null]);
  assert.deepEqual(E.normEvents[1], { $axf: H.EVENT_FRAME, plugin: 'gate', kind: 'action', at: daysAgo(1), n: 3 });
});

// ------------------------------------------------------------------ snapshots + zero tokens

t('schemas/home-cards.json + schemas/json/home-picks|home-cards|plugin-activity.schema.json are current (run --write)', () => {
  assert.ok(same(JSON.parse(rd('framework/schemas/home-cards.json')), H.REGISTRY));
  for (const [name, s] of Object.entries(H.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name);
});
t('zero tokens: neither engine imports a language model or calls a network', () => {
  for (const f of ['framework/core/engines/home-cards.mjs', 'framework/core/engines/plugin-activity.mjs']) {
    const src = rd(f);
    assert.ok(!/anthropic|openai|\/v1\/messages|fetch\(|node:http|llm/i.test(src.replace(/'llm'/g, '')), `${f} must stay pure`);
  }
});
t('HOME-CARDS.md and PORTING.md carry the contract and the deferred twin', () => {
  assert.ok(rd('framework/spec/HOME-CARDS.md').includes('resolveHomeCards'));
  assert.ok(/Deferred: home-cards@1/.test(rd('framework/spec/PORTING.md')));
});

console.log(`check-home-cards: ${n} checks passed`);
