/**
 * The IDE workspace: toolbar docks on all four edges, four pane areas (left, center, right, bottom) with tabs and
 * splitters, floating pane windows and floating toolbars. Any pane can be shown, hidden, moved to another area or
 * floated at any time (tab drag, pane menu, context menu, View menu, toolbar). On a phone every visible pane becomes a
 * tab of one area.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Icon, IconButton, useAxfState, useIsPhone, useRuntime } from '../axf/react';
import { describe } from './commands';
import { registerZone, startDrag, setTrashHandler, DragLayer } from './dnd';
import { PANE_VIEWS } from './panes';
import { studio, useStudio } from './store';
import { paneDef, ui, useUi, type Area, type Dock, type ToolbarDef } from './ui';
import { trashItem } from './model';

const AREAS: Exclude<Area, 'float'>[] = ['left', 'center', 'right', 'bottom'];

export function Workspace() {
  const rt = useRuntime();
  useAxfState();
  const layoutId = useUi((s) => s.layout);
  const custom = useUi((s) => s.custom);
  const zoom = useUi((s) => s.zoom);
  const floats = useUi((s) => s.floats);
  const toolbars = useUi((s) => s.toolbars);
  const phone = useIsPhone();
  const lay = ui.layout();
  void layoutId; void custom;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // the trash can deletes pieces / sections (to the project trash) and toolbar items
    setTrashHandler((p) => {
      if (p.kind === 'piece' || p.kind === 'section') { studio().edit('Delete', (q) => trashItem(q, { kind: p.kind as 'piece' | 'section', id: p.id })); rt.toast(`"${p.label}" moved to the trash.`, 'info', 'Deleted'); }
      if (p.kind === 'tb-item') { const [tb, i] = p.id.split('#'); const t = ui.toolbar(tb!); if (t) ui.patchToolbar(t.id, { items: t.items.filter((_, k) => k !== Number(i)) }); }
      if (p.kind === 'pane') ui.togglePane(p.id, false);
    });
    const offs = [
      registerZone('area', { accepts: (p) => p.kind === 'pane', positions: () => ['inside'], drop: (p, area) => ui.movePane(p.id, area as Area) }),
      registerZone('tb-item', {
        axis: 'x',
        accepts: (p) => p.kind === 'tb-item' || p.kind === 'command',
        positions: () => ['before', 'after'],
        drop: (p, target, pos) => {
          const [tid, ti] = target.split('#'); const t = ui.toolbar(tid!); if (!t) return;
          let items = [...t.items]; let at = Number(ti) + (pos === 'after' ? 1 : 0);
          let spec = p.id;
          if (p.kind === 'tb-item') {
            const [sid, si] = p.id.split('#'); const src = ui.toolbar(sid!); if (!src) return;
            spec = src.items[Number(si)]!;
            if (sid === tid) { items.splice(Number(si), 1); if (Number(si) < at) at--; }
            else ui.patchToolbar(sid!, { items: src.items.filter((_, k) => k !== Number(si)) });
          }
          items.splice(at, 0, spec); ui.patchToolbar(tid!, { items });
        },
      }),
      registerZone('tb-end', { accepts: (p) => p.kind === 'tb-item' || p.kind === 'command', positions: () => ['inside'], drop: (p, tid) => {
        const t = ui.toolbar(tid); if (!t) return; let spec = p.id;
        if (p.kind === 'tb-item') { const [sid, si] = p.id.split('#'); const src = ui.toolbar(sid!); if (!src) return; spec = src.items[Number(si)]!; if (sid === tid) { ui.patchToolbar(tid, { items: [...src.items.filter((_, k) => k !== Number(si)), spec] }); return; } ui.patchToolbar(sid!, { items: src.items.filter((_, k) => k !== Number(si)) }); }
        ui.patchToolbar(tid, { items: [...t.items, spec] });
      } }),
    ];
    return () => offs.forEach((f) => f());
  }, [rt]);

  const visible = (a: Area) => Object.entries(lay.panes).filter(([, pl]) => !pl.hidden && pl.area === a).sort((x, y) => x[1].order - y[1].order).map(([id]) => id);
  const byArea = Object.fromEntries(AREAS.map((a) => [a, visible(a)])) as Record<Exclude<Area, 'float'>, string[]>;
  const floating = visible('float');
  const dock = (d: Dock) => toolbars.filter((t) => t.visible && t.dock === d).sort((a, b) => a.order - b.order);

  const style = {
    '--ws-left': byArea.left.length && !zoom ? `${lay.sizes.left}px` : '0px',
    '--ws-right': byArea.right.length && !zoom ? `${lay.sizes.right}px` : '0px',
    '--ws-bottom': byArea.bottom.length && !zoom ? `${lay.sizes.bottom}px` : '0px',
  } as CSSProperties;

  const all = AREAS.flatMap((a) => byArea[a]);
  return (
    <div className="ws-root" ref={rootRef} data-fx-ctx-target="ws-workspace">
      <Dock edge="top" list={dock('top')} />
      <div className="ws-body">
        <Dock edge="left" list={dock('left')} />
        {phone ? (
          <div className="ws-areas ws-areas--phone"><AreaView area="center" ids={all} /></div>
        ) : zoom ? (
          <div className="ws-areas ws-areas--zoom"><AreaView area={zoom} ids={byArea[zoom as Exclude<Area, 'float'>] ?? []} /></div>
        ) : (
          <div className="ws-areas" style={style} data-has-left={byArea.left.length > 0} data-has-right={byArea.right.length > 0} data-has-bottom={byArea.bottom.length > 0}>
            {byArea.left.length > 0 && <><AreaView area="left" ids={byArea.left} /><Splitter which="left" /></>}
            <AreaView area="center" ids={byArea.center} />
            {byArea.right.length > 0 && <><Splitter which="right" /><AreaView area="right" ids={byArea.right} /></>}
            {byArea.bottom.length > 0 && <><Splitter which="bottom" /><AreaView area="bottom" ids={byArea.bottom} /></>}
          </div>
        )}
        <Dock edge="right" list={dock('right')} />
      </div>
      <Dock edge="bottom" list={dock('bottom')} />
      {!phone && floating.map((id) => <FloatPane key={id} id={id} rect={floats[id]} />)}
      {dock('float').map((t) => <FloatToolbar key={t.id} tb={t} root={rootRef} />)}
      <DragLayer />
    </div>
  );
}

/* ---------- areas ---------- */

function AreaView({ area, ids }: { area: Area; ids: string[] }) {
  const front = useUi((s) => s.front[area]);
  const zoom = useUi((s) => s.zoom);
  const cur = ids.includes(front ?? '') ? front! : ids[0];
  if (!ids.length) return <section className={`ws-area ws-area--${area} ws-area--empty`} data-ws-drop="area" data-ws-drop-id={area}><div className="ws-area__empty fx-muted"><Icon name="layout" size={20} /><span>Drop a pane tab here, or pick one in View › Panes.</span></div></section>;
  return (
    <section className={`ws-area ws-area--${area}`} data-ws-drop="area" data-ws-drop-id={area}>
      <div className="ws-area__tabs" role="tablist">
        {ids.map((id) => {
          const pd = paneDef(id)!;
          return (
            <button key={id} type="button" role="tab" aria-selected={id === cur} className={`fx-tab ws-area__tab ${id === cur ? 'is-active' : ''}`}
              onClick={() => ui.front(id)} onPointerDown={(e) => startDrag(e, { kind: 'pane', id, label: pd.title, icon: pd.icon, trashable: true })}
              data-fx-ctx-target="ws-pane" data-fx-ctx-payload={id} title={pd.description}>
              <span className="ws-grip"><Icon name={pd.icon} size={13} /></span>{pd.title}
            </button>
          );
        })}
        <span className="fx-grow" />
        {area !== 'float' && <IconButton icon={zoom ? 'minimize' : 'monitor'} label={zoom ? 'Back to the layout' : 'Maximise this area'} onClick={() => ui.zoom(area)} />}
        <IconButton icon="x" label={`Hide ${paneDef(cur!)?.title}`} onClick={() => ui.togglePane(cur!, false)} />
      </div>
      <div className="ws-area__body" data-fx-ctx-target="ws-pane" data-fx-ctx-payload={cur}>
        <PaneBody id={cur!} />
      </div>
    </section>
  );
}

function PaneBody({ id }: { id: string }) {
  const project = useStudio((s) => s.project);
  const View = PANE_VIEWS[id];
  if (!View) return <p className="fx-muted">No pane "{id}".</p>;
  if (!project && id !== 'projects' && id !== 'log') return <p className="fx-muted ws-pad">Open or create a project first.</p>;
  return <View />;
}

function Splitter({ which }: { which: 'left' | 'right' | 'bottom' }) {
  const down = (e: RPointerEvent) => {
    e.preventDefault();
    const start = ui.layout().sizes[which]; const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const d = which === 'left' ? ev.clientX - sx : which === 'right' ? sx - ev.clientX : sy - ev.clientY;
      ui.setSize(which, Math.max(160, Math.min(window.innerWidth * 0.6, start + d)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <div className={`ws-split ws-split--${which}`} onPointerDown={down} role="separator" aria-orientation={which === 'bottom' ? 'horizontal' : 'vertical'} aria-label={`Resize the ${which} area`} />;
}

function FloatPane({ id, rect }: { id: string; rect?: { x: number; y: number; w: number; h: number; z: number } }) {
  const pd = paneDef(id)!;
  const r = rect ?? { x: 80, y: 80, w: 420, h: 320, z: 0 };
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const sx = e.clientX - r.x, sy = e.clientY - r.y; ui.front(id);
    const move = (ev: PointerEvent) => ui.setFloat(id, { x: Math.max(0, ev.clientX - sx), y: Math.max(0, ev.clientY - sy) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (ref.current) ui.setFloat(id, { w: ref.current.offsetWidth, h: ref.current.offsetHeight }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className="ws-float fx-popover" ref={ref} style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: 40 + (r.z % 1000) }} onPointerUp={() => ref.current && ui.setFloat(id, { w: ref.current.offsetWidth, h: ref.current.offsetHeight })}>
      <header className="ws-float__head" onPointerDown={drag} data-fx-ctx-target="ws-pane" data-fx-ctx-payload={id}>
        <Icon name={pd.icon} size={14} /> <strong>{pd.title}</strong><span className="fx-grow" />
        <IconButton icon="layout" label="Dock in the center" onClick={() => ui.movePane(id, 'center')} />
        <IconButton icon="x" label="Hide" onClick={() => ui.togglePane(id, false)} />
      </header>
      <div className="ws-float__body"><PaneBody id={id} /></div>
    </div>
  );
}

/* ---------- toolbars ---------- */

function Dock({ edge, list }: { edge: Dock; list: ToolbarDef[] }) {
  if (!list.length) return null;
  return <div className={`ws-dock ws-dock--${edge}`}>{list.map((t) => <ToolbarView key={t.id} tb={t} vertical={edge === 'left' || edge === 'right'} />)}</div>;
}

function ToolbarView({ tb, vertical, onGrip }: { tb: ToolbarDef; vertical?: boolean; onGrip?: (e: RPointerEvent) => void }) {
  const rt = useRuntime();
  useAxfState(); useUi((s) => s); useStudio((s) => s.recording); useStudio((s) => s.selection); useStudio((s) => s.undo + s.redo * 1000);
  const grip = onGrip ?? ((e: RPointerEvent) => detach(e, tb));
  return (
    <div className={`ws-toolbar ${vertical ? 'ws-toolbar--v' : ''}`} role="toolbar" aria-label={tb.name} data-fx-ctx-target="ws-toolbar" data-fx-ctx-payload={tb.id}>
      <span className="ws-toolbar__grip ws-grip" onPointerDown={grip} title={`${tb.name}: drag to float, drop on an edge to dock`}><Icon name="more" size={14} /></span>
      {tb.items.map((spec, i) => {
        if (spec === '|') return <span key={i} className="ws-toolbar__sep" data-ws-drop="tb-item" data-ws-drop-id={`${tb.id}#${i}`} onPointerDown={(e) => startDrag(e, { kind: 'tb-item', id: `${tb.id}#${i}`, label: 'Separator', icon: 'minus', trashable: true })} />;
        const d = describe(rt, spec);
        const disabled = (spec === 'ws.undo' && !studio().get().undo) || (spec === 'ws.redo' && !studio().get().redo);
        const live = spec === 'ws.record.toggle' && studio().get().recording;
        return (
          <span key={i} className="ws-toolbar__item" data-ws-drop="tb-item" data-ws-drop-id={`${tb.id}#${i}`} onPointerDown={(e) => { if (e.pointerType === 'mouse') startDrag(e, { kind: 'tb-item', id: `${tb.id}#${i}`, label: d.label, icon: d.icon, trashable: true }); }}>
            <button type="button" className={`fx-btn fx-btn--sm ${tb.labels ? 'fx-btn--ghost' : 'fx-btn--quiet'} ${d.checked || live ? 'is-on' : ''}`} disabled={disabled}
              aria-pressed={d.checked ?? undefined} title={`${d.label}${d.shortcut ? ` (${d.shortcut})` : ''}`} onClick={() => rt.dispatch(spec)}>
              <Icon name={live ? 'pause' : d.icon} size={15} />{tb.labels && <span>{live ? 'Stop' : d.label}</span>}
            </button>
          </span>
        );
      })}
      <span className="ws-toolbar__end" data-ws-drop="tb-end" data-ws-drop-id={tb.id} />
    </div>
  );
}

/** drag a toolbar by its grip: it floats under the pointer; let go near an edge of the workspace and it docks there */
function detach(e: RPointerEvent, tb: ToolbarDef, root?: HTMLElement | null) {
  e.preventDefault();
  const host = root ?? (e.currentTarget as HTMLElement).closest('.ws-root') as HTMLElement | null;
  if (!host) return;
  const box = host.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY; let moved = false;
  const ox = tb.dock === 'float' ? sx - box.left - tb.x : 12, oy = tb.dock === 'float' ? sy - box.top - tb.y : 12;
  const edgeOf = (x: number, y: number): Dock => (y - box.top < 36 ? 'top' : box.bottom - y < 36 ? 'bottom' : x - box.left < 36 ? 'left' : box.right - x < 36 ? 'right' : 'float');
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    moved = true;
    ui.patchToolbar(tb.id, { dock: 'float', x: Math.max(0, ev.clientX - box.left - ox), y: Math.max(0, ev.clientY - box.top - oy) });
    host.dataset.wsDockHint = edgeOf(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    delete host.dataset.wsDockHint;
    if (!moved) return;
    const edge = edgeOf(ev.clientX, ev.clientY);
    if (edge !== 'float') ui.patchToolbar(tb.id, { dock: edge, order: 99 });
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

function FloatToolbar({ tb, root }: { tb: ToolbarDef; root: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="ws-toolbar-float fx-popover" style={{ left: tb.x, top: tb.y }}>
      <ToolbarView tb={tb} onGrip={(e) => detach(e, tb, root.current)} />
    </div>
  );
}

export function PaneFrame({ children, tools }: { children: ReactNode; tools?: ReactNode }) {
  const [, force] = useState(0); void force;
  return <div className="ws-pane">{tools && <div className="ws-pane__tools">{tools}</div>}<div className="ws-pane__scroll">{children}</div></div>;
}
