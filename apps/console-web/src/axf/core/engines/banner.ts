/**
 * Banner engine — the thin permanent bar across the top of the screen (asset type `banner`) and the assets it holds.
 *
 * A banner shows the app logo and hosts *attachments*: assets of the attachable types (`badge`, `clock`) placed on its
 * left, center or right. They come from the banner asset's own `attach` list and from modules at run time
 * (`rt.attachToBanner`, e.g. a plugin's status badge); a run-time attachment with the same type + id replaces the asset's
 * own. Unknown types, bad sides and assets that don't exist are skipped, so a banner never breaks on a missing piece.
 *
 * Placement is the shared widget-host rule (engines/widgets.ts). Pure functions, mirrored by the Kotlin kernel
 * (engine/BannerEngine.kt); fixtures in spec/fixtures/banner.json.
 */
import type { BadgeData, BannerData, BannerSide, ClockData } from '../types';
import type { VarMap } from './theme';
import { WIDGET_TYPES, attachmentKey, placeOnHost, type HostAttachment, type PlacedAttachment } from './widgets';

/** Types a banner can hold (asset-types.json → banner.attach.types): badges and every widget. */
export const ATTACHABLE_TYPES = ['badge', ...WIDGET_TYPES] as const;
export const BANNER_SIDES: readonly BannerSide[] = ['left', 'center', 'right'];
export const BANNER_HEIGHT = { min: 16, max: 48, thin: 24 } as const;

export interface BannerAttachment extends HostAttachment { at: BannerSide }
export type { PlacedAttachment };
export type PlacedBanner = Record<BannerSide, PlacedAttachment[]>;
export { attachmentKey };

const clampHeight = (h: unknown) => {
  const n = typeof h === 'number' && Number.isFinite(h) ? Math.round(h) : BANNER_HEIGHT.thin;
  return Math.min(BANNER_HEIGHT.max, Math.max(BANNER_HEIGHT.min, n));
};

/** CSS variables for the banner (height; 0px when there's no banner or it's hidden). */
export function bannerVars(b: BannerData | null | undefined, hidden = false): VarMap {
  return { '--fx-banner-h': b && !hidden ? `${clampHeight(b.height)}px` : '0px' };
}

/** Where every attachment goes (the banner as a host: badges and widgets, left / center / right). */
export function placeAttachments(b: BannerData | null | undefined, extra: BannerAttachment[], has: (type: string, id: string) => boolean): PlacedBanner {
  return placeOnHost(b?.attach, extra, has, ATTACHABLE_TYPES, BANNER_SIDES) as PlacedBanner;
}

/** The theme token a badge tone paints with (`--fx-<token>`). */
export const BADGE_TONE_TOKEN: Record<BadgeData['tone'], string> = {
  neutral: 'text', success: 'success', warning: 'warning', danger: 'danger', accent: 'accent', muted: 'muted',
};
export function badgeToneToken(b: Pick<BadgeData, 'tone'>): string {
  return BADGE_TONE_TOKEN[b.tone] ?? 'text';
}

/** Clock parts (in the clock's time zone); the UI layer fills them from the platform clock. */
export interface ClockParts { year: number; month: number; day: number; weekday: number; hour: number; minute: number; second: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const two = (n: number) => String(n).padStart(2, '0');

/** "Sun Oct 18 18:20", "6:20:05 PM", … — the same text on every port. weekday 0 = Sunday, month 1-12. */
export function formatClock(c: Pick<ClockData, 'format' | 'seconds' | 'date'>, t: ClockParts): string {
  const sec = c.seconds ? `:${two(t.second)}` : '';
  const time = c.format === '12h'
    ? `${t.hour % 12 === 0 ? 12 : t.hour % 12}:${two(t.minute)}${sec} ${t.hour < 12 ? 'AM' : 'PM'}`
    : `${two(t.hour)}:${two(t.minute)}${sec}`;
  const md = `${MONTHS[(t.month - 1 + 12) % 12]} ${t.day}`;
  const date = c.date === 'short' ? md : c.date === 'weekday' ? `${DAYS[((t.weekday % 7) + 7) % 7]} ${md}` : '';
  return date ? `${date} ${time}` : time;
}
