/*
 * IconPicker (widget-icons@1): choose the icon of one banner or settings widget, and how it is drawn. Search, the grid
 * of every glyph (the framework set, then each icon pack), a live preview of the widget, the display mode and Reset to
 * default. Every pick is saved at once to `axf.widget.<id>.icon` / `.mode` (appearance settings, so they reach every
 * device of the app through axHub). Dialog `axf.widget.icons` (console_open `dialog:axf.widget.icons?widget=<id>`).
 * Framework controls and theme tokens only.
 */
import { useMemo, useState } from 'react';
import { parseWidgetIconId, WIDGET_ICON_MODES } from '../../core/engines/widget-icons';
import { useAxfState, useRuntime } from '../AxfProvider';
import { ControlScope } from '../controlTargets';
import { WIDGET_ICONS_DIALOG, resetWidgetIcon, resolveWidget, setWidgetIcon, setWidgetMode, widgetIconMap, widgetIconsSeen, WidgetGlyph } from '../widgetIcons';
import { Button, IconButton } from './Controls';
import { Note, SelectField, TextField } from './Forms';
import type { DialogMap } from './Overlays';

const MODE_LABEL: Record<string, string> = { auto: 'Automatic (icon when the text is long)', icon: 'Icon only', 'icon+text': 'Icon and text', text: 'Text only' };

/** One section of the grid: a source (the framework set or a pack) and its glyph refs. */
interface Section { id: string; label: string; refs: string[] }

function sections(rt: ReturnType<typeof useRuntime>): Section[] {
  const map = widgetIconMap(rt);
  const out: Section[] = [{ id: 'framework', label: 'Framework', refs: [...(map.glyphs ?? [])] }];
  for (const [pack, glyphs] of Object.entries(map.packs ?? {})) if (glyphs.length) out.push({ id: pack, label: pack === map.pack ? `${pack} (in use)` : pack, refs: glyphs.map((g) => `${pack}/${g}`) });
  return out;
}

export function IconPicker({ widget, label }: { widget: string; label?: string }) {
  const rt = useRuntime();
  useAxfState();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const parts = parseWidgetIconId(widget);
  const name = label ?? widgetIconsSeen(rt).find((w) => w.id === widget)?.label ?? widget;
  const all = useMemo(() => sections(rt), [rt]);
  if (!parts) return <Note tone="warning" icon="alert">“{widget}” is not a widget id. Open the picker from a widget’s right-click menu.</Note>;
  const r = resolveWidget(rt, { id: widget, kind: parts.kind, name });
  const picked = String(rt.settings.get(`axf.widget.${widget}.mode`) ?? 'auto') || 'auto';
  const q = query.trim().toLowerCase();
  const shown = all.map((s) => ({ ...s, refs: q ? s.refs.filter((ref) => ref.toLowerCase().includes(q)) : s.refs })).filter((s) => s.refs.length);
  const pick = (ref: string) => setError(setWidgetIcon(rt, widget, ref) ?? '');
  return (
    <ControlScope address={`dialog:${WIDGET_ICONS_DIALOG}`}>
      <div className="fx-stack fx-icon-picker" data-fx-icon-picker={widget}>
        <div className="fx-icon-picker__preview" aria-live="polite">
          <span className="fx-icon-picker__glyph"><WidgetGlyph icon={r.icon} size={28} /></span>
          <span className="fx-stack fx-icon-picker__what">
            <strong>{name}</strong>
            <span className="fx-icon-picker__meta">{r.icon} · {r.via === 'pick' ? 'your pick' : r.via === 'own' || r.via === 'kind' ? 'default' : r.via} · {MODE_LABEL[r.mode]}</span>
          </span>
        </div>
        <SelectField label="Show as" value={picked} options={['auto', ...WIDGET_ICON_MODES].map((m) => ({ value: m, label: MODE_LABEL[m] ?? m }))} onChange={(v) => setError(setWidgetMode(rt, widget, v) ?? '')} />
        <TextField label="Search icons" value={query} placeholder="rocket, bell, pack name…" onChange={setQuery} autoFocus />
        {error && <Note tone="danger" icon="alert">{error}</Note>}
        <div className="fx-stack fx-icon-picker__sections">
          {shown.map((s) => (
            <section key={s.id} className="fx-stack fx-icon-picker__section" aria-label={s.label}>
              <span className="fx-icon-picker__heading">{s.label}</span>
              <div className="fx-icon-picker__grid" role="toolbar" aria-label={`${s.label} icons`}>
                {s.refs.map((ref) => (
                  <span key={ref} className={`fx-icon-picker__cell${ref === r.icon ? ' is-on' : ''}`}>
                    <IconButton id={`icon-picker.${ref.replace('/', '.')}`} icon={ref} label={`Use ${ref}`} title={ref} aria-pressed={ref === r.icon} onClick={() => pick(ref)} />
                  </span>
                ))}
              </div>
            </section>
          ))}
          {!shown.length && <Note icon="search">No icon matches “{query}”.</Note>}
        </div>
        <div className="fx-row fx-icon-picker__actions" role="toolbar" aria-label="Icon picker actions">
          <Button tone="ghost" icon="undo" onClick={() => { resetWidgetIcon(rt, widget); setError(''); }}>Reset to default</Button>
          <Button tone="primary" icon="check" onClick={() => rt.closeDialog()}>Done</Button>
        </div>
      </div>
    </ControlScope>
  );
}

/** Every widget with its icon: the overview the dialog shows when it is opened without a widget. */
function WidgetIconList() {
  const rt = useRuntime();
  useAxfState();
  return (
    <div className="fx-stack fx-icon-picker">
      <Note icon="info">Pick the icon of any banner or settings widget. Right-click a widget for the same.</Note>
      <div className="fx-stack fx-icon-picker__list" role="toolbar" aria-label="Widgets">
        {widgetIconsSeen(rt).map((w) => (
          <Button key={w.id} id={`icon-picker.widget.${w.id}`} tone="ghost" icon={w.resolved.icon} onClick={() => rt.openDialog(WIDGET_ICONS_DIALOG, { widget: w.id, label: w.label })}>{w.label}</Button>
        ))}
      </div>
    </div>
  );
}

export const iconPickerDialog: DialogMap = {
  [WIDGET_ICONS_DIALOG]: {
    title: 'Widget icon', icon: 'star', searchable: true,
    render: (props) => (typeof props.widget === 'string' && props.widget ? <IconPicker widget={props.widget} label={typeof props.label === 'string' ? props.label : undefined} /> : <WidgetIconList />),
  },
};
