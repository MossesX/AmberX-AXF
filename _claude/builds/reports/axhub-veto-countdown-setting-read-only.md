# axHub: veto countdown setting, read-only calls skip it

Brett, Nov 16 2026: "We need to stop this 90 second thing. Put the veto thing on zero seconds or 10 seconds."

Decision #119. The work is in the **axHub repo** (`MossesX/axHub`), branch `claude/axhub-veto-countdown-setting-read-only`,
checked out on the VPS at `/root/axf-builds/axhub-veto-countdown-setting-read-only.axhub` (a git worktree of `/root/axHub`,
started from `origin/main` at `9de150a`). This AmberX-AXF branch only carries this report and the orchestrator's records.

## s1 (Fable): spec and schema entry, done

- Spec: `docs/veto-countdown.md` in axHub. Setting `vetoSeconds` 0–120, default **10**, in the hub-wide document
  `settings/approvals.json` (approval-settings@1, next to `settings/appearance.json`), read live by the hub and the apps;
  per-tool `vetoSettings` override on the same range; clamp on read, refuse on write. 0 s = still a veto call, run at
  Vinnie's next pass, no `held`/`warning` push. Read-only calls run at once: `read_only` claim on the MCP `call`,
  connector `readOnly` hook with a verdict `{readOnly, programs, why}`, `vps.run` command classifier (writes: redirection,
  sudo, hidden code, assignment prefixes, every chained segment, git push/commit/…, docker run/rm/…, files, network,
  secret-looking paths), per-service `config.readOnlyAllow` / `readOnlyDeny` entries (`program` or `program subcommand`).
  A wrong claim is refused with the reason, not held.
- Code (additive, no behaviour change yet): `ApprovalSettings`, `APPROVAL_SETTINGS_PATH`, defaults and limits in
  `packages/core/src/model.ts`; `ApprovalSettingsSchema`, `ApprovalSettingsPatchSchema`, `clampApprovalSettings` and
  `CallSchema.readOnly` in `schemas.ts`; `OutboundConnector.readOnly` + `ReadOnlyVerdict` in `connector.ts`; tests in
  `packages/core/test/approval-settings.test.ts`. Typecheck clean; core veto, passes and the new tests pass.

## Next steps (Opus phase, s2–s12)

Follow §4 of the spec: core constants and `vetoSettingsFor` defaults → `Hub.approvalSettings` option and the zero-second
path → Vinnie pushes → the document reader in `main.ts` → the `read-only.ts` classifier and tests → hook, `CONFIG_KEYS`,
hub decision step, log kind → MCP `read_only`, `settings_get/set` → CLI → web app page and deep link → AXF console
approvals setting, `console_show` target, AmberX voice → live hub migration. Every door (REST, MCP, CLI, voice) the same.
