/**
 * home-cards@1 — which plugins hold a slot on Home, in what order, and why (Brett, Nov 15 2026: "When I disable
 * plugins, the home cards need to be disabled as well. They need to be removed, and other ones need to replace them.
 * The home screen always needs to be filled with some plugins, even if I don't have some selected. Yes, I can select
 * which ones I want, but if I don't, you need to pick some. Pick the most active.").
 *
 * Pure: picks (his pins, his order) + the plugin inventory (installed, enabled) + activity scores + a slot count in,
 * an ordered list of cards marked pinned / auto out, plus what was dropped and why. No I/O, no clock unless `at` is
 * missing, no language model. The contract is spec/HOME-CARDS.md; the fixture is spec/fixtures/home-cards.json; the
 * scores come from core/engines/plugin-activity.mjs. Every port replays the same fixture.
 */

export const SCHEMA = 'home-cards@1';
export const PICKS_FRAME = 'home-picks@1';
export const CARDS_FRAME = 'home-cards@1';
export const ACTIVITY_FRAME = 'plugin-activity@1';
export const EVENT_FRAME = 'plugin-activity-event@1';
export const VERSION = 1;

/** How a card got its slot: Brett pinned it, or the ranking filled a free slot. */
export const MODES = Object.freeze(['pinned', 'auto']);
/** What counts as activity (plugin-activity-event@1.kind). */
export const EVENT_KINDS = Object.freeze(['open', 'action', 'job', 'alert']);
/** Why a pick did not get a slot. */
export const DROP_REASONS = Object.freeze(['disabled', 'uninstalled', 'duplicate', 'invalid', 'overflow']);
/** A plugin folder id (the same pattern card@1 uses for source.plugin). */
export const ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';
export const SLOTS = Object.freeze({ default: 6, min: 1, max: 24 });
export const PICKS_MAX = 24;
export const EVENTS_MAX = 20000;
export const COUNT_MAX = 1000000;
export const WINDOW = Object.freeze({ days: 14, halfLifeDays: 3, minDays: 1, maxDays: 365 });
export const WEIGHTS = Object.freeze({ open: 1, action: 2, job: 3, alert: 2 });
export const SCORE_DECIMALS = 4;

/** The one registry (= framework/schemas/home-cards.json; spec/check-home-cards.mjs fails when they drift). */
export const REGISTRY = Object.freeze({
  schema: SCHEMA,
  version: VERSION,
  picks: PICKS_FRAME,
  cards: CARDS_FRAME,
  activity: ACTIVITY_FRAME,
  event: EVENT_FRAME,
  modes: [...MODES],
  eventKinds: [...EVENT_KINDS],
  dropReasons: [...DROP_REASONS],
  idPattern: ID_PATTERN,
  slots: { ...SLOTS },
  picksMax: PICKS_MAX,
  eventsMax: EVENTS_MAX,
  countMax: COUNT_MAX,
  window: { ...WINDOW },
  weights: { ...WEIGHTS },
  scoreDecimals: SCORE_DECIMALS,
});

const ID_RE = new RegExp(ID_PATTERN);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isPluginId = (v) => typeof v === 'string' && ID_RE.test(v);

/** A slot count inside the allowed range (anything unusable becomes the default). */
export function clampSlots(n) {
  const v = Number.isFinite(n) ? Math.round(n) : SLOTS.default;
  return Math.min(SLOTS.max, Math.max(SLOTS.min, v));
}

/* ================================================================== home-picks@1 */

/** The raw pick list as Brett wrote it (order kept, nothing judged): a bare list, a picks doc, or nothing. */
export function pickList(picks) {
  const list = Array.isArray(picks) ? picks : isObj(picks) && Array.isArray(picks.plugins) ? picks.plugins : [];
  return list.map((p) => (isObj(p) ? str(p.id ?? p.plugin ?? p.folder) : str(p)));
}

/** A clean home-picks@1: valid ids only, first occurrence wins, up to PICKS_MAX, slots clamped. The store shape. */
export function normPicks(raw, at = new Date().toISOString()) {
  const d = isObj(raw) ? raw : {};
  const plugins = [];
  for (const id of pickList(raw)) if (isPluginId(id) && !plugins.includes(id) && plugins.length < PICKS_MAX) plugins.push(id);
  const out = { $axf: PICKS_FRAME, slots: clampSlots(Array.isArray(raw) ? undefined : d.slots), plugins, at: isIso(d.at) ? d.at : at };
  if (str(d.updatedBy)) out.updatedBy = str(d.updatedBy);
  return out;
}

/** Errors in a home-picks@1 doc (empty = valid). */
export function picksErrors(doc, path = 'picks') {
  const e = [];
  if (!isObj(doc)) return [`${path} must be an object`];
  if (doc.$axf !== PICKS_FRAME) e.push(`${path}.$axf must be ${PICKS_FRAME}`);
  if (!(Number.isInteger(doc.slots) && doc.slots >= SLOTS.min && doc.slots <= SLOTS.max)) e.push(`${path}.slots must be an integer ${SLOTS.min}–${SLOTS.max}`);
  if (!Array.isArray(doc.plugins)) e.push(`${path}.plugins must be a list of plugin ids`);
  else {
    if (doc.plugins.length > PICKS_MAX) e.push(`${path}.plugins holds at most ${PICKS_MAX}`);
    doc.plugins.forEach((p, i) => { if (!isPluginId(p)) e.push(`${path}.plugins[${i}] must be a plugin id`); });
    if (new Set(doc.plugins).size !== doc.plugins.length) e.push(`${path}.plugins repeats an id`);
  }
  if (doc.at !== undefined && !isIso(doc.at)) e.push(`${path}.at must be an ISO date-time`);
  if (doc.updatedBy !== undefined && (typeof doc.updatedBy !== 'string' || doc.updatedBy.length > 80)) e.push(`${path}.updatedBy must be a string up to 80`);
  return e;
}

/* ================================================================== inputs */

/**
 * The inventory as a Map id → enabled. Accepts a list of ids (all enabled), a list of records ({ id | folder | plugin,
 * enabled }, enabled defaults to true), or an object { id: boolean }. An id absent from the Map is not installed.
 */
export function inventoryMap(plugins) {
  const m = new Map();
  const put = (id, on) => { const k = str(id); if (isPluginId(k)) m.set(k, m.has(k) ? m.get(k) && on : on); };
  if (Array.isArray(plugins)) for (const p of plugins) { if (isObj(p)) put(p.id ?? p.folder ?? p.plugin, p.enabled !== false); else put(p, true); }
  else if (isObj(plugins)) for (const [k, v] of Object.entries(plugins)) put(k, v !== false && v !== 'off' && v !== 'disabled');
  return m;
}

/** Scores as a Map id → number from plugin-activity@1 records, { plugin, score } pairs or an object { id: score }. */
export function scoreMap(activity) {
  const m = new Map();
  const put = (id, s) => { const k = str(id); if (isPluginId(k)) m.set(k, Math.max(0, Number.isFinite(s) ? s : 0)); };
  if (Array.isArray(activity)) { for (const r of activity) if (isObj(r)) put(r.plugin ?? r.id, Number(r.score)); }
  else if (isObj(activity)) { for (const [k, v] of Object.entries(activity)) put(k, Number(v)); }
  return m;
}

/** The ranking order the resolver fills with: score desc, then id asc (stable across ports and runs). */
export function byRank(scores) {
  return (a, b) => { const d = (scores.get(b) ?? 0) - (scores.get(a) ?? 0); return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0; };
}

/* ================================================================== the resolver */

/**
 * The resolver: `{ picks, plugins, activity, slots?, at? }` → home-cards@1.
 *   1. slots = clamp(slots ?? picks.slots ?? default).
 *   2. Pins first in Brett's order; invalid / uninstalled / disabled / duplicate / overflow picks go to `dropped`.
 *   3. Free slots fill with the top-ranked enabled plugins not already pinned (score desc, id asc; no activity = 0).
 *   4. Never a gap: cards.length = min(slots, enabled count); `short` is the remainder.
 */
export function resolveHomeCards({ picks, plugins, activity, slots, at } = {}) {
  const inv = inventoryMap(plugins);
  const scores = scoreMap(activity);
  const n = clampSlots(slots ?? (isObj(picks) ? picks.slots : undefined));
  const stamp = isIso(at) ? at : new Date().toISOString();
  const cards = [];
  const dropped = [];
  const taken = new Set();
  for (const id of pickList(picks)) {
    if (!isPluginId(id)) { dropped.push({ plugin: id, why: 'invalid' }); continue; }
    if (taken.has(id)) { dropped.push({ plugin: id, why: 'duplicate' }); continue; }
    taken.add(id);
    if (!inv.has(id)) { dropped.push({ plugin: id, why: 'uninstalled' }); continue; }
    if (!inv.get(id)) { dropped.push({ plugin: id, why: 'disabled' }); continue; }
    if (cards.length >= n) { dropped.push({ plugin: id, why: 'overflow' }); continue; }
    cards.push({ plugin: id, mode: 'pinned', rank: cards.length + 1, score: scores.get(id) ?? 0 });
  }
  const free = [...inv.entries()].filter(([id, on]) => on && !taken.has(id)).map(([id]) => id).sort(byRank(scores));
  for (const id of free) {
    if (cards.length >= n) break;
    cards.push({ plugin: id, mode: 'auto', rank: cards.length + 1, score: scores.get(id) ?? 0 });
  }
  return { $axf: CARDS_FRAME, at: stamp, slots: n, cards, dropped, short: Math.max(0, n - cards.length) };
}

/** The plugin ids on Home, in order. */
export const cardIds = (cards) => (isObj(cards) && Array.isArray(cards.cards) ? cards.cards.map((c) => c.plugin) : []);

/** Errors in a home-cards@1 doc (empty = valid). */
export function cardsErrors(doc, path = 'cards') {
  const e = [];
  if (!isObj(doc)) return [`${path} must be an object`];
  if (doc.$axf !== CARDS_FRAME) e.push(`${path}.$axf must be ${CARDS_FRAME}`);
  if (!isIso(doc.at)) e.push(`${path}.at must be an ISO date-time`);
  if (!(Number.isInteger(doc.slots) && doc.slots >= SLOTS.min && doc.slots <= SLOTS.max)) e.push(`${path}.slots must be an integer ${SLOTS.min}–${SLOTS.max}`);
  if (!Array.isArray(doc.cards)) e.push(`${path}.cards must be a list`);
  else {
    if (Number.isInteger(doc.slots) && doc.cards.length > doc.slots) e.push(`${path}.cards holds more than ${doc.slots} slots`);
    const seen = new Set();
    doc.cards.forEach((c, i) => {
      const p = `${path}.cards[${i}]`;
      if (!isObj(c)) { e.push(`${p} must be an object`); return; }
      if (!isPluginId(c.plugin)) e.push(`${p}.plugin must be a plugin id`);
      else if (seen.has(c.plugin)) e.push(`${p}.plugin repeats ${c.plugin}`);
      seen.add(c.plugin);
      if (!MODES.includes(c.mode)) e.push(`${p}.mode must be one of ${MODES.join(', ')}`);
      if (c.rank !== i + 1) e.push(`${p}.rank must be ${i + 1}`);
      if (!(Number.isFinite(c.score) && c.score >= 0)) e.push(`${p}.score must be a number ≥ 0`);
    });
    if (Number.isInteger(doc.slots) && Number.isInteger(doc.short) && doc.cards.length + doc.short !== doc.slots) e.push(`${path}.short must be slots − cards (${doc.slots - doc.cards.length})`);
  }
  if (!Array.isArray(doc.dropped)) e.push(`${path}.dropped must be a list`);
  else doc.dropped.forEach((d, i) => { if (!isObj(d) || typeof d.plugin !== 'string' || !DROP_REASONS.includes(d.why)) e.push(`${path}.dropped[${i}] must be { plugin, why: ${DROP_REASONS.join(' | ')} }`); });
  if (!(Number.isInteger(doc.short) && doc.short >= 0)) e.push(`${path}.short must be an integer ≥ 0`);
  return e;
}

/* ================================================================== JSON Schemas */

const $schema = 'https://json-schema.org/draft/2020-12/schema';
const $id = (f) => `https://amberx.ai/axf/schemas/${f}`;
const idProp = { type: 'string', pattern: ID_PATTERN };
const slotProp = { type: 'integer', minimum: SLOTS.min, maximum: SLOTS.max };
const countProp = { type: 'integer', minimum: 0, maximum: COUNT_MAX };
const dayProp = { type: 'number', minimum: WINDOW.minDays, maximum: WINDOW.maxDays };

/** JSON Schemas for framework/schemas/json (spec/check-home-cards.mjs --write regenerates them). */
export function jsonSchemas() {
  return {
    'home-picks.schema.json': {
      $schema, $id: $id('home-picks.schema.json'), title: `${PICKS_FRAME} (${SCHEMA})`, type: 'object', required: ['$axf', 'slots', 'plugins'], additionalProperties: true,
      properties: {
        $axf: { const: PICKS_FRAME },
        slots: slotProp,
        plugins: { type: 'array', maxItems: PICKS_MAX, items: idProp },
        at: { type: 'string', format: 'date-time' },
        updatedBy: { type: 'string', maxLength: 80 },
      },
    },
    'home-cards.schema.json': {
      $schema, $id: $id('home-cards.schema.json'), title: `${CARDS_FRAME} (${SCHEMA})`, type: 'object', required: ['$axf', 'at', 'slots', 'cards', 'dropped', 'short'], additionalProperties: true,
      properties: {
        $axf: { const: CARDS_FRAME },
        at: { type: 'string', format: 'date-time' },
        slots: slotProp,
        cards: {
          type: 'array', maxItems: SLOTS.max,
          items: { type: 'object', additionalProperties: false, required: ['plugin', 'mode', 'rank', 'score'], properties: { plugin: idProp, mode: { enum: [...MODES] }, rank: slotProp, score: { type: 'number', minimum: 0 } } },
        },
        dropped: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['plugin', 'why'], properties: { plugin: { type: 'string', maxLength: 80 }, why: { enum: [...DROP_REASONS] } } } },
        short: { type: 'integer', minimum: 0, maximum: SLOTS.max },
      },
    },
    'plugin-activity.schema.json': {
      $schema, $id: $id('plugin-activity.schema.json'), title: `${ACTIVITY_FRAME} (${SCHEMA})`, type: 'object', required: ['$axf', 'plugin', 'at', 'window', 'counts', 'score'], additionalProperties: false,
      properties: {
        $axf: { const: ACTIVITY_FRAME },
        plugin: idProp,
        at: { type: 'string', format: 'date-time' },
        window: { type: 'object', additionalProperties: false, required: ['days', 'halfLifeDays'], properties: { days: dayProp, halfLifeDays: dayProp } },
        counts: { type: 'object', additionalProperties: false, required: [...EVENT_KINDS], properties: Object.fromEntries(EVENT_KINDS.map((k) => [k, countProp])) },
        score: { type: 'number', minimum: 0 },
      },
      $defs: {
        event: {
          title: `${EVENT_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['plugin', 'kind', 'at'],
          properties: { $axf: { const: EVENT_FRAME }, plugin: idProp, kind: { enum: [...EVENT_KINDS] }, at: { type: 'string', format: 'date-time' }, n: { type: 'integer', minimum: 1, maximum: COUNT_MAX } },
        },
      },
    },
  };
}
