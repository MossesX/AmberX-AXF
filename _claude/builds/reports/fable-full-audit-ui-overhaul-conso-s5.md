# Console audit, step s5: background loops and timers in the console server

Build `fable-full-audit-ui-overhaul-conso`, step s5 (reported item 4: runaway background processes and loops).
Companion to the s1 findings report (`fable-full-audit-ui-overhaul-conso.md`, F5/F6).

## Measured

- Live console (uvicorn, port 7090): py-spy, 60 s with `--gil`: 43 of 3000 samples held the GIL (about 1.5% of a
  core). Every background thread was asleep or waiting. No thread was spinning.
- The steady top item was the Activity watcher: a full feed rebuild every 15 s (it parses the builds store for the
  holds). It is bounded and cached, but it ran even when the plugin was off.
- The "~99% of a core" from earlier is the orchestrator demo's idle poller (s1 F5), removed in s4. Nothing in
  `server/` or `plugins/*/server` loops without a sleep or a blocking wait.
- Outside the console process: the maintenance host cron (`maint.py snapshot` → `du -sxb /root/axf-builds`) uses a
  full core for 1-2 min every 10 min. It already runs at `nice 19` / `ionice -c3`, so it gives way to other work.
  Left as is. Noted here because it shows up in `top` near the console.

## Fixed

| Where | Problem | Fix |
|---|---|---|
| `server/main.py` `/api/shell` | Each open host shell kept a default-executor thread busy with a 0.5 s `select` poll. That pool is shared with every `to_thread`/`run_in_executor` call. A closed shell was never `waitpid`-ed, so it stayed a zombie, and a shell that ignored SIGHUP lived on. A shell that exited left its socket open. | The pty is read with `loop.add_reader`, so there is no thread and no polling. On close the shell gets SIGHUP and is reaped, with SIGKILL after 5 s. When the shell exits, the socket closes. A write to a dead pty no longer raises out of the handler. |
| `console-terminal` `console_tmux` | Every open nav websocket ran its own `tmux ls` every 3 s, uncached (s1 F6). | Shared single-flight answer for 3 s. It is dropped when a tab is stopped. Test added. |
| `activity` watcher | Full feed rebuild every 15 s while the plugin was off. | Skips the pass while the plugin is off. |
| `chat-viewer` sync timer | Synced sources while the plugin was off. | Skips while off. |
| `maintenance` monitor | Raised disk/swap alerts and started the nightly run while the plugin was off. | Skips while off. |
| `chat-viewer` audio render | stderr was a pipe that was only read after stdout ended. A renderer that wrote more than 64 KB to stderr would block both processes forever. | stderr is drained on its own thread. The error text is kept. |
| `theme-manager` skin make | Fire-and-forget `Popen` was never waited on, so every run left a zombie. | A daemon thread waits on it. |
| `server/app_catalog.py` | The loop could not be stopped. | Stoppable event, and the lifespan stops it with the alerts hub. |

## Left on purpose

- `github-app` keeper and `ai-keys` refresh run whether the plugin is on or off. They keep GitHub and Claude
  credentials fresh, and turning a plugin off should not let a credential expire underneath other parts of the
  console. Both run every 5-10 min and cost little.
- SSE loops (`alerts`, `crew-live`, `console-commands`, `follow-amber`): uvicorn here reports ASGI spec 2.3, so
  Starlette watches for the disconnect and cancels each generator. None of them outlive their client.
