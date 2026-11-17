/**
 * Custom shape editor (widget-shape@1 `custom`): enter or paste one closed SVG outline in a 0..100 square, or start from a
 * preset (WIDGET_SHAPE_PRESETS), see it on the widget's icon at once, and Use it. The engine is the only judge:
 * customPathClip (core/engines/bannerwidgets.ts) turns the path into the percent polygon the widget is clipped to, or
 * refuses it, so the preview, the saved choice and every port agree. Saving runs `banner.widget:<widget>:path=<d>`, the
 * same action REST, MCP, the CLI and voice run.
 *
 * Dialog WIDGET_SHAPE_DIALOG (`axf.banner.widget-shape`, payload { key }), opened by Shape ▸ Custom… on the widget's
 * right-click / long-press menu, the Banners settings row and `banner.widget.custom-shape:<widget>`. Tokens only: the
 * preview sets --fx-widget-shape-clip inline, axf.css draws it.
 */
import { useState } from 'react';
import { BANNER_WIDGET_CUSTOM_PATH, BANNER_WIDGET_SHAPE_TOKENS, WIDGET_SHAPE_PRESETS, customPathClip } from '../../core/engines/bannerwidgets';
import { WIDGET_SHAPE_DIALOG } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { ControlScope } from '../controlTargets';
import { Button } from './Controls';
import { Note, TextField } from './Forms';
import { Icon, IconOverride } from './Icon';
import type { DialogMap } from './Overlays';

export function WidgetShapeEditor({ widgetKey }: { widgetKey: string }) {
  const rt = useRuntime();
  useAxfState();
  const w = rt.bannerWidgets().find((x) => x.key === widgetKey) ?? null;
  const saved = w ? rt.bannerWidgetPrefs()[w.key]?.customPath ?? w.view.customPath ?? '' : '';
  const [path, setPath] = useState<string>(saved || WIDGET_SHAPE_PRESETS[0]!.path);
  if (!w) return <Note tone="warning" icon="alert">“{widgetKey}” is not a banner widget. Open Shape ▸ Custom… from a widget’s right-click menu.</Note>;
  const clip = customPathClip(path);
  const shape = rt.bannerWidgetShape(w.key);
  const preview = (d: string) => ({ [BANNER_WIDGET_SHAPE_TOKENS.clip]: customPathClip(d) ?? 'none' }) as Record<string, string>;
  return (
    <ControlScope address={`panel:${WIDGET_SHAPE_DIALOG}`}>
      <div className="fx-stack fx-widget-shape-editor" data-axf-target={`panel:${WIDGET_SHAPE_DIALOG}`} data-fx-widget={w.key}>
        <div className="fx-row fx-widget-shape-editor__head">
          <span className="fx-widget-shape-editor__preview" style={preview(path)} aria-label={clip ? 'Preview of the outline' : 'No preview: the outline is refused'} role="img">
            <IconOverride icon={shape.icon}><Icon name={w.icon ?? 'box'} size={24} /></IconOverride>
          </span>
          <span className="fx-stack">
            <strong>{w.label}</strong>
            <span className="fx-widget-shape-editor__meta">{shape.shape === 'custom' ? 'Custom outline in use' : `Now: ${shape.shape}`}</span>
          </span>
        </div>
        <div className="fx-widget-shape-editor__presets" role="toolbar" aria-label="Preset outlines">
          {WIDGET_SHAPE_PRESETS.map((p) => (
            <Button key={p.id} id={`widget-shape.preset.${p.id}`} tone={p.path === path.trim() ? 'primary' : 'ghost'} aria-pressed={p.path === path.trim()} onClick={() => setPath(p.path)}>
              <span className="fx-widget-shape-editor__swatch" style={preview(p.path)} aria-hidden="true" />{p.label}
            </Button>
          ))}
        </div>
        <TextField label="Outline (SVG path)" mono value={path} placeholder={WIDGET_SHAPE_PRESETS[0]!.path} onChange={setPath}
          hint={`One closed outline in a 0..100 square: M L H V C S Q T Z, ends with Z, at most ${BANNER_WIDGET_CUSTOM_PATH.max} characters`}
          error={clip ? undefined : 'Not one closed outline inside the square: the widget would stay a circle'} />
        <div className="fx-row fx-widget-shape-editor__actions" role="toolbar" aria-label="Custom shape actions">
          <Button id="widget-shape.circle" tone="ghost" icon="undo" onClick={() => { rt.dispatch(`banner.widget:${w.key}:circle`); rt.closeDialog(); }}>Back to circle</Button>
          <Button id="widget-shape.use" tone="primary" icon="check" disabled={!clip} onClick={() => { rt.dispatch(`banner.widget:${w.key}:path=${path.trim()}`); rt.closeDialog(); }}>Use this shape</Button>
        </div>
      </div>
    </ControlScope>
  );
}

export const widgetShapeDialog: DialogMap = {
  [WIDGET_SHAPE_DIALOG]: { title: 'Custom shape', icon: 'box', searchable: false, render: (props) => <WidgetShapeEditor widgetKey={typeof props.key === 'string' ? props.key : ''} /> },
};
