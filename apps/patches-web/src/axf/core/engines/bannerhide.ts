/*
 * Banner hide state (Brett, Oct 23 2026): "every plugin with a banner carries in its settings interface a hide switch
 * which hides the banner but continues to log its activity. Under the hide switch is another switch, offset to the
 * right, to hide all banners, with a tooltip that lists all installed banners that will be hidden. … switching it in any
 * interface just overrides the last. … another setting that appears in every banner's settings interface: a timer. A
 * checkbox enables a text field with two characters for digits only that represents minutes" (the hide lasts that many
 * minutes, then the banner shows again).
 *
 * One state for every interface (Settings → Plugins → Banners, the right-click Banner settings, a host's Banners tab):
 *   banners  { <banner id>: { on, at } }   hidden or not, and when that was last switched (ms)
 *   timer    { on, minutes }                one timer for every hide: a hide lasts `minutes` after it was switched
 * A hide may carry its own end (`until`, ms): the banner's right-click menu hides it for 1, 5 or 10 minutes (Brett,
 * Oct 23 2026); such a hide ignores the shared timer. Any other switch clears it.
 * Hide all is not stored on its own: it is on while every banner is hidden, and switching it switches every banner, so
 * whichever switch was touched last wins. Pure (no DOM, no storage); BannerSettings.tsx keeps it in one setting.
 * Android twin deferred (spec/PORTING.md).
 */

export const BANNER_HIDE_KEY = 'axf.banners.hide';
export const TIMER_MIN = 1;
export const TIMER_MAX = 99;
export const TIMER_DEFAULT = 15;

export interface BannerHideEntry { on: boolean; at: number; until?: number }
export interface BannerHideState { banners: Record<string, BannerHideEntry>; timer: { on: boolean; minutes: number } }

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EMPTY: BannerHideState = { banners: {}, timer: { on: false, minutes: TIMER_DEFAULT } };

const clampMinutes = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(TIMER_MAX, Math.max(TIMER_MIN, Math.round(v))) : TIMER_DEFAULT;

/** The saved value, every field checked (anything odd = not hidden / timer off). */
export function parseBannerHide(raw: unknown): BannerHideState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { banners: {}, timer: { ...EMPTY.timer } };
  const o = raw as Record<string, unknown>;
  const banners: Record<string, BannerHideEntry> = {};
  const b = o.banners;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    for (const [id, v] of Object.entries(b as Record<string, unknown>)) {
      if (!ID.test(id) || !v || typeof v !== 'object') continue;
      const e = v as Record<string, unknown>;
      const entry: BannerHideEntry = { on: e.on === true, at: typeof e.at === 'number' && Number.isFinite(e.at) && e.at >= 0 ? e.at : 0 };
      if (typeof e.until === 'number' && Number.isFinite(e.until) && e.until >= 0) entry.until = e.until;
      banners[id] = entry;
    }
  }
  const t = o.timer && typeof o.timer === 'object' && !Array.isArray(o.timer) ? (o.timer as Record<string, unknown>) : {};
  return { banners, timer: { on: t.on === true, minutes: clampMinutes(t.minutes) } };
}

/** When a banner's hide ends (ms), Infinity without the timer, null when it isn't hidden. */
export function hideEndsAt(s: BannerHideState, id: string): number | null {
  const e = s.banners[id];
  if (!e?.on) return null;
  if (e.until !== undefined) return e.until;
  return s.timer.on ? e.at + s.timer.minutes * 60_000 : Infinity;
}

/** Is this banner hidden right now? */
export function bannerHidden(s: BannerHideState, id: string, now: number): boolean {
  const end = hideEndsAt(s, id);
  return end !== null && now < end;
}

/** Hide all is on while every one of these banners is hidden (none = off). */
export function allBannersHidden(s: BannerHideState, ids: readonly string[], now: number): boolean {
  return ids.length > 0 && ids.every((id) => bannerHidden(s, id, now));
}

/** The next time any of these banners comes back by itself (ms), or null. */
export function nextHideEnd(s: BannerHideState, ids: readonly string[], now: number): number | null {
  let next: number | null = null;
  for (const id of ids) {
    const end = hideEndsAt(s, id);
    if (end !== null && end !== Infinity && end > now && (next === null || end < next)) next = end;
  }
  return next;
}

/** Hide or show one banner (the last switch touched wins). */
export function setBannerHidden(s: BannerHideState, id: string, on: boolean, now: number): BannerHideState {
  if (!ID.test(id)) return s;
  return { ...s, banners: { ...s.banners, [id]: { on, at: now } } };
}

/** The quick hides on a banner's right-click menu (minutes). */
export const QUICK_HIDE_MINUTES = [1, 5, 10] as const;

/** Hide one banner for this many minutes (1–99), whatever the shared timer says. */
export function hideBannerFor(s: BannerHideState, id: string, minutes: number, now: number): BannerHideState {
  if (!ID.test(id)) return s;
  return { ...s, banners: { ...s.banners, [id]: { on: true, at: now, until: now + clampMinutes(minutes) * 60_000 } } };
}

/** Hide all / show all: every one of these banners, at once. */
export function setAllBannersHidden(s: BannerHideState, ids: readonly string[], on: boolean, now: number): BannerHideState {
  const banners = { ...s.banners };
  for (const id of ids) if (ID.test(id)) banners[id] = { on, at: now };
  return { ...s, banners };
}

/**
 * The timer: on/off and its minutes. Switching it on (or changing the minutes) starts the time again for banners that
 * are hidden now, so an old hide doesn't end the moment the timer is set.
 */
export function setBannerTimer(s: BannerHideState, patch: { on?: boolean; minutes?: number }, now: number): BannerHideState {
  const timer = { on: patch.on ?? s.timer.on, minutes: patch.minutes === undefined ? s.timer.minutes : clampMinutes(patch.minutes) };
  const banners: Record<string, BannerHideEntry> = {};
  for (const [id, e] of Object.entries(s.banners)) {
    const hiddenNow = bannerHidden(s, id, now);
    banners[id] = hiddenNow && e.until !== undefined ? e : hiddenNow && timer.on ? { on: true, at: now } : hiddenNow ? e : { on: false, at: e.at };
  }
  return { banners, timer };
}

/** What the minutes field keeps of what was typed: digits only, at most two. */
export function minutesInput(text: string): string {
  return text.replace(/\D+/g, '').slice(0, 2);
}

/** The minutes a field's text stands for (empty / 0 = null: keep the old value). */
export function minutesFrom(text: string): number | null {
  const n = Number(minutesInput(text));
  return n >= TIMER_MIN ? Math.min(TIMER_MAX, n) : null;
}
