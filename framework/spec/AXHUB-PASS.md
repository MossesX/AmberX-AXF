# axHub approval passes: what a pass covers (pass@2)

Contract for build `approval-pass-covers-every-call` (step s1, Nov 25 2026). It amends axHub's pass@1
(`docs/veto-pass.md` §1-2 in the axHub repo, decisions #112 and #113; `PolicyPassSchema` in
`packages/core/src/schemas.ts`, `packages/core/src/passes.ts`). Schema: `framework/schemas/axhub-pass.json`
(the record, the decision table `x-decision`, the log fields `x-log`, the migration and its cases `x-migration`).
Reader in this repo: `readPassCovers` / `passCoversLabel` in `apps/console-web/src/hubPages/core.ts`, checked
against the schema's cases by `apps/console-web/src/hubPages/test.mjs`.

Why: with a pass on, `vps.run` still counted down and `console_terminal_sessions_stop` still asked. A pass is
Brett saying "do what I tell you for this long", so while one is active every call it covers runs at once: no
countdown, no approval prompt, no notice, and the log says which pass it ran under.

## 1. `covers`

```json
{ "schemaVersion": 2, "id": "2b0c…", "covers": "all", "expiresAt": "…", "…": "the pass@1 fields, unchanged" }
{ "schemaVersion": 2, "id": "9f1e…", "covers": [
    { "service": "vps", "tool": "run" },
    { "service": "axf-console", "tool": "console_terminal_sessions_*" },
    { "service": "*", "scope": "tokens.theme" } ] }
```

| `covers` | Covers |
| --- | --- |
| `"all"` (**the default** for every grant that names nothing, and what pass settings preselect as "All tools") | every tool on every service, whatever its policy, including tools registered later |
| a list of 1-50 entries | exactly the calls an entry matches |

An entry is `{ service, tool?, scope? }`:

- `service`: a namespace, or `*` for any service (then `scope` is required: "anything, anywhere" is spelled `all`).
- `tool`: a name or pattern, left out = every tool of the service. `*` stands for any run of characters; the
  rest is literal and case-sensitive.
- `scope`: a control@1 target (`tokens.theme`). A scoped entry never covers a call without a `target` argument.

A call matches an entry when all the parts it gives match. Naming a tool is the owner's choice: a listed
destructive tool, shell (`vps.run`) or hub tool is covered like any other. This replaces pass@1's narrow-pass
exclusions (destructive, delete-named, explicit-approval, `ssh`, the hub's namespaces) and its scope-only match.

Requests (`axhub.pass_grant`, `axhub.pass_update`, `POST /auth/api/passes`, `axhub passes grant`, the AmberX voice
command) take `covers` the same way; left out = `all`. A list item may be short: `"vps"` (every tool),
`"vps.run"` (split at the first dot), `"scope:tokens.theme"` (any service). The hub stores entries. The pass@1
request words (`service`, `tools`, `scope`, `scope: "all"`) keep working and are turned into `covers` by the
migration rule in §4. `include_irreversible` goes only with `all`.

Length is separate from coverage: a pass of any length the hub's longest-pass limit allows (24 hours must be
allowed) covers the same calls from its first second to its last. Expiry is checked by the hub's clock on every call.

A pass also carries `quietNotice` (default `false`): see §3.

Still written for older readers: `all`, `service`, `tools`, `scopes`, derived from `covers` (`all: true`,
`service: "*"`, `tools: ["*"]` for `all`). `covers` is the truth; the mirrors are never read when it is present.

## 2. How a pass decides each policy

The hub resolves the call's policy as before, then asks the passes. For an active pass whose `covers` matches:

| Policy | Without a pass | Under the pass | Logged `ranUnder` |
| --- | --- | --- | --- |
| `allow` | runs | runs; no pass is used or named | no |
| `veto` (`vps.run`, ordinary writes) | countdown, veto notice | **runs at once**: no countdown, no notice | yes |
| `confirm` | `confirmation_required`, approval prompt | **runs at once**: no prompt, no notice | yes |
| always-approve | straight approval, never a countdown | **runs at once**: no prompt, no notice | yes |
| `deny` | refused | refused: no pass lifts a deny | no |

*Always-approve* is a tool whose approval is always the owner's own tap: annotation `explicitApproval`, or a
destructive or otherwise guarded tool that policy holds at `confirm` (`console_terminal_sessions_stop`). The
hub records which of the three it skipped (`policySkipped`).

The same check runs wherever a call can be held: the hub's own call path, the veto queue, the
`confirmation_required` answer, and tools reached through a downstream proxy (the console's `/mcp`). A covered
call never enters the held list, so nothing downstream can prompt, count down or notify for it.

Never covered, by any pass:

1. **Owner-grant tools** (`axhub.pass_grant`, `axhub.pass_update`): a pass can't grant, widen or stretch a pass.
2. **Irreversible calls** (the connector's verdict, `docs/veto-pass.md` §2a), unless `covers` is `all` and the
   grant said `include_irreversible: true`. A list never covers one. This is the one guard decision #113 kept.
3. A call carrying a `confirmation_id` (it answers an approval already asked).
4. Anything after `expiresAt` or a revoke.

A **feed pass** (control-pass@1, published by a service about itself) is read as a list held to that service and
keeps pass@1's narrow exclusions: it was approved in the console, not on the hub, so it never reaches a
destructive, explicit-approval or irreversible call.

When several passes cover a call, the one ending last is named.

## 3. What a covered run logs

On the job and on its approvals-log entry:

| Field | Value |
| --- | --- |
| `ranUnder` | the pass id; present exactly when a pass let the call run |
| `policySkipped` | `veto`, `confirm` or `always-approve` |
| `ranAt` | when it ran |
| `status` | `ran under pass` / `failed under pass` (unchanged) |
| `passId`, `passGrantedBy`, `passExpiresAt`, `passScope` | as in pass@1; `passId` equals `ranUnder`, `passScope` is the coverage label |

Plus one audit entry per covered run (pass id, qualified tool, policy skipped, time), and the pass's `uses`
goes up (`pass_status` shows it as the run count, with `covers`). The log filter `pass=any|<id>` is unchanged.

Notices: a covered run sends no veto or approval notice. With `quietNotice: true` it sends one quiet
`ran under pass` line instead; nothing else.

The coverage label (`passScope`, the pass card, the banner): `everything`, `everything, including irreversible
calls`, or the entries joined (`vps.run, axf-console.console_terminal_sessions_*, scope tokens.theme`).

## 4. Migration (`pass-covers-1`)

Read-time, the same on every reader (hub, web pages, console); nothing has to be rewritten first.

1. `covers` is `"all"` or a valid list: use it.
2. `covers` is present and anything else: the pass covers **nothing** (fail closed) and the reader says so.
3. No `covers`: the pass reads as **`all`**,
4. except a pass@1 record whose own fields name something narrower (a `service` other than `*`, a tool pattern
   other than `*`, or `scopes`): it keeps exactly what it named, as one entry per tool and scope. Brett approved
   that pass for those calls; the migration must not turn it into a pass for everything.

Storage: axHub SQLite migration 7 adds a nullable `covers` column to `passes`; `NULL` means "not written yet"
and is read by rules 3-4. A backfill is optional and writes what the read rule answers. New records are
`schemaVersion: 2` and always carry `covers`.

The cases every reader must agree on are in the schema file (`x-migration.cases`).

## 5. Choices made here

- "No field reads as `all`" is rule 3; rule 4 is the one exception, so an already approved narrow pass is not
  widened behind Brett's back. Such passes end within their own length, after which only pass@2 records exist.
- The irreversible guard stays (decision #113). The CI check of step s10 walks tool policies, which it does not touch.
- An explicit list covers what it names, shells and destructive tools included: the picker shows the tool, and
  picking it is the approval.
- This repo holds the contract and the console's reader. The hub's matcher, call path, log and web API follow
  it in the axHub repo (steps s2-s9).
