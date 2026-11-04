/**
 * Build optimizer core (build-optimize@1). Pure: no fs, no DOM, no AI. Shared by the Optimize builds dialog, the CLI
 * (../optimizer.mjs), the server part and the tests. Built on the packager core (build-package@1, ./packager-core.mjs):
 * the same waiting-step candidates, estimates, areas and dependency rules, so "combine steps into a build" is written
 * once for both.
 *
 * Brett, Nov 4 2026 (voice): an Optimize builds button takes every waiting step and repacks them into the fewest builds,
 * moving the steps over and combining builds; a dialog lists the new package of builds (each with all of its steps) to
 * confirm. Addendum 2/3: the planner is plain deterministic code (Basic mode, zero tokens, the fallback); Deep mode (AI)
 * only refines it (names, moves, drops, reasoning), and every AI suggestion goes back through validate() here.
 *
 * Plan shape: { $axf, mode, at, packs: [{ id, name, category, model, thinking, minutes, keys, why, after: [pack ids],
 * areas, sources }], left: [keys not packed], flags: { key: { kind, ref, why } }, summary, warnings, settings, filter }.
 */
import * as P from './packager-core.mjs';

export const SCHEMA = 'build-optimize@1';
export const MODES = ['auto', 'deep', 'basic'];
export const TARGETS = ['fewest', 'balanced', 'fastest'];
export const NOTIFY = ['no-ai', 'every', 'off'];
export const SCHEDULES = ['manual', 'after-new', 'nightly'];
export const EMPTIED = ['archive', 'delete'];
export const DROPS = ['flag', 'untick'];
export const CATEGORY_RULES = ['common', 'first', 'fixed'];
export const RULES = ['area', 'chain', 'category', 'app', 'profile', 'modelSplit', 'urgentApart'];
export const RULE_LABEL = { area: 'By area / claims', chain: 'By dependency chain', category: 'By category', app: 'By app / plugin', profile: 'By build profile', modelSplit: 'Keep Fable and Opus separate', urgentApart: 'Keep urgent apart' };
export const STATUS_SCOPE = ['pending', 'waiting', 'running', 'plan-ready'];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'auto', aiModel: 'Opus', aiThinking: 'high', tokenBudget: 60000, agent: 'Patches',
  maxSteps: 8, maxMinutes: 240, maxBuilds: 0, target: 'fewest', slots: 3, overheadMin: 20,
  rules: { area: { on: true, weight: 3 }, chain: { on: true, weight: 5 }, category: { on: true, weight: 1 }, app: { on: true, weight: 2 }, profile: { on: true, weight: 4 }, modelSplit: { on: true, weight: 0 }, urgentApart: { on: true, weight: 0 } },
  safety: { neverTouchRunning: true, respectPins: true, pullFromRunning: true, emptied: 'archive', requireConfirm: true },
  drops: 'flag', naming: '{area} · {category} pack {n}', categoryRule: 'common', fixedCategory: 'Optimized',
  schedule: 'manual', notify: 'no-ai', pins: [],
});
/** Settings that can never be switched off (Brett: running builds are never touched; Deep always asks first). */
export const LOCKED = ['safety.neverTouchRunning', 'safety.requireConfirm'];
export const DEFAULT_FILTER = Object.freeze({ profiles: [], categories: [], models: [], thinking: [], agents: [], statuses: [], areas: [], tags: [], minAgeDays: 0, maxAgeDays: 0, fableCandidates: false, include: [], exclude: [], q: '' });
export const PRESETS = Object.freeze({
  safe: { label: 'Safe', settings: { maxSteps: 6, maxMinutes: 180, target: 'balanced', safety: { pullFromRunning: false }, drops: 'flag' } },
  aggressive: { label: 'Aggressive', settings: { maxSteps: 12, maxMinutes: 360, target: 'fewest', rules: { category: { on: false }, app: { on: false } }, drops: 'untick' } },
  'fable-only': { label: 'Fable only', settings: {}, filter: { models: ['Fable'] } },
});

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);
const THINK_RANK = Object.fromEntries(P.THINKING.map((t, i) => [t, i]));

/** Settings with every value checked and the locked ones forced on. */
export function normSettings(s = {}) {
  const d = DEFAULT_SETTINGS; const o = s && typeof s === 'object' ? s : {};
  const rules = {};
  for (const r of RULES) rules[r] = { on: o.rules?.[r]?.on === undefined ? d.rules[r].on : o.rules[r].on === true, weight: num(o.rules?.[r]?.weight, d.rules[r].weight, 0, 10) };
  return {
    mode: pick(o.mode, MODES, d.mode), aiModel: pick(o.aiModel, P.MODELS, d.aiModel), aiThinking: pick(o.aiThinking, P.THINKING, d.aiThinking),
    tokenBudget: num(o.tokenBudget, d.tokenBudget, 0, 2_000_000), agent: str(o.agent, 60) || d.agent,
    maxSteps: num(o.maxSteps, d.maxSteps, 1, 40), maxMinutes: num(o.maxMinutes, d.maxMinutes, 15, 2400), maxBuilds: num(o.maxBuilds, d.maxBuilds, 0, 200),
    target: pick(o.target, TARGETS, d.target), slots: num(o.slots, d.slots, 1, 20), overheadMin: num(o.overheadMin, d.overheadMin, 0, 240),
    rules,
    safety: { neverTouchRunning: true, respectPins: o.safety?.respectPins !== false, pullFromRunning: o.safety?.pullFromRunning !== false, emptied: pick(o.safety?.emptied, EMPTIED, 'archive'), requireConfirm: true },
    drops: pick(o.drops, DROPS, d.drops), naming: str(o.naming, 120) || d.naming, categoryRule: pick(o.categoryRule, CATEGORY_RULES, d.categoryRule), fixedCategory: str(o.fixedCategory, 60) || d.fixedCategory,
    schedule: pick(o.schedule, SCHEDULES, d.schedule), notify: pick(o.notify, NOTIFY, d.notify), pins: [...new Set(arr(o.pins).map((x) => str(x, 80)).filter(Boolean))],
  };
}
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b ?? {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a?.[k] ?? {}, v) : v; return o; };
/** Base settings with a preset (or saved profile) laid over them. */
export function withPreset(settings, preset) { return normSettings(merge(normSettings(settings), preset?.settings ?? {})); }
export function normFilter(f = {}) {
  const o = f && typeof f === 'object' ? f : {}; const d = DEFAULT_FILTER; const list = (k) => [...new Set(arr(o[k]).map((x) => str(x, 120)).filter(Boolean))];
  return { profiles: list('profiles'), categories: list('categories'), models: list('models').filter((m) => P.MODELS.includes(m)), thinking: list('thinking').filter((t) => P.THINKING.includes(t)), agents: list('agents'),
    statuses: list('statuses').filter((x) => STATUS_SCOPE.includes(x)), areas: list('areas'), tags: list('tags'), minAgeDays: num(o.minAgeDays, d.minAgeDays, 0, 3650), maxAgeDays: num(o.maxAgeDays, d.maxAgeDays, 0, 3650),
    fableCandidates: o.fableCandidates === true, include: list('include'), exclude: list('exclude'), q: str(o.q, 200) };
}

// ---------------------------------------------------------------- scope

const urgent = (c) => c.profiles.includes('urgent') || /urgent/i.test(c.category);
const appOf = (c) => c.areas.find((a) => a.startsWith('plugin:') || a.startsWith('app:')) || '';
const thinkingOf = (c) => c.thinking || P.DEFAULT_THINKING[c.recommendedModel || c.model];

/**
 * The waiting steps a run may repack: the packager's candidates (never the step a running build is on, never a step
 * packaged or with a helper) minus pinned builds, running builds when pulling from them is off, and the filter.
 * `builds` are builds@1 records. Returns { items, out: [{ key, why }], inProgress }.
 */
export function scope(builds, { plans = [], profileOrder = {}, settings = {}, filter = {}, now = new Date().toISOString() } = {}) {
  const st = normSettings(settings); const f = normFilter(filter);
  const byId = new Map(arr(builds).map((b) => [b.id, b]));
  const { candidates, skipped } = P.candidates(builds, { plans, profileOrder });
  const items = []; const out = [];
  const age = (b) => (b?.createdAt ? (Date.parse(now) - Date.parse(b.createdAt)) / 86400000 : 0);
  for (const c0 of candidates) {
    const b = byId.get(c0.build);
    const c = { ...c0, agent: str(b?.agent ?? b?.assignee ?? b?.origin?.by, 80), tags: arr(b?.tags), createdAt: str(b?.createdAt, 40), app: '' };
    c.app = appOf(c);
    const why = (() => {
      if (st.safety.respectPins && (b?.pinned === true || st.pins.includes(c.build) || b?.steps?.find((x) => (x.uid || x.id) === (c.uid || c.step))?.pinned === true)) return 'pinned';
      if (c.buildStatus === 'running' && !st.safety.pullFromRunning) return 'in a running build';
      if (f.include.length && !f.include.includes(c.build)) return 'not included';
      if (f.exclude.includes(c.build)) return 'excluded';
      if (f.profiles.length && !c.profiles.some((p) => f.profiles.includes(p))) return 'other profile';
      if (f.categories.length && !f.categories.includes(c.category)) return 'other category';
      if (f.models.length && !f.models.includes(c.model) && !f.models.includes(c.recommendedModel)) return 'other model';
      if (f.fableCandidates && c.model !== 'Fable' && c.recommendedModel !== 'Fable') return 'not a Fable candidate';
      if (f.thinking.length && !f.thinking.includes(thinkingOf(c))) return 'other thinking level';
      if (f.agents.length && !f.agents.includes(c.agent)) return 'other agent';
      if (f.statuses.length && !f.statuses.includes(c.buildStatus)) return 'other status';
      if (f.areas.length && !c.areas.some((a) => f.areas.some((x) => a === x || a.includes(x)))) return 'other area';
      if (f.tags.length && !c.tags.some((t) => f.tags.includes(t))) return 'no matching tag';
      if (f.minAgeDays && age(b) < f.minAgeDays) return 'too new';
      if (f.maxAgeDays && age(b) > f.maxAgeDays) return 'too old';
      const q = f.q.trim().toLowerCase();
      if (q && !`${c.text} ${c.buildTitle} ${c.build} ${c.category}`.toLowerCase().includes(q)) return 'no match';
      return '';
    })();
    if (why) out.push({ key: c.key, build: c.build, why }); else items.push(c);
  }
  return { items, out, inProgress: skipped.inProgress };
}

/** Filter choices with counts, for the filter bar and the button's dropdown. */
export function facets(items) {
  const count = (fn) => { const m = new Map(); for (const c of items) for (const v of fn(c)) if (v) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n })); };
  return { profiles: count((c) => c.profiles), categories: count((c) => [c.category]), models: count((c) => [...new Set([c.model, c.recommendedModel])]), thinking: count((c) => [thinkingOf(c)]),
    agents: count((c) => [c.agent]), statuses: count((c) => [c.buildStatus]), areas: count((c) => c.areas), tags: count((c) => c.tags), builds: count((c) => [c.build]) };
}

// ---------------------------------------------------------------- duplicates and already-built work (zero tokens)

const STOP = new Set('a an and the of to in on for with from into by is be it its this that as or at add make use new every all each one their them so via plus not'.split(' '));
/** Words every wrap-up step has (tests, shots, report, PR): a step made only of these is never flagged. */
const ROUTINE = new Set('typecheck tests test checks screenshots shots phone desktop review item report threads readme docs merge queue green pr'.split(' '));
export function words(t) { return new Set(str(t, 2000).toLowerCase().replace(/[^a-z0-9@.\-/ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))); }
export function similarity(a, b) { const A = words(a); const B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n += 1; return n / (A.size + B.size - n); }

/**
 * Steps that look like another waiting step (duplicate) or like a step already done in a built / complete build
 * (already built). Jaccard on the words, `min` = how alike (0.7 by default). Returns { key: { kind, ref, why, score } }.
 */
export function findDuplicates(items, builds, { min = 0.7 } = {}) {
  const flags = {};
  const jac = (A, B) => { if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n += 1; return n / (A.size + B.size - n); };
  const done = [];
  for (const b of arr(builds)) if (!b.deleted && ['built', 'complete'].includes(b.status)) for (const s of arr(b.steps)) if (s.done) { const W = words(s.title || s.text); if (W.size >= 3) done.push({ ref: `${b.id} ${s.id}`, W, pr: b.pr }); }
  const list = arr(items).map((c) => ({ c, W: words(c.text) }));
  // an inverted index keeps it fast on hundreds of steps: only texts that share a word are compared
  const index = new Map(); done.forEach((d, i) => { for (const w of d.W) { if (!index.has(w)) index.set(w, []); index.get(w).push(i); } });
  list.forEach(({ c, W }, i) => {
    if (W.size < 3 || [...W].filter((w) => !ROUTINE.has(w)).length < 2) return;
    const seen = new Set(); const hits = new Set(); let best = null;
    for (const w of W) for (const j of index.get(w) ?? []) {
      if (seen.has(j)) continue; seen.add(j);
      const d = done[j]; const sc = jac(W, d.W);
      if (sc >= min) { hits.add(d.ref.split(' ')[0]); if (!best || sc > best.sc) best = { d, sc }; }
    }
    // a step that looks like done steps in many builds is a routine wrap-up (tests, shots, report, PR), not built work
    if (best && hits.size < 3) flags[c.key] = { kind: 'built', ref: best.d.ref, why: `looks already built: ${best.d.ref}${best.d.pr ? ` (${best.d.pr})` : ''}`, score: Math.round(best.sc * 100) / 100 };
    if (flags[c.key]) return;
    for (let j = 0; j < i; j++) {
      const o = list[j]; if (o.c.build === c.build || o.W.size < 3) continue;
      const sc = jac(W, o.W);
      if (sc >= min && sc > (flags[c.key]?.score ?? 0)) flags[c.key] = { kind: 'duplicate', ref: o.c.key, why: `looks like ${o.c.build} ${o.c.step}`, score: Math.round(sc * 100) / 100 };
    }
  });
  return flags;
}

// ---------------------------------------------------------------- the planner (Basic mode)

/**
 * Steps of one source are a chain (they run in order): a unit is a source's in-scope steps. A source is never split
 * just to fit the caps (that would make more builds, not fewer): the caps only limit what gets combined. With the
 * chain rule off every step is its own unit (the dependencies still order them).
 */
function unitsOf(items, st) {
  const bySrc = new Map();
  for (const c of items) { if (!bySrc.has(c.build)) bySrc.set(c.build, []); bySrc.get(c.build).push(c); }
  const units = [];
  for (const [build, list] of bySrc) {
    list.sort((a, b) => a.index - b.index);
    const chunks = st.rules.chain.on ? [list] : list.map((c) => [c]);
    chunks.forEach((ch, i) => units.push(group(`${build}#${i}`, ch)));
  }
  return units;
}
/** A group of steps with what affinity() needs precomputed. */
function group(id, items) {
  return { id, items, minutes: items.reduce((t, c) => t + c.minutes, 0), order: Math.min(...items.map((c) => c.order)),
    areas: new Set(items.flatMap((c) => c.areas)), apps: new Set(items.map((c) => c.app).filter(Boolean)), cats: new Set(items.map((c) => c.category).filter(Boolean)),
    keys: new Set(items.map((c) => c.key)), needs: new Set(items.flatMap((c) => c.after)), builds: new Set(items.map((c) => c.build)) };
}

/** Hard partition key: units with different keys never share a build. A source with both models stays whole (Mixed). */
function partitionOf(u, st) {
  const c = u.items[0]; const k = [];
  if (st.rules.modelSplit.on) { const m = new Set(u.items.map((x) => x.model)); k.push(m.size > 1 ? `mixed:${u.id}` : [...m][0]); }
  if (st.rules.profile.on) k.push(c.profiles.slice().sort().join('+') || 'plans');
  if (st.rules.urgentApart.on) k.push(urgent(c) ? 'urgent' : 'normal');
  return k.join('|');
}

const meets = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
/** How much two groups belong together (higher = sooner merged). */
function affinity(a, b, st) {
  const r = st.rules; let s = 0;
  if (r.area.on) for (const x of a.areas) if (b.areas.has(x)) s += r.area.weight;
  if (r.app.on && meets(a.apps, b.apps)) s += r.app.weight;
  if (r.category.on && meets(a.cats, b.cats)) s += r.category.weight;
  if (r.chain.on && (meets(a.needs, b.keys) || meets(b.needs, a.keys))) s += r.chain.weight;
  if (meets(a.builds, b.builds)) s += r.chain.weight + 1; // steps of one source (chain rule off) belong together
  return s;
}
const fits = (a, b, st) => a.items.length + b.items.length <= st.maxSteps && a.minutes + b.minutes <= st.maxMinutes;
const join = (a, b) => group(a.id, [...a.items, ...b.items]);

/** Group the units of one partition: related ones first (affinity), then, for "fewest", unrelated ones into what fits. */
function groupPartition(units, st) {
  let groups = units.slice().sort((a, b) => a.order - b.order);
  // 1. related groups merge, best pair first (deterministic: ties go to the earlier pair in queue order)
  const score = new Map();
  const key = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  for (;;) {
    let best = null;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      if (!fits(groups[i], groups[j], st)) continue;
      const k = key(groups[i], groups[j]);
      let sc = score.get(k); if (sc === undefined) { sc = affinity(groups[i], groups[j], st); score.set(k, sc); }
      if (sc > 0 && (!best || sc > best.s)) best = { i, j, s: sc };
    }
    if (!best) break;
    const m = { ...join(groups[best.i], groups[best.j]), id: `${groups[best.i].id}+${groups[best.j].id}` };
    groups = groups.filter((_, k) => k !== best.i && k !== best.j).concat(m).sort((a, b) => a.order - b.order);
  }
  if (st.target === 'fastest') return groups; // unrelated work stays apart, so it can run side by side
  // 2. fewest: first-fit decreasing of the rest into what fits; balanced: the same number of builds, evened out
  const sorted = groups.slice().sort((a, b) => b.minutes - a.minutes || b.items.length - a.items.length || a.order - b.order);
  const bins = [];
  for (const g of sorted) { const i = bins.findIndex((x) => fits(x, g, st)); if (i >= 0) bins[i] = { ...join(bins[i], g), id: `${bins[i].id}+${g.id}` }; else bins.push(g); }
  if (st.target === 'balanced' && bins.length > 1) {
    const n = Math.max(bins.length, Math.min(st.slots, sorted.length));
    const even = [];
    for (const g of sorted) {
      let k = -1;
      for (let i = 0; i < n; i++) if (!even[i] || fits(even[i], g, st)) { if (k < 0 || (even[i]?.minutes ?? 0) < (even[k]?.minutes ?? 0)) k = i; }
      if (k < 0) even.push(g); else even[k] = even[k] ? { ...join(even[k], g), id: `${even[k].id}+${g.id}` } : g;
    }
    return even.filter(Boolean).sort((a, b) => a.order - b.order);
  }
  return bins.sort((a, b) => a.order - b.order);
}

/** Order inside a build: queue order of the sources, a source's steps in their order, `after` deps first. */
function orderItems(items) {
  const keys = new Set(items.map((c) => c.key));
  const sorted = items.slice().sort((a, b) => a.order - b.order || a.build.localeCompare(b.build) || a.index - b.index);
  const out = []; const seen = new Set();
  const visit = (c, path = new Set()) => {
    if (seen.has(c.key) || path.has(c.key)) return; path.add(c.key);
    const pre = [...c.before.map((n) => (typeof n === 'string' ? n : n.key)), ...c.after].filter((k) => keys.has(k));
    for (const k of pre) visit(items.find((x) => x.key === k), path);
    seen.add(c.key); out.push(c);
  };
  for (const c of sorted) visit(c);
  return out;
}

const shortArea = (a) => a.replace(/^(plugin|app|framework):/, '');
function mostCommon(list) { const m = new Map(); for (const v of list) if (v) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''; }

/** Name from the template: {area} {category} {model} {n} {steps} {builds}. */
export function packName(template, items, n) {
  const segs = (c) => str(c.category, 60).split('>').map((x) => x.trim()).filter(Boolean);
  const area = shortArea(mostCommon(items.flatMap((c) => c.areas))) || shortArea(mostCommon(items.map((c) => c.app))) || mostCommon(items.map((c) => segs(c)[0])) || 'Builds';
  const cats = [...new Set(items.map((c) => segs(c).slice(-1)[0]).filter((x) => x && x !== area))];
  const category = cats.length === 1 ? cats[0] : cats.length ? (cats.length <= 2 ? cats.join(' + ') : 'Mixed') : 'General';
  const models = [...new Set(items.map((c) => c.model))];
  return str(template || DEFAULT_SETTINGS.naming, 200).replace(/\{area\}/g, area).replace(/\{category\}/g, category).replace(/\{model\}/g, models.length === 1 ? models[0] : 'Mixed')
    .replace(/\{n\}/g, String(n)).replace(/\{steps\}/g, String(items.length)).replace(/\{builds\}/g, String(new Set(items.map((c) => c.build)).size)).trim() || `Pack ${n}`;
}
function packCategory(items, st) {
  if (st.categoryRule === 'fixed') return st.fixedCategory;
  if (st.categoryRule === 'first') return items[0]?.category || st.fixedCategory;
  return mostCommon(items.map((c) => c.category)) || st.fixedCategory;
}

/** Describe a pack from its ordered keys (model, thinking, minutes, areas, sources, why). */
export function describePack(keys, byKey, { id, name, category, n = 1, settings, why = '' } = {}) {
  const st = normSettings(settings);
  const items = orderItems(arr(keys).map((k) => byKey.get(k)).filter(Boolean));
  const models = [...new Set(items.map((c) => c.model))];
  const thinking = items.map(thinkingOf).sort((a, b) => (THINK_RANK[b] ?? 0) - (THINK_RANK[a] ?? 0))[0] || 'medium';
  const sources = [...new Set(items.map((c) => c.build))];
  const areas = [...new Set(items.flatMap((c) => c.areas))].sort();
  return {
    id: id || `pack-${n}`, name: str(name, 200) || packName(st.naming, items, n), category: str(category, 60) || packCategory(items, st),
    model: models.length === 1 ? models[0] : 'Mixed', thinking, minutes: items.reduce((t, c) => t + c.minutes, 0), keys: items.map((c) => c.key),
    sources, areas, why: why || (sources.length > 1 ? `${sources.length} builds that share ${areas.length ? areas.map(shortArea).slice(0, 3).join(', ') : 'a category'}` : `${sources[0] ?? ''} on its own`), after: [],
  };
}

/**
 * The order packs must run in: a source split over packs runs its earlier part first; an `after` dep's pack goes
 * first; packs that claim the same area run one after the other (different areas can run side by side). Fills each
 * pack's `after` (ids) and returns the packs sorted. Cycles are broken by queue order and reported.
 */
export function orderPacks(packs, byKey) {
  const packOf = new Map(); packs.forEach((p) => p.keys.forEach((k) => packOf.set(k, p.id)));
  const edges = new Map(packs.map((p) => [p.id, new Set()])); // id → ids it must come after
  const why = new Map();
  for (const p of packs) for (const k of p.keys) {
    const c = byKey.get(k); if (!c) continue;
    for (const pre of [...c.before.map((n) => (typeof n === 'string' ? n : n.key)), ...c.after]) {
      const q = packOf.get(pre); if (q && q !== p.id) { edges.get(p.id).add(q); why.set(`${p.id}<${q}`, `${c.build} ${c.step} needs ${pre.split('/').pop()} first`); }
    }
  }
  const rank = new Map(packs.map((p, i) => [p.id, Math.min(...p.keys.map((k) => byKey.get(k)?.order ?? 1e6), 1e6) * 1000 + i]));
  const out = []; const done = new Set(); const warnings = [];
  const left = new Set(packs.map((p) => p.id));
  while (left.size) {
    const ready = [...left].filter((id) => [...edges.get(id)].every((q) => done.has(q))).sort((a, b) => rank.get(a) - rank.get(b));
    const next = ready[0] ?? [...left].sort((a, b) => rank.get(a) - rank.get(b))[0];
    if (!ready.length) warnings.push(`${next}: its steps and another pack's need each other (a cycle); it goes first by queue order`);
    left.delete(next); done.add(next); out.push(packs.find((p) => p.id === next));
  }
  // same-area packs never run side by side: each one waits for the previous pack that claims one of its areas
  const seenArea = new Map();
  for (const p of out) {
    for (const a of p.areas) { const q = seenArea.get(a); if (q && q !== p.id) { edges.get(p.id).add(q); if (!why.has(`${p.id}<${q}`)) why.set(`${p.id}<${q}`, `both touch ${shortArea(a)}`); } }
    for (const a of p.areas) seenArea.set(a, p.id);
  }
  for (const p of out) p.after = [...edges.get(p.id)].map((q) => ({ id: q, why: why.get(`${p.id}<${q}`) ?? '' }));
  return { packs: out, warnings };
}

/** Estimated time and cost saved: one build's overhead (session start, PR, CI, shots) for every build fewer. */
export function savings(fromBuilds, toBuilds, st, pricing) {
  const fewer = Math.max(0, fromBuilds - toBuilds); const minutes = fewer * st.overheadMin;
  const m = pricing?.models?.opus; const t = pricing?.heuristic?.tokensPerMinute;
  const perMin = m && t ? ((t.input * m.input + t.output * m.output + t.cacheRead * m.cacheRead + (t.cacheWrite ?? 0) * m.cacheWrite) / 1e6) : 0;
  return { fewer, minutes, usd: Math.round(minutes * perMin * 100) / 100 };
}

/**
 * Basic mode: the whole plan from scoped items, plain code. opts: { settings, builds (for duplicate checks and the
 * summary), pricing, now, mode }. Never touches running steps (they are not candidates) or pinned builds (scope()).
 */
export function plan(items, opts = {}) {
  const st = normSettings(opts.settings); const at = opts.now || new Date().toISOString();
  const byKey = new Map(arr(items).map((c) => [c.key, c]));
  const flags = findDuplicates(items, opts.builds ?? []);
  const units = unitsOf(arr(items), st);
  const parts = new Map();
  for (const u of units) { const k = partitionOf(u, st); if (!parts.has(k)) parts.set(k, []); parts.get(k).push(u); }
  const all = [...parts.values()].flatMap((us) => groupPartition(us, st));
  // a group of one build's own steps is that build already: it stays as it is (no new build for nothing)
  const groups = all.filter((g) => g.builds.size > 1);
  const stays = [...new Set(all.filter((g) => g.builds.size === 1).flatMap((g) => [...g.builds]))];
  let packs = groups.map((g, i) => describePack(g.items.map((c) => c.key), byKey, { n: i + 1, settings: st }));
  const ord = orderPacks(packs, byKey);
  packs = ord.packs.map((p, i) => ({ ...p, id: `pack-${i + 1}`, name: p.name.replace(/\bpack \d+\b/, `pack ${i + 1}`), _old: p.id }));
  const ren = new Map(packs.map((p) => [p._old, p.id]));
  packs = packs.map(({ _old, ...p }) => ({ ...p, after: p.after.map((a) => ({ ...a, id: ren.get(a.id) ?? a.id })) }));
  const unticked = st.drops === 'untick' ? Object.keys(flags) : [];
  return finish({ $axf: SCHEMA, mode: 'basic', at, packs, stays, unticked, flags, settings: st, warnings: ord.warnings }, items, opts);
}

/** Summary and checks for a plan (after the planner, after Deep mode, after every edit in the dialog). */
export function finish(pl, items, opts = {}) {
  const st = normSettings(pl.settings ?? opts.settings);
  const byKey = new Map(arr(items).map((c) => [c.key, c]));
  const unt = new Set(arr(pl.unticked));
  const packs = arr(pl.packs).map((p) => ({ ...p, keys: p.keys.filter((k) => byKey.has(k) && !unt.has(k)) })).filter((p) => p.keys.length);
  const packed = new Set(packs.flatMap((p) => p.keys));
  const sources = [...new Set(arr(items).map((c) => c.build))];
  // every open step of each source (kept on the plan, so the dialog's edits recount without the store)
  const open = { ...(pl.open ?? {}) };
  for (const b of arr(opts.builds)) if (sources.includes(b.id)) open[b.id] = arr(b.steps).filter((s) => !s.done && !s.skip && !s.packagedInto && !s.assignedTo && !s.withHelper).map((s) => `${b.id}/${s.uid || s.id}`);
  // a source is emptied when every open step it has is in a pack now (a running build never is: its current step stays)
  const emptied = sources.filter((id) => !id.startsWith('plan:') && (open[id] ?? []).length > 0 && open[id].every((k) => packed.has(k)));
  const kept = sources.filter((id) => !emptied.includes(id));
  const touched = new Set(packs.flatMap((p) => p.keys.map((k) => byKey.get(k).build)));
  const from = [...touched].filter((id) => !id.startsWith('plan:')).length;
  const to = packs.length + kept.filter((id) => touched.has(id) && !id.startsWith('plan:')).length;
  const save = savings(from, to, st, opts.pricing);
  const warnings = [...new Set([...arr(pl.warnings), ...validate({ ...pl, packs }, items, st)])];
  const summary = { from, to, packs: packs.length, steps: packed.size, emptied, partial: kept.filter((id) => touched.has(id)), left: arr(items).filter((c) => !packed.has(c.key)).length, minutes: packs.reduce((t, p) => t + p.minutes, 0), saved: save,
    line: `${from} build${from === 1 ? '' : 's'} become ${packs.length}${kept.some((id) => touched.has(id)) ? ` (+${kept.filter((id) => touched.has(id)).length} keep their other steps)` : ''}` };
  return { ...pl, open, packs: packs.map((p) => ({ ...p, ...describePack(p.keys, byKey, { id: p.id, name: p.name, category: p.category, settings: st, why: p.why }), after: p.after ?? [], ...(p.ai ? { ai: p.ai } : {}) })), summary, warnings, settings: st };
}

/**
 * Checks on a plan, whatever made it (planner, AI, Brett's drags): caps, Fable and Opus apart when the rule is on,
 * a step moved before the steps it needs, keys that are not waiting steps. Returns plain-language warnings.
 */
export function validate(pl, items, settings) {
  const st = normSettings(settings); const byKey = new Map(arr(items).map((c) => [c.key, c]));
  const w = []; const packOf = new Map(); const pos = new Map();
  arr(pl.packs).forEach((p, pi) => p.keys.forEach((k, i) => { if (packOf.has(k)) w.push(`${k} is in two builds`); packOf.set(k, pi); pos.set(k, i); }));
  arr(pl.packs).forEach((p, pi) => {
    const items_ = p.keys.map((k) => byKey.get(k)).filter(Boolean);
    const unknown = p.keys.filter((k) => !byKey.has(k)); if (unknown.length) w.push(`${p.name || p.id}: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not waiting any more (running, built or taken)`);
    if (items_.length > st.maxSteps) w.push(`${p.name || p.id}: ${items_.length} steps, over the ${st.maxSteps}-step cap`);
    const m = items_.reduce((t, c) => t + c.minutes, 0); if (m > st.maxMinutes) w.push(`${p.name || p.id}: ~${P.fmtMinutes(m)}, over the ${P.fmtMinutes(st.maxMinutes)} cap`);
    if (st.rules.modelSplit.on && new Set(items_.map((c) => c.model)).size > 1 && new Set(items_.filter((c) => c.model === 'Fable').map((c) => c.build)).size + new Set(items_.filter((c) => c.model === 'Opus').map((c) => c.build)).size > new Set(items_.map((c) => c.build)).size) w.push(`${p.name || p.id}: mixes Fable and Opus steps (marked Mixed)`);
    for (const c of items_) for (const pre of [...c.before.map((n) => (typeof n === 'string' ? n : n.key)), ...c.after]) {
      if (!packOf.has(pre)) continue;
      const q = packOf.get(pre);
      if (q === pi && pos.get(pre) > pos.get(c.key)) w.push(`${p.name || p.id}: ${c.build} ${c.step} comes before ${pre.split('/').pop()}, which it needs`);
    }
  });
  if (st.maxBuilds && arr(pl.packs).length > st.maxBuilds) w.push(`${arr(pl.packs).length} builds, over the ${st.maxBuilds}-build cap: raise the caps or narrow the filter`);
  return w;
}

// ---------------------------------------------------------------- edits in the confirm dialog (and the AI's suggestions)

/** Move steps (keys, multi-select) into pack `to` at `index` (drop position = order). New pack: to = '+'. */
export function moveKeys(pl, keys, to, index = null, { items = [], settings } = {}) {
  const ks = arr(keys); const packs = arr(pl.packs).map((p) => ({ ...p, keys: p.keys.filter((k) => !ks.includes(k)) }));
  let target = packs.find((p) => p.id === to);
  if (!target) { let n = packs.length + 1; while (packs.some((p) => p.id === `pack-${n}`)) n += 1; target = { id: `pack-${n}`, name: '', category: '', keys: [], after: [], why: 'made by hand' }; packs.push(target); }
  const at = Number.isInteger(index) ? Math.max(0, Math.min(target.keys.length, index)) : target.keys.length;
  target.keys.splice(at, 0, ...ks);
  return finish({ ...pl, packs: packs.filter((p) => p.keys.length || p === target) }, items, { settings: settings ?? pl.settings });
}
/** Prerequisites a set of moved keys leaves behind in another pack (for "move prerequisites too?"). */
export function missingPrereqs(pl, keys, to, items) {
  const byKey = new Map(arr(items).map((c) => [c.key, c])); const target = arr(pl.packs).find((p) => p.id === to);
  const there = new Set([...(target?.keys ?? []), ...arr(keys)]); const need = [];
  for (const k of arr(keys)) { const c = byKey.get(k); if (!c) continue; for (const pre of [...c.before.map((n) => (typeof n === 'string' ? n : n.key)), ...c.after]) if (byKey.has(pre) && !there.has(pre) && !need.includes(pre)) need.push(pre); }
  return need;
}
export function tick(pl, key, on, items) { const u = new Set(arr(pl.unticked)); if (on) u.delete(key); else u.add(key); return finish({ ...pl, unticked: [...u] }, items, { settings: pl.settings }); }
export function rename(pl, id, name, items) { return finish({ ...pl, packs: arr(pl.packs).map((p) => (p.id === id ? { ...p, name: str(name, 200) } : p)) }, items, { settings: pl.settings }); }

/** What Apply sends: each pack's name, category and ordered keys (unticked keys are left where they are). */
export function applyRequest(pl) {
  const unt = new Set(arr(pl.unticked));
  return { $axf: SCHEMA, mode: pl.mode, packs: arr(pl.packs).map((p, i) => ({ id: p.id, name: p.name, category: p.category, thinking: p.thinking, keys: p.keys.filter((k) => !unt.has(k)), after: arr(p.after).map((a) => a.id), why: p.why, order: i })).filter((p) => p.keys.length), emptied: pl.settings?.safety?.emptied ?? 'archive' };
}

// ---------------------------------------------------------------- Deep mode: the AI's answer, checked by plain code

/** The token estimate shown before a Deep run (evidence characters / 4, plus the answer). */
export function estimateTokens(prompt) { return Math.ceil(str(prompt, 2_000_000).length / 4) + 4000; }

/**
 * Lay an AI review over a Basic plan. The answer is JSON: { packs: [{ id, name?, why?, keys? }], drops: [{ key, why }],
 * moves: [{ key, to, why }], notes: [{ key, why, model?, thinking?, split? }], deps: [{ key, needs, why }] }. Anything
 * that does not check out (an unknown key, a running step, a model upgrade) is ignored and listed in `rejected`.
 * Model and thinking changes are suggestions only (an upgrade needs Brett). Returns the new plan.
 */
export function applyAi(pl, ai, items, opts = {}) {
  const byKey = new Map(arr(items).map((c) => [c.key, c])); const rejected = []; const reasons = {};
  let out = { ...pl, packs: arr(pl.packs).map((p) => ({ ...p, keys: p.keys.slice() })) };
  for (const m of arr(ai?.moves)) {
    if (!byKey.has(m?.key)) { rejected.push(`move ${m?.key}: not a waiting step`); continue; }
    if (!out.packs.some((p) => p.id === m.to) && m.to !== '+') { rejected.push(`move ${m.key}: no pack ${m.to}`); continue; }
    out = { ...out, packs: out.packs.map((p) => ({ ...p, keys: p.keys.filter((k) => k !== m.key) })) };
    const t = out.packs.find((p) => p.id === m.to); if (t) t.keys.push(m.key); else out.packs.push({ id: `pack-${out.packs.length + 1}`, name: '', category: '', keys: [m.key], after: [], why: str(m.why, 300) });
    reasons[m.key] = { kind: 'moved', why: str(m.why, 300) || 'moved by the review' };
  }
  const deps = []; // hidden dependencies the review found: the step goes into its prerequisite's pack, after it
  for (const d of arr(ai?.deps)) {
    if (!byKey.has(d?.key) || !byKey.has(d?.needs)) { rejected.push(`dep ${d?.key} → ${d?.needs}: not waiting steps`); continue; }
    const c = byKey.get(d.key); if (!c.after.includes(d.needs)) byKey.set(d.key, { ...c, after: [...c.after, d.needs] });
    deps.push({ key: d.key, needs: d.needs, why: str(d.why, 300) });
    reasons[d.key] = { kind: 'dependency', why: `needs ${d.needs}: ${str(d.why, 260)}` };
  }
  const unt = new Set(arr(out.unticked)); const flags = { ...(out.flags ?? {}) };
  for (const d of arr(ai?.drops)) {
    if (!byKey.has(d?.key)) { rejected.push(`drop ${d?.key}: not a waiting step`); continue; }
    flags[d.key] = { kind: d.kind === 'duplicate' ? 'duplicate' : 'built', ref: str(d.ref, 120), why: str(d.why, 300) || 'already built or duplicate (review)', score: 1, ai: true };
    if (out.settings?.drops === 'untick') unt.add(d.key);
    reasons[d.key] = { kind: 'drop', why: flags[d.key].why };
  }
  const notes = {};
  for (const n of arr(ai?.notes)) {
    const c = byKey.get(n?.key); if (!c) { rejected.push(`note ${n?.key}: not a waiting step`); continue; }
    notes[n.key] = { why: str(n.why, 300), ...(P.MODELS.includes(n.model) && n.model !== c.model ? { model: n.model, upgrade: n.model === 'Fable' && c.model === 'Opus' } : {}), ...(P.THINKING.includes(n.thinking) ? { thinking: n.thinking } : {}), ...(n.split ? { split: true } : {}) };
  }
  const named = new Map(arr(ai?.packs).filter((p) => p && typeof p.id === 'string').map((p) => [p.id, p]));
  out.packs = out.packs.map((p) => { const a = named.get(p.id); return a ? { ...p, ai: { name: str(a.name, 200), why: str(a.why, 400) }, why: str(a.why, 400) || p.why } : p; });
  const items2 = [...byKey.values()];
  const ord = orderPacks(out.packs.map((p) => ({ ...p, areas: [...new Set(p.keys.flatMap((k) => byKey.get(k)?.areas ?? []))] })), byKey);
  return finish({ ...out, packs: ord.packs, mode: 'deep', unticked: [...unt], flags, reasons, notes, deps, rejected, warnings: [...arr(pl.warnings), ...ord.warnings] }, items2, { settings: pl.settings, builds: opts.builds ?? [], pricing: opts.pricing });
}

/** One-line notice for the alert / banner / phone (addendum 4). */
export function notice(pl, { fellBack = false, why = '' } = {}) {
  const head = pl.mode === 'deep' ? 'Ran in Deep mode (AI)' : fellBack ? `Ran in Basic mode, AI wasn't available${why ? ` (${why})` : ''}` : 'Ran in Basic mode';
  return `${head}: ${pl.summary?.line ?? ''}`;
}
/** Should this run notify? `no-ai` = only when Deep was wanted and Basic ran instead. */
export function shouldNotify(setting, { fellBack }) { return setting === 'every' || (setting === 'no-ai' && fellBack === true); }
