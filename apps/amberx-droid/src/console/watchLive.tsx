/*
 * `@console/watchLive` inside AmberX: the console's Watch live link reads the console server's /api/previews (headless
 * sessions' live previews), which AmberX doesn't have, so console plugins that show it (the approvals banner) draw
 * nothing here. Same exports as apps/console-web/src/watchLive.tsx.
 */
export interface PreviewMatch { session?: string; branch?: string; change?: string; worktree?: string; text?: string }

export function WatchLiveFor(_props: PreviewMatch & { className?: string }) {
  return null;
}
