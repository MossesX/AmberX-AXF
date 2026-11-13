/**
 * Toolbar settings, applied live to every toolbar on the page (build fix-toolbar-settings-doing-nothing; Brett, Nov 13
 * 2026: "Fix it so every toolbar setting actually applies live to that toolbar, on every toolbar in the console").
 *
 * A toolbar's settings dialog (right-click / long-press → Toolbar settings, chrome-settings@1) saves its choices to
 * `axf.chrome.toolbar.<instance>`. Most toolbars are plain `role="toolbar"` rows a plugin draws, with no renderer that
 * could read that setting, so this host does it for all of them, the same way tapConfirm.ts gives every toolbar
 * tap-to-confirm: installed once by <AxfProvider>, it finds every `[role="toolbar"]` (now and as pages open) and
 * writes the saved choices onto it as `data-axf-tb-*` attributes that framework/ui/axf.css draws:
 *
 *   variant      icons | icons-labels | labels   buttons with an icon show only it / both / only their text
 *   align        start | center | spread         where the items sit along the row
 *   density      compact | regular | roomy       gaps and padding
 *   surface      flat | raised | glass           the row's background
 *   divider      on | off                        a rule between items
 *   showSearch   on                              a filter box at the end that hides items whose name doesn't match
 *   collapsible  on                              a fold button at the start; the fold is per device
 *                                                (`axf.toolbars.<instance>.folded`)
 *
 * Only fields the person set are written (an unset field leaves the toolbar as its plugin built it). A toolbar that
 * renders a field itself (the app toolbar, from its toolbar asset) lists it in `data-axf-tb-native` and is skipped for
 * that field. The instance id is the one the toolbar's context menu opens (`toolbarInstanceOf`).
 */
import { CHROME_INSTANCE_KEY, normalizeInstanceOverride } from '../core/engines/chrome-settings-rules.mjs';
import { toolbarElementId } from './tapConfirm';

/** The toolbar fields this host draws (CHROME_FIELDS.toolbar minus tapConfirm, which tapConfirm.ts reads). */
export const TOOLBAR_LOOK_FIELDS = ['variant', 'align', 'density', 'surface', 'divider', 'showSearch', 'collapsible'] as const;
export type ToolbarLookField = typeof TOOLBAR_LOOK_FIELDS[number];

/**
 * What a page toolbar looks like before anyone sets anything: the base the settings dialog shows and compares with.
 * Page toolbars are rows of labelled buttons and controls, so their buttons are "Icons + labels", not the app toolbar
 * asset's "Icons" (comparing with the asset is why picking Icons used to save nothing).
 */
export const TOOLBAR_AS_BUILT: Record<ToolbarLookField, string | boolean> = { variant: 'icons-labels', align: 'start', density: 'regular', surface: 'flat', divider: false, showSearch: false, collapsible: false };

/** The per-device fold of a collapsible toolbar. */
export const toolbarFoldKey = (instance: string) => `axf.toolbars.${instance}.folded`;

/** Marks the elements this host adds to a toolbar (fold button, filter box): never filtered, folded or counted. */
const OWN = 'data-axf-tb-own';

const slug = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/[^a-z0-9._:/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) : '');

/** The chrome settings instance of a toolbar element: the same id its context menu opens (Overlays.tsx). */
export function toolbarInstanceOf(el: HTMLElement): string {
  if (el.getAttribute('data-fx-ctx-target') === 'toolbar') { const p = slug(el.getAttribute('data-fx-ctx-payload')); if (p) return p; }
  return slug(el.dataset.axfToolbar ?? el.dataset.axfToolbarAsset ?? el.getAttribute('aria-label')) || toolbarElementId(el);
}

/** Settings this host needs: read, write and hear changes (the runtime's SettingsRegistry fits). */
export interface ToolbarLookSettings {
  get(key: string): unknown;
  set(key: string, value: never): void;
  clear(key: string): void;
  subscribe(fn: () => void): () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHEVRON = { open: 'M6 9l6 6 6-6', folded: 'M9 18l6-6-6-6' };
function chevron(doc: Document, folded: boolean): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'fx-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', folded ? CHEVRON.folded : CHEVRON.open);
  svg.appendChild(p);
  return svg;
}

/** The items of a toolbar a filter box looks at: its own children, minus what this host added. */
const itemsOf = (el: HTMLElement) => Array.from(el.children).filter((c): c is HTMLElement => !c.hasAttribute(OWN));
const textOf = (c: Element) => `${c.textContent ?? ''} ${c.getAttribute('aria-label') ?? ''} ${c.getAttribute('title') ?? ''}`.toLowerCase();

function setAttr(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * Apply one toolbar's saved settings to its element (idempotent: calling it again with the same settings changes
 * nothing). `folded` / `onFold` drive the fold button of a collapsible toolbar.
 */
export function applyToolbarLook(el: HTMLElement, override: unknown, folded: boolean, onFold: (folded: boolean) => void): void {
  const doc = el.ownerDocument;
  const native = new Set((el.dataset.axfTbNative ?? '').split(/\s+/).filter(Boolean));
  const o = normalizeInstanceOverride('toolbar', override) as Partial<Record<ToolbarLookField, string | boolean>>;
  const has = (k: ToolbarLookField) => k in o && !native.has(k);
  for (const k of ['variant', 'align', 'density', 'surface'] as const) setAttr(el, `data-axf-tb-${k}`, has(k) ? String(o[k]) : null);
  setAttr(el, 'data-axf-tb-divider', has('divider') ? (o.divider ? 'on' : 'off') : null);

  // Collapsible: a fold button first; folded hides every other item (per device).
  const collapsible = has('collapsible') && o.collapsible === true;
  let fold = el.querySelector<HTMLButtonElement>(':scope > [data-axf-tb-own="fold"]');
  if (collapsible) {
    if (!fold) {
      fold = doc.createElement('button');
      fold.type = 'button';
      fold.className = 'fx-iconbtn axf-tb-fold';
      fold.setAttribute(OWN, 'fold');
      fold.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onFold(fold!.getAttribute('aria-expanded') === 'true'); });
      el.insertBefore(fold, el.firstChild);
    }
    const label = `${folded ? 'Unfold' : 'Fold'} ${el.getAttribute('aria-label') || 'toolbar'}`;
    if (fold.getAttribute('aria-expanded') !== String(!folded) || !fold.firstChild) {
      fold.setAttribute('aria-expanded', String(!folded));
      fold.setAttribute('aria-label', label);
      fold.title = label;
      fold.replaceChildren(chevron(doc, folded));
    }
  } else if (fold) fold.remove();
  setAttr(el, 'data-axf-tb-collapsible', collapsible ? 'on' : null);
  setAttr(el, 'data-axf-tb-folded', collapsible && folded ? 'on' : null);

  // Search box: a filter at the end; items whose name doesn't match are hidden (the box keeps its text while shown).
  const search = has('showSearch') && o.showSearch === true;
  let box = el.querySelector<HTMLInputElement>(':scope > [data-axf-tb-own="search"]');
  if (search && !box) {
    box = doc.createElement('input');
    box.type = 'search';
    box.className = 'fx-input axf-tb-search';
    box.setAttribute(OWN, 'search');
    box.placeholder = 'Filter';
    box.setAttribute('aria-label', `Filter ${el.getAttribute('aria-label') || 'toolbar'}`);
    box.addEventListener('input', () => filterToolbar(el));
    el.appendChild(box);
  } else if (!search && box) { box.remove(); box = null; }
  setAttr(el, 'data-axf-tb-search', search ? 'on' : null);
  filterToolbar(el);
}

/** Hide the items of a toolbar that don't match its filter box (all shown when it has none or it is empty). */
export function filterToolbar(el: HTMLElement): void {
  const box = el.querySelector<HTMLInputElement>(':scope > [data-axf-tb-own="search"]');
  const q = (box?.value ?? '').trim().toLowerCase();
  for (const c of itemsOf(el)) {
    // a group of items (role="group", e.g. status chips) is filtered item by item, and hidden when none is left
    const inner = c.getAttribute('role') === 'group' ? Array.from(c.children) as HTMLElement[] : [];
    for (const x of inner) setAttr(x, 'data-axf-tb-filtered', q && !textOf(x).includes(q) ? 'out' : null);
    const out = inner.length ? inner.every((x) => x.hasAttribute('data-axf-tb-filtered')) : !!q && !textOf(c).includes(q);
    setAttr(c, 'data-axf-tb-filtered', out ? 'out' : null);
  }
}

export interface ToolbarLookHost { dispose(): void; refresh(): void }

/**
 * Install the host on a document: every toolbar there now and later gets its saved settings, and a change of any
 * setting re-applies them (live). Returns a handle; `refresh` re-applies at once (tests, after a big DOM change).
 */
export function installToolbarLook(doc: Document, settings: ToolbarLookSettings): ToolbarLookHost {
  const applyAll = () => {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[role="toolbar"]'))) {
      if (el.closest('[data-axf-toolbars-panel]')) continue;
      const id = toolbarInstanceOf(el);
      const key = toolbarFoldKey(id);
      applyToolbarLook(el, settings.get(CHROME_INSTANCE_KEY('toolbar', id)), settings.get(key) === true, (f) => { if (f) settings.set(key, true as never); else settings.clear(key); });
    }
  };
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; applyAll(); }); };
  const offSettings = settings.subscribe(schedule);
  const MO = (doc.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null)?.MutationObserver ?? globalThis.MutationObserver;
  const mo = MO ? new MO((records) => { if (records.some((r) => r.addedNodes.length)) schedule(); }) : null;
  mo?.observe(doc.documentElement, { childList: true, subtree: true });
  applyAll();
  return { dispose: () => { offSettings(); mo?.disconnect(); }, refresh: applyAll };
}
