# Skin configuration panel: before AI makes a skin, Brett picks what it may change

Built Nov 13 2026. Phase 1 on Fable (contract, engine, Default skin, fixture), phase 2 on Opus (maker, server, API
parity, panel, UI options, tests). Branch `claude/skin-configuration-panel-before-ai-makes-a-skin-brett-picks-what-it-may-change`,
PR #547. UI Review item `r-20261113-46228a31` (three layouts) is waiting.

## What it does
- **skin-config@1** (`framework/core/engines/skin-config-rules.mjs`): a permission tree built from the asset registry,
  category > group > option (1145 options today), each **allow**, **lock** or **ask**, most specific wins. Limits a
  type declares: app menu, nav menu and context menu depth (1 = flat), toolbar group count.
- **Default skin**: each app's current look saved as a protected skin@1 asset `default-<app>` on the hub
  (`shared/settings/skins/<app>.json`); it can't be deleted; Restore to default goes back to it.
- **AI skin maker** (s4): the brief carries only the allowed options (compacted to whole categories or groups) and
  the limits; locked and ask options are never named. The output is shape-checked against skin@1 and held to the
  config: ask is applied as lock, everything outside the allowed set goes back to the Default skin and is listed with
  its reason (`unknown`, `locked`, `ask`, `limit`, `unused`). A made skin is saved as `ai-<app>-<stamp>` and is listed
  with the other skins. The generator is `AXF_SKIN_MAKER_CMD` (brief on stdin, JSON on stdout), else `claude -p` on
  Opus under the agent cap; with neither, Make returns the brief and says so.
- **Storage**: one document per app on the hub, `shared/settings/skin-config/<app>.json` (`global` = hub-wide level);
  made skins and their job records under `skin-config/made/`.
- **Panel**: Settings → Appearance → **Skin config** (the settings library's own sub-tab, shown while something
  provides `axf.skin-config@1`; the Appearance overview has a Skin config row). Level (this app / hub-wide), layout,
  Reset, "Everything not set" mode and counts, the Default skin row with **Save current look as Default**, **Make skin
  with AI** with a wish field and the last result (applied / dropped), section TabGroup, search, and the tree with
  allow/lock switches per category, group and option plus depth steppers. Three layouts, each a `settings` asset
  tagged `ui-choices:skin-config`: tree with switches, two-column picker, compact chip grid.

## How each part is reached
MCP = the Theme manager plugin commands (plugin-commands@1, generated from the routes), by the ids below.

| What | Deep link | REST (`/api/plugins/theme-manager`) | MCP | CLI (`node framework/cli/skins.mjs`) | Voice / console action |
|---|---|---|---|---|---|
| Open the panel | `console_show settings:appearance/skin-config` | – | `console_settings appearance/skin-config` | – | `skin.config.open` |
| Read config | – | `GET /skin-config/{app}` | `skin-config-by-app` | `config get <app>` | panel |
| Tree / schema | – | `GET /skin-config/tree` | `skin-config-tree` | `config tree`, `config schema` | – |
| Allow / lock / ask / inherit | – | `POST /skin-config/{app}/set {path, mode}`, `/allow`, `/lock` | `skin-config-by-app-set`, `-allow`, `-lock` | `config allow|lock|ask|inherit <app> <path>` | `skin.config.allow:<path>` etc. |
| Depth / count limit | – | `POST /skin-config/{app}/depth {type, value, limit?}` | `skin-config-by-app-depth` | `config depth <app> <type> <n>` | `skin.config.depth:<type>:<n>` |
| Default mode | – | `POST /skin-config/{app}/mode` | `skin-config-by-app-mode` | `config mode <app> <mode>` | panel |
| Whole document | – | `PUT /skin-config/{app}` | `skin-config-by-app-set-skin-config-put` | `config put <app> <file>` | – |
| Reset | – | `POST /skin-config/{app}/reset` | `skin-config-by-app-reset` | `config reset <app>` | `skin.config.reset` |
| Save current look as Default | – | `POST /skin-config/{app}/default` | `skin-config-by-app-default` | `config default <app>` | `skin.config.default` |
| Brief the AI would get | – | `GET /skin-config/{app}/brief?wish=` | `skin-config-by-app-brief` | `config brief <app>` | – |
| Make skin with AI | – | `POST /skin-config/{app}/make {wish}` (background) | `skin-config-by-app-make` | `config make <app> --wish "…"` | `skin.config.make:<wish>` |
| Results | – | `GET /skin-config/{app}/made` | `skin-config-by-app-made` | `config made <app>` | panel |
| Check an output | – | – | – | `config hold <app> --from out.json` | – |

## Tests
`framework/spec/check-skin-config.mjs` (38 checks, fixture regenerated with the maker cases),
`framework/spec/check-skins-config-cli.mjs` (9, new, in CI), `plugins/theme-manager/test.py` (55, route tests added),
console `tsc`, check-theme, check-controls, check-toolbars, check-chrome-assets, check-skin-coverage,
check-chrome-settings, shared-assets check, plugin-commands check, glossary catalog `--check`: all pass.

## Gaps
- Kotlin twin of skin-config@1 is deferred (framework/spec/PORTING.md).
- New assets a made skin names (beyond picking existing ids) are saved on the hub under `skin-config/made/assets/`;
  the apps do not load hub-made assets yet, so the brief steers the AI to pick existing ids (`choices`).
- The `ask` mode is settable through the API and shows as an Ask chip; the panel's switches set allow / lock only.
