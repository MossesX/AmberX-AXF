/**
 * Inherit / override (inherit@1, build app-style-override s3; Brett, Nov 3 2026: "Put a button in each app's settings
 * to override axHub's style"). One rule for everything that follows a shared source (axHub's look, a nav menu's
 * defaults, an add-on's appearance): a value follows its source until its owner overrides it; an override is recorded
 * per part (a named group of values), shows the source's value beside the owner's, and is undone by "Reset to the
 * source". Editing a value of a part that is inheriting switches that part's override on by itself.
 *
 * Pure (no IO, no DOM). Parts name the values they cover in two kinds, so one engine serves asset slots and settings
 * keys alike:
 *
 *   part   { id, label, detail?, slots: [slot…], keys: [settings key…] }
 *   flags  { [part id]: true }             the parts overriding now (absent = inheriting)
 *   row    { name, kind, part, from: 'source' | 'own', source, own, differs }
 *
 * Users: engines/app-style.mjs (an app's design / colours over axHub's). Nav menus and add-ons describe their own
 * parts and call the same functions. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
export const INHERIT_FRAME = 'inherit@1';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Parts cleaned: an id, a label, string lists of slots and keys. Bad entries dropped. */
export function normalizeParts(raw) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!isObj(p) || typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(p.id) || out.some((x) => x.id === p.id)) continue;
    const list = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 160) : []);
    out.push({ id: p.id, label: typeof p.label === 'string' && p.label ? p.label : p.id, ...(typeof p.detail === 'string' ? { detail: p.detail } : {}), slots: list(p.slots), keys: list(p.keys) });
  }
  return out;
}

/** The part ids that cover `name` (a slot or a key). One value may belong to more than one part. */
export function partsOf(parts, kind, name) {
  const field = kind === 'slot' ? 'slots' : 'keys';
  return parts.filter((p) => p[field].includes(name)).map((p) => p.id);
}

/** Override flags cleaned against the parts: `{ [id]: true }` for every part overriding; anything else dropped. */
export function normalizeFlags(raw, parts) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const p of parts) if (raw[p.id] === true || (isObj(raw[p.id]) && raw[p.id].on === true)) out[p.id] = true;
  return out;
}

/** Is a value of these parts overridden? Yes when any part that covers it overrides. */
export const overriding = (flags, partIds) => partIds.some((id) => flags[id] === true);

/** One value: the source's while inheriting, the owner's while overriding (the owner's missing = the source's). */
export function inheritValue(source, own, isOverriding) {
  const from = isOverriding && own !== undefined ? 'own' : 'source';
  return { value: from === 'own' ? own : source, from, source, own, differs: own !== undefined && !same(source, own) };
}

/**
 * Every value the parts cover, resolved: `source` / `own` are `{ slots: {name: value}, keys: {name: value} }`.
 * Returns the effective values and one row per value for a settings screen ("Inherited from axHub" or "Overriding
 * axHub" with the source's value beside).
 */
export function resolveInherited(parts, flags, source = {}, own = {}) {
  const values = { slots: {}, keys: {} };
  const rows = [];
  for (const kind of ['slot', 'key']) {
    const field = kind === 'slot' ? 'slots' : 'keys';
    const seen = new Set();
    for (const p of parts) {
      for (const name of p[field]) {
        if (seen.has(name)) continue;
        seen.add(name);
        const ids = partsOf(parts, kind, name);
        const r = inheritValue(source[field]?.[name], own[field]?.[name], overriding(flags, ids));
        if (r.value !== undefined) values[field][name] = r.value;
        rows.push({ name, kind, part: ids[0], ...r });
      }
    }
  }
  return { values, rows };
}

/**
 * A local edit touched these values: which parts it puts into override. While a part inherits, an edit switches it
 * on by itself (unless the owner *is* the source, whose edits change the source). Returns the new flags and the parts
 * that were switched on now (empty = nothing changed).
 */
export function autoOverride(parts, flags, touched, { isSource = false } = {}) {
  if (isSource) return { flags, switched: [] };
  const next = { ...flags };
  const switched = [];
  for (const t of touched ?? []) {
    for (const id of partsOf(parts, t.kind, t.name)) if (!next[id]) { next[id] = true; switched.push(id); }
  }
  return { flags: next, switched };
}

/** The note a settings row shows: inherited, or overriding with the source's value beside. */
export function inheritNote(row, sourceLabel = 'the source', fmt = (v) => String(v ?? '—')) {
  if (row.from === 'own') return `Overriding ${sourceLabel} (${sourceLabel}: ${fmt(row.source)})`;
  return `Inherited from ${sourceLabel}`;
}
