/*
 * Badge shapes (Brett, Nov 13 2026: "Badge shape picker on the Banners screen: pill (text), icon or dot for every badge,
 * like Following AmberX"). Every badge on the top bar (asset type `badge`) can be a pill (icon + text), only its icon or
 * only a coloured dot; a status chip (Following Amber and the like) has no icon, so it is a pill or a dot. "Own" keeps
 * the shape the badge was made with. The pick is a banner widget choice (`shape`, core/engines/bannerwidgets.ts), so it
 * saves and syncs like every other widget choice, and the API / voice reach it through
 * `banner.widget:<widget>:shape-<pill|icon|dot|own>`. Theme tokens only.
 */
import type { BannerWidget } from '../../core/runtime';
import { bannerWidgetShapes, type BannerBadgeShape } from '../../core/engines/bannerwidgets';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Segmented } from './Controls';

const SHAPE_LABEL: Record<BannerBadgeShape | 'own', string> = { own: 'Own', pill: 'Pill', icon: 'Icon', dot: 'Dot' };
const SHAPE_TIP: Record<BannerBadgeShape | 'own', string> = {
  own: 'The shape it was made with',
  pill: 'Pill: its icon and its text',
  icon: 'Only its icon',
  dot: 'Only a coloured dot',
};

/** Does this widget take a shape (badges and status chips)? */
export function hasBadgeShape(w: Pick<BannerWidget, 'type'>): boolean { return bannerWidgetShapes(w.type).length > 0; }

/** The shape picker for one badge: Own · Pill · Icon · Dot (a status: Own · Pill · Dot). */
export function BadgeShapePicker({ w, size }: { w: BannerWidget; size?: 'sm' }) {
  const rt = useRuntime();
  const shapes = bannerWidgetShapes(w.type);
  if (!shapes.length) return null;
  const options = (['own', ...shapes] as const).map((s) => ({ value: s, label: SHAPE_LABEL[s], title: SHAPE_TIP[s] }));
  return (
    <Segmented
      className="fx-badge-shapes__pick" size={size} label={`Shape of ${w.label}`} value={w.view.shape ?? 'own'} options={options}
      disabled={!rt.canArrange()} onChange={(v) => rt.dispatch(`banner.widget:${w.key}:shape-${v}`)}
    />
  );
}

/** Every badge on the top bar with its shape picker (the Banners page). */
export function BadgeShapesList() {
  const rt = useRuntime();
  useAxfState();
  const list = rt.bannerWidgets().filter(hasBadgeShape);
  if (!list.length) return <p className="fx-muted fx-small">No badges on the top bar.</p>;
  return (
    <div className="fx-badge-shapes" data-axf-badge-shapes="">
      {list.map((w) => (
        <div key={w.key} className="fx-badge-shapes__row" data-axf-badge-shape={w.key}>
          <span className="fx-badge-shapes__name">{w.label}{!w.attached && <span className="fx-muted fx-small"> · not on the bar now</span>}</span>
          <BadgeShapePicker w={w} size="sm" />
        </div>
      ))}
    </div>
  );
}
