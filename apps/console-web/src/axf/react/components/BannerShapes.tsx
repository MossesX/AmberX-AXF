/*
 * Banner widget shapes in the settings dialogs (shape@1). `WidgetShapeField` is the Shape row of one banner widget's
 * settings (per instance: Inherit = follow the app / skin / hub, Restore previous edit); `BannerShapeSettings` is the
 * Shape tab of the banner's right-click settings (chrome-banner settings asset): the app's shape for every banner
 * widget, then the widget that was right-clicked. Both go through rt.setShape / rt.restoreShape (the same calls the
 * `shape.set` / `shape.restore` actions, REST, MCP, CLI and voice make). Theme tokens and framework controls only.
 */
import { shapeScopeKey, type ShapeLevel } from '../../core/engines/shape';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Note, Section } from './Forms';
import { ShapePicker } from './ShapePicker';

const LEVEL_LABEL: Record<string, string> = { instance: 'this widget', app: 'this app', skin: 'the skin', global: 'the hub-wide default', default: "the banner's default" };

/** Where the shape in force comes from, in words. */
export function shapeSourceText(level: string, id: string): string {
  return `${id} · from ${LEVEL_LABEL[level] ?? level}`;
}

/** The shape of one banner widget (`type:id`): picked here, or inherited. */
export function WidgetShapeField({ widget, compact = true }: { widget: string; compact?: boolean }) {
  const rt = useRuntime();
  useAxfState();
  const r = rt.resolveShape(widget);
  const own = rt.shapeAtKey(shapeScopeKey('instance', widget));
  const canRestore = shapeScopeKey('instance', widget) in rt.shapeHistory();
  const slug = widget.replace(/[^a-z0-9-]+/gi, '-');
  return (
    <div className="fx-stack" data-axf-target={`section:banner-widget.shape.${slug}`}>
      <Note icon="box">Shape now: {shapeSourceText(r.level, r.id)}</Note>
      <ShapePicker value={own} compact={compact} target={`banner-widget.shape.${slug}`} onPick={(id) => rt.setShape('instance', id, widget)}
        inherit={{ label: 'Inherit from skin', onInherit: () => rt.setShape('instance', '', widget) }}
        onRestore={() => rt.restoreShape('instance', widget)} canRestore={canRestore} />
    </div>
  );
}

/** The app level: every banner widget's shape on this app. */
function LevelShapeField({ level, title, inheritLabel }: { level: Exclude<ShapeLevel, 'instance'>; title: string; inheritLabel: string }) {
  const rt = useRuntime();
  useAxfState();
  const key = shapeScopeKey(level);
  return (
    <Section title={title}>
      <ShapePicker value={rt.shapeAtKey(key)} compact target={`banner.shape.${level}`} onPick={(id) => rt.setShape(level, id)}
        inherit={{ label: inheritLabel, onInherit: () => rt.setShape(level, '') }} onRestore={() => rt.restoreShape(level)} canRestore={key in rt.shapeHistory()} />
    </Section>
  );
}

/** The Shape tab of the banner's settings dialog. */
export function BannerShapeSettings() {
  const rt = useRuntime();
  useAxfState();
  const hit = rt.contextBannerWidget ? rt.bannerWidgets().find((w) => w.key === rt.contextBannerWidget) : null;
  const r = rt.resolveShape();
  return (
    <div className="fx-stack" data-axf-target="section:banner.shape">
      <Note icon="box">Banner widgets on this app: {shapeSourceText(r.level, r.id)}. A widget's own pick beats the app's, the app's beats the skin's, the skin's beats the hub-wide default.</Note>
      <LevelShapeField level="app" title="Every banner widget on this app" inheritLabel="Inherit from skin" />
      {hit && <Section title={`Only ${hit.label}`}><WidgetShapeField widget={hit.key} /></Section>}
    </div>
  );
}

export { LevelShapeField };
