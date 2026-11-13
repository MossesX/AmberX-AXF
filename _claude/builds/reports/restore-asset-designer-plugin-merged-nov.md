# Restore the Asset Designer plugin (merged Nov 10, now missing)

Build `restore-asset-designer-plugin-merged-nov`, Phase 1 (Fable), Nov 13 2026. Branch `claude/restore-asset-designer-plugin-merged-nov`.

## What Brett said (verbatim)

> find the archive build for it and rebuild it, branches should still be around somewhere

## What removed it: nothing. It was never merged.

- The Oct 18 build `asset-designer` (Asset Designer plugin, no-code) never had a branch or a PR. Its 11 steps were never ticked.
  `git log --all -- apps/console-web/plugins/asset-designer` is empty on every ref, and no `claude/asset-designer` branch ever existed on origin.
- Nov 7: build `ui-asset-designer` (designer@1 host + add-ons) was created to redo the menu / toolbar editors from scratch. Its Fable phase (the contracts) went up as PR #376 (`claude/ui-asset-designer`). The merge queue kicked it out the same day (CI failed on top of main). The Opus phase (the host plugin and six add-on plugins) was never built; the reconciler's "s7–s40 done" notes came from the PR body naming those step ids.
- Nov 10 04:35: an audit note marked build `asset-designer` **complete** as "superseded by ui-asset-designer and context-menu-designer" and set `builtAt` to that moment. No code moved.
- Nov 12 03:26: the shipped-features backfill made `sm-asset-designer` from that record: "complete 2026-11-10 (date inferred: no commit or PR recorded), 0 file(s)". That is the "merged Nov 10" entry.
- Nov 12 22:32: PR #376 was closed unmerged and its branch deleted (during the land-all-97 sweep). Its head stayed reachable as `refs/pull/376/head`; the real work is one commit, `0df7bf125`.

So the "missing plugin" was a status record without code behind it. Rule for the audit and the backfill: a build is merged only when a PR with its files landed; `git log --all -- <folder>` decides, not a note.

## What was restored and built

**designer@1 contracts (from PR #376's commit `0df7bf125`, cherry-picked onto current main; conflicts resolved by keeping both sides):**
`framework/core/engines/designer-rules.mjs` + `.d.mts`, `designer-doc.mjs` + `.d.mts`, the `designer` and `embed` asset types in `asset-types.json` (+ `core/types.ts`, `validate.ts`, `cli/build-engine.mjs`, JSON schemas), starters `assets/designer/*`, `assets/settings/designer*`, `assets/embed/*`, `spec/DESIGNER.md`, `spec/check-designer.mjs` + `fixtures/designer.json` (476 checks, in CI), PORTING.md row. The baked copies in the apps were regenerated (`shared-assets.mjs bake --all`; the console's `src/axf/core` files copied from the framework; the other apps already carry edited baked cores, so only the new engine files were added there). The breakroom profile files and the stale doc edits in that commit were dropped.

**The plugin, `apps/console-web/plugins/asset-designer` (`ai.amberx.axf.console.asset-designer`, uiEditor builder):**
- **Every asset type.** The editor is built from the registry: chrome settings fields first (chrome-settings@1 `CHROME_FIELDS`, with their kinds, options and defaults), then the type's required fields, then its optional fields; kinds from the enum, the chrome field, a sample built-in asset's value, the field description, then the key. A JSON view for anything the fields do not reach. Start from a built-in asset (never overwritten), open a saved one, duplicate.
- **Chrome settings interfaces.** A toolbar, tab group, banner or menu shows "Settings interface…", which opens its `settings` asset (a copy of the shared default `chrome-<type>` as `chrome-<type>-designed`) with all of its tokens as fields: layout, header, search, descriptions, tabs, hide, groups, levels, defaultLevel, levelOf, visible, toolbar, extends, for. Toolbar and tab group assets themselves expose all 7 / 12 chrome fields plus the type's own.
- **Validation gate.** `validateAsset` (baked core) runs on every change; each error is shown next to the field it names (`fieldOfError`), the rest in a banner; Save is disabled until clean. The server runs the framework validator again (`server/designer.mjs` → `cli/build-engine.mjs validateAsset`) and answers 422 with the errors, writing nothing. `POST /validate` runs it without saving.
- **designed@1 manifests.** Every save makes or bumps the manifest with `makeDesigned` (uid kept, revision +1, version bump, data hash); the Manifest tab shows it; `GET /library` is the designer-library@1 index.
- **Storage + runtime.** asset@1 files under `.axf-console/plugins/asset-designer/assets/<type>/<id>.json` (0600, atomic); registered into the runtime at load (`rt.registry.register`, origin `asset-designer`) so slots, pickers and skins see them. Live preview swaps the real chrome (slot of the type) to the draft while it is valid and restores the previous asset when turned off.
- **API parity (plugin-commands@1, auto):** 9 reads · 8 commands on REST `/api/control/asset-designer/<command>`, MCP `asset_designer_<command>`, CLI `axf asset-designer <command>`, and the console actions `asset-designer.open | .new:<type> | .edit:<type>:<id> | .chrome:<type> | .reload` (voice through the same action bus). Deep link: console_show / console_open target `asset-designer`. Settings `axf.asset-designer.type` and `axf.asset-designer.live` are console settings (control@1 `console.settings`).
- Installed and enabled by default; nav Plugins → Asset designer; app menu Plugins + View; context menu "Design an asset…"; Settings → Plugins → Asset designer (prefs, open buttons, lifecycle panel); `install.mjs` / `uninstall.mjs` / `hooks.mjs` (health: data folder + validator); help.json (every control; coverage 100% for the plugin); self-tests `test.py` (server) + `test.mts` (model + Node side).
- `framework/catalog/plugins.json`: the planned entry removed (the manifest is the entry now).

## Checks

`check-designer.mjs` 476 ok · `axf validate --framework` 557 assets · `shared-assets.mjs check --all` ok · `plugin-lifecycle.mjs check asset-designer` clean · `plugin-commands.mjs check` 9 reads · 8 commands · `check-plugin-commands.mjs` 57 ok · `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` ok · `menu-reach.mts` no finding for this plugin · console `tsc --noEmit` ok · `test.mts` + `test.py` all pass.
Help coverage: the plugin is fully covered; the console-wide ratchet (99.6%) misses are pre-existing (approvals-banner fields, molly-guide tab).

## Left for the next phase

- UI Review: desktop and phone shots need a built console (none runs on this VPS); the review item is to be submitted from the Opus phase with `review.mjs submit --kind settings …`.
- Shipped features: `sm-asset-designer` should be re-issued from this build's PR so the ledger shows the real merge.
- The Kotlin twin of designer@1 stays deferred (PORTING.md).
