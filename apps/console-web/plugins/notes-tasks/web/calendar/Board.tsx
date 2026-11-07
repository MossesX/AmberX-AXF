/**
 * The Calendar window (windows@1 + dock@1): a floating window whose panes are dock tabs, so splitters, tab drag and
 * splitting come from the framework. Each pane has its own view, date and calendars. An event dragged out of one pane
 * lands in any other because drag.ts finds its target under the pointer. Saved layouts live on the hub (`layouts`), so
 * they follow Brett to every device.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Checkbox, IconButton, TabGroup, TextField, useRuntime } from '@console/axf/react';
import type { DockLayoutData } from '@console/axf/core/engines/dock';
import { VIEW_LABEL, VIEWS, localDay, stepDate, viewTitle, type CalView, type PaneState, type SavedLayout } from './core';
import { CalendarBody } from './views';
import { DIALOG, newId } from './actions';
import { mutateCal, startCalSync, useCalendar } from './store';

export const PANE_KIND = 'notes-tasks.calendar.pane';
const PANE_TABS = VIEWS.map((v) => ({ value: v as CalView, label: VIEW_LABEL[v] }));

const panes = new Map<string, PaneState>();
const subs = new Set<() => void>();
const bump = () => subs.forEach((f) => f());
const paneOf = (id: string): PaneState => panes.get(id) ?? { view: 'week', date: localDay(), calendars: [] };
const setPane = (id: string, p: Partial<PaneState>) => { panes.set(id, { ...paneOf(id), ...p }); bump(); };
let version = 0;
const usePane = (id: string) => { useSyncExternalStore((f) => { const g = () => { version++; f(); }; subs.add(g); return () => { subs.delete(g); }; }, () => version); return paneOf(id); };

let windowId = '';
const leaf = (pane: number) => ({ kind: 'leaf' as const, pane });
const hsplit = (...children: DockLayoutData['tree'][]) => ({ kind: 'split' as const, vertical: false, children, weights: children.map(() => 1) });
const vsplit = (...children: DockLayoutData['tree'][]) => ({ kind: 'split' as const, vertical: true, children, weights: children.map(() => 1) });
export const PRESETS: { id: string; name: string; data: DockLayoutData; views: CalView[]; offsets: number[] }[] = [
  { id: 'one', name: 'One pane', data: { panes: 1, tree: leaf(1) }, views: ['week'], offsets: [0] },
  { id: 'week-month', name: 'A week here, a month there', data: { panes: 2, tree: hsplit(leaf(1), leaf(2)) }, views: ['week', 'month'], offsets: [0, 1] },
  { id: 'two-weeks', name: 'This week and next', data: { panes: 2, tree: vsplit(leaf(1), leaf(2)) }, views: ['week', 'week'], offsets: [0, 1] },
  { id: 'three', name: 'Day, week, month', data: { panes: 3, tree: hsplit(leaf(1), leaf(2), leaf(3)) }, views: ['day', 'week', 'month'], offsets: [0, 0, 0] },
  { id: 'four', name: 'Four panes', data: { panes: 4, tree: vsplit(hsplit(leaf(1), leaf(2)), hsplit(leaf(3), leaf(4))) }, views: ['day', 'agenda', 'week', 'month'], offsets: [0, 0, 0, 1] },
];

const open = (rt: AxfRuntime) => windowId && rt.windows.state.windows.some((w) => w.id === windowId);
const paneTab = (id: string, st: PaneState) => { panes.set(id, st); return { id, title: VIEW_LABEL[st.view], kind: PANE_KIND, payload: '', icon: 'clock' }; };

/** Opens the window, or brings it up. On a phone it fills the screen. */
export function openBoard(rt: AxfRuntime, preset = 'week-month') {
  if (open(rt)) { rt.windows.focus(windowId); return; }
  const w = Math.round(window.innerWidth * 0.86); const h = Math.round(window.innerHeight * 0.8);
  windowId = rt.windows.openFloating([paneTab(newId('pane'), { view: 'week', date: localDay(), calendars: [] })], 'Calendar', 'floating', w, h);
  applyPreset(rt, preset);
  if (window.innerWidth < 720) rt.windows.maximize(windowId);
}

export function applyPreset(rt: AxfRuntime, id: string) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p || !open(rt)) return;
  const wm = rt.windows;
  const groups = Object.values(wm.state.groups).filter((g) => g.windowId === windowId);
  const tabs = groups.flatMap((g) => g.tabs);
  for (let i = tabs.length; i < p.data.panes; i++) wm.addTab(groups[0]!.id, paneTab(newId('pane'), { view: 'week', date: localDay(), calendars: [] }));
  wm.applyPreset(p.data, windowId);
  const placed = Object.values(wm.state.groups).filter((g) => g.windowId === windowId).flatMap((g) => g.tabs);
  placed.slice(0, p.views.length).forEach((t, i) => {
    const view = p.views[i]!;
    setPane(t.id, { view, date: stepDate(view, localDay(), p.offsets[i] ?? 0) });
    wm.renameTab(t.id, VIEW_LABEL[view]);
  });
}

export function loadLayout(rt: AxfRuntime, l: SavedLayout) {
  if (!open(rt)) openBoard(rt, 'one');
  for (const [id, st] of Object.entries(l.panes)) panes.set(id, st);
  rt.windows.restoreLayout(l.snapshot, windowId);
  bump();
}

export function BoardPane({ id }: { id: string }) {
  const rt = useRuntime();
  const p = usePane(id);
  const { store } = useCalendar();
  useEffect(() => startCalSync(), []);
  const step = (dir: number) => setPane(id, { date: stepDate(p.view, p.date, dir) });
  const cals = Object.values(store.calendars);
  const [pickCals, setPickCals] = useState(false);
  return (
    <div className="axp-cal axp-cal-pane">
      <div className="axp-cal-nav" role="toolbar" aria-label="Calendar pane" data-axf-tap-confirm="off" data-axf-tap-confirm-reason="Paging through dates has to take one tap, it changes nothing">
        <IconButton icon="chevron-left" label="Back" onClick={() => step(-1)} />
        <Button size="sm" onClick={() => setPane(id, { date: localDay() })}>Today</Button>
        <IconButton icon="chevron-right" label="Forward" onClick={() => step(1)} />
        <h3 className="axp-cal-title">{viewTitle(p.view, p.date)}</h3>
        <span className="axp-cal-grow" />
        <IconButton icon="list" label="Calendars in this pane" onClick={() => setPickCals(!pickCals)} />
        <IconButton icon="layout" label="Layouts" onClick={() => rt.openDialog(DIALOG.layouts, {})} />
      </div>
      <TabGroup id="calendar.pane-views" label="Pane view" value={p.view} onChange={(v) => { setPane(id, { view: v }); rt.windows.renameTab(id, VIEW_LABEL[v]); }} tabs={PANE_TABS} />
      {pickCals && (
        <div className="axp-cal-panecals">
          {cals.filter((c) => c.id !== 'tasks').map((c) => {
            const on = !p.calendars.length || p.calendars.includes(c.id);
            return <Checkbox key={c.id} label={c.name} checked={on} onChange={(v) => {
              const all = cals.map((x) => x.id);
              const cur = p.calendars.length ? p.calendars : all;
              const next = v ? [...cur, c.id] : cur.filter((x) => x !== c.id);
              setPane(id, { calendars: next.length === all.length ? [] : next });
            }} />;
          })}
        </div>
      )}
      <CalendarBody view={p.view} date={p.date} only={p.calendars.length ? p.calendars : undefined} onStep={step} onDay={(d) => { setPane(id, { view: 'day', date: d }); rt.windows.renameTab(id, VIEW_LABEL.day); }} />
    </div>
  );
}

export function LayoutsDialog({ close }: { close: () => void }) {
  const rt = useRuntime();
  const { store } = useCalendar();
  const [name, setName] = useState('');
  const saved = Object.values(store.layouts).sort((a, b) => a.name.localeCompare(b.name));
  const save = () => {
    const snapshot = rt.windows.snapshot(windowId);
    if (!snapshot || !name.trim()) return;
    const ids = Object.values(rt.windows.state.groups).filter((g) => g.windowId === windowId).flatMap((g) => g.tabs.map((t) => t.id));
    const id = newId('l');
    mutateCal((s) => { s.layouts[id] = { id, name: name.trim(), snapshot, panes: Object.fromEntries(ids.map((t) => [t, paneOf(t)])), updatedAt: '' }; });
    setName('');
  };
  return (
    <div className="axp-cal-form">
      <h3 className="axp-cal-section">Layouts</h3>
      <div className="axp-cal-presets">{PRESETS.map((p) => <Button key={p.id} size="sm" onClick={() => { applyPreset(rt, p.id); close(); }}>{p.name}</Button>)}</div>
      <h3 className="axp-cal-section">Saved</h3>
      {saved.length === 0 && <p className="fx-small fx-muted">Nothing saved yet. Set the panes up, name it and save.</p>}
      {saved.map((l) => (
        <div key={l.id} className="axp-cal-listrow">
          <Button size="sm" onClick={() => { loadLayout(rt, l); close(); }}>{l.name}</Button>
          <span className="axp-cal-grow" />
          <IconButton icon="trash" label={`Delete ${l.name}`} onClick={() => mutateCal((s) => { delete s.layouts[l.id]; })} />
        </div>
      ))}
      <form className="axp-cal-quick" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label="Save this layout as" value={name} onChange={setName} placeholder="Planning week" />
        <Button type="submit" tone="primary" disabled={!name.trim()}>Save</Button>
      </form>
    </div>
  );
}
