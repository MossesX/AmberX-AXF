/**
 * Banner strip (web only): an app's live banners, shown by a host as ONE banner region (Brett, Nov 3 2026: "Install the
 * banners in Molly").
 *
 * The host frames the app's banner-strip page, an embed@1 view page (`axf-embed-page=view:axf-banners`). That page
 * draws only the app's banners: every `banners` plugin it has (app.frame.banners, the same Banner settings, colours and
 * order as on its own) and the widgets its plugins attach to its banner bar (alerts bell, Claude badge, chips). A
 * banner plugin added to the app shows in the host with no change on the host's side. The host's other frames of the
 * same app keep hiding their own banner (embed@1 `hidden: banner`), so there is one banner on screen.
 *
 * Two message lines:
 *   strip ⇄ host   window.postMessage, envelope `$axf: 'banner-strip@1'` (below): the strip's size and whether something
 *                  it opened (dialog, menu, popover) needs the whole window; a view it was asked to open; its banner list
 *                  (for per-banner show / hide in the host); the host's answers; whether the strip draws the app's
 *                  whole banner bar, so the host's top banner is the app's banner asset (`bar`).
 *   strip → app    BroadcastChannel `axf.banner-strip` (same origin, so the host never sees it): a banner item that opens
 *                  one of the app's views opens it in the app's own frame, the way it does on its own.
 * Nothing here runs standalone; data only, the actions stay inside the app.
 */
import { embedUrlFull } from '../core/engines/embed';

/** The view page a host asks for. */
export const BANNER_STRIP_VIEW = 'axf-banners';
export const BANNER_STRIP_PAGE = `view:${BANNER_STRIP_VIEW}`;
export const BANNER_STRIP_MESSAGE = 'banner-strip@1';
export const BANNER_STRIP_CHANNEL = 'axf.banner-strip';
export const BANNER_STRIP_LIMITS = { banners: 60, id: 80, label: 80, icon: 40, view: 80, px: 100000 } as const;

/** One banner the strip can show, for the host's per-banner switches. */
export interface BannerStripEntry { id: string; label: string; icon?: string; /** hidden inside a host (its Banner settings switch) */ hidden: boolean }

export type BannerStripMessage =
  /** strip → host: how tall the strip is; `overlay` = something it opened needs the whole window until it closes; `bar` =
   * the strip draws the app's whole banner bar (its banner asset, logo and attached widgets) at its top, so the host can
   * leave its own banner out (absent = the older widgets-only strip) */
  | { $axf: typeof BANNER_STRIP_MESSAGE; type: 'size'; height: number; overlay: boolean; bar?: boolean }
  /** strip → host: a banner item opened one of the app's views; bring the app's frame on screen */
  | { $axf: typeof BANNER_STRIP_MESSAGE; type: 'open'; view: string }
  /** strip → host: every banner the app has, and which are hidden inside a host */
  | { $axf: typeof BANNER_STRIP_MESSAGE; type: 'banners'; banners: BannerStripEntry[] }
  /** host → strip: where the strip sits in the host's window while it covers the whole window (so it doesn't jump) */
  | { $axf: typeof BANNER_STRIP_MESSAGE; type: 'inset'; top: number; left: number; width: number }
  /** host → strip: show or hide one banner inside the host (writes the banner's own "Hide it inside a host app") */
  | { $axf: typeof BANNER_STRIP_MESSAGE; type: 'set-hidden'; id: string; hidden: boolean }
  /** host → strip: send the banner list again */
  | { $axf: typeof BANNER_STRIP_MESSAGE; type: 'banners-request' }
  /** host → strip: draw the app's whole banner bar (its banner asset in force) as the host's top banner, or only the
   * widgets its plugins attach (Brett, Nov 4 2026: "Make Molly's top banner asset the same as console") */
  | { $axf: typeof BANNER_STRIP_MESSAGE; type: 'bar'; on: boolean };

/** strip → the app's own frame (BroadcastChannel): open a view; the app answers `ack` so the strip stops resending. */
export type BannerStripChannelMessage =
  | { type: 'navigate'; view: string; /** the settings tab, when the view is the settings page */ tab?: string; n: number }
  | { type: 'ack'; n: number }
  | { type: 'hello' };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const VIEW = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const px = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(Math.round(v), BANNER_STRIP_LIMITS.px)) : null);

/** A message as it arrived, checked; null when it isn't one. */
export function parseBannerStripMessage(raw: unknown): BannerStripMessage | null {
  if (!isObj(raw) || raw.$axf !== BANNER_STRIP_MESSAGE) return null;
  const $axf = BANNER_STRIP_MESSAGE;
  switch (raw.type) {
    case 'size': { const height = px(raw.height); return height === null ? null : { $axf, type: 'size', height, overlay: raw.overlay === true, ...(raw.bar === true ? { bar: true } : {}) }; }
    case 'open': return typeof raw.view === 'string' && VIEW.test(raw.view) ? { $axf, type: 'open', view: raw.view } : null;
    case 'banners': {
      if (!Array.isArray(raw.banners)) return null;
      const banners: BannerStripEntry[] = []; const seen = new Set<string>();
      for (const b of raw.banners) {
        if (banners.length >= BANNER_STRIP_LIMITS.banners || !isObj(b) || typeof b.id !== 'string' || !ID.test(b.id) || seen.has(b.id)) continue;
        seen.add(b.id);
        const e: BannerStripEntry = { id: b.id, label: clip(b.label, BANNER_STRIP_LIMITS.label) || b.id, hidden: b.hidden === true };
        const icon = clip(b.icon, BANNER_STRIP_LIMITS.icon); if (icon) e.icon = icon;
        banners.push(e);
      }
      return { $axf, type: 'banners', banners };
    }
    case 'inset': { const top = px(raw.top), left = px(raw.left), width = px(raw.width); return top === null || left === null || width === null ? null : { $axf, type: 'inset', top, left, width }; }
    case 'set-hidden': return typeof raw.id === 'string' && ID.test(raw.id) ? { $axf, type: 'set-hidden', id: raw.id, hidden: raw.hidden === true } : null;
    case 'banners-request': return { $axf, type: 'banners-request' };
    case 'bar': return { $axf, type: 'bar', on: raw.on === true };
    default: return null;
  }
}

/** A channel message as it arrived, checked; null when it isn't one. */
export function parseBannerStripChannel(raw: unknown): BannerStripChannelMessage | null {
  if (!isObj(raw)) return null;
  const n = typeof raw.n === 'number' && Number.isFinite(raw.n) ? raw.n : null;
  if (raw.type === 'navigate' && typeof raw.view === 'string' && VIEW.test(raw.view) && n !== null) {
    return typeof raw.tab === 'string' && ID.test(raw.tab) ? { type: 'navigate', view: raw.view, tab: raw.tab, n } : { type: 'navigate', view: raw.view, n };
  }
  if (raw.type === 'ack' && n !== null) return { type: 'ack', n };
  if (raw.type === 'hello') return { type: 'hello' };
  return null;
}

/** The address of an app's banner strip, for a host (`host` = the host's embed@1 id). */
export function bannerStripUrl(appUrl: string, host: string): string {
  return embedUrlFull(appUrl, host, { page: BANNER_STRIP_PAGE });
}
