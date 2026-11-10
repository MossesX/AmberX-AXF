/**
 * skin-sections@1 (build skins-as-packages-of-slices, Fable, Nov 10 2026): a skin is a package of sections.
 *
 * Brett (Nov 10 2026): "Every skin has to be a package of chunks. Every single thing has to be its own asset. It can't
 * be one. Every section must be its own chunk." A skin manifest (skin@1, `data.sections`) only names one asset per
 * section; every section is a standalone asset of its own type, with a name, a preview, tags and a source:
 *
 *   colors      color-theme      design      style-theme      layout     layout         behavior   behavior-theme
 *   typography  typography       density     density          sizing     sizing         icons      icon-pack
 *   controls    style-package    chrome      chrome-set       parts      style-parts
 *
 * Two asset types carry what used to sit inline in a skin or a design package:
 *   chrome-set@1   `{ slots: type → asset id (title bar, menus, toolbar, nav, context menus, widgets …), hidden:
 *                     type → bool, spacing: tight | compact | regular, settings: appearance key → value }`
 *   style-parts@1  `{ parts: { <asset type>: { <customize token>: value } } }`
 *
 * Applying a skin takes some sections and leaves others out (`mixSkins`): a left-out section keeps what is in force
 * now. A result drawn from more than one skin is a mix; the UI and the CLI offer to save it as a new skin
 * (`skinManifest`). A skin travels as a skin-package@1 file with its section assets inside (`exportSkinPackage`,
 * `importSkinPackage`). The resolved form the runtime composes with (layoutTheme, colorTheme, styleTheme, assets,
 * iconPack, parts, extras) is built from the sections by `resolveSections`; `applySectionOverrides` swaps or drops
 * sections on a resolved skin (the app-look@1 `skin.sections` state).
 *
 * Plain JS shared by the TS engine (skin.ts), the build engine, the skins CLI and the console server. Pure; the
 * Kotlin twin is deferred (spec/PORTING.md, "skin-sections@1").
 */
import { partsErrors } from './skin-coverage.mjs';

export const SKIN_SECTIONS_CONTRACT = 'skin-sections@1';
export const SKIN_PACKAGE_FRAME = 'skin-package@1';
export const CHROME_SET_TYPE = 'chrome-set';
export const STYLE_PARTS_TYPE = 'style-parts';

/** The sections of a skin package, in the order a template shows them. `required`: a skin must name one. */
export const SKIN_SECTIONS = Object.freeze([
  { id: 'colors', label: 'Colours', type: 'color-theme', icon: 'palette', required: true, what: 'Background, surfaces, text and accent colours.' },
  { id: 'design', label: 'Design', type: 'style-theme', icon: 'sparkles', required: true, what: 'Type, radii, shadows and the look of every surface.' },
  { id: 'layout', label: 'Layout', type: 'layout', icon: 'layout', required: true, what: 'Where the bars, menus and content sit.' },
  { id: 'behavior', label: 'Behaviour', type: 'behavior-theme', icon: 'zap', required: false, what: 'Motion, interaction, windows and feedback.' },
  { id: 'typography', label: 'Typography', type: 'typography', icon: 'type', required: false, what: 'Font sizes and line heights.' },
  { id: 'density', label: 'Density', type: 'density', icon: 'list', required: false, what: 'Gaps, paddings and row heights.' },
  { id: 'sizing', label: 'Sizing', type: 'sizing', icon: 'maximize', required: false, what: 'Control and widget sizes.' },
  { id: 'icons', label: 'Icons', type: 'icon-pack', icon: 'star', required: false, what: 'The icon set every button and menu draws with.' },
  { id: 'controls', label: 'Controls', type: 'style-package', icon: 'package', required: false, what: 'Buttons, containers, sliders, dialogs, pop-ups, tabs, gauges and meters.' },
  { id: 'chrome', label: 'Chrome', type: CHROME_SET_TYPE, icon: 'layers', required: false, what: 'Title bar, menus, toolbar, navigation, context menus, widgets, spacing, and what is shown or hidden.' },
  { id: 'parts', label: 'Parts', type: STYLE_PARTS_TYPE, icon: 'sliders', required: false, what: 'Style tweaks per drawn part: radius, weight, hover, colours.' },
].map(Object.freeze));

export const SKIN_SECTION_IDS = Object.freeze(SKIN_SECTIONS.map((s) => s.id));
export const REQUIRED_SECTIONS = Object.freeze(SKIN_SECTIONS.filter((s) => s.required).map((s) => s.id));
const BY_ID = Object.fromEntries(SKIN_SECTIONS.map((s) => [s.id, s]));
const BY_TYPE = Object.fromEntries(SKIN_SECTIONS.map((s) => [s.type, s.id]));
/** Section id → the appearance slot it fills (the bundle sections have none). */
const SLOT_OF = { colors: 'color-theme', design: 'style-theme', layout: 'layout', behavior: 'behavior-theme', typography: 'typography', density: 'density', sizing: 'sizing', controls: 'style-package' };
/** Slots a skin never sets (the same list as skin-rules.mjs SKIN_NEVER, repeated here so this module stays leaf-level). */
const NEVER = ['uac-policy', 'help', 'skin', 'design-package', 'interface', CHROME_SET_TYPE, STYLE_PARTS_TYPE];
const SPACINGS = ['tight', 'compact', 'regular'];
const ID = /^[a-z0-9][a-z0-9-]*$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export const skinSection = (id) => BY_ID[id] ?? null;
export const sectionOfType = (type) => BY_TYPE[type] ?? '';
export const sectionType = (id) => BY_ID[id]?.type ?? '';
export const isSectionId = (id) => typeof id === 'string' && !!BY_ID[id];
/** The slot types a chrome set may hold: anything that is not a section's own type, a style-package member, or never set by a skin. */
export function chromeSlotTypes(allTypes, members = []) {
  return allTypes.filter((t) => !BY_TYPE[t] && !members.includes(t) && !NEVER.includes(t));
}

/* ---------------------------------------------------------------- the two bundle asset types */

function idMap(raw, keep = () => true) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (ID.test(k) && typeof v === 'string' && ID.test(v) && keep(k)) out[k] = v;
  return out;
}
function boolMap(raw) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
  return out;
}

/** chrome-set@1 kept: slots that are chrome / widget types (never a section's type or a control member), hidden, spacing, settings. */
export function normalizeChromeSet(raw, members = []) {
  const d = isObj(raw) ? raw : {};
  const out = { slots: idMap(d.slots, (t) => !BY_TYPE[t] && !members.includes(t) && !NEVER.includes(t)) };
  if (isObj(d.hidden)) out.hidden = boolMap(d.hidden);
  if (SPACINGS.includes(d.spacing)) out.spacing = d.spacing;
  if (isObj(d.settings)) out.settings = { ...d.settings };
  return out;
}

/** Validation messages for a chrome set (the core validator and the build engine both call this). */
export function chromeSetErrors(raw, members = []) {
  if (!isObj(raw)) return ['data must be an object'];
  const errors = [];
  if (!isObj(raw.slots)) errors.push('data.slots must be an object (asset type → asset id)');
  else for (const [t, id] of Object.entries(raw.slots)) {
    if (BY_TYPE[t]) errors.push(`data.slots.${t}: ${t} is the ${BY_ID[BY_TYPE[t]].label} section of a skin, not chrome`);
    else if (members.includes(t)) errors.push(`data.slots.${t}: a control belongs to the Controls section (style-package)`);
    else if (NEVER.includes(t)) errors.push(`data.slots.${t}: a chrome set never sets ${t}`);
    else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.slots.${t} must be an asset id`);
  }
  if ('hidden' in raw && (!isObj(raw.hidden) || Object.values(raw.hidden).some((v) => typeof v !== 'boolean'))) errors.push('data.hidden must map asset types to true / false');
  if ('spacing' in raw && !SPACINGS.includes(raw.spacing)) errors.push('data.spacing must be tight, compact or regular');
  if ('settings' in raw && !isObj(raw.settings)) errors.push('data.settings must be an object');
  return errors;
}

/** style-parts@1 kept: `{ parts }` as given (the TS engine normalizes each type's tokens against the registry). */
export function normalizeStyleParts(raw) {
  const d = isObj(raw) ? raw : {};
  return { parts: isObj(d.parts) ? { ...d.parts } : {} };
}

/** Validation messages for style parts; `types` / `targets` are the registry and the style targets (skin-coverage@1). */
export function stylePartsErrors(raw, types, targets) {
  if (!isObj(raw)) return ['data must be an object'];
  if (!isObj(raw.parts)) return ['data.parts must be an object (asset type → customize tokens)'];
  return partsErrors(raw.parts, types, targets).map((e) => e.replace(/^data\.parts/, 'data.parts'));
}

/* ---------------------------------------------------------------- the manifest: sections */

/** Keep only known sections with well-formed asset ids. */
export function normalizeSections(raw) {
  const out = {};
  if (isObj(raw)) for (const s of SKIN_SECTIONS) if (typeof raw[s.id] === 'string' && ID.test(raw[s.id])) out[s.id] = raw[s.id];
  return out;
}

/** Validation messages for `data.sections` of a skin manifest. */
export function sectionsErrors(raw) {
  if (!isObj(raw)) return ['data.sections must be an object (section → asset id)'];
  const errors = [];
  for (const id of REQUIRED_SECTIONS) if (typeof raw[id] !== 'string' || !ID.test(raw[id])) errors.push(`data.sections.${id} must be a ${BY_ID[id].type} asset id`);
  for (const [k, v] of Object.entries(raw)) {
    if (!BY_ID[k]) errors.push(`data.sections.${k}: not a skin section (one of ${SKIN_SECTION_IDS.join(', ')})`);
    else if (!REQUIRED_SECTIONS.includes(k) && (typeof v !== 'string' || !ID.test(v))) errors.push(`data.sections.${k} must be a ${BY_ID[k].type} asset id`);
  }
  return errors;
}

/**
 * The sections a resolved skin names as assets: `sections` when the manifest has them, else what the legacy fields
 * say (themes, scale slots, behaviour, the style package, the icon pack). Inline chrome and parts are not here: see
 * `inlineSectionsOf`.
 */
export function sectionsOf(skin) {
  const s = isObj(skin) ? skin : {};
  if (isObj(s.sections) && Object.keys(s.sections).length) return normalizeSections(s.sections);
  const out = {};
  const assets = isObj(s.assets) ? s.assets : {};
  if (s.colorTheme) out.colors = s.colorTheme;
  if (s.styleTheme) out.design = s.styleTheme;
  if (s.layoutTheme) out.layout = s.layoutTheme;
  for (const [sec, slot] of Object.entries(SLOT_OF)) if (!out[sec] && typeof assets[slot] === 'string') out[sec] = assets[slot];
  if (typeof s.iconPack === 'string') out.icons = s.iconPack;
  return out;
}

/** The chrome and parts a resolved skin carries inline (legacy skins, design packages): as chrome-set / style-parts data. */
export function inlineSectionsOf(skin, members = []) {
  const s = isObj(skin) ? skin : {};
  const out = {};
  const named = sectionsOf(s);
  if (!named.chrome) {
    const chrome = normalizeChromeSet({ slots: s.assets, hidden: s.extras?.hidden, spacing: s.extras?.spacing, settings: s.extras?.settings }, members);
    if (Object.keys(chrome.slots).length || chrome.hidden && Object.keys(chrome.hidden).length || chrome.spacing || chrome.settings && Object.keys(chrome.settings).length) out.chrome = chrome;
  }
  if (!named.parts && isObj(s.parts) && Object.keys(s.parts).length) out.parts = { parts: { ...s.parts } };
  return out;
}

/* ---------------------------------------------------------------- resolving sections into the composed form */

/** Take one section out of a resolved skin (its slots, its extras, its parts). */
export function stripSection(skin, sec, members = []) {
  const out = { ...skin, assets: { ...(skin.assets ?? {}) } };
  if (out.sections) { out.sections = { ...out.sections }; delete out.sections[sec]; }
  if (sec === 'colors') out.colorTheme = '';
  else if (sec === 'design') out.styleTheme = '';
  else if (sec === 'layout') out.layoutTheme = '';
  else if (sec === 'icons') delete out.iconPack;
  else if (sec === 'controls') { delete out.assets['style-package']; for (const t of members) delete out.assets[t]; }
  else if (sec === 'chrome') { for (const t of Object.keys(out.assets)) if (!BY_TYPE[t] && !members.includes(t)) delete out.assets[t]; delete out.extras; }
  else if (sec === 'parts') delete out.parts;
  else if (SLOT_OF[sec]) delete out.assets[SLOT_OF[sec]];
  return out;
}

/**
 * Put one section asset into a resolved skin. `resolve(type, id)` gives an asset's data (null = unknown); the bundle
 * sections (controls' members, chrome, parts) need it, the others only record the id.
 */
export function setSection(skin, sec, id, resolve, members = []) {
  const out = stripSection(skin, sec, members);
  if (!ID.test(id ?? '')) return out;
  out.sections = { ...(out.sections ?? {}), [sec]: id };
  const data = resolve ? resolve(sectionType(sec), id) : null;
  if (sec === 'colors') out.colorTheme = id;
  else if (sec === 'design') out.styleTheme = id;
  else if (sec === 'layout') out.layoutTheme = id;
  else if (sec === 'icons') out.iconPack = id;
  else if (sec === 'controls') {
    out.assets['style-package'] = id;
    if (isObj(data) && isObj(data.slots)) for (const [t, v] of Object.entries(data.slots)) if (members.includes(t) && typeof v === 'string' && ID.test(v)) out.assets[t] = v;
  } else if (sec === 'chrome') {
    if (isObj(data)) {
      const c = normalizeChromeSet(data, members);
      Object.assign(out.assets, c.slots);
      const x = {};
      if (c.spacing) x.spacing = c.spacing;
      if (c.hidden && Object.keys(c.hidden).length) x.hidden = c.hidden;
      if (c.settings && Object.keys(c.settings).length) x.settings = c.settings;
      if (Object.keys(x).length) out.extras = x;
    }
  } else if (sec === 'parts') {
    if (isObj(data) && isObj(data.parts) && Object.keys(data.parts).length) out.parts = { ...data.parts };
  } else if (SLOT_OF[sec]) out.assets[SLOT_OF[sec]] = id;
  return out;
}

/** A sections map as a resolved skin (the fields the runtime composes with). */
export function resolveSections(sections, resolve, members = []) {
  let out = { layoutTheme: '', colorTheme: '', styleTheme: '', assets: {}, sections: {} };
  for (const s of SKIN_SECTIONS) if (sections[s.id]) out = setSection(out, s.id, sections[s.id], resolve, members);
  return out;
}

/**
 * app-look@1 `skin.sections` over a resolved skin: `{ <section>: <asset id> }` swaps that section, `{ <section>: null }`
 * leaves it out (the app's own look shows through there).
 */
export function applySectionOverrides(skin, overrides, resolve, members = []) {
  let out = skin;
  for (const [sec, v] of Object.entries(overrides ?? {})) {
    if (!BY_ID[sec]) continue;
    out = v ? setSection(out, sec, v, resolve, members) : stripSection(out, sec, members);
  }
  return out;
}

/** `skin.sections` kept: known sections → asset id or null. */
export function normalizeSectionOverrides(raw) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (BY_ID[k] && (v === null || (typeof v === 'string' && ID.test(v)))) out[k] = v;
  return out;
}

/* ---------------------------------------------------------------- mixing: apply with picks */

/**
 * Applying `incoming` with only `include` sections over what is in force now.
 *   current  `{ skin, sections }`: the skin in force ('' = the app's own look) and its sections (asset ids; a section
 *            the current look only has inline, or not at all, is absent)
 *   incoming `{ skin, sections }`: the skin being applied
 *   include  the sections taken from `incoming` (default: every section it has); the rest keep the current's
 * Returns the resulting sections, which skin each came from, whether that is a mix of more than one skin, and the
 * `skin.sections` overrides that give this result when `incoming.skin` is picked. A mix is a section the incoming
 * skin has that the result takes from elsewhere (left out or swapped); a section the incoming skin does not cover
 * keeps the current one without making a mix, so applying a whole skin never asks to save a new one.
 */
export function mixSkins(current, incoming, include) {
  const cur = { skin: current?.skin ?? '', sections: normalizeSections(current?.sections) };
  const inc = { skin: incoming?.skin ?? '', sections: normalizeSections(incoming?.sections) };
  const take = new Set(Array.isArray(include) ? include.filter(isSectionId) : Object.keys(inc.sections));
  const sections = {};
  const sources = {};
  const overrides = {};
  const left = [];
  for (const s of SKIN_SECTIONS) {
    const id = s.id;
    if (take.has(id) && inc.sections[id]) { sections[id] = inc.sections[id]; sources[id] = inc.skin; continue; }
    if (inc.sections[id]) left.push(id);
    if (cur.sections[id]) {
      sections[id] = cur.sections[id];
      sources[id] = cur.sections[id] === inc.sections[id] ? inc.skin : (cur.skin || 'own');
      if (inc.sections[id] !== cur.sections[id]) overrides[id] = cur.sections[id];
    } else if (inc.sections[id]) overrides[id] = null;
  }
  const from = [...new Set(Object.values(sources))];
  const mixed = SKIN_SECTIONS.some((s) => inc.sections[s.id] && sections[s.id] && sources[s.id] !== inc.skin);
  return { sections, sources, mixed, from, left, overrides };
}

/* ---------------------------------------------------------------- manifests, packages, catalog */

/** A skin manifest (asset@1 envelope) from a sections map. */
export function skinManifest(meta, sections, preview) {
  const id = typeof meta.id === 'string' && ID.test(meta.id) ? meta.id : slug(meta.name ?? 'skin');
  const data = { sections: normalizeSections(sections) };
  if (isObj(preview) && (preview.caption || preview.image)) data.preview = { ...(preview.caption ? { caption: String(preview.caption).slice(0, 200) } : {}), ...(preview.image ? { image: String(preview.image).slice(0, 20000) } : {}) };
  return { $axf: 'asset@1', type: 'skin', id, name: String(meta.name ?? id).trim().slice(0, 120) || id, version: String(meta.version ?? '1.0.0'), description: String(meta.description ?? '').slice(0, 500), author: String(meta.author ?? '').slice(0, 80), tags: Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).slice(0, 40)).slice(0, 20) : ['skin'], data };
}

/** A lower-case id from a name (`My Skin 2` → `my-skin-2`). */
export function slug(name) {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return ID.test(s) && s.length > 1 ? s : `skin-${Date.now().toString(36)}`;
}

/** The errors of a manifest whose sections name assets that do not exist (`has(type, id)`). */
export function missingSections(sections, has) {
  const out = [];
  for (const [sec, id] of Object.entries(normalizeSections(sections))) if (!has(sectionType(sec), id)) out.push(`${sec}: no ${sectionType(sec)} "${id}"`);
  return out;
}

/** A skin and its section assets as one portable file (skin-package@1). `assetOf(type, id)` gives the asset envelope. */
export function exportSkinPackage(skinAsset, assetOf) {
  const sections = sectionsOf(skinAsset?.data);
  const items = [];
  const missing = [];
  for (const [sec, id] of Object.entries(sections)) {
    const a = assetOf(sectionType(sec), id);
    if (a) items.push(a); else missing.push(`${sec}: ${sectionType(sec)} ${id}`);
  }
  return { $axf: SKIN_PACKAGE_FRAME, exportedAt: new Date().toISOString(), skin: skinAsset, sections: items, missing };
}

/** A skin-package@1 file checked: the skin manifest and the section assets it carries (each of the right type). */
export function importSkinPackage(raw) {
  if (!isObj(raw) || raw.$axf !== SKIN_PACKAGE_FRAME) return { ok: false, errors: ['not a skin-package@1 file'] };
  const errors = [];
  const skin = raw.skin;
  if (!isObj(skin) || skin.$axf !== 'asset@1' || skin.type !== 'skin' || typeof skin.id !== 'string' || !ID.test(skin.id) || !isObj(skin.data)) errors.push('skin must be a skin asset@1');
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const wanted = isObj(skin?.data) ? sectionsOf(skin.data) : {};
  const have = new Set();
  for (const a of sections) {
    if (!isObj(a) || a.$axf !== 'asset@1' || typeof a.type !== 'string' || typeof a.id !== 'string' || !ID.test(a.id) || !isObj(a.data)) { errors.push('every section must be an asset@1 with a type, an id and data'); continue; }
    const sec = sectionOfType(a.type);
    if (!sec) errors.push(`${a.type}/${a.id}: ${a.type} is not a skin section type`);
    else if (wanted[sec] !== a.id) errors.push(`${a.type}/${a.id}: the skin does not name it as its ${sec}`);
    else have.add(sec);
  }
  return { ok: errors.length === 0, errors, skin, sections: sections.filter(isObj), notIncluded: Object.keys(wanted).filter((s) => !have.has(s)) };
}

/**
 * The slice library: every section asset there is, by section, with who uses it. `lists(type)` gives the assets of a
 * type (envelopes with `__source` when known); `skins` are the skin entries (`{ id, name, data }`).
 */
export function sliceCatalog(lists, skins = []) {
  const usedBy = {};
  for (const s of skins) for (const [sec, id] of Object.entries(sectionsOf(s.data))) (usedBy[`${sec}/${id}`] ??= []).push(s.id);
  const out = [];
  for (const s of SKIN_SECTIONS) {
    for (const a of lists(s.type) ?? []) {
      out.push({ section: s.id, type: s.type, id: a.id, name: a.name ?? a.id, description: a.description ?? '', tags: Array.isArray(a.tags) ? a.tags : [], source: a.__source ?? 'builtin', usedBy: usedBy[`${s.id}/${a.id}`] ?? [], preview: slicePreview(s.id, a.data) });
    }
  }
  return out;
}

/** What a slice card shows: colour swatches for a colour theme, a few facts for the rest. */
export function slicePreview(sec, data) {
  const d = isObj(data) ? data : {};
  if (sec === 'colors') { const t = isObj(d.tokens) ? d.tokens : {}; return { swatches: [t.bg, t.surface, t.accent, t.text].filter((x) => typeof x === 'string'), scheme: d.scheme ?? '' }; }
  if (sec === 'layout') return { facts: [d.nav ? `nav ${d.nav}` : '', d.toolbarPosition ? `toolbar ${d.toolbarPosition}` : '', d.inspector && d.inspector !== 'none' ? `inspector ${d.inspector}` : ''].filter(Boolean) };
  if (sec === 'controls') return { facts: Object.keys(isObj(d.slots) ? d.slots : {}).slice(0, 8) };
  if (sec === 'chrome') return { facts: [...Object.keys(isObj(d.slots) ? d.slots : {}).slice(0, 6), d.spacing ? `${d.spacing} spacing` : ''].filter(Boolean) };
  if (sec === 'parts') return { facts: Object.keys(isObj(d.parts) ? d.parts : {}).slice(0, 8) };
  if (sec === 'design') return { facts: [d.fontFamily ? String(d.fontFamily).split(',')[0] : '', d.radius != null ? `radius ${d.radius}` : ''].filter(Boolean) };
  return { facts: [] };
}

/* ---------------------------------------------------------------- thumbnails */

/**
 * A skin's thumbnail as an SVG: the colour theme's tokens (bg, surface, text, accent, border) laid out as the layout
 * says (nav left / right / top / none, toolbar on or off). Deterministic, no browser needed, small enough for a
 * manifest's `preview.image` as a data URI (`thumbnailDataUri`).
 */
export function skinThumbnail(colors, layout, opts = {}) {
  const c = isObj(colors) ? colors : {};
  const l = isObj(layout) ? layout : {};
  const w = 160, h = 100;
  const bg = hex(c.bg, '#1c1c1e'), surface = hex(c.surface, '#2c2c2e'), text = hex(c.text, '#f2f2f7'), accent = hex(c.accent, '#f5a623'), border = hex(c.border, surface);
  const nav = l.nav === 'right' ? 'right' : l.nav === 'top' ? 'top' : l.nav === 'none' ? 'none' : 'left';
  const bar = l.showToolbar !== false;
  const parts = [`<rect width="${w}" height="${h}" fill="${bg}"/>`];
  let top = 0;
  parts.push(`<rect x="0" y="0" width="${w}" height="10" fill="${surface}"/>`, `<circle cx="7" cy="5" r="2.5" fill="${accent}"/>`, `<rect x="14" y="3.5" width="30" height="3" rx="1.5" fill="${text}" opacity=".7"/>`);
  top = 10;
  if (bar) { parts.push(`<rect x="0" y="${top}" width="${w}" height="8" fill="${surface}" opacity=".7"/>`); for (let i = 0; i < 5; i++) parts.push(`<rect x="${6 + i * 11}" y="${top + 2}" width="7" height="4" rx="1" fill="${text}" opacity=".45"/>`); top += 8; }
  let x0 = 0, cw = w;
  if (nav === 'left' || nav === 'right') {
    const nx = nav === 'left' ? 0 : w - 34;
    parts.push(`<rect x="${nx}" y="${top}" width="34" height="${h - top}" fill="${surface}"/>`);
    for (let i = 0; i < 5; i++) parts.push(`<rect x="${nx + 5}" y="${top + 6 + i * 11}" width="${i === 1 ? 22 : 18}" height="3.5" rx="1.5" fill="${i === 1 ? accent : text}" opacity="${i === 1 ? 1 : 0.5}"/>`);
    x0 = nav === 'left' ? 34 : 0; cw = w - 34;
  } else if (nav === 'top') { parts.push(`<rect x="0" y="${top}" width="${w}" height="9" fill="${surface}" opacity=".9"/>`); for (let i = 0; i < 4; i++) parts.push(`<rect x="${8 + i * 26}" y="${top + 3}" width="18" height="3" rx="1.5" fill="${i === 0 ? accent : text}" opacity="${i === 0 ? 1 : 0.5}"/>`); top += 9; }
  const px = x0 + 7, py = top + 7;
  parts.push(`<rect x="${px}" y="${py}" width="${Math.round(cw * 0.5)}" height="5" rx="2" fill="${text}" opacity=".9"/>`);
  parts.push(`<rect x="${px}" y="${py + 10}" width="${cw - 14}" height="22" rx="3" fill="${surface}" stroke="${border}" stroke-width="1"/>`);
  parts.push(`<rect x="${px + 6}" y="${py + 16}" width="${Math.round(cw * 0.45)}" height="3" rx="1.5" fill="${text}" opacity=".6"/>`, `<rect x="${px + 6}" y="${py + 23}" width="${Math.round(cw * 0.3)}" height="3" rx="1.5" fill="${text}" opacity=".35"/>`);
  parts.push(`<rect x="${px}" y="${py + 38}" width="${Math.round((cw - 18) / 2)}" height="18" rx="3" fill="${surface}" stroke="${border}" stroke-width="1"/>`, `<rect x="${px + Math.round((cw - 18) / 2) + 4}" y="${py + 38}" width="${Math.round((cw - 18) / 2)}" height="18" rx="3" fill="${surface}" stroke="${border}" stroke-width="1"/>`);
  parts.push(`<rect x="${px}" y="${h - 14}" width="30" height="9" rx="${opts.radius === 'pill' ? 4.5 : opts.radius === 'none' ? 0 : 2}" fill="${accent}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(opts.name ?? 'Skin')}">${parts.join('')}</svg>`;
}

export function thumbnailDataUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%22/g, "'")}`;
}

function hex(v, fb) { return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fb; }
function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
