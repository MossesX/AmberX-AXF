/** Types for deepLink-core.mjs (console deep links, the pure part). */
export declare const DEEP_LINK_PARAMS: readonly ['axf-target', 'axf-open'];
export interface DeepLink {
  address?: string;
  action?: string;
  view?: string;
  sub?: string;
  source: 'hash' | 'target' | 'open';
  raw: string;
  /** the URL without the link (history.replaceState) */
  rest: string;
  error?: string;
}
export interface DeepLinkPlan { view?: string; address?: string; action?: string; error?: string }
export declare function isAddressLike(s: string): boolean;
export declare function parseDeepLink(href: string): DeepLink | null;
export declare function planDeepLink(link: DeepLink | null, opts: { hasAction: (id: string) => boolean; isControlKind: (kind: string) => boolean }): DeepLinkPlan | null;
export interface PendingTargets { push(plan: DeepLinkPlan, label?: string): void; poke(): void; size(): number; stop(): void }
export declare function createPendingTargets(opts: {
  isReady: (view: string | null, plan: DeepLinkPlan) => boolean;
  open: (plan: DeepLinkPlan) => void;
  notice: (message: string) => void;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}): PendingTargets;
