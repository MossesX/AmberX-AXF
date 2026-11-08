<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md tokens=274 -->
## Record: change-log@1

`{ $axf, id, createdAt, updatedAt, kind, title, asked, repos[], model, who {session, where, user, host}, state, steps[], result, closed }`

- `id` = `chg-<YYYYMMDD>-<hex>`; the date picks the file: `changes/<YYYY>/<MM>/<id>.json`.
- `kind` is an open set (build, edit, remove, fix, other have labels and icons).
- `steps[]` = `{text, state queued|running|done|failed|skipped, startedAt, finishedAt, note}`.
- `result` = `{state done|failed|partial|cancelled, summary, branch, commits[{sha, message}], filesChanged, tests {name: {before, after, state}}, links {name: https URL or repo path}}`; `state` (top level) = the result's state, else `running`.
- `closed` = `{at, by}` or null.
- Long text is cut, anything that looks like a token or password is hidden (same rule as activity@1), links are https or plain repo paths only, an entry is at most 64 KB.
- JSON Schema for editors: the plugin's `schema/change-log.schema.json`. The validators are `changes-core.mjs` (Node) and `server/store.py` (Python); the self-test runs both on the same cases and checks they agree.
