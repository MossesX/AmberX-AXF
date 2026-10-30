/*
 * Context menu designer — the Actions window (a floating window, tab kind `ctxd-actions`) and its Filter dialog
 * (`context-menu-designer.filter`). The window lists every action the app can run (web/actions.ts) with a search bar
 * and a Filter button; tapping one hands it to the designer (the selected item's action, or a new item). The filter
 * is one setting (`context-menu-designer.actions.filter`, JSON), so every open window follows a change at once.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Icon, IconButton, Note, Segmented, Switch, useAxfState, useRuntime } from '@console/axf/react';
import { ASSET_TYPES, type AxfRuntime } from '@console/axf/core';
import { bundledPlugins } from '@console/plugins';
import {
  SOURCES, buildCatalog, defaultFilter, filterChanges, filterRows, groupRows, normalizeFilter, owners,
  type ActionFilter, type ActionRow, type ActionSource, type CatalogInput,
} from './actions';

export const ACTIONS_TAB_KIND = 'ctxd-actions';
export const ACTIONS_TAB_ID = 'ctxd-actions';
export const FILTER_DIALOG = 'context-menu-designer.filter';
export const FILTER_KEY = 'context-menu-designer.actions.filter';
const PAGE = 300;

/* ---- the designer ⇄ window bridge: what a tap in the window does ---- */

export interface PickTarget { label: string; pick: (row: ActionRow) => void }
let target: PickTarget | null = null;
const listeners = new Set<() => void>();
export function setPickTarget(t: PickTarget | null): void { target = t; listeners.forEach((f) => f()); }
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const usePickTarget = () => useSyncExternalStore(subscribe, () => target, () => target);

/* ---- filter (a setting, so it hot-renders everywhere) ---- */

export const readFilter = (rt: AxfRuntime): ActionFilter => normalizeFilter(rt.settings.get(FILTER_KEY));
export const writeFilter = (rt: AxfRuntime, f: ActionFilter) => rt.settings.set(FILTER_KEY, JSON.stringify(f));

/** Everything the catalog needs, read off the runtime now. */
export function catalogInput(rt: AxfRuntime): CatalogInput {
  const entries = rt.search.entries();
  const of = (kind: string) => entries.filter((e) => e.kind === kind);
  const f = (e: { focus: unknown }, k: string) => String((e.focus as Record<string, unknown>)?.[k] ?? '');
  const swapTypes = (ASSET_TYPES as readonly string[]).filter((t) => t !== 'uac-policy' && rt.registry.list(t as never).length > 1);
  return {
    actions: rt.actions.list(),
    libraries: rt.libraries.map((l) => ({ id: l.id, label: l.label, views: l.ui?.views.map((v) => v.id), dialogs: l.ui?.dialogs.map((d) => d.id), settingsTabs: l.ui?.settingsTabs.map((t) => t.id) })),
    pluginIds: bundledPlugins.map((p) => p.manifest.id).filter(Boolean),
    views: of('view').filter((e) => f(e, 'view')).map((e) => ({ id: f(e, 'view'), label: e.label, ...(e.icon ? { icon: e.icon } : {}), ...(e.requires ? { requires: e.requires } : {}) })),
    dialogs: of('dialog').filter((e) => f(e, 'id')).map((e) => ({ id: f(e, 'id'), label: e.label, ...(e.icon ? { icon: e.icon } : {}) })),
    settingsTabs: of('settings-tab').filter((e) => f(e, 'tab')).map((e) => ({ id: f(e, 'tab'), label: e.label, ...(e.icon ? { icon: e.icon } : {}) })),
    swapTypes,
  };
}

/** Open the Actions window, or bring it forward when it's open. */
export function openActionsWindow(rt: AxfRuntime): void {
  const wm = rt.windows;
  const inGroup = wm.groupOf(ACTIONS_TAB_ID);
  if (inGroup) {
    const g = wm.state.groups[inGroup]!;
    wm.activate(inGroup, g.tabs.findIndex((t) => t.id === ACTIONS_TAB_ID));
    const win = wm.state.windows.find((w) => w.id === g.windowId);
    if (win?.minimized) wm.restore(win.id); else if (win) wm.focus(win.id);
    return;
  }
  const w = Math.min(520, innerWidth - 24);
  const h = Math.min(620, innerHeight - 96);
  wm.openFloating([{ id: ACTIONS_TAB_ID, title: 'Actions', kind: ACTIONS_TAB_KIND, icon: 'zap' }], 'Actions', 'floating', w, h, Math.max(8, innerWidth - w - 16), 72);
}

function Badges({ r }: { r: ActionRow }) {
  return (
    <span className="axp-ctxd-act__badges">
      {r.params && <span className="fx-chip">needs arguments</span>}
      {r.stub && <span className="fx-chip fx-chip--warning">no handler yet</span>}
      {r.requires && <span className="fx-chip" title={`Needs the permission ${r.requires}`}>{r.requires}</span>}
    </span>
  );
}

/** The window's content. */
export function ActionsTab() {
  const rt = useRuntime();
  useAxfState(); // filter, registry and library changes re-render it
  const pick = usePickTarget();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const filter = readFilter(rt);
  const all = useMemo(() => buildCatalog(catalogInput(rt)), [rt, rt.libraries.length, rt.actions.list().length, rt.getState().rev]);
  const rows = filterRows(all, filter, q, (p) => rt.can(p));
  const groups = groupRows(rows.slice(0, limit));
  const changed = filterChanges(filter);
  const srcIcon = (s: ActionSource) => SOURCES.find((x) => x.id === s)?.icon ?? 'zap';
  return (
    <div className="axp-ctxd-act">
      <div className="axp-ctxd-act__bar">
        <input className="fx-input" type="search" aria-label="Search actions" value={q} placeholder="Search actions: name, id or plugin" onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} autoFocus />
        <span className="axp-ctxd-act__filter">
          <Button size="sm" icon="sliders" onClick={() => rt.openDialog(FILTER_DIALOG)}>Filter</Button>
          {changed > 0 && <span className="fx-chip fx-chip--accent" aria-label={`${changed} filter choices changed`}>{changed}</span>}
        </span>
      </div>
      <p className="axp-ctxd-muted axp-ctxd-act__target">
        {pick ? <>Tap an action to use it for <strong>{pick.label}</strong>.</> : 'Open a menu or chunk in the designer to use an action.'}
        {' '}{rows.length} of {all.length} actions.
      </p>
      {!rows.length && <Note>Nothing matches. Change the search or the filter.</Note>}
      <div className="axp-ctxd-act__list">
        {groups.map((g) => (
          <section key={g.key} className="axp-ctxd-act__group">
            <header className="axp-ctxd-act__head"><Icon name={srcIcon(g.source)} size={14} /><strong>{SOURCES.find((s) => s.id === g.source)?.label}</strong><span className="axp-ctxd-muted">› {g.label} · {g.rows.length}</span></header>
            <ul className="axp-ctxd-list">
              {g.rows.map((r) => (
                <li key={r.spec}>
                  <button type="button" data-fx-row className="axp-ctxd-row axp-ctxd-act__row" disabled={!pick} onClick={() => pick?.pick(r)} title={pick ? `Use ${r.spec}` : undefined}>
                    {r.icon ? <Icon name={r.icon} size={14} /> : <Icon name="zap" size={14} />}
                    <span className="axp-ctxd-act__text"><span>{r.label}</span><code className="axp-ctxd-muted">{r.spec}</code></span>
                    <Badges r={r} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {rows.length > limit && <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</Button>}
    </div>
  );
}

/** The Filter dialog: sources, owners, what kinds of action, sort. Every change applies at once. */
export function FilterDialog({ close }: { close: () => void }) {
  const rt = useRuntime();
  useAxfState();
  const f = readFilter(rt);
  const set = (patch: Partial<ActionFilter>) => writeFilter(rt, { ...f, ...patch });
  const all = useMemo(() => buildCatalog(catalogInput(rt)), [rt]);
  const who = owners(all);
  const count = (s: ActionSource) => all.filter((r) => r.source === s).length;
  const toggleSource = (s: ActionSource, on: boolean) => set({ sources: on ? [...new Set([...f.sources, s])] : f.sources.filter((x) => x !== s) });
  const toggleOwner = (o: string) => set({ owners: f.owners.includes(o) ? f.owners.filter((x) => x !== o) : [...f.owners, o] });
  return (
    <div className="fx-stack axp-ctxd-filter">
      <section className="fx-stack">
        <strong>Where it comes from</strong>
        {SOURCES.map((s) => <Switch key={s.id} label={`${s.label} (${count(s.id)})`} hint={s.note} checked={f.sources.includes(s.id)} onChange={(v) => toggleSource(s.id, v)} />)}
      </section>
      {SOURCES.filter((s) => f.sources.includes(s.id)).map((s) => {
        const list = who.filter((o) => o.source === s.id);
        if (list.length < 2) return null;
        return (
          <details key={s.id} className="axp-ctxd-filter__owners" open={list.some((o) => f.owners.includes(o.owner))}>
            <summary><strong>{s.label}: only these</strong> <span className="axp-ctxd-muted">({list.length})</span></summary>
            <div className="axp-ctxd-filter__chips">
              {list.map((o) => (
                <button key={o.owner || '_app'} type="button" className={`fx-chip${f.owners.includes(o.owner) ? ' is-on' : ''}`} aria-pressed={f.owners.includes(o.owner)} onClick={() => toggleOwner(o.owner)}>{o.label} · {o.count}</button>
              ))}
            </div>
          </details>
        );
      })}
      {f.owners.length > 0 && <p className="axp-ctxd-muted">Showing {f.owners.length} picked owner{f.owners.length === 1 ? '' : 's'} only. <Button size="sm" tone="quiet" onClick={() => set({ owners: [] })}>Show every owner</Button></p>}
      <section className="fx-stack">
        <strong>What to list</strong>
        <Switch label="Ready-made pages, dialogs and settings" hint="nav:<page>, dialog:<id>, settings.open:<tab>, swap:<type>:next" checked={f.expanded} onChange={(v) => set({ expanded: v })} />
        <Switch label="Actions that need arguments" hint="Listed as id: for you to finish typing" checked={f.params} onChange={(v) => set({ params: v })} />
        <Switch label="Stand-ins with no handler yet" hint="Standard framework actions this app hasn’t given a handler" checked={f.stubs} onChange={(v) => set({ stubs: v })} />
        <Switch label="Only what my role can run" checked={f.allowedOnly} onChange={(v) => set({ allowedOnly: v })} />
      </section>
      <Segmented label="Sort" value={f.sort} options={[{ value: 'source', label: 'By source' }, { value: 'name', label: 'Name' }, { value: 'id', label: 'Action id' }]} onChange={(v) => set({ sort: v as ActionFilter['sort'] })} />
      <div className="fx-row fx-row--wrap axp-ctxd-opts">
        <Button size="sm" tone="primary" icon="check" onClick={close}>Done</Button>
        <Button size="sm" icon="refresh" disabled={filterChanges(f) === 0} onClick={() => writeFilter(rt, defaultFilter())}>Back to the defaults</Button>
        <IconButton icon="zap" label="Open the Actions window" onClick={() => { close(); openActionsWindow(rt); }} />
      </div>
    </div>
  );
}
