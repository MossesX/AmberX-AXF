/*
 * Icon picker (Brett, Nov 16 2026: "let me change the icon of any banner/toolbar widget"). Lists the framework's icons
 * and every glyph of every registered icon pack (icon-pack@1), searchable by name or pack. `IconPicker` is the control;
 * the `axf.widget.icon` dialog wraps it for one host widget (Change icon… in the widget's right-click / long-press menu
 * and in its settings) and saves the pick as that widget's icon override (core/engines/widgeticons.ts), with Reset to
 * the asset's own icon. Framework controls and theme tokens only.
 */
import { useMemo, useState } from 'react';
import { iconChoices } from '../../core/engines/widgeticons';
import { WIDGET_ICON_DIALOG } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button } from './Controls';
import { ChoiceGrid, Note, TextField } from './Forms';
import { ICON_NAMES } from './Icon';
import type { DialogMap } from './Overlays';

/** Most icons drawn at once (the search narrows the rest). */
const SHOWN_MAX = 120;

/** Every icon the picker can offer right now: framework names plus each icon pack's glyphs. */
export function useIconChoices(): { name: string; packs: string[] }[] {
  const rt = useRuntime();
  useAxfState();
  const packs = rt.registry.list('icon-pack' as never) as unknown as { id: string; name?: string; data?: { glyphs?: Record<string, unknown> } }[];
  return useMemo(() => iconChoices(ICON_NAMES, packs.map((p) => ({ id: p.id, name: p.name, glyphs: p.data?.glyphs }))), [packs.map((p) => p.id).join('|')]);
}

export function IconPicker({ value, onPick, label = 'Icon' }: { value?: string; onPick: (name: string) => void; label?: string }) {
  const all = useIconChoices();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const hits = needle ? all.filter((c) => c.name.includes(needle) || c.packs.some((p) => p.includes(needle))) : all;
  return (
    <div className="fx-icon-picker" data-axf-target="section:icon-picker">
      <TextField label={`Search ${all.length} icons`} value={q} onChange={setQ} placeholder="star, clock, bell…" />
      <ChoiceGrid label={label} selected={value ? [value] : []} onToggle={onPick}
        choices={hits.slice(0, SHOWN_MAX).map((c) => ({ id: c.name, title: c.name, icon: c.name, ...(c.packs.length ? { tag: c.packs.join(', ') } : {}) }))} />
      {hits.length > SHOWN_MAX && <Note icon="search">{hits.length - SHOWN_MAX} more: type to narrow the list.</Note>}
      {!hits.length && <Note icon="info">No icon matches "{q}".</Note>}
    </div>
  );
}

/** Change icon… for one widget on one host: the pick is saved at once as that widget's override. */
export function WidgetIconPanel({ host, widget }: { host: string; widget: string }) {
  const rt = useRuntime();
  useAxfState();
  const [type = '', id = ''] = [widget.slice(0, widget.indexOf(':')), widget.slice(widget.indexOf(':') + 1)];
  const own = (rt.registry.get(type as never, id) as { data?: { icon?: string } } | undefined)?.data?.icon;
  const override = rt.widgetIcons()[`${host}/${widget}`];
  return (
    <div className="fx-stack" data-axf-target={`section:widget-icon.${host}`}>
      <Note icon={override ?? own ?? 'info'}>{override ? `Your icon: ${override}${own ? ` (the widget's own is ${own})` : ''}.` : own ? `The widget's own icon: ${own}.` : 'This widget has no icon of its own yet.'}</Note>
      <IconPicker value={override ?? own} onPick={(name) => rt.setWidgetIconOverride(host, widget, name)} />
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="undo" disabled={!override} data-axf-target={`button:widget-icon.reset`} onClick={() => rt.setWidgetIconOverride(host, widget, null)}>Back to the widget's own icon</Button>
        <Button tone="ghost" icon="check" data-axf-target={`button:widget-icon.done`} onClick={() => rt.closeDialog()}>Done</Button>
      </div>
    </div>
  );
}

export const widgetIconDialog: DialogMap = {
  [WIDGET_ICON_DIALOG]: { title: 'Change icon', icon: 'star', searchable: false, render: (props) => <WidgetIconPanel host={typeof props.host === 'string' ? props.host : 'banner'} widget={typeof props.widget === 'string' ? props.widget : ''} /> },
};
