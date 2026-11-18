# Rebuild differences: Phone Connect (rebuild-fresh-main-phone-connect-small vs PR #712 / AmberX)

Replaces: the Nov 15 attempt `phone-connect-small-android-companion` (PR #712, never merged) and, for the phone's
jobs, the AmberX app (`apps/amberx-droid`). Full report: `_claude/builds/reports/rebuild-fresh-main-phone-connect-small.md`.

| | Before | Now |
| --- | --- | --- |
| Credential | the phone's hub session cookie on every call | one-time code claimed with the hub sign-in once → revocable device token (hash at rest) |
| Contract | none written | phone-connect@1: spec, engine, fixture, JSON Schemas, CI check; Python port replays the fixture |
| Who decides an approval | not stated | personOnly: Approve/Deny open the hub page; a phone tap reaching the console is relayed only via approvals-relay@1 |
| Push | AmberX reads the alert feed | alert hub pushes to the paired phone; AmberX reads the feed until its code is removed |
| Open a page | axHub `amberx.open_url` → AmberX | the paired phone first (same tool name), url policy per phone |
| Recorder | AmberX OutputRecordService (two-track mic opt-in) | ported core (playback only, 30-min AAC parts, same axHub docs); mic track not yet |
| Voice | AmberX hands-free voice, wake word | one line: say / listen once (opt-in); phone phrases → console `phone.voice` |
| API | AmberX-only tools | REST, MCP `phone_connect_*`, CLI `axf phone`, voice `phone.*`, `GET state` with addresses |
| Removed | — | nothing deleted yet; AmberX code removal is build `remove-amberx-app-code-once-phone` |

Compatibility: axHub `amberx.*` tool names keep working; `amberx.recorder_start` still goes through the hub's approval.
Migration: an AmberX phone pairs Phone Connect once with a code (`migrateDevice` answers `unpaired` / reason `pair`).
Tests before: none for the phone link on main. After: 244 Python + 17 CLI + phase 1 fixture checks + app LinkRulesTest.
