/**
 * Banner engine — the thin permanent bar across the top of the screen (asset type `banner`) and the assets it holds.
 *
 * A banner shows the app logo and hosts *attachments*: assets of the attachable types (`badge`, `clock`) placed on its
 * left, center or right. They come from the banner asset's own `attach` list and from modules at run time
 * (`rt.attachToBanner`, e.g. a plugin's status badge); a run-time attachment with the same type + id replaces the asset's
 * own. Unknown types, bad sides and assets that don't exist are skipped, so a banner never breaks on a missing piece.
 *
 * Pure functions, mirrored by the Kotlin kernel (engine/BannerEngine.kt); fixtures in spec/fixtures/banner.json.
 */
import type { BadgeData, BannerData, BannerSide, ClockData } from '../types';
import type { VarMap } from './theme';

/** Types a banner can hold (asset-types.json → banner.attach.types). */
export const ATTACHABLE_TYPES = ['badge', 'clock'] as const;
export const BANNER_SIDES: readonly BannerSide[] = ['left', 'center', 'right'];
export const BANNER_HEIGHT = { min: 16, max: 48, thin: 24 } as const;

export interface BannerAttachment {
  type: string;
  id: string;
  at: BannerSide;
  /** Lower comes first on its side. Asset entries default to their index × 10. */
  order?: number;
  /** Who attached it: `asset` for the banner's own list, else the module / plugin id. */
  origin?: string;
}
export interface PlacedAttachment { key: string; type: string; id: string; at: BannerSide; order: number; origin: string }
export type PlacedBanner = Record<BannerSide, PlacedAttachment[]>;

export const attachmentKey = (type: string, id: string) => `${type}:${id}`;

const clampHeight = (h: unknown) => {
  const n = typeof h === 'number' && Number.isFinite(h) ? Math.round(h) : BANNER_HEIGHT.thin;
  return Math.min(BANNER_HEIGHT.max, Math.max(BANNER_HEIGHT.min, n));
};

/** CSS variables for the banner (height; 0px when there's no banner or it's hidden). */
export function bannerVars(b: BannerData | null | undefined, hidden = false): VarMap {
  return { '--fx-banner-h': b && !hidden ? `${clampHeight(b.height)}px` : '0px' };
}

/** Where every attachment goes. `has(type, id)` says whether that asset exists. */
export function placeAttachments(b: BannerData | null | undefined, extra: BannerAttachment[], has: (type: string, id: string) => boolean): PlacedBanner {
  const byKey = new Map<string, PlacedAttachment>();
  const add = (a: BannerAttachment, fallbackOrder: number, origin: string) => {
    if (!a || typeof a.type !== 'string' || typeof a.id !== 'string') return;
    if (!(ATTACHABLE_TYPES as readonly string[]).includes(a.type)) return;
    if (!(BANNER_SIDES as readonly string[]).includes(a.at)) return;
    if (!has(a.type, a.id)) return;
    const key = attachmentKey(a.type, a.id);
    const order = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : fallbackOrder;
    byKey.set(key, { key, type: a.type, id: a.id, at: a.at, order, origin: a.origin ?? origin });
  };
  (Array.isArray(b?.attach) ? b!.attach : []).forEach((a, i) => add(a, i * 10, 'asset'));
  extra.forEach((a, i) => add(a, 1000 + i * 10, 'runtime'));
  const out: PlacedBanner = { left: [], center: [], right: [] };
  for (const p of byKey.values()) out[p.at].push(p);
  for (const side of BANNER_SIDES) out[side].sort((x, y) => x.order - y.order || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return out;
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
