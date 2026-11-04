/**
 * Build packager core (build-package@1). Pure: no fs, no DOM. Shared by the Package builds window, the CLI
 * (../packager.mjs), the server part and the tests.
 *
 * Brett, Nov 4 2026 (voice): select the steps still waiting to be built (Fable by default), combine them into one
 * build package, then send it to a helper session or add it to this orchestrator as its own build. Addendum 1: every
 * step is listed on its own (grouped by source build), with per-step ticks, select all / none / group / invert; the
 * "All Fable work" preset only pre-ticks; nothing is sent without confirming the ticked list; and the order is
 * re-analyzed after every send.
 *
 * A candidate is one waiting step: a step of a pending / running / waiting build that is not done, not skipped, not
 * already packaged, not with a helper and not the step a running build is on right now; or an undone step of a Plan
 * Studio plan marked ready that has no build yet. Its key is `<build>/<uid>` (`plan:<id>/<step>` for plans).
 * Dependencies: steps of one source run in order, so a step needs the open steps before it (and its `after` list).
 */

export const SCHEMA = 'build-package@1';
export const MODELS = ['Fable', 'Opus'];
/** Same list as model-advice@1 (framework/core/model-advice.mjs), lowest first. */
export const THINKING = ['low', 'medium', 'high', 'max'];
export const DEFAULT_THINKING = { Fable: 'high', Opus: 'medium' };
/** Build statuses whose open steps are waiting work. */
export const WAITING_STATUSES = ['pending', 'running', 'waiting'];
export const DESTINATIONS = ['helper', 'mine'];
export const PRESETS = { 'all-fable': { label: 'All Fable work, send to helper now', filter: { model: 'Fable' }, dest: 'helper', now: true } };
export const DEFAULT_FILTER = { model: 'Fable', thinking: '', area: '', profile: '', status: '', q: '' };

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const slug = (t) => str(t, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'package';
const open = (s) => s && !s.done && !s.skip;
const RANK = { Opus: 0, Fable: 1 };

/** "45 min", "2 h", "1.5 d" → minutes (a day = 8 working hours); null when unreadable. */
export function minutesOf(e) {
  if (typeof e === 'number' && e > 0) return e;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(str(e, 30));
  if (!m) return null;
  const n = Number(m[1]); const u = (m[2] || 'min').toLowerCase();
  return Math.round(u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 480 : n);
}
export const fmtMinutes = (min) => (!min ? '' : min < 60 ? `${min} min` : `${Number.isInteger(min / 60) ? min / 60 : (min / 60).toFixed(1)} h`);
export const normThinking = (t) => (THINKING.includes(str(t).toLowerCase()) ? str(t).toLowerCase() : '');

/** Folder → area name, so steps from many builds can be filtered by what they touch. */
export function areaOf(path) {
  const p = str(path, 300).replace(/^\.?\//, '');
  let m;
  if ((m = /^apps\/console-web\/plugins\/([^/]+)/.exec(p))) return `plugin:${m[1]}`;
  if ((m = /^apps\/([^/]+)/.exec(p))) return `app:${m[1]}`;
  if (/^framework\/(core|android\/axf-kernel)\b/.test(p)) return 'kernel';
  if (/^framework\/(spec|schemas)\b/.test(p)) return 'spec';
  if ((m = /^framework\/([^/]+)/.exec(p))) return `framework:${m[1]}`;
  if (/^_claude\/builds\b/.test(p)) return 'builds';
  if ((m = /^([^/]+)\//.exec(p))) return m[1];
  return p ? 'repo' : '';
}
export const areasOf = (paths) => [...new Set(arr(paths).map(areaOf).filter(Boolean))].sort();

/** The step a running build is on right now (never packaged out from under its session). */
function currentStep(b) {
  if (b.status !== 'running') return null;
  return b.steps.find((s) => open(s) && !s.packagedInto && !s.assignedTo && !s.withHelper) ?? null;
}
/** The model a step is best built on: the audit's recommendation when present (model-advice@1), else its own. */
export const adviceModel = (s) => (MODELS.includes(s?.recommendedModel) ? s.recommendedModel : '');

/**
 * Every waiting step of every build (all profiles; `profiles` lists where its build shows) plus ready plans' steps.
 * Returns { candidates, skipped: { noSteps: [build ids], inProgress: [keys] } }. Input builds are builds@1 records.
 */
export function candidates(builds, { plans = [], profileOrder = {} } = {}) {
  const out = []; const noSteps = []; const inProgress = [];
  for (const b of arr(builds)) {
    if (!b || b.deleted || b.hidden || !WAITING_STATUSES.includes(b.status)) continue;
    const steps = arr(b.steps);
    if (!steps.length) { noSteps.push(b.id); continue; }
    const cur = currentStep(b);
    const touches = arr(b.touches);
    // kept small: a plain key for an earlier open step that is itself listed; a short line only for the others
    // (being built now, in another package, with a helper)
    const pre = (index) => steps.slice(0, index).filter(open).map((x) => {
      const key = `${b.id}/${x.uid || x.id}`;
      const busy = x === cur || x.packagedInto || x.assignedTo || x.withHelper;
      return busy ? { key, text: str(x.title || x.text, 80), model: x.model === 'Fable' ? 'Fable' : 'Opus', ...(x === cur ? { inProgress: true } : {}), ...(x.packagedInto ? { packaged: str(x.packagedInto, 80) } : {}), ...(x.assignedTo || x.withHelper ? { helper: true } : {}) } : key;
    });
    steps.forEach((s, index) => {
      if (!open(s) || s.packagedInto || s.assignedTo || s.withHelper) return;
      const key = `${b.id}/${s.uid || s.id}`;
      if (cur && s === cur) { inProgress.push(key); return; }
      const files = [...arr(s.files), ...touches];
      out.push({
        key, kind: 'step', build: b.id, buildTitle: str(b.title, 300), buildStatus: b.status, category: str(b.category, 60),
        profiles: arr(b.profiles), order: Math.min(...arr(b.profiles).map((p) => profileOrder[p]?.[b.id] ?? b.order?.[p] ?? 1e6), 1e6),
        package: b.package ? b.id : '', step: s.id, uid: s.uid || '', index, text: str(s.title || s.text, 2000), ...(s.title ? { fullText: str(s.text, 2000) } : {}),
        model: MODELS.includes(s.model) ? s.model : 'Opus', recommendedModel: adviceModel(s),
        thinking: normThinking(s.thinking) || normThinking(s.recommendedThinking), why: str(s.why || s.modelWhy, 300),
        estimate: str(s.estimate, 20), minutes: minutesOf(s.estimate) ?? 0, files: arr(s.files), areas: areasOf(files),
        after: arr(s.after), phase: str(s.phase, 80), before: pre(index),
      });
    });
  }
  for (const p of arr(plans)) {
    if (!p || p.status !== 'ready' || p.build?.id) continue;
    const psteps = arr(p.steps);
    psteps.forEach((s, index) => {
      if (s.done || s.packagedInto) return;
      const model = s.model === 'Fable' ? 'Fable' : 'Opus';
      out.push({
        key: `plan:${p.id}/${s.id || index}`, kind: 'plan-step', build: `plan:${p.id}`, buildTitle: str(p.title, 300), buildStatus: 'plan-ready',
        category: str(p.category, 60), profiles: [], order: 2e6, package: '', step: str(s.id) || `p${index + 1}`, uid: '', index,
        text: str(s.text, 2000), model, recommendedModel: '', thinking: '', why: '',
        estimate: s.minutes ? `${s.minutes} min` : '', minutes: Number(s.minutes) || 0, files: [], areas: [],
        after: arr(s.dependsOn).map((d) => `plan:${p.id}/${d}`), phase: str(s.phase, 80),
        before: psteps.slice(0, index).map((x, i) => ({ x, i })).filter(({ x }) => !x.done).map(({ x, i }) => (x.packagedInto ? { key: `plan:${p.id}/${x.id || i}`, text: str(x.text, 80), model: x.model === 'Fable' ? 'Fable' : 'Opus', packaged: str(x.packagedInto, 80) } : `plan:${p.id}/${x.id || i}`)),
      });
    });
  }
  out.sort((a, b) => a.order - b.order || a.build.localeCompare(b.build) || a.index - b.index);
  return { candidates: out, skipped: { noSteps, inProgress } };
}

/** Does a candidate pass the filter? model = its own model or the audit's recommendation. */
export function matches(c, f = DEFAULT_FILTER) {
  if (f.model && c.model !== f.model && c.recommendedModel !== f.model) return false;
  if (f.thinking && (c.thinking || DEFAULT_THINKING[c.recommendedModel || c.model]) !== f.thinking) return false;
  if (f.area && !c.areas.includes(f.area)) return false;
  if (f.profile && !c.profiles.includes(f.profile)) return false;
  if (f.status && c.buildStatus !== f.status) return false;
  const q = str(f.q, 200).trim().toLowerCase();
  if (q && !`${c.text} ${c.buildTitle} ${c.build} ${c.category}`.toLowerCase().includes(q)) return false;
  return true;
}
export const filterCandidates = (list, f) => arr(list).filter((c) => matches(c, { ...DEFAULT_FILTER, ...(f ?? {}) }));

/** Filter choices with counts (only values that exist). */
export function facets(list) {
  const count = (fn) => { const m = new Map(); for (const c of list) for (const v of fn(c)) if (v) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n })); };
  return {
    model: count((c) => [...new Set([c.model, c.recommendedModel])]),
    thinking: count((c) => [c.thinking || DEFAULT_THINKING[c.recommendedModel || c.model]]),
    area: count((c) => c.areas), profile: count((c) => c.profiles), status: count((c) => [c.buildStatus]),
  };
}

/** Candidates grouped by source build, in queue order. */
export function groups(list) {
  const m = new Map();
  for (const c of list) { if (!m.has(c.build)) m.set(c.build, { build: c.build, title: c.buildTitle, status: c.buildStatus, kind: c.kind, items: [] }); m.get(c.build).items.push(c); }
  return [...m.values()].map((g) => ({ ...g, minutes: g.items.reduce((t, c) => t + c.minutes, 0) }));
}

// ---------------------------------------------------------------- selection (addendum 1: pick ones or select all)

/** Selection operations over the keys in view. `sel` is an array of keys (order = priority). */
export function select(sel, op, keys = []) {
  const cur = arr(sel); const view = arr(keys); const inView = new Set(view);
  switch (op) {
    case 'all': return [...cur, ...view.filter((k) => !cur.includes(k))];
    case 'none': return cur.filter((k) => !inView.has(k));
    case 'invert': return [...cur.filter((k) => !inView.has(k)), ...view.filter((k) => !cur.includes(k))];
    case 'toggle': return view.every((k) => cur.includes(k)) ? cur.filter((k) => !inView.has(k)) : [...cur, ...view.filter((k) => !cur.includes(k))];
    case 'add': return [...cur, ...view.filter((k) => !cur.includes(k))];
    case 'remove': return cur.filter((k) => !inView.has(k));
    default: throw new Error(`unknown selection op ${op}`);
  }
}
/** A preset pre-ticks (never sends by itself): the keys it ticks among the candidates. */
export function presetKeys(list, preset = 'all-fable') {
  const p = PRESETS[preset]; if (!p) throw new Error(`unknown preset ${preset}`);
  return filterCandidates(list, p.filter).map((c) => c.key);
}

/** Move one key in the priority order (drag to order): to index `to`. */
export function move(order, key, to) {
  const o = arr(order).filter((k) => k !== key); const i = Math.max(0, Math.min(o.length, Number(to) || 0));
  o.splice(i, 0, key); return o;
}

// ---------------------------------------------------------------- dependencies

/**
 * What the selected steps need that is not selected: the open steps before them in the same source (steps of one
 * build run in order, `before` on each candidate) and their `after` steps. `inProgress` ones are being built by their
 * own session right now. Returns [{ key, text, build, needs: [{ key, text, model, selectable, inProgress, packaged, helper }] }].
 */
export function dependencies(list, sel) {
  const chosen = new Set(arr(sel)); const byKey = new Map(arr(list).map((c) => [c.key, c]));
  const out = [];
  for (const key of arr(sel)) {
    const c = byKey.get(key); if (!c) continue;
    const needs = arr(c.before).map((n) => (typeof n === 'string' ? { key: n, text: byKey.get(n)?.text ?? n, model: byKey.get(n)?.model ?? 'Opus' } : n))
      .filter((n) => !chosen.has(n.key)).map((n) => ({ inProgress: false, packaged: '', helper: false, ...n, selectable: byKey.has(n.key) }));
    for (const a of arr(c.after)) if (!chosen.has(a) && !needs.some((n) => n.key === a) && byKey.has(a)) needs.push({ key: a, text: byKey.get(a).text, model: byKey.get(a).model, selectable: true, inProgress: false, packaged: '', helper: false });
    if (needs.length) out.push({ key, text: c.text, build: c.build, needs });
  }
  return out;
}
/** Bring the selectable prerequisites along (added to the selection, each before the first step that needs it). */
export function bringAlong(sel, deps) {
  let o = arr(sel).slice();
  for (const d of arr(deps)) for (const n of d.needs) if (n.selectable && !o.includes(n.key)) { const at = o.indexOf(d.key); o.splice(at < 0 ? o.length : at, 0, n.key); }
  return o;
}

/**
 * Keep dependencies whatever the drag order: steps of one source keep their source order. The slots that source's
 * steps occupy stay where Brett put them; the steps are refilled into those slots in source order. Returns
 * { order, fixed: [keys moved] }.
 */
export function keepDeps(order, list) {
  const byKey = new Map(arr(list).map((c) => [c.key, c])); const o = arr(order).filter((k) => byKey.has(k));
  const bySrc = new Map();
  o.forEach((k, i) => { const c = byKey.get(k); if (!bySrc.has(c.build)) bySrc.set(c.build, []); bySrc.get(c.build).push(i); });
  const out = o.slice(); const fixed = [];
  for (const slots of bySrc.values()) {
    const keys = slots.map((i) => o[i]).sort((a, b) => byKey.get(a).index - byKey.get(b).index);
    slots.forEach((i, j) => { if (out[i] !== keys[j]) fixed.push(keys[j]); out[i] = keys[j]; });
  }
  return { order: out, fixed: [...new Set(fixed)] };
}

// ---------------------------------------------------------------- the package

/** A free package id: `pkg-<slug>`, then -2, -3 … */
export function packageId(name, taken = []) {
  const base = `pkg-${slug(name)}`.slice(0, 70); const t = new Set(arr(taken));
  if (!t.has(base)) return base;
  for (let i = 2; ; i++) if (!t.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A name from what is in it: "Fable package: 7 steps from 3 builds". */
export function suggestName(items, model = 'Fable') {
  const builds = new Set(arr(items).map((c) => c.build));
  const m = model === 'keep' ? 'Build' : model;
  return `${m} package: ${items.length} step${items.length === 1 ? '' : 's'} from ${builds.size} build${builds.size === 1 ? '' : 's'}`;
}

/**
 * Turn the ordered selection into a package build (builds@1 shape for the store) and the marks on its sources.
 * opts: { name, model: 'keep' | 'Fable' | 'Opus', thinking, id, taken, by, said, dest, now, category }.
 * Raising a step's model (Opus → Fable) is an upgrade: listed in `upgrades`; the store refuses it without Brett.
 */
export function makePackage(list, order, opts = {}) {
  const byKey = new Map(arr(list).map((c) => [c.key, c]));
  const missing = arr(order).filter((k) => !byKey.has(k));
  if (missing.length) throw new Error(`no longer waiting (built, packaged or taken meanwhile): ${missing.join(', ')}`);
  const { order: ord } = keepDeps(order, list);
  if (!ord.length) throw new Error('tick at least one step to package');
  const items = ord.map((k) => byKey.get(k));
  const model = ['Fable', 'Opus'].includes(opts.model) ? opts.model : 'keep';
  const name = str(opts.name, 200).trim() || suggestName(items, model === 'keep' ? 'Fable' : model);
  const id = str(opts.id, 80) || packageId(name, opts.taken);
  const upgrades = model === 'keep' ? [] : items.filter((c) => RANK[model] > RANK[c.model]).map((c) => c.key);
  const thinking = normThinking(opts.thinking) || DEFAULT_THINKING[model === 'keep' ? 'Fable' : model];
  const sources = [...new Set(items.map((c) => c.build))];
  const at = opts.now || new Date().toISOString();
  const steps = items.map((c, i) => ({
    id: `s${i + 1}`, text: c.fullText || c.text, model: model === 'keep' ? c.model : model, estimate: c.estimate, files: c.files,
    why: c.why || `from ${c.buildTitle} (${c.build} ${c.step})`, phase: '', group: c.buildTitle.slice(0, 80), thinking: c.thinking || thinking,
    origin: { build: c.build, step: c.uid || c.step, how: 'package' },
  }));
  const minutes = items.reduce((t, c) => t + c.minutes, 0);
  const build = {
    id, title: name, category: str(opts.category, 60) || 'Packages', status: 'pending', source: 'package',
    detail: [`Build package (${SCHEMA}): ${items.length} step${items.length === 1 ? '' : 's'} from ${sources.length} build${sources.length === 1 ? '' : 's'}, ~${fmtMinutes(minutes) || '?'}, thinking ${thinking}.`,
      'Each step is still listed in its source build as "packaged into" this one; ticking it done here ticks it there too.',
      ...sources.map((s) => `- ${s}: ${items.filter((c) => c.build === s).map((c) => c.step).join(', ')}`)].join('\n'),
    steps,
    package: { $axf: SCHEMA, thinking, model, sources, items: items.map((c) => ({ key: c.key, build: c.build, step: c.step, uid: c.uid })), at, by: str(opts.by, 120) || 'console', dest: DESTINATIONS.includes(opts.dest) ? opts.dest : 'mine', sent: null },
    ...(str(opts.said).trim() ? { said: str(opts.said, 8000) } : {}),
  };
  return { build, marks: items.map((c) => ({ key: c.key, build: c.build, step: c.step, uid: c.uid, kind: c.kind })), upgrades, minutes, thinking };
}

/** The confirm list: exactly what will be packaged, in order, before anything is sent (addendum 1). */
export function confirmLines(list, order) {
  const byKey = new Map(arr(list).map((c) => [c.key, c]));
  return keepDeps(order, list).order.map((k, i) => { const c = byKey.get(k); return `${i + 1}. [${c.model}] ${c.text} (${c.build} ${c.step}${c.estimate ? `, ~${c.estimate}` : ''})`; });
}

// ---------------------------------------------------------------- re-analyze the order (after every send)

/**
 * Builds that must come before others because of packages: a package needs the open steps before its packaged ones
 * in each source (source → before package); a source's open steps after a packaged one need the package (package →
 * before source). Returns edges [{ before, after, why }]. Both directions on one pair = a conflict (steps on both sides).
 */
export function packageEdges(builds) {
  const byId = new Map(arr(builds).filter((b) => !b.deleted).map((b) => [b.id, b]));
  const edges = [];
  for (const p of byId.values()) {
    if (!p.package || !WAITING_STATUSES.includes(p.status)) continue;
    const bySrc = new Map();
    for (const s of arr(p.steps)) if (s.origin?.how === 'package' && !s.done) { if (!bySrc.has(s.origin.build)) bySrc.set(s.origin.build, []); bySrc.get(s.origin.build).push(s.origin.step); }
    for (const [src, refs] of bySrc) {
      const b = byId.get(src); if (!b || !WAITING_STATUSES.includes(b.status)) continue;
      const idx = refs.map((r) => b.steps.findIndex((s) => s.uid === r || s.id === r)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const first = Math.min(...idx); const last = Math.max(...idx);
      const before = b.steps.slice(0, first).filter((s) => open(s) && !s.packagedInto);
      const after = b.steps.slice(last + 1).filter((s) => open(s) && !s.packagedInto);
      if (before.length) edges.push({ before: b.id, after: p.id, why: `${p.id} needs ${b.id}'s ${before.map((s) => s.id).join(', ')} first` });
      if (after.length) edges.push({ before: p.id, after: b.id, why: `${b.id}'s ${after.map((s) => s.id).join(', ')} need${after.length === 1 ? 's' : ''} ${p.id}'s steps` });
    }
  }
  return edges;
}

/**
 * Re-analyze the queue order of one profile: every edge satisfied, running builds and pinned ones never move, nothing
 * else moves without a reason. `ids` = the profile's current order. Returns { order, moves: [{ id, from, to, why }],
 * conflicts: [why] }.
 */
export function reanalyze(builds, ids, { now = '' } = {}) {
  const byId = new Map(arr(builds).map((b) => [b.id, b]));
  const order = arr(ids).filter((id) => byId.has(id));
  const fixed = (id) => byId.get(id)?.status === 'running' || byId.get(id)?.pinned === true;
  const edges = packageEdges(builds).filter((e) => order.includes(e.before) && order.includes(e.after));
  const pair = new Set(edges.map((e) => `${e.before}>${e.after}`));
  const both = new Map(); // one line per pair that needs each other both ways
  for (const e of edges) if (pair.has(`${e.after}>${e.before}`)) { const k = [e.before, e.after].sort().join('|'); both.set(k, [...(both.get(k) ?? []), e.why]); }
  const conflicts = [...both.entries()].map(([k, why]) => `${k.replace('|', ' ↔ ')}: steps on both sides (${why.join('; ')}); they run side by side`);
  const live = edges.filter((e) => !pair.has(`${e.after}>${e.before}`));
  const out = order.slice(); const moves = [];
  for (let pass = 0; pass < order.length + 1; pass++) {
    let changed = false;
    for (const e of live) {
      const i = out.indexOf(e.before); const j = out.indexOf(e.after);
      if (i < j) continue; // already in order
      // move the one that may move: the later-needed build goes right after its prerequisite, else the prerequisite goes right before it
      if (!fixed(e.after)) { out.splice(j, 1); out.splice(out.indexOf(e.before) + 1, 0, e.after); moves.push({ id: e.after, why: e.why }); changed = true; }
      else if (!fixed(e.before)) { out.splice(i, 1); out.splice(out.indexOf(e.after), 0, e.before); moves.push({ id: e.before, why: e.why }); changed = true; }
      else conflicts.push(`${e.before} and ${e.after} are both running or pinned: ${e.why}`);
    }
    if (!changed) break;
  }
  const seen = new Set();
  const final = moves.reverse().filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).reverse()
    .map((m) => ({ id: m.id, from: order.indexOf(m.id), to: out.indexOf(m.id), why: m.why })).filter((m) => m.from !== m.to);
  return { order: out, moves: final, conflicts: [...new Set(conflicts)], at: now };
}
