# Skin checker: flags anything that breaks a professional look

Build `skin-checker-flags-anything-that-breaks-a-profes`. Phase 1 (Fable): the skin-check@1 contract and settings schema. Phase 2 (Opus, this report): s2–s13.

Brett said (2026-11-10 17:11): "Yeah, build that shit right now."

## What shipped

- **Engine** (`packages/skin-checker`): a pure TypeScript engine with a rule registry. It loads a skin or design package with its colour theme, style theme, typography, density and sizing assets, runs the rules, sorts the issues and scores them. Every rule can be switched off or given another severity in the settings. A rule that throws, or lacks an asset it needs, is skipped with the reason, so a check never crashes.
- **Five rules, twelve rule ids:**
  - spacing: `off-scale` (sizing paddings off the density gap/pad scale; control and list-row heights off the density rows), `too-many-steps`
  - typography: `font-families` (typefaces across the body, mono and display stacks and skin parts; superfamily variants count once), `off-scale` (headings, eyebrow and sizing text sizes off the type scale)
  - palette: `sprawl`, `near-duplicate` (OKLab ΔE; the fix merges into the canonical token)
  - contrast: `text` 4.5:1, `large-text` 3:1, `ui` 3:1, over the framework's foreground/background pairs plus the pairs the skin's parts add. The fix is the nearest OKLab shade that passes over every background that token is checked against.
  - shape: `radius`, `border`, `shadow` (values outside the token set, too many distinct values, radii out of order)
- **One core** (`src/core.ts`) behind every surface. It handles: skins, check, state, fix, fix_all, set, settings get/set/reset, open and check_all. State lives in the plugin data folder: `settings.json`, the last result per skin, and fixed asset copies that shadow the built-ins. The console never rewrites built-in asset files; `axf skin fix … --in-place` does.
- **Console plugin `skin-editor`:**
  - REST routes under `/api/plugins/skin-editor/checker`.
  - The checker panel: live score and grade, the issue list with a category filter, a jump to each issue's token with an inline edit that re-runs the check after 600 ms, Fix and Fix all.
  - A thresholds section under Settings → Plugins → Skin editor, generated from the settings schema.
  - Deep link: action `skin-editor.checker:<skin>:<issue>`, or `?skin=&issue=` in the address.
- **CLI** `axf skin list | check | fix | set | settings | open` with `--json`. Exit codes: 0 pass, 1 fail, 2 usage error.
- **CI**: `.github/workflows/skins.yml` runs the unit tests and `axf skin check --all --json` whenever skin assets or the checker change. It writes a summary table and uploads `skin-check.json`.

## How each UI feature is reached

| Feature | Deep link / UI | REST (`/api/plugins/skin-editor/checker`) | MCP | CLI | Voice (AmberX, developer tab) |
| --- | --- | --- | --- | --- | --- |
| Open the checker on a skin / issue | console_show `action:skin-editor.checker:<skin>:<issue>`; Plugins → Skin editor; `?skin=&issue=` | `GET /link?skin=&issue=` | `skin_editor_link` → `console_show` | `axf skin open <skin> [issue]` | `dev.skin-open` "open skin checker fresh" |
| Read state (last result) | panel on open | `GET /{skin}` | `skin_editor_state` | `axf skin check <skin> --cached` | `dev.skin-state` "skin score fresh" |
| Run the check | Check again | `POST /{skin}/check` | `skin_editor_check` | `axf skin check <skin>` | `dev.skin-check` "check skin fresh" |
| Fix one issue | Fix (row / token box) | `POST /{skin}/fix {issues}` | `skin_editor_fix` | `axf skin fix <skin> <issueId…>` | `dev.skin-fix` "fix skin issue 2 on fresh" |
| Fix all | Fix all | `POST /{skin}/fix-all` | `skin_editor_fix_all` | `axf skin fix <skin> --all` | `dev.skin-fix-all` "fix skin fresh" |
| Edit a token (re-runs) | Token box | `POST /{skin}/set {token, value}` | `skin_editor_set` | `axf skin set <skin> <tokenKey> <value>` | via Gizmo with `skin_editor_set` |
| List skins with scores | skin picker | `GET /skins` | `skin_editor_skins` | `axf skin list` | (used by `dev.skin-check` to find ids) |
| Read settings | Settings → Plugins → Skin editor | `GET /settings` | `skin_editor_settings_get` | `axf skin settings` | `dev.skin-settings` |
| Write a setting | sliders, switches, severity selects | `PUT /settings` | `skin_editor_settings_set` | `axf skin settings set <key> <value>` | `dev.skin-setting-set` |
| Reset settings | Reset to defaults | `DELETE /settings` | `skin_editor_settings_reset` | `axf skin settings reset` | `dev.skin-settings-reset` |

## Results on the shipped skins

None of the 28 shipped skins and design packages passes at the default minimum score (80). Scores run from 3 to 39. Most of the penalty is real drift:

- the `compact` sizing paddings (0.85, 0.9, 0.75) sit between density steps;
- the sizing text sizes (0.86, 0.88, 0.8) and headings (1.3, 1.12) sit off the type scale;
- subtle surface ladders (bg vs surface2 at ΔE 1.1–2.5) count as near-duplicates;
- four style themes pair a display face with the body and mono faces (three typefaces);
- a few colour themes have muted text or status colours just under AA.

Fix all brings every skin to 85–100 within three passes.

I did not apply those fixes to the shipped assets: they change how every app looks, so that is Brett's call. In the console the fixes land as copies in the plugin's data folder. For the repo files, use `axf skin fix <skin> --all --in-place`, then `--write-baseline`.

Because of that, CI is a ratchet. A skin fails the job only when it is below the threshold (`packages/skin-checker/ci/settings.json`) **and** below its recorded score (`packages/skin-checker/ci/baseline.json`), or when it is new and fails.

## Decisions (no one to ask; headless)

- The planned file paths did not match the repo. The engine stays a framework package (`packages/skin-checker`). The UI, REST and MCP live in a new console plugin `skin-editor`, so it can be removed. Settings live in the plugin data folder, not `apps/console-web/server/data`. The contract's REST paths are relative to the hosting plugin's mount, so the package never names a plugin folder.
- MCP tool names follow plugin-commands@1 (`skin_editor_*`). Voice ids are AmberX developer-tab commands (`dev.skin-*`) in which Gizmo runs those tools. The contract's surface table was updated to match.
- Added a `set` action (one token write, then a re-check). The panel's inline edit needs it, and the rule that the panel acts only through REST requires it.
- TypeScript imports carry explicit `.ts` extensions. `bin/skin-check.mjs` runs the CLI with Node's type stripping (Node 22.6+, tested on 22.23) or tsx (Node 20), so the console's Python routes and CI need no build step.

## Tests

- `npx -y tsx packages/skin-checker/test/skin-checker.test.ts`: 79 checks (engine, score, every rule on a clean and a broken fixture, fixes, colour maths, loader on every shipped skin).
- `python apps/console-web/plugins/skin-editor/test.py`: 73 checks. Every route and its bad input; settings persistence. Parity: REST = CLI for check, state, settings get/set, set, open and fix_all. For every contract action, the REST route is served, the MCP tool runs that route, the voice command exists and names the MCP tool, and the CLI form exists.
- `apps/amberx-droid/test.mjs` 2343/2343; console `test_mcp_tools.py` 203 checks, `test_plugin_catalog.py` 39.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` and `plugin-commands check skin-editor` pass. `plugin-lifecycle check skin-editor` is clean apart from this session's untracked brief files. Console `tsc --noEmit` passes.

## Left / for Brett

- UI Review: the checker panel and the thresholds settings (desktop and phone) are waiting there. In the headless capture the slider track does not draw (hub look off); that comes from the framework Slider, not this plugin.
- Decide whether to apply Fix all to the shipped skins (and record a new baseline), or loosen the defaults (e.g. treat surface ladders as intended).
- Kotlin twin deferred (framework/spec/PORTING.md, skin-check@1).
