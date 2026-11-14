/**
 * skin-upgrade@1 (build picker-dialog-plugin-replaces-all, Nov 14 2026; Brett: "skins have to touch them"). When a new
 * asset type joins the registry, every existing skin has to reach it, or the type falls back to the theme defaults
 * and the skin stops being a complete look. This is the upgrader: pure rules that give a skin the defaults for a type
 * it does not name yet, and the gaps a CI check fails on. The CLI (framework/cli/skin-upgrade.mjs) runs them over
 * every shipped skin (framework/assets/skin, each app's src/assets/skin and src/assets-overrides/skin).
 *
 * First type carried: picker@1 (spec/PICKER.md).
 *   assets.picker  the picker starter the skin opens its drop-downs with: a starter with the skin's own id wins
 *                  (windows → windows), else the skin's dialog variant (sheet → bottom-sheet), else its density
 *                  (compact → compact-list), else `standard`;
 *   parts.picker   the style parts the skin already gives its menus, carried over so a skinned picker reads like the
 *                  skin's context menu (then its buttons, then its density); nothing is invented: a skin without any
 *                  matching parts gets no block, and the check asks only for the slot.
 *
 * Plain JS shared by the CLI, the skins plugin and the tests. Pure: no IO. Kotlin twin deferred (Android on hold).
 */

export const SKIN_UPGRADE_CONTRACT = 'skin-upgrade@1';
export const PICKER_SLOT = 'picker';
export const PICKER_DEFAULT_STARTER = 'standard';
/** The starters by the trait that picks them (every id ships in framework/assets/picker). */
export const PICKER_STARTER_FOR = { sheet: 'bottom-sheet', compact: 'compact-list', roomy: 'bottom-sheet' };
/** Style parts that read the same on a menu row and on a picker option row: the ones carried over. */
export const PICKER_PART_TOKENS = ['fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'textTransform', 'textColor', 'background', 'borderColor', 'radius', 'borderWidth', 'shadow', 'glass', 'itemPadding', 'gap', 'iconSet', 'iconSize', 'iconColor', 'showIcons', 'animation', 'animationSpeed', 'easing', 'hover', 'hoverColor', 'cursor', 'click', 'clickColor', 'focusRing'];
/** Where a picker's parts are borrowed from, first match wins. */
export const PICKER_PART_SOURCES = ['context-menu', 'app-menu', 'nav-menu', 'button'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

/**
 * The picker starter a skin should open its drop-downs with. `ctx.starters` = the picker ids that ship;
 * `ctx.id` = the skin's id; `ctx.dialogVariant` = the variant of the dialog asset the skin names (modal / drawer / sheet).
 */
export function pickPickerStarter(skin, ctx = {}) {
  const d = isObj(skin) ? skin : {};
  const starters = Array.isArray(ctx.starters) && ctx.starters.length ? ctx.starters : [PICKER_DEFAULT_STARTER];
  const has = (id) => typeof id === 'string' && starters.includes(id);
  if (has(ctx.id)) return ctx.id;
  const assets = isObj(d.assets) ? d.assets : {};
  if (has(assets.dialog)) return assets.dialog;
  if (ctx.dialogVariant === 'sheet' && has(PICKER_STARTER_FOR.sheet)) return PICKER_STARTER_FOR.sheet;
  const density = typeof assets.density === 'string' ? assets.density : '';
  if (density in PICKER_STARTER_FOR && has(PICKER_STARTER_FOR[density])) return PICKER_STARTER_FOR[density];
  return has(PICKER_DEFAULT_STARTER) ? PICKER_DEFAULT_STARTER : starters[0];
}

/** The parts block a skinned picker inherits from the skin's own menus / buttons; null when the skin has none to give. */
export function pickerPartsFor(skin) {
  const d = isObj(skin) ? skin : {};
  const parts = isObj(d.parts) ? d.parts : {};
  for (const src of PICKER_PART_SOURCES) {
    const from = parts[src];
    if (!isObj(from)) continue;
    const out = {};
    for (const k of PICKER_PART_TOKENS) if (k in from) out[k] = from[k];
    if (Object.keys(out).length) return out;
  }
  return null;
}

/** What a skin still lacks for the types the upgrader carries (CI fails on a non-empty list). */
export function skinUpgradeGaps(skin) {
  const d = isObj(skin) ? skin : {};
  const out = [];
  const assets = isObj(d.assets) ? d.assets : {};
  if (!ID.test(String(assets[PICKER_SLOT] ?? ''))) out.push(`assets.${PICKER_SLOT}`);
  return out;
}

/**
 * A skin with the picker defaults added where missing. Never changes what a skin already says. Returns
 * `{ data, changed }` where `changed` lists the fields written (`assets.picker`, `parts.picker`); `data` keeps the
 * skin's key order (picker is placed after the dialog slot when there is one).
 */
export function upgradeSkin(skin, ctx = {}) {
  const d = isObj(skin) ? skin : {};
  const changed = [];
  let assets = isObj(d.assets) ? d.assets : {};
  if (!ID.test(String(assets[PICKER_SLOT] ?? ''))) {
    const id = pickPickerStarter(d, ctx);
    const next = {};
    let placed = false;
    for (const [k, v] of Object.entries(assets)) {
      if (k === PICKER_SLOT) continue;
      next[k] = v;
      if (k === 'dialog') { next[PICKER_SLOT] = id; placed = true; }
    }
    if (!placed) next[PICKER_SLOT] = id;
    assets = next;
    changed.push(`assets.${PICKER_SLOT}`);
  }
  let parts = isObj(d.parts) ? d.parts : null;
  if (!parts || !isObj(parts[PICKER_SLOT])) {
    const give = pickerPartsFor(d);
    if (give) { parts = { ...(parts ?? {}), [PICKER_SLOT]: give }; changed.push(`parts.${PICKER_SLOT}`); }
  }
  if (!changed.length) return { data: d, changed };
  const data = { ...d, assets };
  if (parts) data.parts = parts;
  return { data, changed };
}
