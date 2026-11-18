/**
 * toolbar-widgets@1 rules (build attach-widgets-to-any-toolbar-banner, Nov 16 2026; Brett, Nov 13: "I can attach widgets
 * to the toolbar right, just like the banner widgets").
 *
 * ONE rules file, plain JS, so core/validate.ts (the reference validator), cli/build-engine.mjs (axf validate, the JSON
 * Schemas) and the TS engine (toolbar-widgets.ts) read the same constants and give the same messages:
 *
 *   hostEntry           one entry of a widget host's list (banner.attach[], toolbar.widgets[]): type, id, at, order
 *                       (checked by validateHostAttachments in widgets.ts) plus the banner widget style (`widget`) and a
 *                       shape@1 ref (`shape`), checked here. The word lists mirror asset-types.json → hostEntry.widget
 *                       (spec/check-widgets.mts keeps them equal).
 *   host shape          a host's `shape { icon, chip }` default widget shapes: shape@1 asset ids, form only (the shape
 *                       asset may ship later; an unknown id falls back to the engine default at run time).
 *   settings keys       axf.toolbar.<id>.widgets (the person's slots for one toolbar instance), axf.toolbar.<id>.widgetStyle
 *                       (defaults for every widget on it), axf.toolbars.widgetStyle (defaults for every toolbar in the app).
 *                       `<id>` is the toolbar's chrome-settings instance (`app` for the app's own toolbar).
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); fixture spec/fixtures/toolbar-widgets.json.
 */

export const TOOLBAR_WIDGETS_CONTRACT = 'toolbar-widgets@1';
/** The app's own toolbar: the chrome-settings instance id (the others are a page toolbar's asset id, `axf-ws-toolbar:<ws>`, …). */
export const TOOLBAR_APP_INSTANCE = 'app';
/** Most slots one toolbar keeps (a damaged setting can't grow without bound). */
export const TOOLBAR_WIDGETS_MAX = 60;
/** A person's additions order after the host's own (index × 10) and run-time ones (1000 + index × 10). */
export const TOOLBAR_PERSON_ORDER = 2000;

export const TOOLBARS_WIDGET_STYLE_KEY = 'axf.toolbars.widgetStyle';
export const TOOLBAR_WIDGETS_KEY = (instance) => `axf.toolbar.${instance}.widgets`;
export const TOOLBAR_WIDGET_STYLE_KEY = (instance) => `axf.toolbar.${instance}.widgetStyle`;
/** The instance a widgets key belongs to, else null. */
export function toolbarInstanceOfKey(key) {
  const m = /^axf\.toolbar\.([a-z0-9][a-z0-9._:/-]{0,119})\.widgets$/i.exec(String(key ?? ''));
  return m ? m[1] : null;
}

/** = asset-types.json → hostEntry.widget (checked equal in spec/check-widgets.mts). */
export const HOST_ENTRY_WIDGET = {
  sizes: ['icon', 'compact', 'normal', 'wide'],
  shows: ['auto', 'both', 'icon', 'text', 'number'],
  priority: { min: 1, max: 9, default: 5 },
  widthUnits: ['px', 'ch'],
  aliasesMax: 12,
};
/** Fields of the banner widget style a host entry may carry, each with its check. */
export const HOST_ENTRY_WIDGET_FIELDS = ['label', 'icon', 'size', 'show', 'priority', 'hideWhenEmpty', 'overflow', 'hidden', 'aliases'];
/** Fields a person's per-toolbar default style may set (the per-widget prefs add hidden, maxWidth, maxUnit). */
export const WIDGET_STYLE_FIELDS = ['size', 'show', 'priority', 'hideWhenEmpty', 'overflow', 'shape'];

/** = asset-types.json → envelope.idPattern (a shape@1 asset id). */
export const ASSET_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** A toolbar instance id (the chrome-settings instance rule). */
export const TOOLBAR_INSTANCE = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;
export const isToolbarInstanceId = (v) => typeof v === 'string' && TOOLBAR_INSTANCE.test(v);
export const isShapeId = (v) => typeof v === 'string' && ASSET_ID.test(v);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Errors in one host entry's `widget` and `shape` (the validators add these to validateHostAttachments' own). `path` is
 * the entry's path (`data.widgets[2]`). Unknown fields inside `widget` are errors: a mistyped field would silently do
 * nothing at run time.
 */
export function hostEntryErrors(path, entry) {
  if (!isObj(entry)) return [];
  const errors = [];
  if ('widget' in entry) {
    const w = entry.widget;
    const p = `${path}.widget`;
    if (!isObj(w)) errors.push(`${p} must be an object (banner widget style)`);
    else {
      for (const k of Object.keys(w)) if (!HOST_ENTRY_WIDGET_FIELDS.includes(k)) errors.push(`${p}.${k} is not a widget style field (one of: ${HOST_ENTRY_WIDGET_FIELDS.join(', ')})`);
      if ('label' in w && (typeof w.label !== 'string' || !w.label.trim())) errors.push(`${p}.label must be a non-empty string`);
      if ('icon' in w && (typeof w.icon !== 'string' || !w.icon.trim())) errors.push(`${p}.icon must be a non-empty string`);
      if ('size' in w && !HOST_ENTRY_WIDGET.sizes.includes(w.size)) errors.push(`${p}.size must be one of: ${HOST_ENTRY_WIDGET.sizes.join(', ')}`);
      if ('show' in w && !HOST_ENTRY_WIDGET.shows.includes(w.show)) errors.push(`${p}.show must be one of: ${HOST_ENTRY_WIDGET.shows.join(', ')}`);
      if ('priority' in w && !isInt(w.priority, HOST_ENTRY_WIDGET.priority.min, HOST_ENTRY_WIDGET.priority.max)) errors.push(`${p}.priority must be a whole number from ${HOST_ENTRY_WIDGET.priority.min} to ${HOST_ENTRY_WIDGET.priority.max}`);
      for (const k of ['hideWhenEmpty', 'overflow', 'hidden']) if (k in w && typeof w[k] !== 'boolean') errors.push(`${p}.${k} must be a boolean`);
      if ('aliases' in w) {
        if (!Array.isArray(w.aliases) || w.aliases.some((a) => typeof a !== 'string' || !a.trim())) errors.push(`${p}.aliases must be a list of non-empty strings`);
        else if (w.aliases.length > HOST_ENTRY_WIDGET.aliasesMax) errors.push(`${p}.aliases has more than ${HOST_ENTRY_WIDGET.aliasesMax} entries`);
      }
    }
  }
  if ('shape' in entry && !isShapeId(entry.shape)) errors.push(`${path}.shape must be a shape asset id (${ASSET_ID.source})`);
  return errors;
}

/** Errors in a host's `shape { icon, chip }` default. */
export function hostShapeErrors(shape, path = 'data.shape') {
  if (shape === undefined) return [];
  if (!isObj(shape)) return [`${path} must be an object { icon?, chip? } of shape asset ids`];
  const errors = [];
  for (const k of Object.keys(shape)) {
    if (k !== 'icon' && k !== 'chip') { errors.push(`${path}.${k} is not a host shape slot (icon or chip)`); continue; }
    if (!isShapeId(shape[k])) errors.push(`${path}.${k} must be a shape asset id (${ASSET_ID.source})`);
  }
  return errors;
}

/** Every toolbar-widgets@1 error of a host asset's data: its list entries' widget / shape fields and its shape default. */
export function hostWidgetStyleErrors(field, data) {
  if (!isObj(data)) return [];
  const errors = [];
  const list = data[field];
  if (Array.isArray(list)) list.forEach((e, i) => errors.push(...hostEntryErrors(`data.${field}[${i}]`, e)));
  errors.push(...hostShapeErrors(data.shape));
  return errors;
}
