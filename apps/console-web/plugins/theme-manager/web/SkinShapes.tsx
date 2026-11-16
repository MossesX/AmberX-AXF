/*
 * Skin editor → Shapes (shape@1, build banner-widget-shapes-more-than-circle). The banner widget shape of the skin in
 * force here (an override of the skin's own `assets.shape`, kept per skin, Restore previous edit), then every banner
 * widget with the shape it draws, where that comes from (global / skin / app / instance), and its own pick if it has
 * one (change, Inherit, Restore previous edit). Every change goes through rt.setShape / rt.restoreShape, the same calls
 * the shape.* actions, the theme-manager /shapes routes, the shape_* MCP tools, `axf shape` and voice make.
 */
import { Button, Note, SelectField, ShapePicker, shapeSourceText, useAxfState, useRuntime } from '@console/axf/react';
import { shapeScopeKey } from '@console/axf/core/engines/shape';

const P = 'axp-theme-manager';

export function SkinShapes() {
  const rt = useRuntime();
  useAxfState();
  const skin = rt.skinInForce().id;
  const skinName = skin ? rt.skinList().find((s) => s.id === skin)?.name ?? skin : '';
  const shapes = rt.registry.list('shape' as never);
  const history = rt.shapeHistory();
  const own = skin ? (rt.shapeSkinOverrides()[skin] ?? '') : '';
  const widgets = rt.bannerWidgets().filter((w) => w.attached);
  return (
    <section className={`${P}__shapes fx-stack`} id="theme-manager-shapes" data-axf-target="panel:theme-manager.shapes">
      <h3>Shapes</h3>
      {skin ? (
        <>
          <Note icon="box">Banner widgets in {skinName}: {own ? `${own} (your pick for this skin)` : `${rt.skinShape(skin) || 'the default'} (the skin's own)`}.</Note>
          <ShapePicker value={own} compact target="theme-manager.shapes.skin" onPick={(id) => rt.setShape('skin', id)}
            inherit={{ label: "Use the skin's own shape", onInherit: () => rt.setShape('skin', '') }}
            onRestore={() => rt.restoreShape('skin')} canRestore={shapeScopeKey('skin') in history} />
        </>
      ) : <Note icon="info">No skin in force here. Turn on Use skin to give a skin its own banner widget shape; the app and per-widget picks below still work.</Note>}
      <h4>Per widget</h4>
      <div className={`${P}__shape-rows fx-stack`} role="list" aria-label="Banner widget shapes">
        {widgets.map((w) => {
          const r = rt.resolveShape(w.key);
          const key = shapeScopeKey('instance', w.key);
          const mine = rt.shapeAtKey(key);
          return (
            <div key={w.key} role="listitem" className="fx-row fx-row--wrap" data-axf-target={`row:theme-manager.shapes.${w.key.replace(/[^a-z0-9-]+/gi, '-')}`}>
              <strong>{w.label}</strong>
              <span className="fx-muted fx-small">{shapeSourceText(r.level, r.id)}</span>
              <span className="fx-grow" />
              <SelectField label={`Shape of ${w.label}`} value={mine} empty="Inherit" options={shapes.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => rt.setShape('instance', v, w.key)} />
              <Button size="sm" tone="ghost" icon="undo" disabled={!(key in history)} onClick={() => rt.restoreShape('instance', w.key)}>Restore previous edit</Button>
            </div>
          );
        })}
        {!widgets.length && <p className="fx-muted">No banner widgets on this app right now.</p>}
      </div>
    </section>
  );
}
