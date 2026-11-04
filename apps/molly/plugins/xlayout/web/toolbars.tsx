/**
 * Plugin toolbars (xlayout@1 `toolbars`): up to three per plugin and screen, each shown or hidden and placed on an edge
 * (top, bottom, left, right) of the app area, both saved in the plugin's own settings tab. xLayout's own three slots
 * hold Molly's items (and, on its first visible slot, the toolbars of the app on screen, merged from that app's chrome);
 * any other Molly plugin declares its own through `declareToolbars` (a cap of three per plugin and screen holds).
 * Items open in the main area, a floating window or (IDE on) a pane (`openTargetFor`). Right-click a toolbar: Customize
 * toolbar (the Toolbar designer, through the `axf.toolbar-designer@1` capability, when it is installed).
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { openTargetFor, splitNs, TOOLBAR_LOCATIONS, TOOLBAR_SLOT_COUNT, visibleToolbars, type ToolbarLocation, type XToolbarItem } from '../../../src/axf/core/engines/xlayout';
import { Icon, useAxfState, useDragToTab, useRuntime, type DragToTabSource } from '../../../src/axf/react';
import { MOLLY_APPS, mollyApp } from '../../../src/molly/apps';
import { appOfView } from '../../../src/molly/host';
import type { ChromeHost } from './host';
import { effectiveXLayout } from './model';
import { openApp } from './workspace';

/** Context target of every plugin toolbar (payload = `<plugin>|<screen>|<slot>`). */
export const TOOLBAR_CTX = 'xlayout-toolbar';

/* ---------- other plugins' toolbars (declared, at most three per plugin and screen) ---------- */

export interface PluginToolbar { slot: number; label: string; location: ToolbarLocation; visible: boolean; items: { id: string; label: string; icon: string; action: string }[] }
interface Declared { plugin: string; label: string; screen: string; bars: PluginToolbar[] }
const declared = new Map<string, Declared>();
const listeners = new Set<() => void>();
let rev = 0;
const changed = () => { rev++; listeners.forEach((f) => f()); };
const keyOf = (plugin: string, screen: string) => `${plugin}|${screen}`;

/**
 * A plugin's toolbars for one screen (`*` = every screen). Slots 1..3; a fourth is refused (returned in `refused`).
 * Each bar's default visibility and location are the plugin's; the user's choice (its settings tab) wins.
 */
export function declareToolbars(plugin: string, label: string, screen: string, bars: PluginToolbar[]): { refused: PluginToolbar[] } {
  const ok = bars.filter((b) => Number.isInteger(b.slot) && b.slot >= 1 && b.slot <= TOOLBAR_SLOT_COUNT).slice(0, TOOLBAR_SLOT_COUNT);
  declared.set(keyOf(plugin, screen), { plugin, label, screen, bars: ok.map((b) => ({ ...b, location: (TOOLBAR_LOCATIONS as readonly string[]).includes(b.location) ? b.location : 'top' })) });
  changed();
  return { refused: bars.filter((b) => !ok.includes(b)) };
}
export function forgetToolbars(plugin: string): void { let any = false; for (const [k, d] of declared) if (d.plugin === plugin) { declared.delete(k); any = true; } if (any) changed(); }
export function declaredToolbars(): Declared[] { return [...declared.values()]; }
export const onToolbars = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const toolbarsRev = () => rev;

/** The user's saved choice for a declared bar (`xlayout.bar.<plugin>.<screen>.<slot>.visible|location`). */
export const barKey = (plugin: string, screen: string, slot: number, what: 'visible' | 'location') => `xlayout.bar.${plugin}.${screen === '*' ? 'all' : screen}.${slot}.${what}`;
function barState(rt: AxfRuntime, d: Declared, b: PluginToolbar): { visible: boolean; location: ToolbarLocation } {
  const v = rt.settings.get(barKey(d.plugin, d.screen, b.slot, 'visible'));
  const l = rt.settings.get(barKey(d.plugin, d.screen, b.slot, 'location'));
  return { visible: typeof v === 'boolean' ? v : b.visible, location: (TOOLBAR_LOCATIONS as readonly unknown[]).includes(l) ? (l as ToolbarLocation) : b.location };
}

/* ---------- running an item ---------- */

/** Run an xlayout toolbar item: an app's item opens that app where the item says, then the app runs it. */
export function runToolbarItem(rt: AxfRuntime, host: ChromeHost, item: XToolbarItem): void {
  const ide = effectiveXLayout(rt).ide.on;
  const target = openTargetFor(item, ide);
  if (item.app) {
    const own = splitNs(item.action, MOLLY_APPS.map((a) => a.id));
    openApp(rt, item.app, target);
    if (own) host.run(item.action);
    return;
  }
  rt.dispatch(item.action);
}

/* ---------- drawing ---------- */

function Btn({ icon, label, badge, pressed, locked, onClick, drag }: { icon: string; label: string; badge?: number; pressed?: boolean; locked?: boolean; onClick: () => void; drag?: DragToTabSource | null }) {
  // drag-to-tab: an app launcher drags into a pane's strip, a pane's edge or out to a window (its next copy when open)
  const dragProps = useDragToTab(locked ? null : drag ?? null);
  return (
    <button type="button" className={`fx-toolbtn${pressed ? ' is-on' : ''}`} disabled={locked} aria-pressed={pressed === undefined ? undefined : pressed} title={label} aria-label={badge ? `${label} (${badge})` : label} onClick={onClick} {...dragProps}>
      <Icon name={locked ? 'lock' : icon} size={16} />
      {!!badge && <span className="fx-toolbtn__badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

function Bar({ location, label, ctx, children }: { location: ToolbarLocation; label: string; ctx: string; children: ReactNode }) {
  return <div className="axp-xlayout-bar fx-toolbar" data-edge={location} role="toolbar" aria-label={label} data-fx-ctx-target={TOOLBAR_CTX} data-fx-ctx-payload={ctx}>{children}</div>;
}

/** Every toolbar on one edge of the app area: xLayout's slots there, the app's own toolbars (slot 1), other plugins'. */
export function ToolbarEdge({ host, location }: { host: ChromeHost; location: ToolbarLocation }) {
  const rt = useRuntime();
  const state = useAxfState();
  useSyncExternalStore(onToolbars, toolbarsRev, toolbarsRev);
  useSyncExternalStore((f) => host.subscribe(f), () => host.rev, () => host.rev);
  const l = effectiveXLayout(rt);
  const app = appOfView(state.view)?.id ?? null;
  const first = visibleToolbars(l)[0]?.slot;
  const out: ReactNode[] = [];
  for (const t of visibleToolbars(l, location)) {
    const guest = t.slot === first && app && l.merge.toolbar === 'merged' ? host.chrome().toolbars.filter((g) => g.app === app) : [];
    if (!t.items.length && !guest.length) continue;
    out.push(
      <Bar key={`x${t.slot}`} location={location} label={t.label} ctx={`xlayout|*|${t.slot}`}>
        {t.items.map((it) => <Btn key={it.id} icon={it.icon ?? 'box'} label={it.label} onClick={() => runToolbarItem(rt, host, it)} drag={it.app ? { view: it.app, label: mollyApp(it.app)?.label ?? it.label, icon: it.icon } : null} />)}
        {guest.map((g) => (
          <span key={g.id} className="fx-toolbar__group" role="group" aria-label={g.label}>
            {g.items.map((it) => <Btn key={it.id} icon={it.icon} label={it.label} badge={it.badge} pressed={it.pressed} locked={it.locked} onClick={() => host.run(it.id)} />)}
          </span>
        ))}
      </Bar>,
    );
  }
  for (const d of declaredToolbars()) {
    if (d.screen !== '*' && d.screen !== state.view && d.screen !== app) continue;
    for (const b of d.bars) {
      const s = barState(rt, d, b);
      if (!s.visible || s.location !== location || !b.items.length) continue;
      out.push(
        <Bar key={`${d.plugin}${d.screen}${b.slot}`} location={location} label={`${d.label} · ${b.label}`} ctx={`${d.plugin}|${d.screen}|${b.slot}`}>
          {b.items.map((it) => <Btn key={it.id} icon={it.icon} label={it.label} onClick={() => rt.dispatch(it.action)} />)}
        </Bar>,
      );
    }
  }
  // the empty rest of the strip is a toolbar too (right-click → Customize toolbar acts on its first bar)
  const first0 = (out[0] as { props?: { ctx?: string } } | undefined)?.props?.ctx;
  return out.length ? <div className="axp-xlayout-edge" data-edge={location} data-fx-ctx-target={TOOLBAR_CTX} data-fx-ctx-payload={first0}>{out}</div> : null;
}

/** The app area with its toolbars on the edges they were put on. */
export function WithToolbars({ host, children }: { host: ChromeHost; children: ReactNode }) {
  return (
    <div className="axp-xlayout-main">
      <ToolbarEdge host={host} location="top" />
      <div className="axp-xlayout-middle">
        <ToolbarEdge host={host} location="left" />
        <div className="axp-xlayout-body">{children}</div>
        <ToolbarEdge host={host} location="right" />
      </div>
      <ToolbarEdge host={host} location="bottom" />
    </div>
  );
}
