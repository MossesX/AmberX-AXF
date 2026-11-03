# pass-all — a veto pass covers everything by default

Urgent build `pass-all`, Opus, Nov 3 2026. Branch `claude/pass-all`, pushed onto `claude/theme-veto-pass` (PR #262) as a
fast-forward. Brett (voice), correcting `theme-veto-pass`: "It's not supposed to be 30 minutes for theme changes. It's 30 minutes
to do whatever I tell you."

## What changed

| Before (theme-veto-pass) | Now |
|---|---|
| Scopes `tokens.theme / style / layout / *`; CLI word `all` = the three token scopes | New scope **`all`**, the default: every write on every control@1 target and every call axHub holds. Narrow token scopes unchanged; CLI word `all` = everything, `tokens` = the three |
| A pass never covered `remove`, `add`, `act` | `all` covers them. Ordinary deletes run without the confirm token (`confirmSkipped: true`) |
| – | **Irreversible** commands: `CONTROL_TARGETS[t].irreversible` (`remove` on `amberx.items`, `amberx.lists`); still confirm unless the `all` grant has `include_irreversible: true`. axHub's signed approval covers the flag (`….irreversible` suffix) |
| – | The pass target itself is never covered (a pass can't grant or approve a pass) |
| Undo rolled back token changes | Undo rolls back token changes and lists every other command it can't roll back (`notUndoable`, in `text` too, and in the THREADS / audit log line) |
| Chip "Theme no veto 29:41" | Chip "**Everything: 29:41 left**" (or the scope name, "+irreversible" when included); requests read "claude asks: everything without veto for 30 min" |
| MCP `token_pass_*` (default theme) | MCP `pass_grant / pass_status / pass_revoke / pass_undo` (default all, `include_irreversible`); `token_pass_*` kept as the same tools |
| `axf token pass grant theme 30` | `axf pass grant 30` (everything), `--scope theme`, `--include-irreversible`; old form still works |
| `pass/check?target=&op=` | also `pass/check?call=<service.tool>&irreversible=` for any axHub call |
| Publication `never: [remove, add, act]` | `default: "all"`, `excluded: ["pass.scopes"]`, `irreversible` rule; `all` publishes `targets: ["*"]` |

Files: `framework/core/engines/control-pass.mjs`, `control-rules.mjs` (irreversible marking, `controlIrreversible`, gate option
`passCovers`), `framework/schemas/control.json` + fixture, `check-control.mts`, `framework/cli/axf.mjs` (`axf pass`),
token-control `control.mjs`, `lib/pass.mjs`, `server/__init__.py`, `web/pass.tsx`, `web/index.tsx`, `web/docs.ts`, `help.json`,
`plugin.json`, `apps/console-web/server/mcp_server.py` + `test_mcp_tools.py`, `framework/spec/CONTROL.md`, `PORTING.md`.

## axHub side (build `axhub-pass-all`)

Contract in `framework/spec/CONTROL.md` → Veto passes → *Deciding a held call*: with an active `all` pass in the signed publication,
axHub runs every held call at once (pass tools excepted), except calls it marks irreversible unless the pass has
`include_irreversible: true`. Until axHub ships that, a pass shows, logs and lifts the console's own delete confirm, but axHub still
holds its calls.

## Tests

| Check | Before | After |
|---|---|---|
| `node apps/console-web/plugins/token-control/test.mjs` | 19 | 20 (new: pass all, ordinary vs irreversible deletes, signed flag, undo listing, CLI words) |
| `npx tsx framework/spec/check-control.mts` | 257 | 260 |
| `python3 apps/console-web/server/test_mcp_tools.py` | pass (token_pass_* only) | 138 checks, pass_* + token_pass_* |
| `tsc --noEmit` (console-web), `check-theme`, `check-controls`, `plugin-lifecycle check token-control`, `help-coverage` | pass | pass |

## Screenshots

UI Review `r-20261103-7cd5aa8b` (group `pass-all - Nov 3 11:08 AM`), copies in `pass-all/shots/`: the banner chip
("Everything: 59:06 left", Extend, Undo 3, Revoke, plus a waiting theme request) and the Passes tab (Everything default, the
irreversible switch), desktop and phone. Seeded pass store; the banner group was forced visible in the sandbox as before.

## Known gaps

- axHub side not in this repo (above).
- Commands other than token writes aren't rolled back by undo; they are listed by name for Brett to check.
- A shell on the VPS can always write files directly; the pass guards the API, MCP and CLI surfaces.
- Kotlin twin deferred (Android on hold), recorded in PORTING.md.
