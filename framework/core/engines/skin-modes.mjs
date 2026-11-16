/**
 * skin-modes@1 (build every-skin-ships-a-light-and-a-dark-colour-theme, Nov 2026, Brett: "Yo, every skin needs a light
 * and dark.").
 *
 * Every skin names a light and a dark colour theme in its data (`colorThemes: { light, dark }`); its own `colorTheme`
 * is one of the two. A light / dark switch is a colour pick inside the skin (skin-rules.mjs `setSkinColorTheme`): the
 * skin stays the same skin and nothing is forked. `system` follows the device's light / dark preference.
 *
 * Plain JS shared by the CLI (`skins.mjs mode`), the console server and the CI check (`spec/check-skin-modes.mjs`). Pure.
 */

export const SKIN_MODES_CONTRACT = 'skin-modes@1';
/** The modes a skin can be in. `system` follows the device. */
export const SKIN_MODES = ['light', 'dark', 'system'];
/** The schemes a colour theme declares (`data.scheme`). */
export const SKIN_SCHEMES = ['light', 'dark'];

const ID = /^[a-z0-9][a-z0-9-]*$/;
const idOr = (v) => (typeof v === 'string' && ID.test(v) ? v : '');

/** A skin's light / dark pair from its asset (`{ light, dark }`, '' where the skin names none). */
export function skinModePair(skin) {
  const d = skin && typeof skin === 'object' ? skin.data ?? {} : {};
  const p = d.colorThemes && typeof d.colorThemes === 'object' ? d.colorThemes : {};
  return { light: idOr(p.light), dark: idOr(p.dark) };
}

/** Is `v` a mode (`light`, `dark`, `system`)? */
export const isSkinMode = (v) => SKIN_MODES.includes(v);

/** The scheme a mode lands on: `system` reads the device (`prefersDark`); light when the device is unknown. */
export function effectiveScheme(mode, prefersDark) {
  if (mode === 'dark' || mode === 'light') return mode;
  return prefersDark === true || prefersDark === 'dark' ? 'dark' : 'light';
}

/**
 * The colour theme a skin shows in a mode: `{ scheme, theme, pick }`. `pick` is the colour pick to store inside the
 * skin ('' = the skin's own colours, so a switch back to the skin's own scheme leaves no pick behind). Throws when the
 * skin has no theme for that scheme.
 */
export function skinModeColor(skin, mode, prefersDark) {
  if (!isSkinMode(mode)) throw new Error(`"${mode}" is not a mode: ${SKIN_MODES.join(', ')}`);
  const scheme = effectiveScheme(mode, prefersDark);
  const theme = skinModePair(skin)[scheme];
  if (!theme) throw new Error(`skin "${skin?.id ?? ''}" has no ${scheme} colour theme`);
  const own = idOr(skin?.data?.colorTheme);
  return { scheme, theme, pick: theme === own ? '' : theme };
}

/** Which scheme a colour theme in force belongs to for this skin ('' = neither of the pair: a free colour pick). */
export function skinSchemeOf(skin, themeId) {
  const p = skinModePair(skin);
  if (themeId && themeId === p.light) return 'light';
  if (themeId && themeId === p.dark) return 'dark';
  return '';
}

/**
 * Coverage: every skin ships a light and a dark colour theme. `skins` = skin assets, `themes` = colour theme assets.
 * One line per problem; an empty list = every skin covered. Checks that both are set, that they ship, that each
 * declares the matching scheme, and that the skin's own `colorTheme` is one of the two.
 */
export function skinModeProblems(skins, themes) {
  const scheme = new Map((themes ?? []).filter((t) => t && t.id).map((t) => [t.id, t.data?.scheme ?? '']));
  const out = [];
  for (const s of skins ?? []) {
    if (!s || !s.id) continue;
    const p = skinModePair(s);
    for (const want of SKIN_SCHEMES) {
      const id = p[want];
      if (!id) { out.push(`${s.id}: no ${want} colour theme (data.colorThemes.${want})`); continue; }
      if (!scheme.has(id)) out.push(`${s.id}: ${want} colour theme "${id}" does not ship`);
      else if (scheme.get(id) !== want) out.push(`${s.id}: ${want} colour theme "${id}" is a ${scheme.get(id) || 'scheme-less'} theme`);
    }
    const own = idOr(s.data?.colorTheme);
    if (own && p.light && p.dark && own !== p.light && own !== p.dark) out.push(`${s.id}: its colorTheme "${own}" is neither its light nor its dark theme`);
  }
  return out;
}

/** One row per skin for lists and the API: `{ id, name, light, dark, own, ownScheme }`. */
export function skinModeRows(skins) {
  return (skins ?? []).filter((s) => s && s.id).map((s) => {
    const p = skinModePair(s);
    const own = idOr(s.data?.colorTheme);
    return { id: s.id, name: s.name ?? s.id, light: p.light, dark: p.dark, own, ownScheme: skinSchemeOf(s, own) };
  });
}
