/**
 * UI Manager rules (ui-element@1 / ui-overrides@1 / ui-change@1; build ui-manager-floating-window-to-select-any, Nov 13 2026).
 *
 * Brett: "a UI manager, opens a floating window which contains the ability to select any UI element in the whole console;
 * collapsible categories; one category is all the ones visible on screen, like a Windows shortcut, two things point to the
 * shared source; select one and it opens an expanding row with all the properties and tokens; you change them by selecting
 * from predetermined things from the integration with the console and the framework".
 *
 * Pure (no IO, no DOM). One definition shared by the UI Manager plugin (its floating window, server, CLI, MCP tools),
 * the build engine's checks and the fixtures. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 *
 * The pieces:
 *   ui-element@1   one thing that can be selected: { id, label, kind, category, assetType?, address?, selector?, plugin?, tokens[] }
 *                  An "On screen now" entry is a shortcut: { ref: <element id> }. Both point at ONE element, so an edit made
 *                  through either lands on the same override.
 *   ui-catalog@1   what the console and the framework know (built with IO by the plugin): asset types (asset-types.json),
 *                  the assets of every type, the asset in force per slot (skin / look), control@1 token paths per set.
 *   property       derived from the element, never typed in: the asset in force (asset ids), every enum field of its asset
 *                  type, every token it reads (control@1 paths: colour, number with range, enum, boolean, string). Every
 *                  property's valid values are a predetermined list (choices); a number is a range with a step. Free text
 *                  is never offered where a list exists.
 *   ui-overrides@1 { elements: { <element id>: { <prop id>: value } } }: only what was changed; reset = drop the key.
 *   preview plan   CSS re-declaring --fx-* tokens on the element's selector (no literals: a colour is var(--fx-<token>))
 *                  plus asset patches / swaps for the runtime: edits hot-render before Apply.
 *   ui-change@1    one applied change set (who, when, element, prop, from → to) with undo.
 */

export const ELEMENT_FRAME = 'ui-element@1';
export const OVERRIDES_FRAME = 'ui-overrides@1';
export const CHANGE_FRAME = 'ui-change@1';
export const CATALOG_FRAME = 'ui-catalog@1';
/** The appearance engine caps a look setting at 4 KB; the overrides document is a plugin file, so the cap is wider. */
export const OVERRIDES_MAX_BYTES = 64 * 1024;
export const RANGE_OPTIONS_MAX = 41;
/** A colour choice is a reference to a colour token, never a literal: '@accent' = var(--fx-accent). */
export const TOKEN_REF = '@';

/** The categories of the tree (open list; `live` = rebuilt from what is on screen). The first is the shortcuts. */
export const ON_SCREEN = 'on-screen';
export const CATEGORIES = [
  { id: ON_SCREEN, label: 'On screen now', icon: 'eye', live: true },
  { id: 'chrome', label: 'Chrome & navigation', icon: 'menu' },
  { id: 'screens', label: 'Screens & pages', icon: 'layout' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'dialogs', label: 'Dialogs & popups', icon: 'box' },
  { id: 'controls', label: 'Controls', icon: 'zap' },
  { id: 'widgets', label: 'Widgets', icon: 'star' },
  { id: 'look', label: 'Look: themes & scales', icon: 'palette' },
  { id: 'plugins', label: 'Plugins', icon: 'package' },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** Asset slot type → the control@1 token set that lists its tokens. */
export const TOKEN_TARGETS = {
  'color-theme': 'tokens.theme', 'style-theme': 'tokens.style', layout: 'tokens.layout', typography: 'tokens.typography',
  density: 'tokens.density', sizing: 'tokens.sizing', 'nav-style': 'tokens.nav',
};
/** Where an asset type's elements live when nothing says otherwise (asset-types.json `group`, then the type itself). */
const GROUP_CATEGORY = { Chrome: 'chrome', Navigation: 'chrome', Overlays: 'dialogs', Controls: 'controls', Widgets: 'widgets', Look: 'look', Brand: 'look', Layout: 'look' };
const LOOK_TYPES = ['color-theme', 'style-theme', 'layout', 'typography', 'density', 'sizing', 'nav-style', 'skin', 'design-package', 'style-package', 'behavior-theme', 'icon-pack', 'branding', 'logo', 'logo-mark', 'animated-logo', 'dock-layout', 'xlayout', 'interface'];
const WIDGET_TYPES = ['clock', 'search-bar', 'counter', 'badge', 'gauge', 'meter', 'progress', 'status', 'avatar', 'label', 'link', 'theme-switch', 'spacer', 'divider', 'action-button'];
/** console-control@1 target kinds → category. */
const TARGET_CATEGORY = { view: 'screens', tab: 'screens', subtab: 'screens', setting: 'settings', button: 'controls', function: 'controls', plugin: 'plugins', grid: 'screens', row: 'screens', step: 'screens', panel: 'screens', scroll: 'screens' };
/** The --fx-* tokens a component kind reads beyond its own asset (components.ts, axf.css). Open list. */
const KIND_TOKENS = {
  button: ['tokens.sizing:button.height', 'tokens.sizing:button.padX', 'tokens.sizing:button.font', 'tokens.theme:accent', 'tokens.theme:accentText', 'tokens.style:radius.md'],
  toolbar: ['tokens.theme:surface', 'tokens.theme:border', 'tokens.style:space', 'tokens.style:borderWidth'],
  'tab-group': ['tokens.theme:accent', 'tokens.theme:muted', 'tokens.style:space', 'tokens.style:radius.sm'],
  banner: ['tokens.theme:surface', 'tokens.theme:border', 'tokens.theme:accent', 'tokens.style:opacityGlass'],
  dialog: ['tokens.theme:surface', 'tokens.theme:border', 'tokens.style:radius.lg', 'tokens.style:opacityScrim', 'tokens.style:blur'],
  popup: ['tokens.theme:surface', 'tokens.theme:border', 'tokens.style:radius.md', 'tokens.style:shadow.md'],
  'context-menu': ['tokens.theme:surface', 'tokens.theme:text', 'tokens.style:radius.md', 'tokens.style:shadow.lg'],
  container: ['tokens.theme:surface', 'tokens.theme:border', 'tokens.style:radius.lg', 'tokens.style:shadow.sm', 'tokens.style:space'],
  'nav-menu': ['tokens.theme:surface', 'tokens.theme:accent', 'tokens.layout:navWidth'],
  'app-menu': ['tokens.theme:surface', 'tokens.theme:text', 'tokens.theme:border'],
  slider: ['tokens.theme:accent', 'tokens.theme:surface2'],
};

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const SCALAR = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
export const ELEMENT_ID = /^[a-z0-9][a-z0-9._:/@=%+-]{0,199}$/i;
const PROP_ID = /^[a-z][a-z0-9.:_-]{0,119}$/i;
export const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const humanize = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const kebab = (p) => String(p).replace(/([a-z])([A-Z])/g, '$1-$2').replace(/\./g, '-').toLowerCase();
const uniq = (a) => [...new Set(a)];

/* ================================================================== elements */

/** The category an element of this kind belongs to (its own `category` wins when it names one that exists). */
export function categoryOf(kind, types = {}, declared = '') {
  if (declared && CATEGORY_IDS.includes(declared) && declared !== ON_SCREEN) return declared;
  if (LOOK_TYPES.includes(kind)) return 'look';
  if (WIDGET_TYPES.includes(kind)) return 'widgets';
  if (TARGET_CATEGORY[kind]) return TARGET_CATEGORY[kind];
  const g = types[kind]?.group;
  return (g && GROUP_CATEGORY[g]) || (types[kind] ? 'controls' : 'plugins');
}

/** A clean ui-element@1 from anything (a manifest row, a console target, storage), or null when it has no id. */
export function normalizeElement(raw, types = {}) {
  const o = isObj(raw) ? raw : {};
  const id = str(o.id, 200);
  if (!ELEMENT_ID.test(id)) return null;
  const kind = slug(o.kind) || 'element';
  const assetType = str(o.assetType, 40) || (types[kind] ? kind : '');
  const tokens = (Array.isArray(o.tokens) ? o.tokens : []).filter((t) => typeof t === 'string' && /^tokens\.[a-z]+:[A-Za-z0-9_.-]+$/.test(t)).slice(0, 60);
  return {
    $axf: ELEMENT_FRAME, id, label: str(o.label, 120) || humanize(id.split(/[:/]/).pop()), kind,
    category: categoryOf(kind, types, str(o.category, 40)),
    ...(assetType ? { assetType } : {}), ...(str(o.address, 400) ? { address: str(o.address, 400) } : {}),
    ...(str(o.selector, 300) ? { selector: str(o.selector, 300) } : {}), ...(str(o.plugin, 120) ? { plugin: str(o.plugin, 120) } : {}),
    ...(str(o.app, 40) ? { app: str(o.app, 40) } : {}), ...(str(o.screen, 120) ? { screen: str(o.screen, 120) } : {}),
    tokens: uniq([...tokens, ...(KIND_TOKENS[assetType || kind] ?? [])]),
  };
}

/** One element per asset slot type that has assets: the framework's own chrome, controls, widgets and look. */
export function frameworkElements(catalog) {
  const out = [];
  for (const [type, spec] of Object.entries(catalog?.types ?? {})) {
    if (type === 'uac-policy' || type === 'help' || type === 'docs' || type === 'book' || type === 'clip' || type === 'demonstration' || type === 'job-type' || type === 'agent-card') continue;
    if (!(catalog.assets?.[type] ?? []).length) continue;
    out.push(normalizeElement({ id: `asset:${type}`, label: spec.label || humanize(type), kind: type, assetType: type, selector: `[data-fx-asset="${type}"]`, app: 'console' }, catalog.types));
  }
  return out.filter(Boolean);
}

/** Elements a plugin declares in its plugin.json (`uiElements: [{ id, label, kind, address?, selector?, assetType?, tokens? }]`); `plugin` is its id, never its folder. */
export function elementsFromManifest(manifest, types = {}) {
  const m = isObj(manifest) ? manifest : {};
  const pid = str(m.id, 120);
  const rows = Array.isArray(m.uiElements) ? m.uiElements : [];
  return rows.map((r) => normalizeElement({ ...(isObj(r) ? r : {}), id: isObj(r) && r.id ? `${pid ? `${pid}/` : ''}${r.id}` : '', plugin: pid, category: isObj(r) && r.category ? r.category : 'plugins' }, types)).filter(Boolean);
}

/** Elements from a console-control-targets@1 snapshot (what the open console reports it has on screen right now). */
export function elementsFromTargets(snapshot, types = {}) {
  const list = Array.isArray(snapshot?.targets) ? snapshot.targets : Array.isArray(snapshot) ? snapshot : [];
  return list.filter(isObj).map((t) => normalizeElement({
    id: `target:${str(t.address, 400)}`, label: str(t.label, 120) || str(t.address, 120), kind: slug(t.kind) || 'element', address: str(t.address, 400),
    selector: `[data-axf-target="${str(t.address, 400).replace(/"/g, '')}"]`, app: 'console', ...(str(t.plugin, 120) ? { plugin: str(t.plugin, 120) } : {}),
  }, types)).filter(Boolean);
}

/** Follow a shortcut to the element it points at. */
export const resolveElement = (idOrRef, elements) => {
  const id = isObj(idOrRef) ? str(idOrRef.ref ?? idOrRef.id, 200) : str(idOrRef, 200);
  return elements.find((e) => e.id === id) ?? null;
};

/**
 * The collapsible tree: On screen now first (shortcuts `{ ref, label, kind }` to the elements whose ids are visible), then each
 * category with its own elements sorted by label. Empty categories drop out; a category no element uses never shows.
 */
export function elementTree(elements, visibleIds = []) {
  const vis = new Set(visibleIds);
  const onScreen = elements.filter((e) => vis.has(e.id)).map((e) => ({ ref: e.id, label: e.label, kind: e.kind, category: e.category }));
  const out = [];
  if (onScreen.length) out.push({ ...CATEGORIES[0], items: onScreen.sort((a, b) => a.label.localeCompare(b.label)) });
  for (const c of CATEGORIES.slice(1)) {
    const items = elements.filter((e) => e.category === c.id).sort((a, b) => a.label.localeCompare(b.label));
    if (items.length) out.push({ ...c, items });
  }
  return out;
}

/** Search the tree: label, id, kind, category, address; shortcuts count as their element. */
export function filterElements(elements, q) {
  const s = str(q, 200).toLowerCase();
  if (!s) return elements;
  return elements.filter((e) => [e.label, e.id, e.kind, e.category, e.address ?? '', e.plugin ?? ''].some((x) => String(x).toLowerCase().includes(s)));
}

/* ================================================================== properties and their choices */

const niceStep = (span) => {
  if (!(span > 0)) return 1;
  const raw = span / 20;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
};
const round = (v, step) => { const d = Math.max(0, -Math.floor(Math.log10(step))); return Number((Math.round(v / step) * step).toFixed(d)); };
const rangeOptions = (min, max, step, unit = '') => {
  const out = [];
  for (let v = min; v <= max + step / 1e6 && out.length < RANGE_OPTIONS_MAX; v += step) out.push({ value: round(v, step), label: `${round(v, step)}${unit && unit !== 'x' ? ` ${unit}` : ''}` });
  return out;
};
const enumOptions = (list) => list.map((v) => ({ value: v, label: humanize(v) }));
const colorOptions = (catalog) => {
  const paths = catalog.paths?.['tokens.theme'] ?? [];
  const theme = activeData(catalog, 'color-theme');
  return paths.filter((p) => p.kind === 'color').map((p) => ({ value: `${TOKEN_REF}${p.id}`, label: humanize(p.id), token: p.token ?? `--fx-${kebab(p.id)}`, ...(theme?.tokens?.[p.id] ? { swatch: String(theme.tokens[p.id]) } : {}) }));
};
/** Values a field has across every known asset of a type: the predetermined list for a string / number field without a rule. */
const knownValues = (catalog, type, path) => {
  const out = [];
  for (const a of catalog.assets?.[type] ?? []) { const v = getAt(a.data, path); if (SCALAR(v) && !out.includes(v)) out.push(v); }
  return out;
};
export function getAt(data, path) { let at = data; for (const p of String(path).split('.')) { if (!isObj(at)) return undefined; at = at[p]; } return at; }
export function activeId(catalog, type) { return catalog?.active?.[type] ?? catalog?.assets?.[type]?.[0]?.id ?? ''; }
export function activeData(catalog, type) { const id = activeId(catalog, type); return (catalog?.assets?.[type] ?? []).find((a) => a.id === id)?.data ?? null; }

/** The choice rule of a control@1 token path: colour → token refs, number → range, enum, boolean, string → known values. */
function tokenChoices(catalog, target, p) {
  const type = Object.keys(TOKEN_TARGETS).find((t) => TOKEN_TARGETS[t] === target);
  if (p.kind === 'color') return { kind: 'token', options: colorOptions(catalog) };
  if (p.kind === 'enum') return { kind: 'enum', options: enumOptions(p.options ?? []) };
  if (p.kind === 'boolean') return { kind: 'bool', options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] };
  if (p.kind === 'number') {
    const known = type ? knownValues(catalog, type, target === 'tokens.theme' ? `tokens.${p.id}` : p.id).filter((v) => typeof v === 'number') : [];
    const min = p.min ?? (known.length ? Math.min(...known, p.default ?? known[0]) : 0);
    const max = p.max ?? (known.length ? Math.max(...known, p.default ?? known[0]) : (p.default ?? 1) * 2 || 1);
    const step = p.step ?? niceStep(max - min);
    return { kind: 'range', min, max, step, unit: p.unit ?? '', options: rangeOptions(min, max, step, p.unit ?? '') };
  }
  const known = type ? knownValues(catalog, type, p.id) : [];
  return { kind: 'enum', options: known.map((v) => ({ value: v, label: String(v) })) };
}

/** The choice rule of one field of an asset type (enums first, then what the known assets of the type use). */
function fieldChoices(catalog, type, path) {
  const spec = catalog.types?.[type] ?? {};
  const leaf = path.split('.').pop();
  const en = spec.enums?.[path] ?? spec.enums?.[leaf];
  if (Array.isArray(en) && en.length) return { kind: 'enum', options: enumOptions(en) };
  const known = knownValues(catalog, type, path);
  const text = spec.optional_fields?.[path] ?? spec.optional_fields?.[leaf] ?? '';
  if (known.every((v) => typeof v === 'boolean') && (known.length || /^\s*boolean/i.test(text))) return { kind: 'bool', options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] };
  if (known.length && known.every((v) => typeof v === 'number')) {
    const min = Math.min(...known, 0), max = Math.max(...known) * 2 || 1, step = niceStep(max - min);
    return { kind: 'range', min, max, step, unit: '', options: rangeOptions(min, max, step) };
  }
  return { kind: 'enum', options: known.map((v) => ({ value: v, label: String(v) })) };
}

/**
 * Every property of an element, each with its predetermined choices. Universal: `visible` (bool) and `transparency`
 * (0–100 %). With an asset type: `asset` (which asset of the type is in force; the ids the framework and plugins ship),
 * every enum / known field of the type (`field:<path>`), every token it reads (`token:<set>:<path>`). A property whose list
 * would be empty is left out: nothing here is ever typed in.
 */
export function propsOf(element, catalog) {
  const out = [];
  const type = element.assetType;
  out.push({ id: 'visible', label: 'Visible', group: 'Element', kind: 'bool', options: [{ value: true, label: 'Shown' }, { value: false, label: 'Hidden' }], default: true });
  out.push({ id: 'transparency', label: 'Transparency', group: 'Element', kind: 'range', min: 0, max: 100, step: 5, unit: '%', options: rangeOptions(0, 100, 5, '%'), default: 100 });
  if (type && (catalog.assets?.[type] ?? []).length) {
    out.push({ id: 'asset', label: `${catalog.types?.[type]?.label ?? humanize(type)} asset`, group: 'Asset', kind: 'asset', assetType: type, options: (catalog.assets[type]).map((a) => ({ value: a.id, label: a.name || a.id })), default: activeId(catalog, type) });
    const spec = catalog.types?.[type] ?? {};
    const data = activeData(catalog, type) ?? {};
    const fields = uniq([...Object.keys(spec.enums ?? {}), ...(spec.required ?? []).filter((f) => !isObj(data[f])), ...Object.entries(spec.nested ?? {}).flatMap(([g, ks]) => ks.map((k) => `${g}.${k}`)), ...Object.keys(spec.optional_fields ?? {}).filter((f) => !/object|array|string\b.*id|id or/i.test(spec.optional_fields[f]))]);
    // a field the type's token set already lists (a colour theme's tokens.bg, a layout's navWidth) is a token row, not a field
    const tokenIds = TOKEN_TARGETS[type] ? (catalog.paths?.[TOKEN_TARGETS[type]] ?? []).map((p) => p.id) : [];
    for (const f of fields) {
      if (f === 'attach' || f === 'groups' || f === 'items' || tokenIds.includes(f) || (type === 'color-theme' && f.startsWith('tokens.'))) continue;
      const c = fieldChoices(catalog, type, f);
      if (!c.options.length) continue;
      const base = getAt(data, f);
      out.push({ id: `field:${f}`, label: humanize(f), group: 'Properties', path: f, assetType: type, ...c, default: SCALAR(base) ? base : c.options[0].value, source: SCALAR(base) ? 'asset' : 'default' });
    }
  }
  const tokens = uniq([...(element.tokens ?? []), ...(type && TOKEN_TARGETS[type] ? (catalog.paths?.[TOKEN_TARGETS[type]] ?? []).map((p) => `${TOKEN_TARGETS[type]}:${p.id}`) : [])]);
  for (const t of tokens) {
    const [target, path] = t.split(':');
    const p = (catalog.paths?.[target] ?? []).find((x) => x.id === path);
    if (!p) continue;
    const c = tokenChoices(catalog, target, p);
    if (!c.options.length) continue;
    const slotType = Object.keys(TOKEN_TARGETS).find((k) => TOKEN_TARGETS[k] === target);
    const base = slotType ? getAt(activeData(catalog, slotType) ?? {}, target === 'tokens.theme' ? `tokens.${path}` : path) : undefined;
    out.push({ id: `token:${t}`, label: humanize(path), group: 'Tokens', target, path, token: p.token ?? (target === 'tokens.theme' ? `--fx-${kebab(path)}` : ''), ...c, default: SCALAR(base) ? base : p.default ?? c.options[0].value, source: SCALAR(base) ? 'asset' : 'default' });
  }
  return out.filter((p) => PROP_ID.test(p.id)).map((p) => ({ ...p, source: p.source ?? (p.id === 'asset' ? 'asset' : 'default') }));
}

/** One value checked against a property: ok with the normalized value, or the error naming the valid choices. */
export function validateValue(prop, value) {
  const list = (prop.options ?? []).map((o) => o.value);
  const pick = (v) => ({ ok: true, value: v });
  const fail = (why) => ({ ok: false, error: `${prop.label}: ${why}; valid: ${list.slice(0, 12).map(String).join(', ')}${list.length > 12 ? ', …' : ''}`, options: prop.options ?? [] });
  if (prop.kind === 'bool') {
    if (typeof value === 'boolean') return pick(value);
    if (value === 'true' || value === 'on' || value === 'shown' || value === '1') return pick(true);
    if (value === 'false' || value === 'off' || value === 'hidden' || value === '0') return pick(false);
    return fail('on or off');
  }
  if (prop.kind === 'range') {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.replace(/[%a-z ]+$/i, '')) : NaN;
    if (!Number.isFinite(n)) return fail(`a number from ${prop.min} to ${prop.max}`);
    if (n < prop.min || n > prop.max) return fail(`out of range: ${prop.min} to ${prop.max}`);
    return pick(round(n, prop.step));
  }
  const hit = list.find((v) => v === value || (typeof v !== 'string' && String(v) === String(value)) || (typeof v === 'string' && typeof value === 'string' && v.toLowerCase() === value.toLowerCase()));
  if (hit === undefined && prop.kind === 'token' && typeof value === 'string' && list.includes(`${TOKEN_REF}${value}`)) return pick(`${TOKEN_REF}${value}`);
  return hit === undefined ? fail('not one of the choices') : pick(hit);
}

/* ================================================================== overrides */

export function normalizeOverrides(raw) {
  const o = isObj(raw) ? raw : {};
  const src = isObj(o.elements) ? o.elements : isObj(o) && !o.$axf ? o : {};
  const elements = {};
  for (const [id, props] of Object.entries(src)) {
    if (!ELEMENT_ID.test(id) || !isObj(props)) continue;
    const m = {};
    for (const [p, v] of Object.entries(props)) if (PROP_ID.test(p) && SCALAR(v)) m[p] = v;
    if (Object.keys(m).length) elements[id] = m;
  }
  return { $axf: OVERRIDES_FRAME, elements, ...(str(o.updatedAt, 40) ? { updatedAt: str(o.updatedAt, 40) } : {}), ...(str(o.updatedBy, 80) ? { updatedBy: str(o.updatedBy, 80) } : {}) };
}

/** The document with one override set (validated against the property). → { doc } or { error }. */
export function withOverride(raw, element, prop, value, { by = '', at = '' } = {}) {
  const v = validateValue(prop, value);
  if (!v.ok) return { error: v.error, options: v.options };
  const doc = normalizeOverrides(raw);
  const id = isObj(element) ? element.id : element;
  doc.elements[id] = { ...(doc.elements[id] ?? {}), [prop.id]: v.value };
  if (by) doc.updatedBy = by;
  if (at) doc.updatedAt = at;
  if (JSON.stringify(doc).length > OVERRIDES_MAX_BYTES) return { error: `too many overrides (over ${OVERRIDES_MAX_BYTES} bytes): reset some first` };
  return { doc, value: v.value };
}

/** Reset: one property, or every property of the element (no prop), or everything (no element). */
export function withoutOverride(raw, element = '', propId = '') {
  const doc = normalizeOverrides(raw);
  const id = isObj(element) ? element.id : element;
  if (!id) return { ...doc, elements: {} };
  if (!doc.elements[id]) return doc;
  if (!propId) delete doc.elements[id];
  else { delete doc.elements[id][propId]; if (!Object.keys(doc.elements[id]).length) delete doc.elements[id]; }
  return doc;
}

/**
 * The expanding row: every property with its choices, the value in force, where it comes from (override / asset / default),
 * and the base it resets to. Shortcuts resolve to their element first, so both show the same rows.
 */
export function propertyRows(element, raw, catalog) {
  const doc = normalizeOverrides(raw);
  const over = doc.elements[element.id] ?? {};
  return propsOf(element, catalog).map((p) => {
    const overridden = p.id in over;
    return { ...p, value: overridden ? over[p.id] : p.default, base: p.default, overridden, source: overridden ? 'override' : p.source === 'asset' && catalog.skin ? 'skin' : p.source };
  });
}

/** How many overrides an element (or everything) carries. */
export const overrideCount = (raw, elementId = '') => { const d = normalizeOverrides(raw); return elementId ? Object.keys(d.elements[elementId] ?? {}).length : Object.values(d.elements).reduce((n, m) => n + Object.keys(m).length, 0); };

/* ================================================================== live preview */

export const selectorOf = (e) => e.selector || (e.address ? `[data-axf-target="${e.address.replace(/"/g, '')}"]` : `[data-axf-element="${e.id.replace(/"/g, '')}"]`);
const unitCss = (v, unit) => unit === 'px' ? `${v}px` : unit === 'em' ? `${v}em` : unit === 'space' ? `calc(var(--fx-space) * ${v})` : unit === 'font' ? `calc(var(--fx-font-size) * ${v})` : unit === '%' ? `${v}%` : String(v);

/**
 * What the runtime applies for a live preview of the pending overrides: CSS scoped to each element's selector (tokens only:
 * a colour becomes var(--fx-<token>), a size keeps its unit, transparency is an opacity, hidden is display:none), `swaps`
 * (asset in force per element) and `patches` (asset fields) for the runtime's chrome patch keys. Nothing is saved.
 */
export function previewPlan(elements, raw, catalog) {
  const doc = normalizeOverrides(raw);
  const rules = [], swaps = [], patches = [];
  for (const [id, over] of Object.entries(doc.elements)) {
    const e = resolveElement(id, elements);
    if (!e) continue;
    const props = propsOf(e, catalog);
    const decl = [];
    for (const [pid, v] of Object.entries(over)) {
      const p = props.find((x) => x.id === pid);
      if (!p) continue;
      if (pid === 'visible') { if (v === false) decl.push('display:none'); continue; }
      if (pid === 'transparency') { decl.push(`opacity:${Number(v) / 100}`); continue; }
      if (pid === 'asset') { swaps.push({ element: e.id, type: p.assetType, id: String(v) }); continue; }
      if (pid.startsWith('field:')) { patches.push({ element: e.id, type: p.assetType, path: p.path, value: v }); continue; }
      if (pid.startsWith('token:')) {
        if (p.kind === 'token' && typeof v === 'string' && v.startsWith(TOKEN_REF)) { if (p.token) decl.push(`${p.token}:var(--fx-${kebab(v.slice(1))})`); continue; }
        if (p.kind === 'range' && p.token) { decl.push(`${p.token}:${unitCss(v, p.unit)}`); continue; }
        if (p.kind === 'bool' || p.kind === 'enum' || !p.token) { patches.push({ element: e.id, target: p.target, path: p.path, value: v }); continue; }
        if (p.token) decl.push(`${p.token}:${String(v)}`);
      }
    }
    if (decl.length) rules.push(`${selectorOf(e)}{${decl.join(';')}}`);
  }
  return { css: rules.join('\n'), swaps, patches };
}

/* ================================================================== change log */

/** Every difference between two override documents: element, property, from → to (undefined = not set). */
export function diffOverrides(beforeRaw, afterRaw) {
  const a = normalizeOverrides(beforeRaw).elements, b = normalizeOverrides(afterRaw).elements;
  const out = [];
  for (const id of uniq([...Object.keys(a), ...Object.keys(b)])) {
    for (const p of uniq([...Object.keys(a[id] ?? {}), ...Object.keys(b[id] ?? {})])) {
      const from = a[id]?.[p], to = b[id]?.[p];
      if (from !== to) out.push({ element: id, prop: p, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) });
    }
  }
  return out.sort((x, y) => x.element.localeCompare(y.element) || x.prop.localeCompare(y.prop));
}

/** One applied change set (ui-change@1): who, when, what; `undone` once undone. */
export function changeEntry(changes, { by = 'brett', at = new Date().toISOString(), note = '' } = {}) {
  const list = (Array.isArray(changes) ? changes : []).filter((c) => isObj(c) && ELEMENT_ID.test(str(c.element, 200)) && PROP_ID.test(str(c.prop, 120)))
    .map((c) => ({ element: c.element, prop: c.prop, ...('from' in c ? { from: c.from } : {}), ...('to' in c ? { to: c.to } : {}) }));
  // the id carries the time to the millisecond and a hash of the content, so two applies in one second never collide
  return { $axf: CHANGE_FRAME, id: `ch-${at.replace(/[^0-9]/g, '').slice(0, 17)}-${slug(by).slice(0, 12) || 'x'}-${hash(JSON.stringify(list) + note)}`, by: str(by, 80) || 'brett', at, ...(str(note, 400) ? { note: str(note, 400) } : {}), changes: list, undone: false };
}
/** A short, stable content hash (FNV-1a, base36). */
export function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36).padStart(7, '0').slice(0, 7); }

/** The document with one change set undone (each property back to its `from`; a property that was not set is reset). */
export function undoChange(raw, entry) {
  let doc = normalizeOverrides(raw);
  for (const c of entry?.changes ?? []) {
    if ('from' in c && SCALAR(c.from)) { doc.elements[c.element] = { ...(doc.elements[c.element] ?? {}), [c.prop]: c.from }; }
    else doc = withoutOverride(doc, c.element, c.prop);
  }
  return doc;
}

/** The exit summary lines (element label, property label, old → new), ready to show before Apply. */
export function summarize(changes, elements, catalog) {
  return changes.map((c) => {
    const e = resolveElement(c.element, elements);
    const p = e ? propsOf(e, catalog).find((x) => x.id === c.prop) : null;
    const show = (v) => (v === undefined ? (p ? `${String(p.default)} (default)` : 'default') : String(v));
    return { element: c.element, elementLabel: e?.label ?? c.element, prop: c.prop, propLabel: p?.label ?? c.prop, from: show(c.from), to: show(c.to) };
  });
}
