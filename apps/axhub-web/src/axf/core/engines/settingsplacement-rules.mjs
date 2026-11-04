/**
 * settings-placement@1 vocabulary (Nov 4 2026): the one list of where settings can open, the words people and Amber
 * use for each, and the free-text parser. Plain JS so the build engine, the console server (through the console
 * commands runner), the CLI and the settings-placement plugin read the same registry as the TypeScript engine
 * (core/engines/settingsplacement.ts imports it). No IO, no DOM.
 *
 *   placements  dialog | panel (side left / right) | sheet | inside (mode) | page | window
 *   choices     dialog | panel-left | panel-right | sheet | inside | page | window   (+ "default" = clear an override)
 */

export const SETTINGS_PLACEMENTS = ['dialog', 'panel', 'sheet', 'inside', 'page', 'window'];
export const SIDES = ['left', 'right'];
export const INSIDE_MODES = ['pane', 'dropdown', 'tab', 'split', 'inline'];
export const PLACEMENT_CHOICES = ['dialog', 'panel-left', 'panel-right', 'sheet', 'inside', 'page', 'window'];

/** Older or spoken names → a placement (`main` was the page until Nov 4 2026). */
export const PLACEMENT_ALIASES = {
  main: 'page', 'full-page': 'page', full: 'page', 'settings-page': 'page',
  pane: 'panel', 'side-panel': 'panel', side: 'panel', drawer: 'panel',
  'bottom-sheet': 'sheet', bottom: 'sheet',
  popup: 'dialog', 'pop-up': 'dialog', modal: 'dialog',
  floating: 'window', 'floating-window': 'window', float: 'window',
  inline: 'inside', 'in-screen': 'inside', screen: 'inside',
};

export const PLACEMENT_LABELS = { dialog: 'Pop-up dialog', panel: 'Side panel', sheet: 'Bottom sheet', inside: 'Inside the screen', page: 'Full page', window: 'Floating window' };
export const CHOICE_LABELS = { dialog: 'Pop-up dialog', 'panel-left': 'Side panel, left', 'panel-right': 'Side panel, right', sheet: 'Bottom sheet', inside: 'Inside the screen', page: 'Full page', window: 'Floating window' };

/** Words people (and Amber) use for each placement, besides the labels (hyphen-joined, lower case). */
export const PLACEMENT_WORDS = {
  dialog: ['dialog', 'popup', 'pop-up', 'modal', 'pop-up-dialog', 'popup-dialog', 'a-dialog'],
  panel: ['panel', 'side-panel', 'side', 'pane', 'drawer', 'sidebar', 'left-panel', 'right-panel', 'left', 'right', 'left-side', 'right-side', 'on-the-left', 'on-the-right'],
  sheet: ['sheet', 'bottom-sheet', 'bottom', 'bottom-panel', 'from-the-bottom'],
  inside: ['inside', 'inside-the-screen', 'in-the-screen', 'in-screen', 'inline', 'in-place', 'in-it', 'inside-it', 'in-itself', 'inside-itself'],
  page: ['page', 'full-page', 'full', 'main', 'main-page', 'settings-page', 'the-page', 'full-screen', 'fullscreen'],
  window: ['window', 'floating-window', 'floating', 'float', 'own-window', 'new-window', 'its-own-window'],
};

const word = (x) => (typeof x === 'string' ? x.trim().toLowerCase().replace(/[\s_]+/g, '-') : '');
/** Text → hyphen-joined lower-case tokens ("Side panel, left!" → "side-panel-left"). */
export const placementTokens = (x) => word(x).replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
const has = (t, w) => `-${t}-`.includes(`-${w}-`);

/** A placement name, old or new, → the placement; anything else → null. */
export function placementOf(x) {
  const w = word(x);
  if (!w) return null;
  if (SETTINGS_PLACEMENTS.includes(w)) return w;
  return PLACEMENT_ALIASES[w] ?? null;
}

/** Is this text "default" / "app default" / "use the app default" (clear the override)? */
export const isDefaultWord = (x) => { const t = placementTokens(x); return !!t && (/^(use-)?(the-)?(app-)?default$/.test(t) || /^(use-)?(the-)?app-s?-default$/.test(t)); };

/**
 * Free text ("side panel left", "bottom sheet", "in a dialog", "pop it up in a floating window") → the choice and, for
 * inside, the mode named in the words; "default" → 'default'; nothing named → null. The longest placement word wins;
 * "left" / "right" pick the panel's side.
 */
export function parsePlacementChoice(text) {
  const t = placementTokens(text);
  if (!t) return null;
  if (isDefaultWord(t)) return 'default';
  let best = null;
  for (const p of SETTINGS_PLACEMENTS) for (const w of [p, placementTokens(PLACEMENT_LABELS[p]), ...PLACEMENT_WORDS[p]]) if (has(t, w) && (!best || w.length > best.w.length)) best = { p, w };
  if (!best) return null;
  const choice = best.p === 'panel' ? (has(t, 'left') ? 'panel-left' : 'panel-right') : best.p;
  const out = { choice };
  if (best.p === 'inside') {
    const m = t.match(/(^|-)(pane|slide-out|dropdown|drop-down|tab|split|inline|section)(-|$)/);
    if (m) out.mode = m[2] === 'slide-out' ? 'pane' : m[2] === 'drop-down' ? 'dropdown' : m[2] === 'section' ? 'inline' : m[2];
  }
  return out;
}

/** The placement and side a choice means. */
export const choiceParts = (choice) => (choice === 'panel-left' ? { placement: 'panel', side: 'left' } : choice === 'panel-right' ? { placement: 'panel', side: 'right' } : SETTINGS_PLACEMENTS.includes(choice) && choice !== 'panel' ? { placement: choice } : null);
