<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md tokens=192 -->
### 6. Model
- **Recommend** one of the top three models only, using the existing policy:
  - **Fable 5.1:** kernel internals, porting, cross-port contracts, heavy refactors
  - **Opus 5.5:** everything else, and anything security-adjacent
  - **Sonnet 5.5:** only when Opus is clearly not needed
- **Show:** the model the session is actually running on.
- **If his pick differs:** Claude can't switch models itself. Tell him the command (`/model <fable|opus|sonnet>`, or relaunch with `claude --model …`) and wait.
- **Check the pending build list** (`pending_list`) here as well: if something there is waiting on the picked model, mention it.
- **If no task has been given yet:** recommend from the open build-queue step (`build_next`). That's the most likely work.
