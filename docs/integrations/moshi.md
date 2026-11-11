# Moshi in the control registry

Moshi (`app.getmoshi.android`, https://getmoshi.app) is the third-party mosh / SSH terminal on Brett's phone; axHub's
handoff copies a ready `claude` command for it. It is not ours, so the registry lists only what Moshi itself publishes
(`apps/amberx-droid/registry/moshi.json`, owner `moshi`), checked Nov 11 2026 against
https://getmoshi.app/docs/notifications ("Open active sessions with deep links", Moshi 3.9.3+; `pane` / `tab` 3.13.0+).

## What can be controlled

| Entry | How | Notes |
|---|---|---|
| `moshi/app/moshi` · launch | Android launcher intent `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=app.getmoshi.android;end` | opens Moshi |
| `moshi/tool/tmux` · resume | `moshi://tmux?session=<name>&window=<0-9>&pane=<%id>` | resumes an **already active or minimized** tmux card; `window` sends the prefix + digit; `pane` needs a current moshi-hook daemon on the host |
| `moshi/tool/herdr` · resume | `moshi://herdr?session=<server session>&workspace=<id>&tab=<id>&pane=<id>` | resumes an active Herdr card; `session` defaults to `default` |

Each value is validated by the registry (patterns, `window` 0-9) and URL-encoded whole; empty optional parameters are
left out of the link. Every surface answers the same link as a **handoff** (`{ via: "url", url: "moshi://…" }`): the
phone opens it (a tap, AmberX, or Brett's browser). REST, MCP and the CLI cannot press anything inside Moshi.

```bash
axf ctl do moshi/tool/tmux resume --session "my project" --window 2
# → handoff moshi://tmux?session=my%20project&window=2
```

## What cannot be controlled (gaps in the registry, with this reason)

- **Opening a host or a new connection**: Moshi publishes no link or intent for it. Its deep links never discover a
  remote session or create a connection from a saved one; with no matching card Moshi shows an error.
- **Running a command, sending keys, typing**: not exposed.
- **Reading Moshi's state** (connections, cards, sessions): not exposed. tmux / Herdr state is read on the host instead
  (`vps/tool/processes`, `vps/tool/logs`).
- **Moshi's settings** (keys, hooks, notifications, look): only inside Moshi. The VPS side of Moshi's key is the systems
  check's `host-moshi-key`.

When Moshi publishes more (a new link, an intent, an API), add it to `moshi.json` with its source and remove the gap.
