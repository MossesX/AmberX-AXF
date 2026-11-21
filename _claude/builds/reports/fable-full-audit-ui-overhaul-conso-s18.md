# fable-full-audit-ui-overhaul-conso s18: the finished look saved as the AmberX skin

## What landed

- `framework/assets/skin/amberx-house.json`: a skin@1 asset named **AmberX** (id `amberx-house`). It is the look the
  console has in force at the end of this build: AmberX Signature (layout `signature-dock`, style `geometric`,
  behaviour `amber`, style package `amber-signature`, toolbar `amberx-signature`), colour themes `saffron-day` (light)
  and `carbon-amber` (dark, the s12 contrast-checked pair), plus the console's chrome and controls (banner
  `amberx-branded`, button `rounded-solid`, container `soft-card`, context menu `compact-classic`, dialog
  `centered-modal`, popup `corner-solid`, tab group `underline`, nav style `accordion`, compact typography, density and
  sizing, tight spacing, icon pack `amberx-outline`).
- Baked into the shared set of console-web, axhub-web and molly (`shared-assets.mjs bake --all`; check passes).
- PORTING.md: the Android asset copy is a deferred gap (no new Android work).

## Choices made

- **Id `amberx-house`, not `amberx`.** A skin and a design package share one picker list and a skin id shadows a
  package with the same id (`skinEntries`). `amberx` is already the AmberX design package (Arctic Daylight + Glass
  Orbit); taking that id would silently remove it from the picker. The skin's display name is AmberX as asked.
- **No nav menu in the skin.** The console's side navigation (`console-nav`, rebuilt in s9) is a console-owned asset.
  A framework skin that named it would leave every other app with an unknown nav id. s12 dropped `nav-menu` from the
  AmberX Signature packages for the same reason, so each app keeps its own menu and the console keeps `console-nav`.
- **"Default skin" means the console's skin.** The console's look uses AmberX, and its Default skin (what Restore to
  default returns to) is saved from that look. I did not set the hub-wide default skin (`defaultSkin` on the shared
  appearance document). That pointer is the floor for every app with Use skin off, so setting it would also re-skin
  axHub and Molly. That is outside a console build. If you want it, it is one more line, shown below.

## Not done yet: the live switch waits for the deploy

Each app ships its skins in its own bundle (`src/axf/assets`). The live console does not have `amberx-house` until
this PR is merged and deployed. If the look document pointed at it before then, the console would draw its bare saved
look until the deploy. So the live data has not been touched. Once the build is deployed, run:

```
node framework/cli/skins.mjs use console amberx-house          # the console's skin in force (keeps one undo)
node framework/cli/skins.mjs config default console            # save that look as the console's Default skin
# optional, every app (changes axHub and Molly too):
# set "defaultSkin": {"id": "amberx-house"} on the shared appearance document
```

`node framework/cli/skins.mjs at console` should then show `amberx-house` from `app`.

## Checks run

check-skin-modes, check-skin-coverage, check-skin-sections, check-skin-colour-rule, check-skin.mts (all four
suites), check-chrome-assets and `shared-assets.mjs check --all` all pass.
