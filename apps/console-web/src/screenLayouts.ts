/**
 * Screen layouts of the console's plugins (screen-layouts@1; framework/core/engines/screen-layouts.mjs), read from the
 * bundled plugin.json manifests so UI Review can offer them without loading a plugin's code.
 *
 * Brett, Nov 4 2026: "So UI Review will only allow you to select from the three layouts it is going to generate." The
 * review item's Layout dropdown lists ONLY the screen's declared layouts (the default marked); a screen without them
 * (an older, grandfathered plugin) gets a disabled dropdown saying "no layout variants". Colour / style stay as they are.
 *
 *   const choice = reviewLayoutChoicesFor('ui-review');   // { options, disabled, reason, default }
 *   <SelectField label="Layout" disabled={choice.disabled} options={choice.options} … />
 *
 * Server side (a screenshot run, the CLI): `node framework/cli/screen-layouts.mjs review --app apps/console-web --screen <view>`.
 */
import { reviewLayoutChoices, screensOfManifests, type ReviewLayoutChoices, type ScreenSpec } from './axf/core/engines/screen-layouts.mjs';
import { bundledPlugins } from './plugins';

/** Every console plugin screen with declared layouts: view → { layouts, default, plugin }. */
export function consoleScreens(): Record<string, ScreenSpec & { plugin: string }> {
  return screensOfManifests(bundledPlugins.map((p) => p.manifest));
}

/** What the UI Review item's Layout dropdown may offer for a screen (view id / route). */
export function reviewLayoutChoicesFor(screen: string): ReviewLayoutChoices {
  return reviewLayoutChoices(consoleScreens(), screen.replace(/^\/+/, ''));
}
