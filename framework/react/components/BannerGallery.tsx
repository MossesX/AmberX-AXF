/*
 * Banner gallery (Brett, Nov 3 2026: "Build me a shitload of new banners … I want some boilerplates"): every banner
 * asset the app ships (the boilerplate pack in framework/assets/banner, tag `boilerplate`, plus any other banner) as a
 * card with a live preview drawn by the same engine and widgets as the real banner. Pick one = `rt.swap('banner', id)`,
 * which goes to the axHub appearance document, so every app follows. Then "Edit this banner" hands over to the banner
 * editor: a library that ships one registers it with `registerBannerEditor`; until then it starts Arrange widgets on
 * the banner (drag, snap). Filters by category (the asset's tags) and previews at desktop or phone (412 px) width.
 * Shown in Settings → Appearance, the `axf.banners.gallery` dialog and the banner's right-click menu. Theme tokens only.
 */
import { useMemo, useState } from 'react';
import type { AxfRuntime } from '../../core';
import { BANNER_SIDES, bannerSurface, bannerVars, placeAttachments } from '../../core/engines/banner';
import type { BadgeData, BannerData } from '../../core/types';
import { useAxfState, useRuntime } from '../AxfProvider';
import type { DialogMap } from './Overlays';
import { BannerBadge } from './Banner';
import { Button, Chip, Segmented } from './Controls';
import { Icon } from './Icon';
import { widgetRenderer } from './Widgets';

export const BANNER_GALLERY_DIALOG = 'axf.banners.gallery';
export const BANNER_GALLERY_ACTION = 'banners.gallery';
export const BANNER_EDIT_ACTION = 'banners.edit';
/** Tags every banner carries that say nothing about its category. */
const PLAIN_TAGS = new Set(['banner', 'boilerplate']);
const CATEGORY_LABEL: Record<string, string> = {
  essentials: 'Essentials', developer: 'Developer', ops: 'Ops', voice: 'Voice', phone: 'Phone', dashboard: 'Dashboard',
  notifications: 'Notifications', search: 'Search', presenter: 'Presenter', focus: 'Focus', brand: 'Brand',
};
const categoryLabel = (t: string) => CATEGORY_LABEL[t] ?? t.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/* ---------------- the banner editor hook ---------------- */

let editor: ((rt: AxfRuntime, bannerId: string) => void) | null = null;
/** The banner editor (its own build) registers here; "Edit this banner" then opens it on the picked banner. */
export function registerBannerEditor(open: (rt: AxfRuntime, bannerId: string) => void): () => void {
  editor = open;
  return () => { if (editor === open) editor = null; };
}
/** Opens the banner editor on a banner (Arrange widgets on the live banner until an editor is registered). */
export function editBanner(rt: AxfRuntime, bannerId: string): void {
  if (editor) { editor(rt, bannerId); return; }
  rt.dispatch('widgets.arrange');
}

/** The gallery's actions and the banner's right-click entry (installed once per runtime by the settings library). */
export function installBannerGallery(rt: AxfRuntime): void {
  rt.actions.register(BANNER_GALLERY_ACTION, () => rt.openDialog(BANNER_GALLERY_DIALOG), { label: 'Banner boilerplates: pick a banner' });
  rt.actions.register(BANNER_EDIT_ACTION, ([id]) => editBanner(rt, id || rt.getState().active.banner || ''), { label: 'Edit the banner', params: true });
  rt.addContextItems({ id: 'axf.banners.gallery.ctx', module: 'axf', target: 'banner', order: 5, items: [
    { id: 'axf-banner-gallery', label: 'Banner boilerplates…', icon: 'grid', action: BANNER_GALLERY_ACTION },
    { id: 'axf-banner-edit', label: 'Edit banner', icon: 'edit', action: BANNER_EDIT_ACTION },
  ] });
}

/* ---------------- one banner, drawn from its asset ---------------- */

/** A banner asset drawn as the real banner would draw it (same engine, same widgets), without taps or shortcuts. */
export function BannerPreview({ data }: { data: BannerData }) {
  const rt = useRuntime();
  useAxfState();
  const placed = placeAttachments(data, [], (t, i) => rt.registry.has(t as never, i));
  return (
    <div className="fx-banner-gallery__frame" aria-hidden="true" {...{ inert: '' }} style={bannerVars(data)}>
      <div className={`fx-banner is-${bannerSurface(data)}${data.divider === false ? '' : ' has-divider'}`}>
        {BANNER_SIDES.map((side) => (
          <div key={side} className={`fx-banner__side is-${side}`}>
            {side === 'left' && data.logo?.show !== false && (
              <span className="fx-banner__logo">
                <span className="fx-brand__mark" aria-hidden="true" />
                {data.logo?.text && <span className="fx-banner__name">{data.logo.text}</span>}
              </span>
            )}
            {placed[side].map((a) => <span key={a.key} className="fx-banner__item"><PreviewWidget type={a.type} id={a.id} /></span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewWidget({ type, id }: { type: string; id: string }) {
  const rt = useRuntime();
  const a = rt.registry.get(type as never, id) as { data: unknown } | undefined;
  if (!a) return null;
  if (type === 'badge') return <BannerBadge data={a.data as BadgeData} />;
  const R = widgetRenderer(type);
  if (!R) return null;
  // a preview's search bar never takes Ctrl/Cmd+K or / from the real one
  const data = type === 'search-bar' ? { ...(a.data as object), shortcut: false } : a.data;
  return <R data={data} id={id} host="banner" />;
}

/* ---------------- the gallery ---------------- */

type Width = 'desktop' | 'phone';

/** Every banner as a card with a live preview; pick one to apply it everywhere (axHub), then edit it. */
export function BannerGallery() {
  const rt = useRuntime();
  const st = useAxfState();
  const banners = rt.registry.list('banner');
  const active = st.active.banner ?? '';
  const locked = !rt.can('assets.swap') || rt.lockedByAppearance('assets.swap');
  const [cat, setCat] = useState('all');
  const [width, setWidth] = useState<Width>('desktop');
  const cats = useMemo(() => {
    const seen = new Set<string>();
    for (const b of banners) for (const t of b.tags ?? []) if (!PLAIN_TAGS.has(t)) seen.add(t);
    return [...seen].sort((x, y) => categoryLabel(x).localeCompare(categoryLabel(y)));
  }, [banners.length]);
  const shown = banners.filter((b) => cat === 'all' || (b.tags ?? []).includes(cat));
  return (
    <div className="fx-banner-gallery fx-stack" data-axf-banner-gallery="">
      <div className="fx-row fx-row--wrap fx-banner-gallery__bar">
        <Segmented size="sm" label="Category" value={cat} onChange={setCat}
          options={[{ value: 'all', label: `All (${banners.length})` }, ...cats.map((c) => ({ value: c, label: categoryLabel(c) }))]} />
        <span className="fx-grow" />
        <Segmented size="sm" label="Preview width" value={width} onChange={setWidth}
          options={[{ value: 'desktop', label: 'Desktop', icon: 'monitor' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]} />
      </div>
      <p className="fx-muted fx-small fx-banner-gallery__hint">
        Pick a banner to use it in every app (it is saved on axHub), then edit it to move, add or remove widgets.
      </p>
      <div className={`fx-banner-gallery__grid is-${width}`}>
        {shown.map((b) => {
          const on = b.id === active;
          const tags = (b.tags ?? []).filter((t) => !PLAIN_TAGS.has(t));
          return (
            <article key={b.id} className={`fx-banner-gallery__card${on ? ' is-on' : ''}`} data-axf-banner-option={b.id}>
              <BannerPreview data={b.data} />
              <div className="fx-banner-gallery__info">
                <div className="fx-row fx-banner-gallery__title">
                  <strong>{b.name}</strong>
                  {on && <Chip tone="accent"><Icon name="check" size={11} /> In use</Chip>}
                  <span className="fx-grow" />
                  {tags.slice(0, 2).map((t) => <Chip key={t}>{categoryLabel(t)}</Chip>)}
                </div>
                <p className="fx-muted fx-small fx-banner-gallery__desc">{b.description}</p>
                <div className="fx-row fx-row--wrap">
                  <Button size="sm" tone={on ? 'quiet' : 'primary'} icon={on ? 'check' : 'download'} disabled={locked || on} onClick={() => rt.swap('banner', b.id)}>
                    {on ? 'In use' : 'Use this banner'}
                  </Button>
                  <Button size="sm" tone="ghost" icon="edit" disabled={locked} onClick={() => { if (!on) rt.swap('banner', b.id); editBanner(rt, b.id); }}>Edit</Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export const bannerGalleryDialog: DialogMap = {
  [BANNER_GALLERY_DIALOG]: { title: 'Banner boilerplates', icon: 'grid', searchable: true, render: () => <BannerGallery /> },
};
