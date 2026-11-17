# Build report: land-per-instance-settings-picker

Brett (Nov 13 2026, verbatim): "I definitely need that; every tab group, application menu, navigation menu, toolbar
can have its own settings interface that changes only it, and they all have transparency"

Phase 1 (Opus), Nov 17 2026. Branch `claude/land-per-instance-settings-picker`.

## s1: the clash

The clash this build was queued for is gone. `claude/per-instance-settings-window-picker` already landed on main
(PR #622, then #642 merged main into it and landed, then #650 fixed the fixture). That branch no longer exists on
origin. On main the framework `Overlays.tsx` and the console's baked copy are identical, and both keep each side's
changes (context-menu chrome data plus the implicit-target instance slugs).

What was still wrong: the console's baked framework copy was behind the framework in 55 files (older theme, runtime,
settings and `axf.css` states) and showed as "edited" against `axf.lock.json`. Each of those files was checked
against the framework's git history. None held anything that exists only in the console copy; the framework has the
newer version of every one. `rebake.mjs apply apps/console-web --force` brought the copy up to date and rewrote the
lock, so `rebake status` now reads `current`. The branch was also brought up to date with origin/main (only build
tracking files had changed there).

## s2: own transparency on every instance

Before this build, each instance already had its own settings interface (#622), and tab rows had their own
`opacity` token. Toolbars, the menu bar, nav, banners and context menus only had the theme-wide surface opacity.

- `framework/core/engines/chrome-settings-rules.mjs`: an instance-only `transparency` field in all six kinds' dialogs
  (Look tab, level simple). Values: `inherit` (Same as all), or `100` … `0` in steps of 10.
  `parseTransparency` takes 0.6, "60%", 60, opaque, half, glass, clear or default.
  `chromeTransparencyVars(type, override)` sets the kind's opacity token, plus backdrop blur when below opaque:
  - tab row: `--fx-tab-opacity`
  - toolbar and menu bar: `--fx-opacity-toolbar`
  - nav: `--fx-nav-opacity` (new; the nav region now reads it)
  - banner: `--fx-opacity-banner`
  - context menu: `--fx-opacity-menu`
- `framework/react/chromeTransparency.ts` (installed by `AxfProvider`) writes those tokens inline on that one
  instance's element, plus the box that paints it (the nav region, the context-menu panel). Each element is matched to
  the same instance id its context menu opens (`chromeSurfaceOf`, split out of `tapSurfaceOf`). The host re-applies
  when settings change and when chrome mounts, so hand-drawn strips are covered too. `inherit` removes the tokens.
- `TabGroup.tsx` also puts the field into its own style. When both are set, the field wins over the row's opacity
  token.

### API (all four paths reach the same setting `axf.chrome.<type>.<instance>` → `transparency`)

- Deep link / UI: right-click or long-press any tab group, toolbar, nav, menu bar, banner or context menu →
  Settings… → Look → Transparency (`chrome.settings:<type>:<instance>`).
- Console REST `/api/console-control` and MCP `console_control_*` / console actions:
  `chrome.transparency:<type>:<instance>:<value>` or `chrome.set:<type>:<instance>:transparency:<value>`; reset with
  `chrome.unset:<type>:<instance>:transparency`.
- CLI: `axf console …` with the same actions. control@1 settings for the key above.
- Voice (AmberX): the same actions through the console command grammar. Words like "half", "glass", "opaque" and
  "clear" parse.
- State: the setting itself, and `data-axf-own-transparency` on the element names the tokens it carries.

## Tests

All passed on this branch:

- `check-chrome-apply.mts`: 330 checks. Transparency per kind, every value distinct, no leak between instances, root
  style untouched.
- `check-chrome-transparency.mts` (new, jsdom, added to CI): 15 checks.
- `check-chrome-settings.mts`: 316 checks.
- `check-tapconfirm.mts`: 80 checks.
- `tsc -p framework/libs` (core + react + libs): clean.
- Also passing: `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `check-console-control`
  (after regenerating `inventory.json`), `chrome-settings check`, `shared-assets check`, `help-coverage`,
  notify-control.

Not run: the console vite build and `theme-swap.mjs` (Playwright). CI runs them.

## Gaps

- Android twin deferred (recorded in `framework/spec/PORTING.md`).
- Dialogs: floating settings / tool windows already have their own Background transparency per window (windows.ts).
  The six chrome kinds are what this build adds.
- Other baked apps (amberx-droid, axhub-web, molly, demo, walkthrough-studio) are still stale. Out of scope here; they
  get the host on their next re-bake.
