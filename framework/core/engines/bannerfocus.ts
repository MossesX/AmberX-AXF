/*
 * Banner focus (Nov 12 2026): the Banners page brings one banner or badge forward when asked (`banners.focus:<what>`,
 * console_show / console_open focus, the CLI, voice, `?axf-banner=<what>`). This turns what was asked for into the
 * banner or badge it names.
 *
 *   "banner:<id or label>"           only banners (the strips under the bar: build status, systems check ...)
 *   "badge:<key, id or label>"       only badges (the widgets on the banner bar: alerts bell, Claude badge, clock ...)
 *   "widget:<...>"                   same as badge:
 *   anything else                    an exact banner (id, its settings tab, its label), then an exact badge, then the
 *                                    first banner whose label or id contains the words, then the first such badge
 *
 * Pure: no DOM, no runtime. The React side (react/components/BannerSettings.tsx) opens the tab, scrolls, expands and
 * flashes what this returns.
 */
import { findBannerWidget, type BannerWidgetQueryable } from './bannerwidgets';

export interface BannerFocusBanner { id: string; label?: string; settingsTab?: string }
export type BannerFocusHit = { kind: 'banner'; id: string } | { kind: 'badge'; key: string };

/** Search query → the words a person or a caller would say ("The Build-status banner" → "build status"). */
export function normBannerQuery(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the\s+/, '').replace(/\s+(banner|badge|widget)$/, '');
}

/** A banner's label as the pages show it (the same rule as bannerLabel). */
const labelOf = (b: BannerFocusBanner) => b.label ?? b.id.replace(/[-_.]+/g, ' ');

function exactBanner(list: readonly BannerFocusBanner[], raw: string, q: string): BannerFocusBanner | undefined {
  return list.find((b) => b.id === raw || b.settingsTab === raw || normBannerQuery(b.id) === q || normBannerQuery(labelOf(b)) === q || (!!b.settingsTab && normBannerQuery(b.settingsTab) === q));
}

function nearBanner(list: readonly BannerFocusBanner[], q: string): BannerFocusBanner | undefined {
  return list.find((b) => normBannerQuery(labelOf(b)).includes(q) || normBannerQuery(b.id).includes(q));
}

function exactBadge<T extends BannerWidgetQueryable>(list: readonly T[], raw: string, q: string): T | undefined {
  const n = (s: string) => normBannerQuery(s);
  return list.find((w) => w.key === raw || w.id === raw || n(w.id) === q || n(w.label) === q || (w.aliases ?? []).some((a) => n(a) === q));
}

/**
 * What `query` names on the Banners page, or null. `banners` = every banner the app has; `badges` = every widget the
 * banner bar has (runtime.bannerWidgets()).
 */
export function resolveBannerFocus(query: string, banners: readonly BannerFocusBanner[], badges: readonly BannerWidgetQueryable[]): BannerFocusHit | null {
  let raw = String(query ?? '').trim();
  if (!raw || raw.length > 200) return null;
  const m = /^(banner|badge|widget)s?\s*:\s*(.+)$/i.exec(raw);
  const only = m ? (m[1]!.toLowerCase() === 'banner' ? 'banner' : 'badge') : '';
  if (m) raw = m[2]!.trim();
  const q = normBannerQuery(raw);
  if (!q) return null;
  const asBanner = (b: BannerFocusBanner | undefined | null): BannerFocusHit | null => (b ? { kind: 'banner', id: b.id } : null);
  const asBadge = (w: BannerWidgetQueryable | undefined | null): BannerFocusHit | null => (w ? { kind: 'badge', key: w.key } : null);
  if (only === 'banner') return asBanner(exactBanner(banners, raw, q) ?? nearBanner(banners, q));
  if (only === 'badge') return asBadge(exactBadge(badges, raw, q) ?? findBannerWidget(badges, q));
  return asBanner(exactBanner(banners, raw, q)) ?? asBadge(exactBadge(badges, raw, q)) ?? asBanner(nearBanner(banners, q)) ?? asBadge(findBannerWidget(badges, q));
}
