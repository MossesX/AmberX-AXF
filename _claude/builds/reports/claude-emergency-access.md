# Let Claude send builds to emergency (build claude-emergency-access)

Pipeline 2.0 build, 6 steps, draft PR #933 (branch `lander/claude-emergency-access`). This report is step s6.

## What Brett said

Nov 24 2026, as filed on the build (Plan Studio 2.0 item `let-claude-send-builds-to-emerge-aewn`):

> Brett, Nov 24: he wants Claude (the console token through MCP, REST, CLI, voice) to be able to send a build to an
> emergency slot when he says so. Today build-orchestrator/pipeline-emergency is Brett-only from his own signed-in
> console and refuses the console token with 403. Change that rule as Brett decides (e.g. allow it, logged with who
> asked and why, with an FYI to his phone).

His exact words were not recorded on the build (`origin.said` is empty), so the text above is the filed summary, not a
quote.

## The old rule

Nov 20 2026 (build emergency-slots): only Brett sends a build to emergency, from his own signed-in console (Build
orchestrator or Plan Studio 2.0). `POST /pipeline/emergency` answered the console token, MCP, voice, agents and every
session with 403 ("Only Brett sends a build to emergency…"). `framework/cli/emergency-builds.mjs send` refuses any
caller without the approver the server sets for Brett's click (exit 3).

## The new rule

A Claude session (the console token: MCP, REST, the CLI, console control, voice) may send a Pipeline 2.0 build to
emergency when Brett says so, if it says **why** and **who asks**. Every such send is logged on the build and one FYI
goes to Brett's phone. An owner-only Claude setting, `builds.claudeEmergency` (default on), switches it off. Brett's own
signed-in click is unchanged: no reason needed, and it works with the setting off.

Not changed: Plan Studio 2.0's own Send to emergency (`POST /emergency`) stays Brett's click only; approving or denying
a model upgrade stays Brett's own tap; `emergency-builds.mjs send` still refuses a session.

## The contract

`POST /api/plugins/build-orchestrator/pipeline/emergency`, body `{ id, reason?, askedBy? }`:

| Caller | Result |
| --- | --- |
| Brett's signed-in console session (hub admin, no agent header) | 200, `via: 'person'`, no reason needed, no FYI |
| Console token + `reason` + `askedBy` | 200, `via: 'console-token'`, note on the build, one FYI |
| Console token, `reason` missing or blank | 400 `reason is missing: …` |
| Console token, no `askedBy` in the body or the `X-Axhub-Session` / `AXF_AGENT` header | 400 `askedBy is missing: …` |
| Console token while `builds.claudeEmergency` is off | 403 saying where Brett switches it on |
| Signed-in hub user who is not an admin | 403 |
| An agent riding Brett's session (agent header set) | treated as the console token |

- On the build: `emergency: { by, via: 'person' | 'console-token', askedBy, reason, at }` (a person's tag has no
  `reason` unless one was given) plus a note: "Sent to emergency by <askedBy> (a Claude session, with the console
  token). Why: <reason> …". Written through the builds store; the emergency slot grant is written first.
- Response: `{ ok, id, emergency, already }`. Sending an emergency build again returns `already: true`, changes nothing
  and sends no second FYI.
- FYI: one alert, source `pipeline`, key `pipeline:emergency-by-claude:<build>`, `meta.type`
  `build-emergency-by-claude`, title "<build> sent to emergency", body with who asked and why. The alert hub asks
  `axf.notify@1` where it goes; the type is declared in the plugin's `notify.json` (push on, priority normal).
- `GET …/pipeline/emergency` adds `claudeCanSend` (the setting) beside `canSend` (this request is Brett's click).
- Setting: `builds.claudeEmergency`, read through `axf.claude-settings@1`. A missing key, a missing provider or a
  failed read all mean on.
- CLI: `node apps/console-web/plugins/build-orchestrator/pipeline.mjs emergency <id> [--reason "…"] [--asked-by name]
  [--json]`. From a Claude session (`CLAUDECODE`, `AXF_SURFACE` or `AXF_SESSION` set) `--reason` is required and
  `--asked-by` defaults to `AXF_AGENT`, then the session name. Exit 0 sent, 2 bad request or build (a missing reason
  included), 3 refused (the setting is off). A person at a shell needs no reason (`via: 'person'`).
- Engine: `framework/core/pipeline-status.mjs` `normEmergency` keeps the optional `via`, `askedBy`, `reason`; a tag
  without them is unchanged, so the fixtures are unchanged. Kotlin twin: same deferred gap as before
  (`framework/spec/PORTING.md`).

## What each step touched

| Step | What | Files |
| --- | --- | --- |
| s1 | The server rule, the store write, the notify type | `apps/console-web/plugins/build-orchestrator/server/__init__.py`, `server/emergency-send.mjs` (new), `server/test_emergency.py`, `notify.json`, `framework/core/pipeline-status.mjs`, `framework/spec/PORTING.md` |
| s2 | `pipeline.mjs emergency <id>` for sessions | `apps/console-web/plugins/build-orchestrator/pipeline.mjs` |
| s3 | The owner-only switch | `apps/console-web/plugins/claude-settings/registry.json`, `test.mjs`, `test.py` |
| s4 | The command for MCP, console control and voice | `apps/console-web/plugins/build-orchestrator/plugin.json`, `web/index.tsx`, `web/StatusTable.tsx` |
| s5 | Decision, rule and README | `_claude/memory/decisions.md`, `_claude/rules/RULES.md`, `apps/console-web/plugins/build-orchestrator/README.md` |
| s6 | Contract test, CI line, this report | `apps/console-web/plugins/build-orchestrator/test-emergency-access.py` (new), `.github/workflows/android.yml` (one line), `_claude/builds/reports/claude-emergency-access.md` |

s6 touched one file outside its list: the plugin's Python tests are listed by name in `.github/workflows/android.yml`,
so the new test got its line there, right after `server/test_emergency.py`.

## How to switch it off

Console → Settings → Plugins → Claude settings → Builds → **Claude can send builds to emergency** → off. Only Brett's
own signed-in click changes it (`claude_settings_set` from a session or the console token is refused with 403). While
off, the console token gets 403 on `pipeline-emergency`, `pipeline.mjs emergency` from a session exits 3, and Brett's
own Send to emergency click still works. To also stop the phone buzzing while leaving it on: mute the notification type
"FYI: Claude sent a build to emergency" in the notification settings.

## Checks run

s6 was cut from main, where none of s1 to s5 exist. The test was run twice: on the s6 worktree alone, and on a scratch
worktree that merges the pushed heads of s1 (`49e691bef`), s2 (`3e2049e52`), s3 (`5180f873f`) and s4 (`4022ce0f8`) on
main (`d59952c17`). The scratch merge was local only, never pushed. s5 is docs only and has no check here.

### `python3 apps/console-web/plugins/build-orchestrator/test-emergency-access.py`, s1 to s4 merged: 45 passed, 0 skipped

```
  ✓ a scratch builds store in a temp folder is seeded (the live store is never used)
  ✓ the orchestrator CLI works on the scratch store
  ✓ the console token with no reason gets 400 naming the reason (400 reason is missing: say why this build goes to emergency (it is logged on the build and sent to Brett))
  ✓ the console token with a blank reason gets 400 naming the reason (400 reason is missing: …)
  ✓ builds.claudeEmergency off: the console token gets 403 saying where Brett switches it on (403 Claude sending builds to emergency is switched off. …)
  ✓ after every refusal nothing is tagged, granted or notified
  ✓ Brett's signed-in session still sends a build with no reason, even with the setting off (200 {'ok': True, 'id': 'rush', 'emergency': {'at': '2026-11-27T06:45:52.910Z', 'by': 'Brett', 'via': 'person', 'askedBy': 'Brett'}, 'already': False})
  ✓ his build is tagged emergency and holds the slot grant; no FYI for his own click
  ✓ the console token with a reason and a name sends the build (200 {'ok': True, 'id': 'calm', 'emergency': {'at': '2026-11-27T06:45:53.054Z', 'by': 'agent:Vinny', 'via': 'console-token', 'askedBy': 'agent:Vinny', 'reason': 'Login is down and Brett said send it to emergency'}, 'already': False})
  ✓ the build carries emergency: { by, via: 'console-token', askedBy, reason, at }
  ✓ the send is a note on the build with who asked and why (Sent to emergency by agent:Vinny (a Claude session, with the console token). Why: Login is down and Brett said send it to emergency It skips the line, builds in the emergency slots and lands first.)
  ✓ the emergency slot grant is on file for it
  ✓ one build-emergency-by-claude notification is asked of axf.notify@1 (1 of 1)
  ✓ the FYI names the build, who asked and why (calm sent to emergency: Asked by agent:Vinny (a Claude session). Why: Login is down and Brett said send it to emergency)
  ✓ notify.json declares build-emergency-by-claude (it may reach the phone) and the FYI's key lands on it
  ✓ the alert hub holds that one FYI
  ✓ sending it again changes nothing and asks for no second notification
  ✓ a signed-in hub user who is not an admin is still refused with 403
  ✓ the list shows both builds; canSend is Brett's click only, claudeCanSend says the setting is on
  ✓ builds.claudeEmergency is an owner-only toggle in the Builds group, on by default (only Brett's own click changes it)
  ✓ scratch build 'up': add / step / request-upgrade (3 checks)
  ✓ it waits on an Opus → Fable upgrade request
  ✓ the console token cannot approve an upgrade (… a model upgrade needs Brett's approval …)
  ✓ the console token cannot approve with an approver in the body
  ✓ the console token cannot deny an upgrade
  ✓ nor can an agent riding Brett's signed-in session
  ✓ nor can a session that sets the approver itself on the CLI
  ✓ Brett's own signed-in click approves it (the refusals above were about who asked)
  ✓ console control refuses function:build-orchestrator.approve / approve-upgrade / deny-upgrade / deny: Brett's own tap only (4 checks)
  ✓ console control does not hold send to emergency back as a deciding action
  ✓ the pipeline-emergency command takes id + reason (required) and askedBy, and is not marked person-only
  ✓ its description states the new rule and names the switch
  ✓ every approve / deny command of the plugin is still a deciding action (0 declared)
  ✓ pipeline.mjs emergency <id> from a session without --reason exits non-zero (exit 2: {"ok":false,"error":"reason is missing: a session sends a build to emergency only with --reason …
  ✓ and says so in plain words without --json
  ✓ with builds.claudeEmergency off the session's send is refused (exit 3)
  ✓ with --reason and --asked-by the session sends it: emergency { by, via: 'console-token', askedBy, reason, at }
  ✓ the CLI's send is a note on the build too, and the slot grant is on file
  ✓ an unknown build exits 2
  ✓ every write went to the scratch store
claude emergency access: 45 checks passed, 0 skipped
```

### The same file on the s6 worktree alone (main, the old rule): 21 passed, 9 skipped

```
  ✓ the old rule is what this worktree has: the console token is refused with 403, nothing tagged
  - skipped: the console token with a reason and a name sends the build (step s1 (the server rule) is not on this worktree yet)
  - skipped: the build carries emergency: { by, via: 'console-token', askedBy, reason, at } and a note (step s1 …)
  - skipped: one build-emergency-by-claude notification is asked of axf.notify@1 (step s1 …)
  - skipped: the console token without a reason gets 400 (step s1 …)
  - skipped: builds.claudeEmergency off gets 403 (step s1 …)
  ✓ Brett's signed-in session sends a build with no reason
  - skipped: builds.claudeEmergency is an owner-only Claude setting, on by default (step s3 (the Claude setting) is not on this worktree yet)
  ✓ … approve / deny refused for the token, console control (13 checks)
  - skipped: the pipeline-emergency command takes reason and askedBy (MCP, console control, voice) (step s4 … is not on this worktree yet)
  - skipped: pipeline.mjs emergency <id> from a session without --reason exits non-zero (step s2 (pipeline.mjs emergency) is not on this worktree yet)
  - skipped: pipeline.mjs emergency <id> --reason … from a session tags the build via console-token (step s2 …)
claude emergency access: 21 checks passed, 9 skipped
```

### Sibling checks on the merged scratch worktree

```
$ python3 apps/console-web/plugins/build-orchestrator/server/test_emergency.py
send to emergency: 44 checks passed
$ node apps/console-web/plugins/claude-settings/test.mjs
✓ claude-settings core — 109 checks
$ python3 apps/console-web/plugins/claude-settings/test.py
✓ claude-settings server — 55 checks
$ node framework/cli/plugin-lifecycle.mjs check build-orchestrator
✓ build-orchestrator: clean
$ node framework/cli/check-console-control.mjs
✓ console-control coverage — views 0, nav 0, tabGroups 0, settings 0, plugins 0, toolbars 0, dataGrids 0, rawButtons 386 (lower than the baseline: run --update to lock in rawButtons)
```

## Known gaps

- **Nothing was run on the lander's real merge.** The 45-check run is on a local merge of s1 to s4 as pushed at the
  time; s1 was being retried while this ran (the store showed it `failed`, then re-sent), so its final head may differ.
  CI on PR #933 runs the test on the real merge.
- **No browser or live-console run.** The web action `build-orchestrator.emergency` (s4), the MCP tool, `axf console …`
  and voice were not exercised end to end; the test covers the route, the store, the alert hub and the CLI in-process.
  No UI Review was submitted from this step.
- **The FYI was not seen on a phone.** The test proves the alert hub asks `axf.notify@1` once with the right type and
  that `notify.json` routes it with push on; delivery (ntfy / web push) was not sent.
- **The CLI's FYI is not asserted.** `pipeline.mjs emergency` posts its FYI to the console over `docker exec`; the test
  runs with `AXF_PIPELINE_CONSOLE=off`, so only the tag, the note and the grant are checked for the CLI path. That post
  is best effort: if the console is down the build is still sent and logged, with no FYI.
- **"When he says so" is not enforced by code.** The gate is a reason, a name and the switch. Nothing verifies that
  Brett actually asked; the log and the FYI are how he finds out.
- **`askedBy` is self-declared.** A token caller can put any name in the body or header. `by` equals `askedBy` for a
  token send.
- **"Upgrade actions" are covered as approve / deny only.** The test checks `approve` and `deny-upgrade` through
  `POST /act` and the CLI, and the console-control deciding rule. The plugin's manifest declares no approve / deny
  command of its own, so that manifest check passes on zero entries. Raising a step's model with `edit-step` is not
  covered here (the plugin's `test.mjs` covers the core rule).
- **Plan Studio 2.0's Send to emergency is still Brett-only.** Claude can send an existing build to emergency, not turn
  a plan into an emergency build in one call.
- **Kotlin twin deferred**, as recorded in `framework/spec/PORTING.md`.
- **`framework/spec/fixtures/console-control.json`** was in s4's file list but s4 did not change it;
  `check-console-control.mjs` passes without it.
