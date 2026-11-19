/**
 * `@console/watchLive` for AmberX. Watch live previews (the screens a headless session is changing) are listed by the
 * Dev Console's own API with the console token, which AmberX doesn't hold, so a console plugin running here shows no
 * preview link. Same props as the console's `WatchLiveFor`, so the plugin code stays the same in both apps.
 */
export function WatchLiveFor(_props: { text?: string; className?: string } & Record<string, unknown>) {
  return null;
}
