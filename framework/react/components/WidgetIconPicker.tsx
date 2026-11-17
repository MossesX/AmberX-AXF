/**
 * Change icon… (widget-shape@1 iconOverride): the icon picker for one banner widget. The icon pack in force (the skin's,
 * else the branding's) comes first, then every other registered pack; search filters the glyph names; a pick saves
 * `iconOverride {pack, id}` on that widget through the same action REST, MCP, the CLI and voice run
 * (`banner.widget:<widget>:icon=<pack>/<glyph>`), and Reset to widget default puts its own icon back (`icon=own`).
 *
 * Dialog WIDGET_ICON_DIALOG (`axf.banner.widget-icon`, payload { key }), opened by the widget's right-click / long-press
 * Change icon…, the Banners settings row and `banner.widget.icon-picker:<widget>`. Framework controls and tokens only.
 *
 * Shared picker: build icon-picker-every-banner-settings-widget (widget-icons@1) adds a general IconPicker for every
 * banner and settings widget; whichever lands second routes this dialog through the one picker (report of this build).
 */
import { useState } from 'react';
import { WIDGET_ICON_OWN } from '../../core/engines/bannerwidgets';
import { WIDGET_ICON_DIALOG } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { ControlScope } from '../controlTargets';
import { Button, IconButton } from './Controls';
import { Note, SelectField, TextField } from './Forms';
import { Icon, IconOverride } from './Icon';
import type { DialogMap } from './Overlays';

interface Pack { id: string; name: string; data: { glyphs?: Record<string, unknown> } }

/** Glyphs one pick shows at most (search narrows the rest). */
const GRID_MAX = 240;

export function WidgetIconPicker({ widgetKey }: { widgetKey: string }) {
  const rt = useRuntime();
  useAxfState();
  const w = rt.bannerWidgets().find((x) => x.key === widgetKey) ?? null;
  const saved = w ? rt.bannerWidgetPrefs()[w.key]?.iconOverride ?? w.view.iconOverride ?? null : null;
  const inForce = rt.skinIconPack() || rt.branding()?.iconPack || '';
  const packs = (rt.registry.all().filter((a) => a.type === 'icon-pack') as unknown as Pack[])
    .slice().sort((a, b) => (a.id === inForce ? -1 : b.id === inForce ? 1 : a.name.localeCompare(b.name)));
  const [packId, setPackId] = useState(saved?.pack ?? packs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  if (!w) return <Note tone="warning" icon="alert">“{widgetKey}” is not a banner widget. Open Change icon… from a widget’s right-click menu.</Note>;
  const pack = packs.find((p) => p.id === packId);
  const q = query.trim().toLowerCase();
  const glyphs = Object.keys(pack?.data.glyphs ?? {}).sort().filter((g) => !q || g.toLowerCase().includes(q));
  const shape = rt.bannerWidgetShape(w.key);
  const pick = (glyph: string) => rt.dispatch(`banner.widget:${w.key}:icon=${packId}/${glyph}`);
  return (
    <ControlScope address={`dialog:${WIDGET_ICON_DIALOG}`}>
      <div className="fx-stack fx-widget-icon-picker" data-axf-target={`dialog:${WIDGET_ICON_DIALOG}`} data-fx-widget={w.key}>
        <div className="fx-row fx-widget-icon-picker__preview" aria-live="polite">
          <span className="fx-widget-icon-picker__glyph"><IconOverride icon={shape.icon}><Icon name={w.icon ?? 'box'} size={24} /></IconOverride></span>
          <span className="fx-stack">
            <strong>{w.label}</strong>
            <span className="fx-widget-icon-picker__meta">{saved ? `${saved.pack} / ${saved.id}` : 'Its own icon'}</span>
          </span>
        </div>
        {packs.length ? (
          <>
            <SelectField label="Icon pack" value={packId} options={packs.map((p) => ({ value: p.id, label: p.id === inForce ? `${p.name} (in use)` : p.name }))} onChange={setPackId} />
            <TextField label="Search icons" value={query} placeholder="bell, rocket, star…" onChange={setQuery} autoFocus />
            <div className="fx-widget-icon-picker__grid" role="toolbar" aria-label={`${pack?.name ?? 'Pack'} icons`}>
              {glyphs.slice(0, GRID_MAX).map((g) => {
                const on = saved?.pack === packId && saved.id === g;
                return (
                  <span key={g} className={`fx-widget-icon-picker__cell${on ? ' is-on' : ''}`}>
                    <IconOverride icon={`${packId}/${g}`}><IconButton id={`widget-icon.${packId}.${g}`} icon="box" size={20} label={`Use ${g}`} title={g} aria-pressed={on} onClick={() => pick(g)} /></IconOverride>
                  </span>
                );
              })}
            </div>
            {!glyphs.length && <Note icon="search">No icon matches “{query}”.</Note>}
            {glyphs.length > GRID_MAX && <Note icon="info">Showing {GRID_MAX} of {glyphs.length}: search to narrow them.</Note>}
          </>
        ) : <Note icon="info">No icon packs are registered in this app, so only the widget’s own icon is available.</Note>}
        <div className="fx-row fx-widget-icon-picker__actions" role="toolbar" aria-label="Icon picker actions">
          <Button id="widget-icon.reset" tone="ghost" icon="undo" disabled={!saved} onClick={() => rt.dispatch(`banner.widget:${w.key}:icon=${WIDGET_ICON_OWN}`)}>Reset to widget default</Button>
          <Button id="widget-icon.done" tone="primary" icon="check" onClick={() => rt.closeDialog()}>Done</Button>
        </div>
      </div>
    </ControlScope>
  );
}

export const widgetIconDialog: DialogMap = {
  [WIDGET_ICON_DIALOG]: { title: 'Change icon', icon: 'palette', searchable: false, render: (props) => <WidgetIconPicker widgetKey={typeof props.key === 'string' ? props.key : ''} /> },
};
