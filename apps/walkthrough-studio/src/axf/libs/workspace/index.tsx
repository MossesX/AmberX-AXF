/**
 * lib-workspace — an IDE workspace for any AXF web app (library@1 `ai.amberx.axf.workspace`).
 *
 *   const ws = createWorkspace({ id: 'studio', panes, layouts, toolbars });        // store, kept per viewer
 *   <WorkspaceHost ws={ws} renderPane={(id) => …} describe={(spec) => …} />       // areas, tabs, splitters, floats, toolbars
 *   <ToolbarCustomizer ws={ws} catalog={…} describe={…} />                         // in a dialog
 *   registerWorkspaceMenus(rt, ws)                                                  // context menus + `axf.ws:<id>:…` actions
 *
 * The app keeps its own pane contents and commands: toolbar items are action specs the runtime dispatches; `describe`
 * turns a spec into its label / icon / check mark. Parts (installed config `libraries.workspace.parts`): areas, splitters,
 * layouts {default}, floating-panes, maximise, toolbars {max, labels}, floating-toolbars, customizer, phone {breakpoint}.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import { Button, Icon, IconButton, SelectField, Switch, TextField, useAxfState, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import type { AxfRuntime, MenuEntry } from '../../core';
import { partOn, partParams, type LibraryPart } from '../../core/library';
import { DragLayer, registerZone, startDrag } from '../dnd';
import { AREAS, Workspace, useWorkspace, type Area, type Dock, type FloatRect, type ToolbarDef, type WorkspaceOptions } from './store';
import spec from './library.json';
import './workspace.css';

export * from './store';
export const WORKSPACE_LIBRARY_ID = 'ai.amberx.axf.workspace';
const PARTS = (spec as { parts: LibraryPart[] }).parts;

export interface WorkspaceConfig { splitters: boolean; layouts: boolean; defaultLayout: string; floatingPanes: boolean; maximise: boolean; toolbars: false | { max: number; labels: boolean }; floatingToolbars: boolean; customizer: boolean; phone: false | { breakpoint: number } }
let config: WorkspaceConfig = { splitters: true, layouts: true, defaultLayout: '', floatingPanes: true, maximise: true, toolbars: { max: 0, labels: false }, floatingToolbars: true, customizer: true, phone: { breakpoint: 760 } };
export function configureWorkspace(installed: { parts?: Record<string, unknown> } | null | undefined): WorkspaceConfig {
  const on = (id: string) => partOn(installed, id, PARTS);
  const pp = (id: string) => partParams(installed, id, PARTS.find((p) => p.id === id));
  config = {
    splitters: on('splitters'), layouts: on('layouts'), defaultLayout: String(pp('layouts').default ?? ''), floatingPanes: on('floating-panes'), maximise: on('maximise'),
    toolbars: on('toolbars') ? { max: Number(pp('toolbars').max ?? 0), labels: !!pp('toolbars').labels } : false,
    floatingToolbars: on('floating-toolbars'), customizer: on('customizer'),
    phone: on('phone') ? { breakpoint: Number(pp('phone').breakpoint ?? 760) } : false,
  };
  return config;
}
export const workspaceConfig = () => config;

const registry = new Map<string, Workspace>();
/** Make (or get) a workspace; the installed config sets its default layout and toolbar limits. */
export function createWorkspace(o: WorkspaceOptions): Workspace {
  const had = registry.get(o.id); if (had) return had;
  const ws = new Workspace({ ...o, defaultLayout: config.defaultLayout || o.defaultLayout, maxToolbars: config.toolbars ? config.toolbars.max : 0, labelsOnNew: config.toolbars ? config.toolbars.labels : false, toolbars: config.toolbars ? o.toolbars : [] });
  registry.set(o.id, ws);
  return ws;
}

/** What a toolbar / customizer shows for one action spec. */
export interface SpecInfo { spec: string; label: string; icon: string; path: string[]; checked?: boolean; disabled?: boolean; shortcut?: string; active?: { icon: string; label: string } }
export type Describe = (spec: string) => SpecInfo;

function usePhone(): boolean {
  const q = config.phone ? `(max-width: ${config.phone.breakpoint}px)` : '';
  const [m, setM] = useState(() => !!q && globalThis.matchMedia?.(q).matches);
  useEffect(() => { if (!q) return; const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

export interface WorkspaceHostProps {
  ws: Workspace;
  renderPane: (id: string) => ReactNode;
  describe: Describe;
  /** what an empty area says */
  emptyHint?: ReactNode;
  /** draw lib-dnd's layer here (default true; turn off when the app mounts DragLayer itself) */
  dragLayer?: boolean;
}

export function WorkspaceHost({ ws, renderPane, describe, emptyHint, dragLayer = true }: WorkspaceHostProps) {
  const rt = useRuntime();
  useAxfState();
  const s = useWorkspace(ws, (x) => x);
  const phone = usePhone();
  const lay = ws.layout();
  const rootRef = useRef<HTMLDivElement>(null);
  const zone = `axf-ws:${ws.id}`;

  useEffect(() => {
    const offs = [
      registerZone(`${zone}:area`, { accepts: (p) => p.kind === `${zone}:pane`, positions: () => ['inside'], drop: (p, area) => ws.movePane(p.id, area as Area) }),
      registerZone(`${zone}:item`, {
        axis: 'x', accepts: (p) => p.kind === `${zone}:item` || p.kind === `${zone}:command`, positions: () => ['before', 'after'],
        drop: (p, target, pos) => { const [tid, ti] = target.split('#'); const at = Number(ti) + (pos === 'after' ? 1 : 0); if (p.kind.endsWith(':command')) ws.placeItem({ spec: p.id }, tid!, at); else { const [sid, si] = p.id.split('#'); ws.placeItem({ toolbar: sid!, index: Number(si) }, tid!, at); } },
      }),
      registerZone(`${zone}:end`, {
        accepts: (p) => p.kind === `${zone}:item` || p.kind === `${zone}:command`, positions: () => ['inside'],
        drop: (p, tid) => { const n = ws.toolbar(tid)?.items.length ?? 0; if (p.kind.endsWith(':command')) ws.placeItem({ spec: p.id }, tid, n); else { const [sid, si] = p.id.split('#'); ws.placeItem({ toolbar: sid!, index: Number(si) }, tid, n + 1); } },
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [ws, zone]);

  const by = Object.fromEntries(AREAS.map((a) => [a, ws.visible(a)])) as Record<(typeof AREAS)[number], string[]>;
  const floating = config.floatingPanes ? ws.visible('float') : [];
  const dock = (d: Dock) => (config.toolbars ? s.toolbars.filter((t) => t.visible && t.dock === d && (d !== 'float' || config.floatingToolbars)).sort((a, b) => a.order - b.order) : []);
  const zoom = config.maximise ? s.zoom : null;
  const style = { '--axf-ws-left': by.left.length && !zoom ? `${lay.sizes.left}px` : '0px', '--axf-ws-right': by.right.length && !zoom ? `${lay.sizes.right}px` : '0px', '--axf-ws-bottom': by.bottom.length && !zoom ? `${lay.sizes.bottom}px` : '0px' } as CSSProperties;
  const area = (a: Area, ids: string[]) => <AreaView ws={ws} area={a} ids={ids} zone={zone} renderPane={renderPane} emptyHint={emptyHint} />;
  const tb = (d: Dock) => <ToolbarDock ws={ws} edge={d} list={dock(d)} describe={describe} zone={zone} rt={rt} phone={phone} />;
  return (
    <div className="axf-ws" ref={rootRef} data-fx-ctx-target={`axf-ws:${ws.id}`}>
      {tb('top')}
      <div className="axf-ws-body">
        {!phone && tb('left')}
        {phone ? <div className="axf-ws-areas axf-ws-areas--one">{area('center', AREAS.flatMap((a) => by[a]).concat(ws.visible('float')))}</div>
          : zoom ? <div className="axf-ws-areas axf-ws-areas--one">{area(zoom, by[zoom as (typeof AREAS)[number]] ?? [])}</div>
          : (
            <div className="axf-ws-areas" style={style}>
              {by.left.length > 0 && <>{area('left', by.left)}{config.splitters ? <Splitter ws={ws} which="left" /> : <span className="axf-ws-gap axf-ws-gap--left" />}</>}
              {area('center', by.center)}
              {by.right.length > 0 && <>{config.splitters ? <Splitter ws={ws} which="right" /> : <span className="axf-ws-gap axf-ws-gap--right" />}{area('right', by.right)}</>}
              {by.bottom.length > 0 && <>{config.splitters ? <Splitter ws={ws} which="bottom" /> : <span className="axf-ws-gap axf-ws-gap--bottom" />}{area('bottom', by.bottom)}</>}
            </div>
          )}
        {!phone && tb('right')}
      </div>
      {tb('bottom')}
      {!phone && floating.map((id) => <FloatPane key={id} ws={ws} id={id} rect={s.floats[id]} renderPane={renderPane} />)}
      {dock('float').map((t) => <div key={t.id} className="axf-ws-tbfloat fx-popover" style={{ left: t.x, top: t.y }}><Toolbar ws={ws} tb={t} describe={describe} zone={zone} rt={rt} onGrip={(e) => detach(e, ws, t, rootRef.current)} /></div>)}
      {dragLayer && <DragLayer />}
    </div>
  );
}

function AreaView({ ws, area, ids, zone, renderPane, emptyHint }: { ws: Workspace; area: Area; ids: string[]; zone: string; renderPane: (id: string) => ReactNode; emptyHint?: ReactNode }) {
  const front = useWorkspace(ws, (s) => s.front[area]);
  const zoom = useWorkspace(ws, (s) => s.zoom);
  const cur = ids.includes(front ?? '') ? front! : ids[0];
  if (!cur) return <section className={`axf-ws-area axf-ws-area--${area} is-empty`} data-axf-drop={`${zone}:area`} data-axf-drop-id={area}><div className="axf-ws-empty">{emptyHint ?? <><Icon name="layout" size={20} /><span>Drop a pane tab here.</span></>}</div></section>;
  return (
    <section className={`axf-ws-area axf-ws-area--${area}`} data-axf-drop={`${zone}:area`} data-axf-drop-id={area}>
      <div className="axf-ws-tabs" role="tablist">
        {ids.map((id) => {
          const pd = ws.pane(id)!;
          return (
            <button key={id} type="button" role="tab" aria-selected={id === cur} className={`fx-tab axf-ws-tab ${id === cur ? 'is-active' : ''}`} title={pd.description}
              onClick={() => ws.front(id)} onPointerDown={(e) => startDrag(e, { kind: `${zone}:pane`, id, label: pd.title, icon: pd.icon, trashable: true, onTrash: () => ws.togglePane(id, false) })}
              data-fx-ctx-target={`axf-ws-pane:${ws.id}`} data-fx-ctx-payload={id}>
              <span className="axf-dnd-grip"><Icon name={pd.icon} size={13} /></span>{pd.title}
            </button>
          );
        })}
        <span className="fx-grow" />
        {config.maximise && area !== 'float' && <IconButton icon={zoom ? 'minimize' : 'monitor'} label={zoom ? 'Back to the layout' : 'Maximise this area'} onClick={() => ws.zoom(area)} />}
        <IconButton icon="x" label={`Hide ${ws.pane(cur)?.title}`} onClick={() => ws.togglePane(cur, false)} />
      </div>
      <div className="axf-ws-body2" data-fx-ctx-target={`axf-ws-pane:${ws.id}`} data-fx-ctx-payload={cur}>{renderPane(cur)}</div>
    </section>
  );
}

function Splitter({ ws, which }: { ws: Workspace; which: 'left' | 'right' | 'bottom' }) {
  const down = (e: RPointerEvent) => {
    e.preventDefault();
    const start = ws.layout().sizes[which]; const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => { const d = which === 'left' ? ev.clientX - sx : which === 'right' ? sx - ev.clientX : sy - ev.clientY; ws.setSize(which, Math.max(160, Math.min(innerWidth * 0.6, start + d))); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  return <div className={`axf-ws-split axf-ws-split--${which}`} onPointerDown={down} role="separator" aria-orientation={which === 'bottom' ? 'horizontal' : 'vertical'} aria-label={`Resize the ${which} area`} />;
}

function FloatPane({ ws, id, rect, renderPane }: { ws: Workspace; id: string; rect?: FloatRect; renderPane: (id: string) => ReactNode }) {
  const pd = ws.pane(id)!;
  const r = rect ?? { x: 80, y: 80, w: 420, h: 320, z: 0 };
  const ref = useRef<HTMLDivElement>(null);
  const keep = () => ref.current && ws.setFloat(id, { w: ref.current.offsetWidth, h: ref.current.offsetHeight });
  const drag = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const sx = e.clientX - r.x, sy = e.clientY - r.y; ws.front(id);
    const move = (ev: PointerEvent) => ws.setFloat(id, { x: Math.max(0, ev.clientX - sx), y: Math.max(0, ev.clientY - sy) });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); keep(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  return (
    <div className="axf-ws-float fx-popover" ref={ref} style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: 40 + (r.z % 1000) }} onPointerUp={keep}>
      <header className="axf-ws-float__head" onPointerDown={drag} data-fx-ctx-target={`axf-ws-pane:${ws.id}`} data-fx-ctx-payload={id}>
        <Icon name={pd.icon} size={14} /> <strong>{pd.title}</strong><span className="fx-grow" />
        <IconButton icon="layout" label="Dock in the center" onClick={() => ws.movePane(id, 'center')} />
        <IconButton icon="x" label="Hide" onClick={() => ws.togglePane(id, false)} />
      </header>
      <div className="axf-ws-float__body">{renderPane(id)}</div>
    </div>
  );
}

function ToolbarDock({ ws, edge, list, describe, zone, rt, phone }: { ws: Workspace; edge: Dock; list: ToolbarDef[]; describe: Describe; zone: string; rt: AxfRuntime; phone: boolean }) {
  if (!list.length) return null;
  return <div className={`axf-ws-dock axf-ws-dock--${edge}`}>{list.map((t) => <Toolbar key={t.id} ws={ws} tb={t} vertical={!phone && (edge === 'left' || edge === 'right')} describe={describe} zone={zone} rt={rt} />)}</div>;
}

function Toolbar({ ws, tb, vertical, describe, zone, rt, onGrip }: { ws: Workspace; tb: ToolbarDef; vertical?: boolean; describe: Describe; zone: string; rt: AxfRuntime; onGrip?: (e: RPointerEvent) => void }) {
  const grip = onGrip ?? ((e: RPointerEvent) => config.floatingToolbars && detach(e, ws, tb, (e.currentTarget as HTMLElement).closest('.axf-ws') as HTMLElement | null));
  return (
    <div className={`axf-ws-toolbar ${vertical ? 'axf-ws-toolbar--v' : ''}`} role="toolbar" aria-label={tb.name} data-fx-ctx-target={`axf-ws-toolbar:${ws.id}`} data-fx-ctx-payload={tb.id}>
      <span className="axf-ws-grip axf-dnd-grip" onPointerDown={grip} title={config.floatingToolbars ? `${tb.name}: drag to float, drop on an edge to dock` : tb.name}><Icon name="more" size={14} /></span>
      {tb.items.map((s, i) => {
        const key = `${tb.id}#${i}`;
        if (s === '|') return <span key={i} className="axf-ws-sep" data-axf-drop={`${zone}:item`} data-axf-drop-id={key} onPointerDown={(e) => startDrag(e, { kind: `${zone}:item`, id: key, label: 'Separator', icon: 'minus', trashable: true, onTrash: () => ws.removeItem(tb.id, i) })} />;
        const d = describe(s);
        const shown = d.active ?? { icon: d.icon, label: d.label };
        return (
          <span key={i} className={`axf-ws-item ${d.checked || d.active ? 'is-on' : ''}`} data-axf-drop={`${zone}:item`} data-axf-drop-id={key}
            onPointerDown={(e) => { if (e.pointerType === 'mouse') startDrag(e, { kind: `${zone}:item`, id: key, label: d.label, icon: d.icon, trashable: true, onTrash: () => ws.removeItem(tb.id, i) }); }}>
            <button type="button" className={`fx-btn fx-btn--sm ${tb.labels ? 'fx-btn--ghost' : 'fx-btn--quiet'}`} disabled={d.disabled} aria-pressed={d.checked ?? undefined}
              title={`${d.label}${d.shortcut ? ` (${d.shortcut})` : ''}`} onClick={() => rt.dispatch(s)}>
              <Icon name={shown.icon} size={15} />{tb.labels && <span>{shown.label}</span>}
            </button>
          </span>
        );
      })}
      <span className="axf-ws-end" data-axf-drop={`${zone}:end`} data-axf-drop-id={tb.id} />
    </div>
  );
}

/** drag a toolbar by its grip: it floats under the pointer; let go near an edge and it docks there */
function detach(e: RPointerEvent, ws: Workspace, tb: ToolbarDef, host: HTMLElement | null) {
  if (!host) return;
  e.preventDefault();
  const box = host.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY; let moved = false;
  const ox = tb.dock === 'float' ? sx - box.left - tb.x : 12, oy = tb.dock === 'float' ? sy - box.top - tb.y : 12;
  const edgeOf = (x: number, y: number): Dock => (y - box.top < 36 ? 'top' : box.bottom - y < 36 ? 'bottom' : x - box.left < 36 ? 'left' : box.right - x < 36 ? 'right' : 'float');
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    moved = true;
    ws.patchToolbar(tb.id, { dock: 'float', x: Math.max(0, ev.clientX - box.left - ox), y: Math.max(0, ev.clientY - box.top - oy) });
    host.dataset.axfDockHint = edgeOf(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    delete host.dataset.axfDockHint;
    if (moved) { const edge = edgeOf(ev.clientX, ev.clientY); if (edge !== 'float') ws.patchToolbar(tb.id, { dock: edge, order: 99 }); }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

/* ---------- toolbar customizer ---------- */

interface Node { name: string; path: string; children: Map<string, Node>; items: SpecInfo[] }
function treeOf(list: SpecInfo[]): Node {
  const root: Node = { name: '', path: '', children: new Map(), items: [] };
  for (const it of list) {
    let n = root;
    for (const seg of it.path) { const p = `${n.path}/${seg}`; if (!n.children.has(seg)) n.children.set(seg, { name: seg, path: p, children: new Map(), items: [] }); n = n.children.get(seg)!; }
    n.items.push(it);
  }
  return root;
}
const countOf = (n: Node): number => n.items.length + [...n.children.values()].reduce((a, c) => a + countOf(c), 0);

export function ToolbarCustomizer({ ws, catalog, describe, initial, close }: { ws: Workspace; catalog: () => SpecInfo[]; describe: Describe; initial?: string; close: () => void }) {
  const toolbars = useWorkspace(ws, (s) => s.toolbars);
  const [cur, setCur] = useState(initial && toolbars.some((t) => t.id === initial) ? initial : toolbars[0]?.id);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<'tree' | 'az' | 'za'>('tree');
  const [open, setOpen] = useState<string[]>([]);
  const all = useMemo(() => catalog(), [catalog, toolbars.length]);
  const tb = toolbars.find((t) => t.id === cur);
  const zone = `axf-ws:${ws.id}:cust`;
  useEffect(() => registerZone(zone, {
    accepts: (p) => p.kind === `${zone}:cmd` || p.kind === `${zone}:item`, positions: () => ['before', 'after'],
    drop: (p, target, pos) => { if (!cur) return; const at = Number(target) + (pos === 'after' ? 1 : 0); if (p.kind.endsWith(':cmd')) ws.placeItem({ spec: p.id }, cur, at); else ws.placeItem({ toolbar: cur, index: Number(p.id) }, cur, at); },
  }), [zone, cur, ws]);
  useEffect(() => registerZone(`${zone}:end`, { accepts: (p) => p.kind === `${zone}:cmd`, positions: () => ['inside'], drop: (p) => { const t = cur && ws.toolbar(cur); if (t) ws.placeItem({ spec: p.id }, t.id, t.items.length); } }), [zone, cur, ws]);

  const cats = [...new Set(all.map((x) => x.path.join(' › ')))].sort();
  const filtered = all.filter((x) => (!cat || x.path.join(' › ').startsWith(cat)) && (!q || `${x.label} ${x.spec} ${x.path.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const add = (s: string) => tb && ws.placeItem({ spec: s }, tb.id, tb.items.length);
  const row = (it: SpecInfo, showPath = false) => (
    <li key={it.spec}>
      <div className="axf-ws-cmd" onPointerDown={(e) => startDrag(e, { kind: `${zone}:cmd`, id: it.spec, label: it.label, icon: it.icon })} onDoubleClick={() => add(it.spec)}>
        <span className="axf-dnd-grip"><Icon name={it.icon} size={14} /></span>
        <span className="axf-ws-cmd__text"><span className="axf-ws-ellipsis">{it.label}</span><span className="axf-ws-cmd__spec">{showPath ? `${it.path.join(' › ')} · ` : ''}{it.spec}</span></span>
        {tb?.items.includes(it.spec) && <Icon name="check" size={12} />}
        <IconButton icon="plus" label={`Add ${it.label}`} onClick={() => add(it.spec)} />
      </div>
    </li>
  );
  const branch = (n: Node, depth: number): ReactNode => (
    <>
      {[...n.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map((k) => {
        const o = open.includes(k.path) || !!q || (depth === 0 && open.length === 0 && k.name === n.children.keys().next().value);
        return (
          <li key={k.path}>
            <button type="button" data-fx-row className="axf-ws-cmdhead" style={{ paddingInlineStart: `calc(var(--fx-space) * ${depth * 1.4 + 0.4})` }} aria-expanded={o} onClick={() => setOpen((x) => (o ? x.filter((y) => y !== k.path) : [...x, k.path]))}>
              <Icon name={o ? 'chevron-down' : 'chevron-right'} size={12} /> <strong>{k.name}</strong> <span className="axf-ws-count">{countOf(k)}</span>
            </button>
            {o && <ul className="axf-ws-cmdgroup">{branch(k, depth + 1)}</ul>}
          </li>
        );
      })}
      {[...n.items].sort((a, b) => a.label.localeCompare(b.label)).map((it) => row(it))}
    </>
  );
  const sorted = sort === 'tree' ? null : [...filtered].sort((a, b) => a.label.localeCompare(b.label) * (sort === 'az' ? 1 : -1));
  return (
    <div className="axf-ws-cust">
      <section className="axf-ws-cust__col">
        <h3 className="axf-ws-h">Toolbars</h3>
        {toolbars.map((t) => (
          <button key={t.id} type="button" data-fx-row className={`axf-ws-row ${t.id === cur ? 'is-active' : ''}`} onClick={() => setCur(t.id)}>
            <Icon name={t.dock === 'float' ? 'layers' : 'layout'} size={14} /><span className="axf-ws-ellipsis fx-grow">{t.name}</span><span className="axf-ws-count">{t.dock} · {t.items.length}</span>
          </button>
        ))}
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="plus" disabled={!ws.canAddToolbar()} onClick={() => { const id = ws.addToolbar(); if (id) setCur(id); }}>Add toolbar</Button>
          <Button size="sm" tone="quiet" icon="refresh" onClick={() => { ws.resetToolbars(); setCur(ws.s.toolbars[0]?.id); }}>Defaults</Button>
        </div>
        {tb && (
          <div className="fx-stack">
            <TextField label="Name" value={tb.name} onChange={(v) => ws.patchToolbar(tb.id, { name: v })} />
            <SelectField label="Place" value={tb.dock} onChange={(v) => ws.patchToolbar(tb.id, { dock: v as Dock })} options={[{ value: 'top', label: 'Docked top' }, { value: 'bottom', label: 'Docked bottom' }, { value: 'left', label: 'Docked left' }, { value: 'right', label: 'Docked right' }, ...(config.floatingToolbars ? [{ value: 'float', label: 'Floating' }] : [])]} />
            <Switch label="Show labels" checked={tb.labels} onChange={(v) => ws.patchToolbar(tb.id, { labels: v })} />
            <Switch label="Shown" checked={tb.visible} onChange={(v) => ws.patchToolbar(tb.id, { visible: v })} />
            <Button size="sm" tone="danger" icon="trash" onClick={() => { ws.removeToolbar(tb.id); setCur(ws.s.toolbars[0]?.id); }}>Remove this toolbar</Button>
          </div>
        )}
      </section>
      <section className="axf-ws-cust__col">
        <h3 className="axf-ws-h">On “{tb?.name}” <span className="axf-ws-count">drag to reorder</span></h3>
        <ol className="axf-ws-list">
          {tb?.items.map((s, i) => {
            const d = s === '|' ? { label: 'Separator', icon: 'minus' } : describe(s);
            return (
              <li key={`${s}-${i}`} className="axf-ws-cmd" data-axf-drop={zone} data-axf-drop-id={String(i)} onPointerDown={(e) => startDrag(e, { kind: `${zone}:item`, id: String(i), label: d.label, icon: d.icon })}>
                <span className="axf-dnd-grip"><Icon name={d.icon} size={14} /></span><span className="axf-ws-ellipsis fx-grow">{d.label}</span>
                <IconButton icon="chevron-up" label="Earlier" onClick={() => i > 0 && ws.placeItem({ toolbar: tb.id, index: i }, tb.id, i - 1)} />
                <IconButton icon="chevron-down" label="Later" onClick={() => i < tb.items.length - 1 && ws.placeItem({ toolbar: tb.id, index: i }, tb.id, i + 2)} />
                <IconButton icon="x" label="Remove" onClick={() => ws.removeItem(tb.id, i)} />
              </li>
            );
          })}
          <li className="axf-ws-drop" data-axf-drop={`${zone}:end`} data-axf-drop-id="end">Drop a command here, or tap + in the list</li>
        </ol>
        {tb && <Button size="sm" tone="quiet" icon="minus" onClick={() => add('|')}>Add a separator</Button>}
      </section>
      <section className="axf-ws-cust__col axf-ws-cust__col--wide">
        <h3 className="axf-ws-h">Every command <span className="axf-ws-count">{filtered.length}</span></h3>
        <div className="fx-search axf-ws-search"><Icon name="search" size={14} /><input className="fx-input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search commands" autoFocus /></div>
        <div className="fx-row">
          <select className="fx-input axf-ws-filter" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">Every category</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="fx-input axf-ws-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort"><option value="tree">Tree</option><option value="az">A → Z</option><option value="za">Z → A</option></select>
        </div>
        <ul className="axf-ws-cmdtree">{sorted ? sorted.map((it) => row(it, true)) : branch(treeOf(filtered), 0)}</ul>
      </section>
      <div className="fx-row fx-row--end axf-ws-cust__foot"><Button tone="primary" onClick={close}>Done</Button></div>
    </div>
  );
}

/* ---------- menus + actions ---------- */

const mark = (on: boolean) => (on ? 'check' : 'minus');
export const paneMenu = (ws: Workspace): MenuEntry[] => ws.panes.map((p) => ({ id: `pn-${p.id}`, label: p.title, icon: mark(ws.paneShown(p.id)), action: `axf.ws:${ws.id}:pane:${p.id}` }));
export const layoutMenu = (ws: Workspace): MenuEntry[] => (config.layouts ? ws.layouts.map((l) => ({ id: `ly-${l.id}`, label: l.label, icon: mark(ws.s.layout === l.id), action: `axf.ws:${ws.id}:layout:${l.id}` })) : []);
export const toolbarMenu = (ws: Workspace, customize?: string): MenuEntry[] => (config.toolbars ? [
  ...ws.s.toolbars.map((t) => ({ id: `tb-${t.id}`, label: `${t.name} (${t.dock})`, icon: mark(t.visible), action: `axf.ws:${ws.id}:toolbar-toggle:${t.id}` })),
  { id: 'tb-sep', separator: true },
  ...(ws.canAddToolbar() ? [{ id: 'tb-add', label: 'Add a toolbar', icon: 'plus', action: `axf.ws:${ws.id}:toolbar-add` }] : []),
  ...(config.customizer && customize ? [{ id: 'tb-cust', label: 'Customize toolbars…', icon: 'sliders', action: customize }] : []),
  { id: 'tb-reset', label: 'Back to the default toolbars', icon: 'refresh', action: `axf.ws:${ws.id}:toolbars-reset` },
] : []);

/** Context menus for panes, toolbars and the workspace; `customize` = the app's action that opens the customizer. */
export function registerWorkspaceMenus(rt: AxfRuntime, ws: Workspace, opts: { customize?: string; extra?: () => MenuEntry[] } = {}): () => void {
  const a = (what: string, ...args: string[]) => `axf.ws:${ws.id}:${[what, ...args].join(':')}`;
  const targets = [`axf-ws-pane:${ws.id}`, `axf-ws-toolbar:${ws.id}`, `axf-ws:${ws.id}`];
  rt.contextExtras.set(targets[0]!, (_t, id = '') => [
    { id: 'move', label: 'Move to', icon: 'arrow-right', items: (['left', 'center', 'right', 'bottom', ...(config.floatingPanes ? ['float'] : [])] as const).map((x) => ({ id: `m-${x}`, label: x === 'float' ? 'Float' : x[0]!.toUpperCase() + x.slice(1), icon: x === 'float' ? 'layers' : 'layout', action: a('move', id, x) })) },
    { id: 'hide', label: 'Hide this pane', icon: 'x', action: a('pane', id) },
    ...(config.maximise ? [{ id: 'zoom', label: 'Maximise its area', icon: 'monitor', action: a('zoom', ws.layout().panes[id]?.area ?? 'center') }] : []),
    { id: 's1', separator: true },
    { id: 'panes', label: 'Panes', icon: 'layout', items: paneMenu(ws) },
    ...(config.layouts ? [{ id: 'layouts', label: 'Workspace layout', icon: 'layout', items: layoutMenu(ws) }] : []),
  ]);
  rt.contextExtras.set(targets[1]!, (_t, id = '') => {
    const t = ws.toolbar(id);
    return [
      ...(config.customizer && opts.customize ? [{ id: 'cust', label: `Customize “${t?.name ?? ''}”…`, icon: 'sliders', action: `${opts.customize}:${id}` }] : []),
      { id: 'labels', label: t?.labels ? 'Icons only' : 'Show labels', icon: 'type', action: a('toolbar-labels', id) },
      { id: 'dock', label: 'Dock', icon: 'layout', items: (['top', 'bottom', 'left', 'right', ...(config.floatingToolbars ? ['float'] : [])] as Dock[]).map((d) => ({ id: `d-${d}`, label: d === 'float' ? 'Float' : `Dock ${d}`, icon: mark(t?.dock === d), action: a('toolbar-dock', id, d) })) },
      { id: 'hide', label: 'Hide', icon: 'eye', action: a('toolbar-toggle', id) },
      { id: 'remove', label: 'Remove', icon: 'trash', action: a('toolbar-remove', id) },
      { id: 's1', separator: true },
      { id: 'all', label: 'Toolbars', icon: 'sliders', items: toolbarMenu(ws, opts.customize) },
    ];
  });
  rt.contextExtras.set(targets[2]!, () => [
    ...(config.layouts ? [{ id: 'layouts', label: 'Workspace layout', icon: 'layout', items: layoutMenu(ws) }] : []),
    { id: 'panes', label: 'Panes', icon: 'layout', items: paneMenu(ws) },
    ...(config.toolbars ? [{ id: 'toolbars', label: 'Toolbars', icon: 'sliders', items: toolbarMenu(ws, opts.customize) }] : []),
    ...(opts.extra?.() ?? []),
  ]);
  return () => targets.forEach((t) => rt.contextExtras.delete(t));
}

/** `axf.ws:<workspace>:<what>[:args]` — what every menu above runs */
function runWs(args: string[]) {
  const [id = '', what = '', x = '', y = ''] = args;
  const ws = registry.get(id); if (!ws) return;
  switch (what) {
    case 'pane': ws.togglePane(x); break;
    case 'show': ws.togglePane(x, true); break;
    case 'move': ws.movePane(x, y as Area); break;
    case 'layout': ws.setLayout(x); break;
    case 'layout-reset': ws.resetLayout(); break;
    case 'zoom': ws.zoom((x as Area) || null); break;
    case 'toolbar-toggle': { const t = ws.toolbar(x); if (t) ws.patchToolbar(x, { visible: !t.visible }); break; }
    case 'toolbar-labels': { const t = ws.toolbar(x); if (t) ws.patchToolbar(x, { labels: !t.labels }); break; }
    case 'toolbar-dock': ws.patchToolbar(x, { dock: y as Dock }); break;
    case 'toolbar-remove': ws.removeToolbar(x); break;
    case 'toolbar-add': ws.addToolbar(undefined, (x as Dock) || 'top'); break;
    case 'toolbars-reset': ws.resetToolbars(); break;
  }
}
export const getWorkspace = (id: string) => registry.get(id);
export type WorkspaceRef = RefObject<HTMLDivElement | null>;

export const library: AxfWebLibrary = {
  id: WORKSPACE_LIBRARY_ID,
  label: 'Workspace',
  version: '0.1.0',
  provides: ['axf.workspace'],
  register(rt) {
    configureWorkspace((rt.manifest as { libraries?: Record<string, { parts?: Record<string, unknown> }> }).libraries?.workspace);
    rt.actions.register('axf.ws', (args) => runWs(args), { label: 'Workspace', params: true } as never);
  },
};
