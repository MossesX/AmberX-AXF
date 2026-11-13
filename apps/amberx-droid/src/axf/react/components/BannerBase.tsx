/*
 * The base every banner is built on (Brett, Nov 2026: "All banners hide when empty"). A banner hands it its entries (a
 * list or a count); with none it draws nothing at all, so the banner takes no space, and it draws again the moment an
 * entry arrives (it re-renders with its data, nothing is cached). The frame around every banner (BannerSettings.tsx →
 * BannerFrame) backs this up for banners that draw an empty shell: it hides itself while what it holds is empty
 * (react/bannerEmpty.ts has the rule).
 *
 *   <BannerBase entries={rows}>{() => <MyBannerRows rows={rows} />}</BannerBase>
 */
import type { ReactNode } from 'react';
import { bannerEntryCount } from '../bannerEmpty';

export interface BannerBaseProps {
  /** What the banner shows: a list or a count. Empty, 0, null or false = the banner is not drawn. */
  entries: number | readonly unknown[] | null | undefined | false;
  /** The banner's content; a function is only called while there are entries. */
  children: ReactNode | (() => ReactNode);
}

export function BannerBase({ entries, children }: BannerBaseProps) {
  if (!bannerEntryCount(entries)) return null;
  return <>{typeof children === 'function' ? (children as () => ReactNode)() : children}</>;
}

/** The same rule as a hook-free test, for a banner that returns early: `if (bannerIsEmpty(rows)) return null;`. */
export function bannerIsEmpty(entries: BannerBaseProps['entries']): boolean {
  return bannerEntryCount(entries) === 0;
}
