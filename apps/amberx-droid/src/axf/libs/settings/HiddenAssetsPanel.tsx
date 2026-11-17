/**
 * The Hidden list (hidden-assets@1; Brett, Nov 17 2026: "We're supposed to be able to hide toolbars and tab groups and all
 * that and be able to see what's hidden.").
 *
 * Everything hidden in this app, grouped by kind (tab groups, toolbars, banners, navigation, menu bar, widgets), with
 * Unhide on every row and Unhide all (tap twice to confirm). Empty: says so and how to hide something. Mounted in
 * Settings → Appearance (anchor `#hidden`) and as the dialog `axf.hidden-assets` (the Assets menu's Hidden items…).
 *
 * Reads and writes only through the runtime (`rt.hidden()`, `chrome.unhide`, `chrome.unhideAll`), so the same list is
 * what REST, MCP, the CLI and voice see. Tokens and framework controls only (THEMING.md).
 *
 * Console control (CONSOLE-CONTROL.md): `panel:hidden-assets`, its `grid:hidden-assets` with one `row:<kind>:<id>` per
 * piece, `button:hidden.unhide.<kind>.<id>` per row and `button:hidden.unhide-all`.
 */
import { useEffect, useState } from 'react';
import type { HiddenAsset } from '../../core';
import { Button, CHROME_APP_INSTANCE, Icon, Note, Section, hiddenPieceLabel, useAxfState, useHiddenList, useRuntime } from '../../react';
import { CHROME_ICONS, CHROME_LABELS } from '../../core/engines/chrome-settings-rules.mjs';

export const HIDDEN_ASSETS_DIALOG = 'axf.hidden-assets';
/** The anchor of the panel inside Settings → Appearance (deep link `view:settings/tab:appearance#hidden`). */
export const HIDDEN_ASSETS_ANCHOR = 'hidden';

const KIND_LABELS: Record<string, string> = { ...(CHROME_LABELS as Record<string, string>), 'app-menu': 'Menu bar', widget: 'Widget' };
const KIND_PLURAL: Record<string, string> = { 'tab-group': 'Tab groups', toolbar: 'Toolbars', banner: 'Banners', 'nav-menu': 'Navigation menus', 'app-menu': 'Menu bar', widget: 'Widgets' };
const kindIcon = (kind: string): string => (CHROME_ICONS as Record<string, string>)[kind] ?? 'layers';

/** When it was hidden, in words a phone can show ("today 14:05", "Nov 12"). */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** The pieces grouped by kind, in the runtime's kind order; kinds with nothing hidden are left out. */
export function groupHidden(list: HiddenAsset[], kinds: string[]): { kind: string; items: HiddenAsset[] }[] {
  const order = [...kinds, ...list.map((e) => e.kind).filter((k) => !kinds.includes(k))];
  return order.filter((k, i) => order.indexOf(k) === i).map((kind) => ({ kind, items: list.filter((e) => e.kind === kind) })).filter((g) => g.items.length);
}

function HiddenRow({ entry, locked }: { entry: HiddenAsset; locked: boolean }) {
  const rt = useRuntime();
  const key = `${entry.kind}:${entry.id}`;
  const name = entry.id === CHROME_APP_INSTANCE ? `${KIND_LABELS[entry.kind] ?? entry.kind} (whole app)` : entry.id;
  const meta = [entry.assetRef && `drawn with ${entry.assetRef}`, when(entry.hiddenAt) && `hidden ${when(entry.hiddenAt)}`, entry.by && entry.by !== rt.manifest.app.id && `by ${entry.by}`].filter(Boolean).join(' · ');
  return (
    <div className="fx-row fx-row--between axf-settings__hidden-row" role="listitem" data-axf-target={`row:${key}`} data-axf-hidden-entry={key}>
      <span className="fx-row axf-settings__hidden-name">
        <Icon name={kindIcon(entry.kind)} size={14} />
        <span className="fx-stack fx-stack--xs">
          <span>{name}</span>
          {meta && <span className="fx-small fx-muted">{meta}</span>}
        </span>
      </span>
      <Button size="sm" tone="neutral" icon="eye" id={`hidden.unhide.${entry.kind}.${entry.id}`} aria-label={`Unhide ${hiddenPieceLabel(entry.kind, entry.id)}`} requires="assets.swap" disabled={locked} onClick={() => rt.dispatch(`chrome.unhide:${key}`)}>Unhide</Button>
    </div>
  );
}

/** The Hidden list: grouped by kind, Unhide per row, Unhide all (confirm), empty state. */
export function HiddenAssetsPanel() {
  const rt = useRuntime();
  useAxfState();
  const list = useHiddenList();
  const locked = !rt.can('assets.swap') || rt.lockedByAppearance('assets.swap');
  const [arm, setArm] = useState(false);
  useEffect(() => { if (!arm) return; const t = setTimeout(() => setArm(false), 4000); return () => clearTimeout(t); }, [arm]);
  const groups = groupHidden(list, rt.hideableKinds());
  const all = () => { if (!arm) { setArm(true); return; } setArm(false); rt.dispatch('chrome.unhideAll'); };
  return (
    <div className="fx-stack axf-settings__hidden" id={`axf-${HIDDEN_ASSETS_ANCHOR}`} data-axf-target="panel:hidden-assets" data-axf-hidden-count={list.length}>
      <div className="fx-row fx-row--between">
        <span className="fx-muted">{list.length ? `${list.length} hidden in this app` : 'Nothing hidden'}</span>
        {list.length > 0 && <Button size="sm" tone={arm ? 'danger' : 'quiet'} icon="eye" id="hidden.unhide-all" requires="assets.swap" disabled={locked} aria-label={arm ? 'Tap again to unhide everything' : 'Unhide all'} onClick={all}>{arm ? 'Tap again to unhide all' : 'Unhide all'}</Button>}
      </div>
      {!list.length && (
        <Note tone="info">
          Nothing is hidden in this app. Right-click (or long-press) any tab group, toolbar, banner, navigation menu, menu bar or widget and pick Hide; it shows up here.
        </Note>
      )}
      {list.length > 0 && (
        <div className="fx-stack" data-axf-target="grid:hidden-assets">
          {groups.map((g) => (
            <Section key={g.kind} title={<span className="fx-row"><Icon name={kindIcon(g.kind)} size={14} />{KIND_PLURAL[g.kind] ?? g.kind}</span>} aside={<span className="fx-small fx-muted">{g.items.length}</span>}>
              <div className="fx-stack fx-stack--xs" role="list" aria-label={`Hidden ${(KIND_PLURAL[g.kind] ?? g.kind).toLowerCase()}`}>
                {g.items.map((e) => <HiddenRow key={`${e.kind}:${e.id}`} entry={e} locked={locked} />)}
              </div>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
