/**
 * The Hidden list (hidden-assets@1, core/engines/hidden-assets.ts; Brett, Nov 17 2026: "hide toolbars and tab groups
 * and all that and be able to see what's hidden").
 *
 * Everything hidden in this app, grouped by kind (tab groups, toolbars, banners, navigation menus, menu bar, widgets),
 * with Unhide on every row and Unhide all, which asks first. Nothing hidden: it says so and how to hide something.
 * Mounted in Settings → Appearance and as the dialog `axf.hidden-assets` (AppearancePanel.tsx).
 *
 * It reads and writes only through the runtime (`rt.hidden()`, `rt.unhide`, `rt.unhideAll`), which keeps the list in
 * the app's look document, so this is the same list REST, MCP, the CLI and voice see, and it survives a reload.
 * Tokens and framework controls only: the layout is the shared fx-stack / fx-row classes, nothing is styled here.
 *
 * Console control (CONSOLE-CONTROL.md): `panel:hidden-assets`, `grid:hidden-assets` with one `row:<kind>:<id>` per
 * piece, `button:hidden.unhide.<kind>.<id>` per row, `button:hidden.unhide-all` and its `button:hidden.unhide-all.yes`.
 */
import { useEffect, useState } from 'react';
import type { HiddenAsset } from '../../core';
import { Button, Icon, Note, Section, useAxfState, useRuntime } from '../../react';
import { CHROME_ICONS, CHROME_LABELS } from '../../core/engines/chrome-settings-rules.mjs';

/** The dialog the list opens in (the Assets menu's Hidden items…, `dialog:axf.hidden-assets`). */
export const HIDDEN_ASSETS_DIALOG = 'axf.hidden-assets';
/** The panel's anchor inside Settings → Appearance (deep link `view:settings/tab:appearance#hidden`). */
export const HIDDEN_ASSETS_ANCHOR = 'hidden';
/** The instance id of the chrome an app draws once (chrome-settings@1): the app's own toolbar, nav, menu bar, banner. */
const APP_INSTANCE = 'app';

const LABELS = CHROME_LABELS as Record<string, string>;
const ICONS = CHROME_ICONS as Record<string, string>;
/** One piece of a kind, in words ("Menu bar" is what the application menu is called on screen). */
const KIND_LABEL: Record<string, string> = { ...LABELS, 'app-menu': 'Menu bar', widget: 'Widget' };
/** A group heading. */
const KIND_PLURAL: Record<string, string> = { 'tab-group': 'Tab groups', toolbar: 'Toolbars', banner: 'Banners', 'nav-menu': 'Navigation menus', 'app-menu': 'Menu bar', widget: 'Widgets' };

export const hiddenKindLabel = (kind: string): string => KIND_LABEL[kind] ?? kind;
export const hiddenKindPlural = (kind: string): string => KIND_PLURAL[kind] ?? hiddenKindLabel(kind);
const kindIcon = (kind: string): string => ICONS[kind] ?? (kind === 'widget' ? 'grid' : 'layers');

/** What a hidden piece is called in the list: the app-wide one by its kind, any other by its id. */
export function hiddenPieceName(entry: Pick<HiddenAsset, 'kind' | 'id'>): string {
  return entry.id === APP_INSTANCE ? `${hiddenKindLabel(entry.kind)} (whole app)` : entry.id;
}

/** When it was hidden, short enough for a phone ("today 2:05 PM", "Nov 12"); empty for a date that can't be read. */
export function hiddenWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return now.toDateString() === d.toDateString()
    ? `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export interface HiddenGroup { kind: string; items: HiddenAsset[] }

/**
 * The pieces grouped by kind, in the order the runtime lists the kinds (a kind it doesn't list goes last, so an entry
 * written by a newer app is still shown and can be unhidden). Kinds with nothing hidden are left out; inside a group
 * the list's own order (oldest first) is kept.
 */
export function groupHidden(list: readonly HiddenAsset[], kinds: readonly string[]): HiddenGroup[] {
  const order = [...new Set([...kinds, ...list.map((e) => e.kind)])];
  return order.map((kind) => ({ kind, items: list.filter((e) => e.kind === kind) })).filter((g) => g.items.length > 0);
}

function HiddenRow({ entry, locked }: { entry: HiddenAsset; locked: boolean }) {
  const rt = useRuntime();
  const key = `${entry.kind}:${entry.id}`;
  const name = hiddenPieceName(entry);
  const when = hiddenWhen(entry.hiddenAt);
  const meta = [
    entry.assetRef && `drawn with ${entry.assetRef}`,
    when && `hidden ${when}`,
    entry.by && entry.by !== rt.manifest.app.id && `by ${entry.by}`,
  ].filter(Boolean).join(' · ');
  return (
    <div className="fx-row fx-row--between" role="listitem" data-axf-target={`row:${key}`} data-axf-hidden-entry={key}>
      <span className="fx-row fx-grow">
        <Icon name={kindIcon(entry.kind)} size={14} />
        <span className="fx-stack fx-stack--xs">
          <span>{name}</span>
          {meta && <span className="fx-small fx-muted">{meta}</span>}
        </span>
      </span>
      <Button size="sm" icon="eye" id={`hidden.unhide.${entry.kind}.${entry.id}`} aria-label={`Unhide ${entry.id === APP_INSTANCE ? hiddenKindLabel(entry.kind).toLowerCase() : `${hiddenKindLabel(entry.kind).toLowerCase()} ${entry.id}`}`} requires="assets.swap" disabled={locked} onClick={() => { rt.unhide({ kind: entry.kind, id: entry.id }); }}>Unhide</Button>
    </div>
  );
}

/** The Hidden list: grouped by kind, Unhide per row, Unhide all (asks first), and an empty state. */
export function HiddenAssetsPanel() {
  const rt = useRuntime();
  useAxfState(); // a look change (hide, unhide, another tab, axHub) repaints through the runtime's state
  const list = rt.hidden();
  const locked = !rt.can('assets.swap') || rt.lockedByAppearance('assets.swap');
  const [asking, setAsking] = useState(false);
  // the question goes away when there is nothing left to ask about (the last piece was unhidden by its own row)
  useEffect(() => { if (!list.length) setAsking(false); }, [list.length]);
  const groups = groupHidden(list, rt.hideableKinds());
  const count = list.length;
  return (
    <div className="fx-stack" id={`axf-${HIDDEN_ASSETS_ANCHOR}`} data-axf-target="panel:hidden-assets" data-axf-hidden-count={count}>
      {count === 0 ? (
        <Note tone="info" icon="eye">
          Nothing is hidden in this app. Right-click (or long-press) a tab group, toolbar, banner, navigation menu, the menu bar or a widget and pick Hide. It is listed here, where you can bring it back.
        </Note>
      ) : (
        <>
          <div className="fx-row fx-row--between fx-row--wrap">
            <span className="fx-muted" aria-live="polite">{count === 1 ? '1 piece hidden in this app' : `${count} pieces hidden in this app`}</span>
            {!asking && <Button size="sm" tone="quiet" icon="eye" id="hidden.unhide-all" requires="assets.swap" disabled={locked} onClick={() => setAsking(true)}>Unhide all</Button>}
          </div>
          {asking && (
            <Note tone="warning">
              <div className="fx-stack fx-stack--xs">
                <span>{count === 1 ? 'Show the hidden piece again?' : `Show all ${count} hidden pieces again?`}</span>
                <div className="fx-row">
                  <Button size="sm" tone="primary" id="hidden.unhide-all.yes" requires="assets.swap" disabled={locked} onClick={() => { setAsking(false); rt.unhideAll(); }}>Unhide all</Button>
                  <Button size="sm" tone="quiet" id="hidden.unhide-all.no" onClick={() => setAsking(false)}>Cancel</Button>
                </div>
              </div>
            </Note>
          )}
          {locked && <span className="fx-small fx-muted">The look of this app is locked, so nothing can be unhidden here.</span>}
          <div className="fx-stack" data-axf-target="grid:hidden-assets">
            {groups.map((g) => (
              <Section key={g.kind} title={<span className="fx-row"><Icon name={kindIcon(g.kind)} size={14} />{hiddenKindPlural(g.kind)}</span>} aside={<span className="fx-small fx-muted">{g.items.length}</span>}>
                <div className="fx-stack fx-stack--xs" role="list" aria-label={`Hidden ${hiddenKindPlural(g.kind).toLowerCase()}`}>
                  {g.items.map((e) => <HiddenRow key={`${e.kind}:${e.id}`} entry={e} locked={locked} />)}
                </div>
              </Section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
