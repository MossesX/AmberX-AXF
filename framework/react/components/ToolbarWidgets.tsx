/*
 * Widgets on any toolbar: the actions, the right-click / long-press block and the Toolbar widgets dialog
 * (toolbar-widgets@1, core/engines/toolbar-widgets.ts; runtime rt.*ToolbarWidget*). Every toolbar gets
 * "Attach widget…" (widget picker + side + style + shape); a widget under the pointer also gets Style…, Move and Detach.
 * Every change is an action, so the console API, MCP, the CLI and voice reach the same thing the menu does:
 *
 *   toolbar.widgets:<instance>[:<type>:<id>]                       open the dialog (on that widget)
 *   toolbar.widget.attach:<instance>:<type>:<id>[:<side>[:<size>[:<shape>]]]
 *   toolbar.widget.detach:<instance>:<type>:<id>                  a widget the person added goes; any other is hidden
 *   toolbar.widget.move:<instance>:<type>:<id>:<start|end>[:<index|prev|next>]
 *   toolbar.widget.style:<instance>:<type>:<id>:<field>:<value>   field size|show|priority|hideWhenEmpty|overflow|hidden|shape|label; value default = back to the default
 *   toolbar.widget:[<instance>:]<name>:<op>                       the voice grammar (add, remove, hide, show, reset, icon, compact, normal, wide, start, end)
 *   toolbar.widget.shape:<instance>:<name>:<shape|inherit>
 *   toolbar.widgets.reset:<instance>
 *
 * Framework controls only, theme tokens only.
 */
import { useState } from 'react';
import { BANNER_WIDGET_SHOWS, BANNER_WIDGET_SIZES, type BannerWidgetShow, type BannerWidgetSize } from '../../core/engines/bannerwidgets';
import { TOOLBAR_SIDES as TOOLBAR_SIDES_LIST, WIDGET_TYPES } from '../../core/engines/widgets';
import { TOOLBAR_APP_INSTANCE, findToolbarWidget, isShapeId, matchToolbarInstance, parseToolbarWidgetArgs, parseToolbarWidgetShapeArgs, type ResolvedToolbarWidget } from '../../core/engines/toolbar-widgets';
import type { AxfRuntime } from '../../core/runtime';
import type { MenuEntry } from '../../core/engines/windows';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, IconButton } from './Controls';
import { Note, SelectField, Switch } from './Forms';
import type { DialogMap } from './Overlays';
import { addDerivedTargets, type ControlTargetDef } from '../controlTargets';
import { TOOLBARS_WIDGET_STYLE_KEY, TOOLBAR_WIDGETS_KEY, TOOLBAR_WIDGET_STYLE_KEY, normalizeToolbarWidgetSlots, normalizeWidgetStyle } from '../../core/engines/toolbar-widgets';

export const TOOLBAR_WIDGETS_DIALOG = 'axf.toolbar.widgets';
/** The console actions (console.actions, console_action, `axf console action`, voice) this module registers. */
export const TOOLBAR_WIDGET_ACTION_IDS = ['toolbar.widgets', 'toolbar.widget.attach', 'toolbar.widget.detach', 'toolbar.widget.move', 'toolbar.widget.style', 'toolbar.widget', 'toolbar.widget.shape', 'toolbar.widgets.reset'] as const;

const SIZE_LABEL: Record<BannerWidgetSize, string> = { icon: 'Icon only', compact: 'Compact', normal: 'Normal', wide: 'Wide' };
const SHOW_LABEL: Record<BannerWidgetShow, string> = { auto: 'Its own mix', both: 'Icon and text', icon: 'Icon only', text: 'Text only', number: 'Number only' };
const SIDE_LABEL: Record<string, string> = { start: 'Start', end: 'End' };
/** shape@1 kinds offered until the shape asset type lands (open registry: shape assets that exist are listed too). */
export const TOOLBAR_WIDGET_SHAPES = ['circle', 'pill', 'rounded', 'squircle', 'square', 'hexagon', 'diamond', 'tag'];
const STYLE_FIELDS = ['size', 'show', 'priority', 'hideWhenEmpty', 'overflow', 'hidden', 'shape', 'label'] as const;

/** One widget row: drawn, hidden or addable, with what the picker, the API and voice need. */
export interface ToolbarWidgetRow {
  key: string;
  type: string;
  id: string;
  label: string;
  aliases: string[];
  /** on the bar | hidden (on it but not drawn) | addable (not on this toolbar) */
  state: 'drawn' | 'hidden' | 'addable';
  at: string | null;
  index: number;
  origin: string | null;
  size: BannerWidgetSize | null;
  show: BannerWidgetShow | null;
  shape: string | null;
}

const nameOf = (rt: AxfRuntime, type: string, id: string, hint?: string | null): string => hint || ((rt.registry.get(type as never, id) as { name?: string } | undefined)?.name ?? `${type} ${id}`);

/** Every widget of one toolbar instance (drawn, hidden) and every widget asset that could be added to it. */
export function toolbarWidgetRows(rt: AxfRuntime, instance: string = TOOLBAR_APP_INSTANCE): ToolbarWidgetRow[] {
  const r = rt.toolbarInstanceWidgets(instance);
  const out: ToolbarWidgetRow[] = [];
  const row = (w: ResolvedToolbarWidget, state: 'drawn' | 'hidden', index: number): ToolbarWidgetRow => ({
    key: w.key, type: w.type, id: w.id, label: nameOf(rt, w.type, w.id, w.hint?.label), aliases: [...(w.hint?.aliases ?? [])],
    state, at: w.at, index, origin: w.origin, size: w.view.size, show: w.view.show, shape: w.shape,
  });
  for (const side of Object.keys(r.sides)) r.sides[side]!.forEach((w, i) => out.push(row(w, 'drawn', i)));
  r.hidden.forEach((w, i) => out.push(row(w, 'hidden', i)));
  const taken = new Set(out.map((w) => w.key));
  for (const type of WIDGET_TYPES) {
    for (const a of rt.registry.list(type as never) as { id: string; name?: string }[]) {
      const key = `${type}:${a.id}`;
      if (!taken.has(key)) out.push({ key, type, id: a.id, label: a.name ?? `${type} ${a.id}`, aliases: [], state: 'addable', at: null, index: -1, origin: null, size: null, show: null, shape: null });
    }
  }
  return out;
}

/** The shape ids a widget can be cut to: the shape@1 kinds plus any shape assets registered. */
export function toolbarWidgetShapes(rt: AxfRuntime): string[] {
  let own: string[] = [];
  try { own = (rt.registry.list('shape' as never) as { id: string }[]).map((a) => a.id); } catch { own = []; }
  return [...new Set([...TOOLBAR_WIDGET_SHAPES, ...own])];
}

/** The instance a context payload names (the toolbar's settings id), `app` when none. */
const instanceOfPayload = (payload: unknown): string => (typeof payload === 'string' && payload ? payload.split('|')[0]! : TOOLBAR_APP_INSTANCE);

/** Split `<instance>:<type>:<id>:rest…` action args into the instance, the widget key and the rest. */
function splitArgs(args: readonly string[], ctx?: { payload?: unknown }): { instance: string; key: string; rest: string[] } | null {
  const [instance = '', type = '', id = '', ...rest] = args;
  if (!type || !id) return null;
  return { instance: instance || instanceOfPayload(ctx?.payload), key: `${type}:${id}`, rest };
}

function styleValue(field: string, raw: string | undefined): unknown {
  if (raw === undefined || raw === '' || raw === 'default' || raw === 'inherit') return null;
  if (field === 'priority') { const n = Number(raw); return Number.isFinite(n) ? n : null; }
  if (field === 'hideWhenEmpty' || field === 'overflow' || field === 'hidden') return raw === 'true' || raw === 'on' || raw === '1';
  return raw;
}

/** Detach: a widget the person added goes; one the toolbar or a plugin put there is hidden (it can be shown again). */
export function detachToolbarWidget(rt: AxfRuntime, instance: string, key: string): boolean {
  const slot = rt.toolbarWidgetSlots(instance).find((s) => `${s.type}:${s.id}` === key);
  const drawn = toolbarWidgetRows(rt, instance).find((w) => w.key === key && w.state !== 'addable');
  if (!drawn) return false;
  if (drawn.origin === 'person' && slot?.at) return rt.removeToolbarWidget(instance, key);
  return rt.setToolbarWidget(instance, key, { hidden: true });
}

/** Move one place left / right, or to a side at an index. */
export function moveToolbarWidgetBy(rt: AxfRuntime, instance: string, key: string, side: string, where: string | number | undefined): boolean {
  const row = toolbarWidgetRows(rt, instance).find((w) => w.key === key && w.state === 'drawn');
  if (!row) return false;
  const target = side || row.at || 'end';
  const index = where === 'prev' ? row.index - 1 : where === 'next' ? row.index + 1 : where === undefined || where === '' ? (target === row.at ? row.index : 999) : Number(where);
  return rt.moveToolbarWidget(instance, key, target, Math.max(0, Number.isFinite(index) ? index : 999));
}

/** The voice / grammar form: `toolbar.widget:[<instance>:]<name>:<op>`. */
function runGrammar(rt: AxfRuntime, args: readonly string[]): boolean {
  const norm = args.length > 3 ? [args[0]!, args.slice(1, -1).join(':'), args[args.length - 1]!] : [...args];
  const p = parseToolbarWidgetArgs(norm);
  if (!p) return false;
  // a toolbar named in words (voice: "main", "settings", "ui-review") → the instance on screen it means
  const known = toolbarWidgetInstances(rt);
  if (!known.includes(p.instance)) {
    const onScreen = typeof document === 'undefined' ? [] : Array.from(document.querySelectorAll<HTMLElement>('[role="toolbar"][data-axf-toolbar]')).map((el) => ({ id: el.dataset.axfToolbar ?? '', label: el.getAttribute('aria-label') ?? '' }));
    const hit = matchToolbarInstance([...onScreen, ...known.map((id) => ({ id, label: id }))], p.instance.replace(/-/g, ' '));
    if (!hit) { rt.toast(`No toolbar "${p.instance}" on screen.`, 'warning', 'Toolbar widgets'); return false; }
    p.instance = hit;
  }
  const rows = toolbarWidgetRows(rt, p.instance);
  const w = findToolbarWidget(rows, p.name);
  if (!w) { rt.toast(`No widget "${p.name}" for that toolbar.`, 'warning', 'Toolbar widgets'); return false; }
  switch (p.op) {
    case 'add': return rt.addToolbarWidget(p.instance, w.type, w.id, w.at ?? 'end');
    case 'remove': return detachToolbarWidget(rt, p.instance, w.key);
    case 'hide': return rt.setToolbarWidget(p.instance, w.key, { hidden: true });
    case 'show': return w.state === 'addable' ? rt.addToolbarWidget(p.instance, w.type, w.id, 'end') : rt.setToolbarWidget(p.instance, w.key, { hidden: null });
    case 'reset': return rt.setToolbarWidget(p.instance, w.key, { size: null, show: null, priority: null, hideWhenEmpty: null, overflow: null, shape: null, label: null, maxWidth: null, maxUnit: null });
    case 'start': case 'end': return w.state === 'addable' ? rt.addToolbarWidget(p.instance, w.type, w.id, p.op) : moveToolbarWidgetBy(rt, p.instance, w.key, p.op, undefined);
    default: return rt.setToolbarWidget(p.instance, w.key, { size: p.op });
  }
}

/** The right-click / long-press block for one toolbar (and the widget under the pointer, if any). */
export function toolbarWidgetMenu(rt: AxfRuntime, instance: string, hitKey: string | null): MenuEntry[] {
  if (!rt.canArrange()) return [];
  const items: MenuEntry[] = [{ id: 'toolbar-widget-attach', label: 'Attach widget…', icon: 'plus', action: `toolbar.widgets:${instance}` }];
  const hit = hitKey ? toolbarWidgetRows(rt, instance).find((w) => w.key === hitKey && w.state === 'drawn') : null;
  if (hit) {
    items.push(
      { id: 'toolbar-widget-style', label: `Style… (${hit.label})`, icon: 'settings', action: `toolbar.widgets:${instance}:${hit.key}` },
      { id: 'toolbar-widget-move', label: 'Move', icon: 'move', items: [
        { id: 'toolbar-widget-move-prev', label: 'One place left', action: `toolbar.widget.move:${instance}:${hit.key}:${hit.at}:prev` },
        { id: 'toolbar-widget-move-next', label: 'One place right', action: `toolbar.widget.move:${instance}:${hit.key}:${hit.at}:next` },
        ...TOOLBAR_SIDES_LIST.map((s) => ({ id: `toolbar-widget-move-${s}`, label: `To the ${s}${hit.at === s ? ' ✓' : ''}`, action: `toolbar.widget.move:${instance}:${hit.key}:${s}` })),
      ] },
      { id: 'toolbar-widget-detach', label: `Detach ${hit.label}`, icon: 'close', action: `toolbar.widget.detach:${instance}:${hit.key}` },
    );
  }
  return items;
}

const installed = new WeakSet<AxfRuntime>();

/** Register the toolbar widget actions and the context block, once per runtime (installChrome calls it). */
export function installToolbarWidgets(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  const a = rt.actions;
  const write = { params: true, requires: 'assets.swap' } as const;
  a.register('toolbar.widgets', ([instance = '', type = '', id = ''], ctx) => rt.openDialog(TOOLBAR_WIDGETS_DIALOG, { instance: instance || instanceOfPayload(ctx?.payload), ...(type && id ? { key: `${type}:${id}` } : {}) }), { label: 'Toolbar widgets (toolbar.widgets:<toolbar>[:<type>:<id>])', params: true });
  a.register('toolbar.widget.attach', (args, ctx) => {
    const p = splitArgs(args, ctx); if (!p) return;
    const [side = 'end', size = '', shape = ''] = p.rest;
    const [type, id] = [p.key.slice(0, p.key.indexOf(':')), p.key.slice(p.key.indexOf(':') + 1)];
    if (!rt.addToolbarWidget(p.instance, type, id, side)) return;
    const patch: Record<string, unknown> = {};
    if ((BANNER_WIDGET_SIZES as readonly string[]).includes(size)) patch.size = size;
    if (shape && isShapeId(shape)) patch.shape = shape;
    if (Object.keys(patch).length) rt.setToolbarWidget(p.instance, p.key, patch);
  }, { ...write, label: 'Attach a widget to a toolbar (toolbar.widget.attach:<toolbar>:<type>:<id>[:<start|end>[:<size>[:<shape>]]])' });
  a.register('toolbar.widget.detach', (args, ctx) => { const p = splitArgs(args, ctx); if (p && !detachToolbarWidget(rt, p.instance, p.key)) rt.toast(`${p.key} is not on toolbar ${p.instance}.`, 'warning', 'Toolbar widgets'); }, { ...write, label: 'Detach a widget from a toolbar (toolbar.widget.detach:<toolbar>:<type>:<id>)' });
  a.register('toolbar.widget.move', (args, ctx) => { const p = splitArgs(args, ctx); if (p && !moveToolbarWidgetBy(rt, p.instance, p.key, p.rest[0] ?? '', p.rest[1])) rt.toast(`Can't move ${p.key} there.`, 'warning', 'Toolbar widgets'); }, { ...write, label: 'Move a widget on a toolbar (toolbar.widget.move:<toolbar>:<type>:<id>:<start|end>[:<index|prev|next>])' });
  a.register('toolbar.widget.style', (args, ctx) => {
    const p = splitArgs(args, ctx); if (!p) return;
    const [field = '', ...v] = p.rest;
    if (!(STYLE_FIELDS as readonly string[]).includes(field)) { rt.toast(`Unknown widget field "${field}".`, 'warning', 'Toolbar widgets'); return; }
    rt.setToolbarWidget(p.instance, p.key, { [field]: styleValue(field, v.join(':')) });
  }, { ...write, label: 'Style a widget on a toolbar (toolbar.widget.style:<toolbar>:<type>:<id>:<size|show|priority|hideWhenEmpty|overflow|hidden|shape|label>:<value|default>)' });
  a.register('toolbar.widget', (args) => { runGrammar(rt, args); }, { ...write, label: 'Toolbar widget by name (toolbar.widget:[<toolbar>:]<name>:<add|remove|hide|show|reset|icon|compact|normal|wide|start|end>)' });
  a.register('toolbar.widget.shape', (args) => {
    const norm = args.length > 3 ? [args[0]!, args.slice(1, -1).join(':'), args[args.length - 1]!] : [...args];
    const p = parseToolbarWidgetShapeArgs(norm); if (!p) return;
    const w = findToolbarWidget(toolbarWidgetRows(rt, p.instance), p.name);
    if (w) rt.setToolbarWidget(p.instance, w.key, { shape: p.shape });
  }, { ...write, label: 'Cut a toolbar widget to a shape (toolbar.widget.shape:<toolbar>:<name>:<shape|inherit>)' });
  a.register('toolbar.widgets.reset', ([instance = ''], ctx) => rt.resetToolbarWidgets(instance || instanceOfPayload(ctx?.payload)), { ...write, label: 'Put a toolbar\'s widgets back (toolbar.widgets.reset:<toolbar>)' });
  // console-control@1: every toolbar's widgets are addressable (REST, MCP, CLI, voice, Ctrl+K)
  addDerivedTargets(rt, (hint) => toolbarWidgetTargets(rt, hint));
  rt.contextExtras.set('*:toolbar-widgets', (target, payload) => (target === 'toolbar' ? toolbarWidgetMenu(rt, instanceOfPayload(payload), rt.contextToolbarWidget) : []));
}

/* ---------------- the dialog / settings section ---------------- */

function WidgetStyleFields({ rt, instance, w }: { rt: AxfRuntime; instance: string; w: ToolbarWidgetRow }) {
  const set = (field: string, value: string) => rt.dispatch(`toolbar.widget.style:${instance}:${w.key}:${field}:${value}`);
  const shapes = toolbarWidgetShapes(rt);
  return (
    <div className="fx-stack fx-stack--sm axf-toolbar-widgets__fields" data-axf-toolbar-widget-fields={w.key}>
      <SelectField label="Size" value={w.size ?? 'compact'} options={BANNER_WIDGET_SIZES.map((s) => ({ value: s, label: SIZE_LABEL[s] }))} onChange={(v) => set('size', v)} />
      <SelectField label="Shows" value={w.show ?? 'auto'} options={BANNER_WIDGET_SHOWS.map((s) => ({ value: s, label: SHOW_LABEL[s] }))} onChange={(v) => set('show', v)} />
      <SelectField label="Shape" value={w.shape ?? ''} empty="The toolbar's shape" options={shapes.map((s) => ({ value: s, label: s.replace(/^./, (c) => c.toUpperCase()) }))} onChange={(v) => set('shape', v || 'default')} />
    </div>
  );
}

/** Every widget on one toolbar with its style, shape, order and Detach, plus Attach a widget. The dialog and the settings Widgets tab. */
export function ToolbarWidgetsPanel({ instance = TOOLBAR_APP_INSTANCE, initial }: { instance?: string; initial?: string }) {
  const rt = useRuntime();
  useAxfState();
  const rows = toolbarWidgetRows(rt, instance);
  const [open, setOpen] = useState(initial ?? '');
  const addable = rows.filter((w) => w.state === 'addable');
  const [pick, setPick] = useState('');
  const [side, setSide] = useState('end');
  const [size, setSize] = useState('');
  const [shape, setShape] = useState('');
  const attach = () => { if (pick) { rt.dispatch(`toolbar.widget.attach:${instance}:${pick}:${side}:${size}:${shape}`); setPick(''); } };
  const line = (w: ToolbarWidgetRow, i: number, total: number) => {
    const isOpen = open === w.key;
    return (
      <div key={w.key} className="fx-stack fx-stack--xs axf-toolbar-widgets__row" data-axf-widget-row={w.key}>
        <div className="fx-row fx-row--sm">
          <Switch label={w.label} checked={w.state === 'drawn'} onChange={(on) => rt.dispatch(`toolbar.widget.style:${instance}:${w.key}:hidden:${on ? 'default' : 'true'}`)} />
          <span className="fx-grow" />
          <span className="fx-muted fx-small">{w.size ? SIZE_LABEL[w.size] : ''}{w.shape ? ` · ${w.shape}` : ''}</span>
          {w.state === 'drawn' && <IconButton icon="chevron-left" label={`Move ${w.label} left`} disabled={i === 0} onClick={() => rt.dispatch(`toolbar.widget.move:${instance}:${w.key}:${w.at}:prev`)} />}
          {w.state === 'drawn' && <IconButton icon="chevron-right" label={`Move ${w.label} right`} disabled={i === total - 1} onClick={() => rt.dispatch(`toolbar.widget.move:${instance}:${w.key}:${w.at}:next`)} />}
          <IconButton icon="settings" label={`Style ${w.label}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : w.key)} />
          {w.state === 'drawn' && <IconButton icon="close" label={`Detach ${w.label}`} onClick={() => rt.dispatch(`toolbar.widget.detach:${instance}:${w.key}`)} />}
        </div>
        {isOpen && <WidgetStyleFields rt={rt} instance={instance} w={w} />}
      </div>
    );
  };
  return (
    <div className="fx-stack fx-stack--md axf-toolbar-widgets" data-axf-toolbar-widgets-panel={instance}>
      {TOOLBAR_SIDES_LIST.map((s) => {
        const list = rows.filter((w) => w.state === 'drawn' && w.at === s);
        return (
          <section key={s} className="fx-stack fx-stack--sm" data-axf-widget-side={s}>
            <h4 className="fx-eyebrow">{SIDE_LABEL[s] ?? s}</h4>
            {list.length ? list.map((w, i) => line(w, i, list.length)) : <p className="fx-muted fx-small">No widgets here yet.</p>}
          </section>
        );
      })}
      {rows.some((w) => w.state === 'hidden') && (
        <section className="fx-stack fx-stack--sm">
          <h4 className="fx-eyebrow">Hidden</h4>
          {rows.filter((w) => w.state === 'hidden').map((w, i, l) => line(w, i, l.length))}
        </section>
      )}
      <section className="fx-stack fx-stack--sm" data-axf-toolbar-widget-attach="">
        <h4 className="fx-eyebrow">Attach a widget</h4>
        {addable.length ? (
          <>
            <SelectField label="Widget" value={pick} empty="Pick a widget" options={addable.map((w) => ({ value: w.key, label: `${w.label} (${w.type})` }))} onChange={setPick} />
            <SelectField label="Side" value={side} options={TOOLBAR_SIDES_LIST.map((s) => ({ value: s, label: SIDE_LABEL[s] ?? s }))} onChange={setSide} />
            <SelectField label="Banner widget style" value={size} empty="Its own size" options={BANNER_WIDGET_SIZES.map((s) => ({ value: s, label: SIZE_LABEL[s] }))} onChange={setSize} />
            <SelectField label="Shape" value={shape} empty="The toolbar's shape" options={toolbarWidgetShapes(rt).map((s) => ({ value: s, label: s.replace(/^./, (c) => c.toUpperCase()) }))} onChange={setShape} />
            <div className="fx-row"><Button tone="primary" icon="plus" disabled={!pick} onClick={attach}>Attach</Button></div>
          </>
        ) : <p className="fx-muted fx-small">Every widget is already on this toolbar.</p>}
      </section>
      <Note icon="info">Saved for this toolbar ({instance}) and kept in sync through axHub. Widgets snap to the toolbar's ends and never draw over its buttons.</Note>
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="undo" onClick={() => rt.dispatch(`toolbar.widgets.reset:${instance}`)}>Put widgets back</Button>
      </div>
    </div>
  );
}

export const toolbarWidgetsDialog: DialogMap = {
  [TOOLBAR_WIDGETS_DIALOG]: { title: 'Toolbar widgets', icon: 'layers', searchable: false, render: (props) => <ToolbarWidgetsPanel instance={typeof props.instance === 'string' ? props.instance : undefined} initial={typeof props.key === 'string' ? props.key : undefined} /> },
};

/* ---------------- console-control targets (toolbar:<id>/widget:<key>) ---------------- */

/** The list address of one toolbar's widgets (state = every row, open = the dialog: the console_show deep link). */
export const toolbarWidgetsListAddress = (instance: string): string => `toolbar:${instance}/widget:all`;

/** Every toolbar instance worth listing: the app's, every toolbar asset, every toolbar on screen, every one with saved widgets. */
export function toolbarWidgetInstances(rt: AxfRuntime): string[] {
  const out = new Set<string>([TOOLBAR_APP_INSTANCE]);
  for (const a of rt.registry.list('toolbar') as { id: string }[]) out.add(a.id);
  if (typeof document !== 'undefined') for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="toolbar"][data-axf-toolbar]'))) if (el.dataset.axfToolbar) out.add(el.dataset.axfToolbar);
  for (const k of Object.keys(rt.settings.savedValues())) { const m = /^axf\.toolbar\.(.+)\.widgets$/.exec(k); if (m) out.add(m[1]!); }
  return [...out];
}

/** The state of one toolbar's widgets: every row, the person's slots and the style defaults (what GET …/widgets answers). */
export function toolbarWidgetsState(rt: AxfRuntime, instance: string): Record<string, unknown> {
  return {
    $axf: 'toolbar-widgets@1', toolbar: instance,
    rows: toolbarWidgetRows(rt, instance),
    slots: rt.toolbarWidgetSlots(instance),
    style: rt.toolbarWidgetStyle(instance),
    keys: { slots: TOOLBAR_WIDGETS_KEY(instance), style: TOOLBAR_WIDGET_STYLE_KEY(instance), all: TOOLBARS_WIDGET_STYLE_KEY },
  };
}

/**
 * Apply one operation to one widget of one toolbar (the value of a press / set on `toolbar:<id>/widget:<key>`):
 * `attach[:<side>[:<size>[:<shape>]]]`, `move:<side>[:<index|prev|next>]`, `style:<field>:<value>`, `hide`, `show`, `reset`,
 * or an object `{ op, side?, index?, size?, shape?, field?, value? }`. Detach is its own (destructive) button.
 */
export function applyToolbarWidgetOp(rt: AxfRuntime, instance: string, key: string, value: unknown): Record<string, unknown> {
  const o: Record<string, unknown> = typeof value === 'string' ? (() => { const [op = '', a = '', b = '', c = ''] = value.split(':'); return op === 'style' ? { op, field: a, value: [b, c].filter(Boolean).join(':') } : op === 'move' ? { op, side: a, index: b } : { op, side: a, size: b, shape: c }; })() : (value && typeof value === 'object' ? value as Record<string, unknown> : {});
  const op = String(o.op ?? '');
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  if (op === 'attach') rt.dispatch(`toolbar.widget.attach:${instance}:${key}:${str(o.side) || 'end'}:${str(o.size)}:${str(o.shape)}`);
  else if (op === 'move') rt.dispatch(`toolbar.widget.move:${instance}:${key}:${str(o.side)}:${str(o.index)}`);
  else if (op === 'style') rt.dispatch(`toolbar.widget.style:${instance}:${key}:${str(o.field)}:${str(o.value) || 'default'}`);
  else if (op === 'hide') rt.dispatch(`toolbar.widget.style:${instance}:${key}:hidden:true`);
  else if (op === 'show') rt.dispatch(`toolbar.widget.style:${instance}:${key}:hidden:default`);
  else if (op === 'reset') rt.dispatch(`toolbar.widget:${instance}:${key}:reset`);
  else return { ok: false, message: `unknown widget op "${op}" (attach, move, style, hide, show, reset)` };
  return { ok: true, row: toolbarWidgetRows(rt, instance).find((w) => w.key === key) ?? null };
}

/** console-control targets: per toolbar its widget list, every widget (drawn, hidden, addable) and each one's Detach button. */
export function toolbarWidgetTargets(rt: AxfRuntime, hint?: string): ControlTargetDef[] {
  const want = hint ? /toolbar:([^/]+)/.exec(hint)?.[1] : undefined;
  const out: ControlTargetDef[] = [];
  for (const instance of want ? [want] : toolbarWidgetInstances(rt)) {
    out.push({
      address: toolbarWidgetsListAddress(instance), kind: 'widget', label: `Widgets on toolbar ${instance}`, icon: 'layers', keywords: ['widgets', 'toolbar', 'attach'],
      requires: 'assets.swap', can: ['open', 'state', 'list'],
      get: () => toolbarWidgetsState(rt, instance), open: () => rt.dispatch(`toolbar.widgets:${instance}`), expand: () => rt.dispatch(`toolbar.widgets:${instance}`),
      element: () => (typeof document === 'undefined' ? null : document.querySelector(`[role="toolbar"][data-axf-toolbar="${instance}"]`)),
    });
    // the settings behind it: what the person added and chose (slots) and the toolbar's default widget style
    const save = (key: string, norm: (v: unknown) => unknown, empty: (v: unknown) => boolean) => (value: unknown) => {
      if (!rt.canArrange()) return { ok: false, message: 'this account can\'t change the look' };
      const next = norm(typeof value === 'string' ? value : JSON.stringify(value ?? null));
      if (empty(next)) rt.settings.clear(key); else rt.settings.set(key, JSON.stringify(next));
      return { ok: true, value: next };
    };
    out.push({
      address: `setting:${TOOLBAR_WIDGETS_KEY(instance)}`, kind: 'setting', label: `Widgets on toolbar ${instance} (slots)`, detail: 'toolbar-widgets@1 slots: [{ type, id, at?, order?, hidden?, size?, show?, shape?, … }]', icon: 'layers', requires: 'assets.swap',
      get: () => rt.toolbarWidgetSlots(instance), set: save(TOOLBAR_WIDGETS_KEY(instance), normalizeToolbarWidgetSlots, (v) => !(v as unknown[]).length),
      open: () => rt.dispatch(`chrome.settings:toolbar:${instance}:widgets`),
    }, {
      address: `setting:${TOOLBAR_WIDGET_STYLE_KEY(instance)}`, kind: 'setting', label: `Widget style on toolbar ${instance}`, detail: '{ size?, show?, priority?, hideWhenEmpty?, overflow?, shape? }', icon: 'layers', requires: 'assets.swap',
      get: () => normalizeWidgetStyle(rt.settings.get(TOOLBAR_WIDGET_STYLE_KEY(instance))), set: save(TOOLBAR_WIDGET_STYLE_KEY(instance), normalizeWidgetStyle, (v) => !Object.keys(v as object).length),
      open: () => rt.dispatch(`chrome.settings:toolbar:${instance}:widgets`),
    });
    for (const w of toolbarWidgetRows(rt, instance)) {
      const address = `toolbar:${instance}/widget:${w.key}`;
      const apply = (v: unknown) => applyToolbarWidgetOp(rt, instance, w.key, v);
      out.push({
        address, kind: 'widget', label: `${w.label} (${instance} toolbar)`, detail: w.state, icon: 'layers', keywords: [w.type, w.id, ...w.aliases],
        requires: 'assets.swap', get: () => toolbarWidgetRows(rt, instance).find((x) => x.key === w.key) ?? null, set: apply, invoke: apply,
        open: () => rt.dispatch(`toolbar.widgets:${instance}:${w.key}`),
        element: () => (typeof document === 'undefined' ? null : document.querySelector(`[role="toolbar"][data-axf-toolbar="${instance}"] [data-axf-toolbar-widget="${w.key}"]`)),
      });
      if (w.state !== 'addable') out.push({
        address: `${address}/button:detach`, kind: 'button', label: `Detach ${w.label} from toolbar ${instance}`, icon: 'close', destructive: true, requires: 'assets.swap',
        invoke: () => ({ ok: detachToolbarWidget(rt, instance, w.key) }),
      });
    }
  }
  return out;
}
