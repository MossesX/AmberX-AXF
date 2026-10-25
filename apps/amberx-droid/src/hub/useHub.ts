/**
 * The hub this build belongs to, plus the app's names for the lib-hub hooks.
 *
 * The address comes from the app manifest's `developer.hub` (the same value the look is read from), so there is one hub
 * per build and nothing to type in. The rules, the feeds and the hooks themselves live in lib-hub
 * (`framework/libs/hub`, harvested from this app Oct 23 2026).
 */
import { HUB_DEFAULT, normalizeHub } from '../axf/libs/hub';
import { useHubApprovals, useHubApps } from '../axf/libs/hub/react';
import manifest from '../../axf.manifest.json';

/** The hub this build belongs to. */
export const HUB: string = normalizeHub((manifest as { developer?: { hub?: string } }).developer?.hub) ?? HUB_DEFAULT;

/** The approvals feed, polled while the page is visible. One watcher for the whole app. */
export const useApprovals = () => useHubApprovals(HUB);

/** The app catalog, read when the view opens and on "Check the hub now". */
export const useApps = () => useHubApps(HUB);
