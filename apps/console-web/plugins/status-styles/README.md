# Status styles

Animations and styling for every status, on builds and on every step (Brett, Nov 21 2026). Settings → Plugins →
Status styles.

- **A style per status.** Each status has a row style, a badge style and an "animated badge" switch. Moving statuses
  (Building, Sending, Running CI, Rolling back…) animate; resting ones (Landed, Failed, Pending…) carry a still look.
- **Whole row or text only.** A preset animates the row (blink, pulse, fade sweep left to right, shimmer, fill,
  stripes, glow, edge bar, flash, heartbeat, shake, bob) or only the row's text (blink, colour pulse, glow, flash,
  underline).
- **A library and your own presets.** 66 presets ship in `assets/status-style/library.json`; the maker saves your own
  beside the saved styles in the plugin's data folder.
- **Every status.** Pipeline 2.0 builds and steps, the statuses coming with the pipeline repair (Scoring risk, Fast
  merge, Post-merge CI, Rolling back, Rolled back), Plan Studio's, and any id you add yourself.

## How it works

Display only. The plugin never reads a build and never decides a status.

1. A page that shows a status marks it: `data-status="<id>"` on the badge (the id the VPS sent). A row is any grid row
   (`data-axf-row`), tappable row (`data-fx-row`), `tr`, `li`, tree or list item, or an element marked
   `data-status-row`.
2. `web/core.ts` turns the status → style map into one stylesheet: the innermost row around a mark takes the row
   preset (`:has()`), the mark itself takes the badge preset.
3. A preset holds picks only (effect, colour token, speed, strength, still look). Every colour, size and duration in
   the stylesheet is a theme token, so it follows every skin and the skin's animation speed. Nothing free-form reaches
   the stylesheet: the server and the web part both check every value against the lists in the library asset.
4. Reduced motion (the system setting or the skin's) stops every animation; a moving row keeps a soft still tint so
   the status still reads.

## Badge packs

Two hooks, so a badge pack needs no code from this plugin:

- The document root carries `data-status-animated="building sending …"`: the statuses whose badge moves right now.
- Inside a `data-status` mark, an element marked `data-badge-animated` is shown only while that status is animated
  (and motion is allowed), and one marked `data-badge-static` otherwise. A pack renders both pictures and the right
  one shows.

## Files

| File | What |
|---|---|
| `assets/status-style/library.json` | the built-in presets and the allowed picks (status-style-library@1) |
| `assets/status-style/default.json` | the shipped style of every known status (status-styles@1) |
| `gen-assets.mjs` | writes both from its tables (`--check` fails when they are stale) |
| `web/core.ts` | pure: clean a preset, lay saved changes over the defaults, build the CSS |
| `web/index.tsx` | the stylesheet in the page and the settings tab |
| `server/__init__.py` | `GET/PUT /config`, `GET/POST /presets`, `DELETE /presets/{id}` (data folder only) |

Tests: `npx -y tsx apps/console-web/plugins/status-styles/test.mts` and
`python3 apps/console-web/plugins/status-styles/test.py`.
