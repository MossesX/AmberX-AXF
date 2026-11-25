# s9: pass settings as an API

Build `approval-pass-covers-every-call`, step s9 (Nov 25 2026, Fable). What a pass covers can be read, set and changed
without the page, the same way from every driver. Contract: `framework/spec/AXHUB-PASS.md` (s1).

## Where the work is

| Repo | Branch | What |
| --- | --- | --- |
| MossesX/axHub | `claude/approval-pass-covers-every-call--s9` (commit `f20d5cd`) | the hub: `covers` on the record and on grant, `axhub.pass_update`, one-pass read, REST and CLI twins |
| AmberX-AXF | `claude/approval-pass-covers-every-call--s9` | the console: the `#/passes/<id>` page, console actions, the voice mapping (pass-voice@1) and its fixture |

## How each part is reached

| Part | Web page | REST (admin session) | MCP | CLI | Voice / console action |
| --- | --- | --- | --- | --- | --- |
| Deep link | `#/passes/<id>` opens that pass above the list (ended ones too) | `url` in every pass answer | `url` in `pass_status` | `url` in `passes show` | `axhub.passes.open:<id>` |
| State: covers and runs | the pass card | `GET /auth/api/passes`, `GET /auth/api/passes/<id>` | `axhub.pass_status {id?}` → `covers`, `label`, `runs` | `axhub passes list`, `passes show <id>` | "pass status" · `axhub.passes.status[:<id>]` |
| Grant with `covers` | the grant form | `POST /auth/api/passes {covers?, minutes}` | `axhub.pass_grant {covers?, minutes}` | `axhub passes grant <minutes> [--covers …]` | "pass for vps for an hour" · `axhub.passes.grant:<minutes>[:<covers>]` |
| Change `covers` | | `POST /auth/api/passes/<id>/update` | `axhub.pass_update {id, covers}` | `axhub passes update <id> --covers …` | "make the pass cover everything" · `axhub.passes.update:<id\|active>:<covers>` |
| Revoke | Revoke on the card | `POST /auth/api/passes/<id>/revoke` | `axhub.pass_revoke {id}` | `axhub passes revoke <id>` | "end the pass" · `axhub.passes.revoke[:<id>]` |

`covers` is `"all"` (the default) or 1-50 entries; short forms `vps`, `vps.run`, `scope:tokens.theme`. The voice engine
(`apps/console-web/plugins/gate/web/pass-voice.mjs`) turns a phrase into the MCP call and gives the same intent as the
REST request and the CLI words; `framework/spec/fixtures/pass-voice.json` pins all three for 29 phrases. In the console
a spoken command runs as `axhub.passes.voice:<phrase>` through the hub relay (a wall admin's session, never a token).

## Choices made (nobody was watching)

- **The hub half is built on axHub `main`**, like the other steps of this run, so it carries its own `covers` field,
  reader (`passCoversOf`, migration `pass-covers-1`) and matcher change. A stored `covers` list covers what it names,
  shells and explicit-approval tools included, and never an owner grant or an irreversible call. Grants made with the
  older words (`service`, `tools`, `scope`) keep writing the pass@1 record and are read through the migration, so
  nothing already granted is widened and no existing label changes.
- **`axhub.pass_update` is an owner-grant tool** like `pass_grant`: a straight approval, never covered by any pass.
- **`quiet_notice` is accepted by update** and stored as `quietNotice` (the field s7 adds, written identically here);
  sending the quiet line is s7's.
- **The pass length limit is untouched** (the hub still caps a pass at 240 minutes). The voice engine reads up to a day
  and the hub's own limit answers; raising it to 24 hours belongs to the step that owns the limit.
- **The voice engine lives in the gate plugin**, next to the page it drives, not in `framework/core`: a new framework
  engine is baked into every app's `axf.lock.json`, which the parallel steps of this build would all collide on. The
  Kotlin twin is recorded as deferred in `framework/spec/PORTING.md`.
- `schemaVersion` stays `1` on the hub record (the hub's `SchemaVersionSchema` is a literal shared by every record);
  `covers` being present is what marks a pass@2 record.

## Checked

- axHub, Node 22 container: `pnpm build` clean; `vitest run` 642 of 643 pass. New: `packages/core/test/pass-covers.test.ts`
  (13), `packages/server/test/pass-covers.test.ts` (3), one storage-contract case for `passes.rewrite` (memory and SQLite).
  The one failure, `packages/connectors/ssh/test/build-tools.test.ts` (`build_land … pushes to main`), fails the same way
  on a clean checkout of axHub `main` in the same container; it is not from this step.
- Console: `node apps/console-web/plugins/gate/test/test.pass-voice.mjs` (5, added to the test workflow),
  `node apps/console-web/plugins/gate/test.mjs`, `npx tsx apps/console-web/src/hubPages/test.mjs` (245 checks, 8 new route
  cases), `tsc --noEmit` (only the generated `src/control/inventory.json` is missing, as on `main`), check-theme,
  check-controls, check-toolbars, check-chrome-assets, check-plugin-pages.
- `help-coverage --check` is red for console-web on one control that is not from this step
  (`hide-this-notice`, `apps/console-web/src/pluginLoader.tsx:604`). The new "All passes" button has its help entry.

## Not done here

- **UI Review**: the one-pass card (`HubPassDetail.tsx`) is new UI and has no shots yet. It needs a signed-in hub
  session to render, which this headless session did not have; it goes to UI Review with the pass settings shots
  (step s11). Not verified in a browser.
- The hub's MCP server instructions (`packages/server/src/mcp.ts`) do not mention `axhub.pass_update` yet: s6 rewrites
  that paragraph, so it was left to avoid a collision. One sentence to add when the steps are merged.
- The merge of this step with s4, s6 and s7 on the axHub side touches the same files (`passes.ts`, `builtin.ts`,
  `model.ts`, `schemas.ts`); the `runs` / `quietNotice` lines were written identically to theirs so they merge clean.
