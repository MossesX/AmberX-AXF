# Inline element editing plugin (`inline-element-editing-plugin-right-click-any-el`)

Brett, Nov 10 2026 16:39 (verbatim): "Right-click elements right down to the child, it opens a dialog with all the
different tokens, in a tree or a classical tree or a grid with expandable rows, edit every token, notes that it overrides
inheritance. A master switch in the main application settings to enable inline edit mode. Same with navigation menus,
toolbars, banners, widgets, every single thing. Part of the plugin gives a monster list of everything changed from axHub's
inheritance, reset them individually to axHub's. Searchable, filterable, a tree with selectable roots and a multi-tab
column with different roots."

Branch `claude/inline-element-editing-plugin-right-click-any-el`, PR #470.

## Phase 1 (Fable, s1–s3)

The contract and engines in `apps/console-web/framework/`: `inline-edit-tokens@1` element paths + resolver, the
`inline-override@1` store (look settings `axf.inline.<root>`) + migration, and the right-click capture layer.
Contract `docs/contracts/inline-edit-tokens.md`, tests `apps/console-web/framework/test.mjs`.

## Phase 2 (Opus, s4–s13): the plugin `apps/console-web/plugins/inline-edit`

| Step | What landed |
|---|---|
| s4 | Plugin scaffold (plugin@1, lifecycle, help, commands). **Master switch "Inline edit mode"** in Settings → Appearance (and Settings → Plugins → Inline edit, View and Plugins menus, right-click menu). Kept on the console server, mirrored into `axf.inline-edit.mode`, which attaches / detaches the s3 capture layer. |
| s5 | Switch API on every surface (table below). Generic CLI improvement in plugin-commands: two words may name a command, extra words fill its input fields (`axf inline-edit mode on`). |
| s6 | Edit dialog: breadcrumb from the root to the child (any step can be the target), **Apply changes to** this item or everything under a chosen parent, a visible note that changes override axHub inheritance under the existing override rules, each token's inherited axHub value and layer. |
| s7 | Three views: tree (groups), classic tree (the element and each parent), grid with expandable rows. Editors: colour palette + picker list, size slider, font / choices, on/off, text. Live preview at once through the applier, written through the overrides store, **Revert to axHub** per token. Saved overrides restyle the elements they address with asset tokens only. |
| s8 | Dialog API; console-commands@1 deep links carry arguments (`?query` → the screen's / dialog's `arg`; `<plugin>/<page>`; console_open on an exact dialog id opens the dialog). |
| s9 | Overrides page: every value changed from axHub's inheritance, tree with selectable roots, full-text search, filters (app, element type, token kind, scope, changed by, since / until). |
| s10 | Tab column (framework TabGroup), a root per tab, kept per user on the server. **Reset to axHub** per item, restores only that item, list updates live; a parent-scope override asks first. |
| s11 | Overrides list API (table below). |
| s12 | Coverage pass in a real console: 689 controls (app menu, every menu and sub-menu row down to the child, nav, toolbar, banner widgets, tabs) all have a path of their own and open the dialog. Fixed: the menu bar's Help mode button and role chip had none (now `item:help-mode`, `item:role`). |
| s13 | Tests, report, THREADS row, PR. |

### How each UI is reached

| UI | Deep link | REST (`/api/plugins/inline-edit/…`, also `/api/control/inline-edit/<command>`) | MCP | CLI | Voice (AmberX → Developer → Inline edit) |
|---|---|---|---|---|---|
| Master switch | `console_settings` / `console_open settings/inline-edit` | `GET mode`, `PUT mode {state: on\|off\|toggle\|status}` | `inline_edit_mode`, `inline_edit_mode_status`; console actions `inline-edit.mode.toggle\|on\|off` | `axf inline-edit mode on\|off\|toggle\|status` | "inline edit on", "is inline edit on" |
| Edit dialog | `console_open` / `console_show` / `console_dialog inline-edit/element?path=<path>&scope=&view=`; action `inline-edit.element:<arg>` | `GET tokens?path=`, `PUT tokens`, `POST tokens/unset`, `GET/PUT element` | `inline_edit_tokens`, `inline_edit_set`, `inline_edit_unset`, `inline_edit_element`, `inline_edit_element_set`, `inline_edit_open_element` | `axf inline-edit tokens <path>`, `set <path> <token> <value> [--scope parent]`, `unset <path> <token>`, `element-set --view grid` | "tokens of …", "set … of … to …", "revert … to axhub", "edit element …", "inline edit view grid" |
| Overrides list | `console_open inline-edit/overrides?root=&q=&filter=&tab=`; action `inline-edit.overrides:<arg>` | `GET overrides?root=&q=&filter=&tab=`, `PUT overrides/state`, `POST overrides/tabs`, `POST overrides/tabs/close`, `POST overrides/reset` | `inline_edit_overrides_list`, `inline_edit_overrides_state`, `inline_edit_tab_add`, `inline_edit_tab_remove`, `inline_edit_overrides_reset` (confirm token), `inline_edit_open_overrides` | `axf inline-edit overrides list`, `overrides reset <id>`, `overrides-state --q …`, `tab-add <root>`, `tab-remove <id>` | "show overrides", "read the overrides", "search overrides for …", "add overrides tab for …", "reset … to axhub" |

Everything runs the one Node runner (`engine.mjs`): the server routes call it, plugin commands reach the routes, voice
hands Gizmo the MCP command. Intents: `plugins/inline-edit/voice.json`, twins in
`apps/amberx-droid/src/plugins/commands/web/lib-developer.ts`.

### Tests

- `plugins/inline-edit/test.mjs` (CI): 25: store, resolver, single-item reset, list filters / tree / roots / tabs, deep
  links, REST = MCP = CLI = voice parity for every command.
- `plugins/inline-edit/test.py` (CI glob): 41: every REST route against the engine.
- `plugins/inline-edit/test-ui.mjs`: 52: right-click → edit → reset in a real console (API + Vite + Playwright),
  desktop and phone. `coverage.mjs`: the s12 pass.
- `framework/spec/check-console-commands.mts`: 71 (5 new deep-link cases). Theme, controls, toolbars, chrome, help
  coverage, plugin commands, typecheck (console + AmberX), AmberX suite (2344): pass.

### UI Review

Waiting: r-20261110-8d5608b5 (switch), r-20261110-5cb94dcc (dialog), r-20261110-86064988 (overrides list), group
"inline-element-editing-plugin-right-click-any-el - Nov 10 4:26 PM". Single option: built only from framework controls.

### Choices made without asking

- The switch is one console-wide value on the server (so REST / CLI / voice can flip it), mirrored into every open
  console within 5 s; it sits in Appearance → Everything else (the Appearance tab folds everything but the theme
  manager) and under Settings → Plugins → Inline edit.
- Parent scope applies at the parent element: what CSS inherits (text colour, font, case) reaches the children; box
  tokens (background, radius) style the parent itself. The resolver already reports the parent value on each child.
- REST lives at the plugin mount `/api/plugins/inline-edit/mode` (plus `/api/control/inline-edit/<command>`), not a new
  top-level `/api/inline-edit/`: plugins can't add console routes outside their mount (plugin-lifecycle@1).
- control@1 for tokens = the `plugins.commands` domain (inline_edit_*). A dedicated `tokens.inline` control@1 target
  (contract §5) is a contract change for a Fable step; not added.
- Touch: a long-press is not captured (s3 contract); the right-click menu has "Inline edit mode" and the overrides list.

### Open

- Kotlin twins deferred (PORTING.md: inline-edit-tokens, console deep links).
- `menu-reach` still lists 4 unknown pages from other plugins (shipped-features, glossary-index, demo-designer,
  book-builder); not this build.
