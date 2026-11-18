# Approval pass covers every call, including VPS commands and stops

Brett (Nov 18 2026): "Why do I keep getting approvals when I set a pass?"

Branches: `claude/approval-pass-covers-every-call` in AmberX-AXF (PR #836) and in axHub.

## Cause (s2: every place the call path skipped the pass)

| # | Where | What it did |
|---|---|---|
| 1 | axHub `packages/core/src/passes.ts` → `PassBook.match` → `passExclusion` | Any pass that wasn't `all` skipped `ssh` services (`vps.run`), the hub's own tools, destructive and delete-named tools and explicit-approval tools (`console_terminal_sessions_stop`). |
| 2 | axHub `PassBook.active` | Dropped `all` from every feed pass, so the pass Brett sets in the console was always narrow on the hub and then hit (1). |
| 3 | axHub `passCovers` | Ignored `covers`; read only the old `service` / `tools` / `scopes` fields. |
| 4 | axHub `PassBook.grant` | Refused any pass that named an `ssh` service. |
| 5 | Console `plugins.commands` (`plugin-commands/commands.mjs` → `plan`) | A `confirm: true` command (`console-terminal/sessions-stop`) always answered `confirmation_required`; it never asked whether a pass covered the call. |
| 6 | Console `token-control` (`control-pass.mjs` → `passCovering` / `passCoveringCall`) | Matched passes by scope id only; `passCoveringCall` only ever matched an `all`-scope pass and ignored `covers`. |
| 7 | Console ← hub | The hub sent no pass with the call, so the console's own confirm layer couldn't know the hub ran it under one. |

Reproductions: axHub `packages/core/test/passes.test.ts` → "a pass covers what it names, whatever the policy class"
(`vps.run` and `terminal_sessions_stop` under a named pass); console `plugin-commands/test.mjs` → "a pass" block.
