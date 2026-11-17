/**
 * Settings → Plugins → Banners → Widget shape and icon (widget-shape@1): one row per top-bar widget with its Shape and its
 * Icon, inside the one Banners settings interface. Levels follow the settings level toolbar (axf.settings.level):
 * Shape and Icon from Basic, the custom outline field from Developer (below that, Custom… opens the editor dialog).
 *
 * Every control saves through the same action REST, MCP, the CLI and voice run (`banner.widget:<widget>:<shape>`,
 * `path=<d>`, `icon=<pack>/<glyph>|own`, `reset`) and carries its console-control address:
 * `setting:banner.widget.<widget>.shape`, `setting:banner.widget.<widget>.icon`, `setting:banner.widget.<widget>.path`.
 */
import { useEffect, useState } from 'react';
import { BANNER_WIDGET_SHAPES, customPathClip, widgetShapeTokens, type BannerWidgetShape } from '../../core/engines/bannerwidgets';
import { SETTINGS_LEVEL_KEY, settingsLevelOf, settingsLevelRank, type SettingsLevel } from '../../core/engines/settingsui';
import type { BannerWidget } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button } from './Controls';
import { Note, Section, SelectField, TextField } from './Forms';
import { Icon, IconOverride } from './Icon';

const SHAPE_LABEL: Record<BannerWidgetShape, string> = { circle: 'Circle', square: 'Square', rounded: 'Rounded', pill: 'Pill', hexagon: 'Hexagon', custom: 'Custom…' };
/** The level each field shows from (settings level toolbar). */
export const WIDGET_SHAPE_FIELD_LEVEL: Record<'shape' | 'icon' | 'path', SettingsLevel> = { shape: 'basic', icon: 'basic', path: 'developer' };
/** The console-control address of one widget's field (registered by the control registry, check-console-control.mjs). */
export const widgetShapeSettingAddress = (key: string, field: 'shape' | 'icon' | 'path') => `setting:banner.widget.${key}.${field}`;

function PathField({ w }: { w: BannerWidget }) {
  const rt = useRuntime();
  const saved = rt.bannerWidgetPrefs()[w.key]?.customPath ?? '';
  const [text, setText] = useState(saved);
  useEffect(() => { setText(saved); }, [saved]);
  const ok = !text.trim() || customPathClip(text) !== null;
  return (
    <span data-axf-target={widgetShapeSettingAddress(w.key, 'path')}>
      <TextField label="Custom outline" mono value={text} placeholder="M50 0 L100 50 L50 100 L0 50 Z" hint="SVG path in a 0..100 square; saved when it is one closed outline"
        error={ok ? undefined : 'Not one closed outline inside the square'}
        onChange={(v) => { setText(v); if (v.trim() && customPathClip(v)) rt.dispatch(`banner.widget:${w.key}:path=${v.trim()}`); }} />
    </span>
  );
}

function WidgetShapeRow({ w, level }: { w: BannerWidget; level: SettingsLevel }) {
  const rt = useRuntime();
  const shape = rt.bannerWidgetShape(w.key);
  const over = rt.bannerWidgetPrefs()[w.key]?.iconOverride ?? w.view.iconOverride ?? null;
  const at = (f: keyof typeof WIDGET_SHAPE_FIELD_LEVEL) => settingsLevelRank(level) >= settingsLevelRank(WIDGET_SHAPE_FIELD_LEVEL[f]);
  const pickShape = (v: string) => (v === 'custom' ? rt.dispatch(`banner.widget.custom-shape:${w.key}`) : rt.dispatch(`banner.widget:${w.key}:${v}`));
  return (
    <div className="fx-banner-widgets__row" data-axf-widget-shape-row={w.key}>
      <div className="fx-banner-widgets__line">
        <span className="fx-banner-shape-rows__glyph" data-fx-wshape={shape.shape} style={widgetShapeTokens(shape)} aria-hidden="true">
          <IconOverride icon={shape.icon}><Icon name={w.icon ?? 'box'} size={14} /></IconOverride>
        </span>
        <strong className="fx-grow">{w.label}</strong>
      </div>
      <div className="fx-banner-widgets__fields">
        {at('shape') && (
          <span data-axf-target={widgetShapeSettingAddress(w.key, 'shape')}>
            <SelectField label="Shape" hint={shape.fell[0]} value={w.view.shape} options={BANNER_WIDGET_SHAPES.map((s) => ({ value: s, label: SHAPE_LABEL[s] }))} onChange={pickShape} />
          </span>
        )}
        {at('icon') && (
          <span className="fx-stack" data-axf-target={widgetShapeSettingAddress(w.key, 'icon')}>
            <span className="fx-small fx-muted">Icon: {over ? `${over.pack} / ${over.id}` : 'its own'}</span>
            <span className="fx-row fx-row--wrap">
              <Button id={`banner-widget.${w.key}.icon`} size="sm" tone="ghost" icon="palette" onClick={() => rt.dispatch(`banner.widget.icon-picker:${w.key}`)}>Change icon…</Button>
              {over && <Button id={`banner-widget.${w.key}.icon-reset`} size="sm" tone="ghost" icon="undo" onClick={() => rt.dispatch(`banner.widget:${w.key}:icon=own`)}>Its own icon</Button>}
            </span>
          </span>
        )}
        {at('path') && w.view.shape === 'custom' && <PathField w={w} />}
      </div>
    </div>
  );
}

/** The section in the Banners settings interface: every widget on the top bar (and the ones waiting to be attached). */
export function BannerWidgetShapeRows() {
  const rt = useRuntime();
  useAxfState();
  const level = settingsLevelOf(rt.settings.get(SETTINGS_LEVEL_KEY)) ?? 'basic';
  const rows = rt.bannerWidgets();
  if (settingsLevelRank(level) < settingsLevelRank(WIDGET_SHAPE_FIELD_LEVEL.shape)) return null;
  return (
    <Section title="Widget shape and icon">
      <div className="fx-banner-widgets" data-axf-target="setting:banner.widget.shapes">
        {rows.length ? rows.map((w) => <WidgetShapeRow key={w.key} w={w} level={level} />) : <Note icon="info">No widgets on the top bar.</Note>}
        <Note icon="info">Right-click or long-press a widget on the bar for the same: Shape ▸ and Change icon…</Note>
      </div>
    </Section>
  );
}
