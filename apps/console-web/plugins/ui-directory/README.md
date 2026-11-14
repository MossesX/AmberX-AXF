# UI Directory

One live data set (`ui-directory@1`) of every UI surface across every AmberX AXF app: every screen, page, tab, dialog,
settings interface, settings panel, plugin UI and banner. Brett, Nov 14 2026: "a plugin that's just a data set of
every single UI page and settings interface, that scales and grows on its own dynamically."

Nothing in it is typed by hand. The collector (`directory.mjs`) reads what the repo already registers:

| Source | What it yields |
| --- | --- |
| `apps/console-web/src/control/inventory.json` (console-control@1) | console screens, tab rows and their tabs, settings tabs and sub-tabs, plugin addresses |
| `apps/console-web/plugins/<folder>/plugin.json` | plugin rows, `provides` dialogs and banners, enabled by default or not |
| `plugins/<folder>/web/index.tsx` | views, dialogs, settings tabs, settings panels and banners the code declares |
| `apps/<app>/axf.manifest.json` + `project.manifest.json` | one app row per app |
| `apps/<app>/src/App.tsx`, `apps/<app>/src/plugins/<folder>/` | the other apps' screens and plugins |
| `apps/<app>/src/assets/ui-registry/*.json` | UI elements an app registers (ui-registry@1) |
| the `--fx-*` tokens in each plugin's / view's own code | the asset-token families a row is styled from |

Each row (`ui-directory-row@1`, contract `framework/core/ui-directory.mjs`, schemas `framework/schemas/json/ui-directory*.schema.json`):
`id` (`<app>:<kind>:<path>`), `name`, `kind`, `app`, `parent`, `plugin`, `address` (console-control), `deepLink`
(`console_open` / `console_settings` / `console_dialog` + target), `settings` (the row id of its settings interface),
`tokens` (families), `status` (`live`, `dynamic`, `unlinked`, `off`), `source`, `file`, `keywords`, `firstSeen`.

## Self-updating

- `build-hooks.mjs` (build-hook@1) rebuilds the directory on every build event: created, steps added, step done, status,
  PR opened or merged, addendum, restored. A rebuild with nothing new writes nothing; otherwise `changes.json` records
  what was added, changed and removed and which build caused it.
- The data lives only in the plugin's data folder (`.axf-console/plugins/ui-directory/`; `AXF_UI_DIRECTORY_DIR` overrides it).
- `node directory.mjs build [--reason r] [--build id]` · `stats` · `tree` · `search <q>` · `get <id>` · `reach <id>` · `gaps` · `changes` · `--json`.

## CI: every UI is registered

`node apps/console-web/plugins/ui-directory/directory.mjs --check` builds the data set fresh and fails when:

- a plugin folder has no row, a console view or settings tab has no row, a row fails the schema, or two rows share an id;
- a UI a plugin's web code declares (`views`, `dialogs`, `settingsTabs`) is not in its plugin.json `provides`
  (`view:<id>`, `dialog:<id>`, `settings-tab:<id>`) — **unregistered**;
- a `provides` entry has no code behind it — **phantom** (dynamic registrations count here until they are declared);
- a row has no deep link — **unlinked**.

The last three are ratcheted in `coverage.json` (only goes down: `node directory.mjs --update-ratchet`). To register a
UI: list it in `provides`, give it a console-control address (a framework view, TabGroup id, settings tab or
`data-axf-target`) so the inventory knows it. `framework/spec/check-ui-directory.mjs` replays the contract against
`framework/spec/fixtures/ui-directory.json` and the schema snapshots.

## API

Server routes under `/api/plugins/ui-directory/`: `GET directory`, `GET stats`, `GET rows` (kind, app, plugin, status,
family, q), `GET search` (q, kind, app, limit), `GET row` (id → row + reach + settings), `GET tree`, `GET changes`,
`GET check`, `POST rebuild`. The same commands over MCP (`ui_directory_*`), the CLI (`axf ui-directory …`) and voice through
plugin-commands@1. Capability `ui-directory@1`: `rows`, `search`, `row`, `rebuild`. Every row's `reach` is the four
doors to its UI from one address: MCP tool + target, the REST `console-control/do open` call, the `axf console` line
and the voice phrase.

## The page

Tools → UI Directory (view `ui-directory`, deep link `console_open ui-directory`): every row as a tree, app → plugin or
shell → screen → tabs, dialogs and panels. Search, app / kind / status / token-family filters, expand and collapse all,
Rebuild. A row's open button opens its UI here (console-control `open` on its address, else its deep link), the gear
opens its settings interface, the info button shows its id, address, file, token families and the four doors to it.
Rows of other apps show how to reach them there.

Everything on the page works without it:

| What | REST (`/api/plugins/ui-directory/`) | MCP | CLI | Voice |
| --- | --- | --- | --- | --- |
| open the page | `console-control/do open view:ui-directory` | `console_open ui-directory`, `ui_directory_open_page` | `axf ui-directory open-page` | "open UI Directory" |
| read the page state | `GET page` | `ui_directory_page` | `axf ui-directory page` | AmberX: control@1 `plugins ui-directory page` |
| search and filter | `POST show {q, app, kind, status, family}` | `ui_directory_show` | `axf ui-directory show --q … --kind …` | "find <words>" (console search), or AmberX: control@1 `plugins ui-directory show` |
| clear, expand, collapse | actions `ui-directory.show-all` / `.expand` / `.collapse` | `ui_directory_show_all` / `_expand` / `_collapse` | `axf ui-directory show-all` … | "press UI Directory: expand every group" |
| open a row / its settings | `POST open {id, settings?}` | `ui_directory_open` | `axf ui-directory open --id …` | "open <row name>" |
| rebuild | `POST rebuild` | `ui_directory_rebuild` | `axf ui-directory rebuild` | AmberX: control@1 `plugins ui-directory rebuild` |

The page reports its state (`POST page`, debounced) so `GET page` answers with what it shows. Its pure logic is
`web/dir-core.mjs`.

Settings → Plugins → UI Directory: size, last build, Rebuild now, install & uninstall.

Tests: `node test.mjs` (contract, collector, store, hook, CI check, page logic, commands), `python3
server/test_ui_directory.py` (page, show, open routes), `node e2e.mjs` (Playwright on the built console, desktop and
phone; `UIDIR_E2E_SHOTS=<dir>` saves screenshots).
