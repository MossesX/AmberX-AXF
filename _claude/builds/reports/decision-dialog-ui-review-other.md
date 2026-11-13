# Decision dialog: UI Review and other approvals pop up on any screen (decision-dialog-ui-review-other)

Built Nov 13 2026 on Opus, branch `claude/decision-dialog-ui-review-other`.

Brett said (2026-11-13 18:14): "anytime something goes to UI review I'm gonna get a notification, and another type of
dialogue just pops up like approve, for other types of things, an approve deny control panel"

## What changed
- **New plugin `decision-dialog`** (removable, plugin-lifecycle@1): one queue (decision@1) of everything waiting for
  Brett and one dialog (`decisions.show`) for all of it. Server: `types / list / item / shot / raise / answer / later /
  withdraw / settings`; capability `decisions@1` (`raise_decision`, `withdraw`, `waiting`, `get`). A decision names
  its source's `handler` capability; the answer goes back through `answer_decision(ref, button, option, note, by)`.
- **UI Review → notification + pop-up.** Every submit raises a `review` decision next to UI Review's own group
  notification (`notify: false`, so it buzzes once). The console reads the queue every 5 s (and on focus) and opens the
  dialog over whatever screen is open, never navigating; it waits while another dialog is open. Deciding the item in
  UI Review takes the decision back. `?axf-decision=<id>` (the notification's link) opens one.
- **The dialog:** type, build, app, title, notes; options side by side with their own desktop + phone pictures and
  **Pick option N**; **Approve as is / Approve**, **Request changes** (note required), **Reject**, **Later**, and
  **Open in UI Review** (the only button that navigates). Several waiting: "2 of 5 waiting" with previous / next.
  The decide row sticks to the bottom on a phone. Pictures are served by the decision plugin from the source's
  `shot_file` (only srcs the decision lists).
- **Other decisions, same dialog:** `types.json` registers each type's default buttons: review, veto, approval, confirm,
  model-upgrade, merge-clash, key-needed, pass, other; a source may send its own. The approvals banner offers held calls
  and waiting approvals through the generic `axf:decision` / `axf:decision-withdraw` window events (no plugin named);
  their buttons run the banner's own person-only actions, and the server refuses to answer such a button from anywhere
  but a console tap (403). Veto and approval don't pop up by default (their own screen already does); they sit in the
  queue and the counter.
- **Approve / deny control panel:** Settings → Plugins → Decision dialog → *Waiting for you* lists every waiting decision
  with its buttons inline (Pick… opens options in the dialog); menu Console → *Decisions waiting for me* with a badge.
- **Settings:** per type *Pops up* and *Notifies*, and how long *Later* waits. The alerts join the Notifications registry
  (`notify.json`: `decision.waiting`, `decision.popup`).

## How each part is reached (API parity)
| What | Console | REST | MCP / CLI | Voice |
| --- | --- | --- | --- | --- |
| Open a decision | dialog, `?axf-decision=<id>`, `decisions.show:<id>`, `decisions.next` | `GET item?id=` | `decision_dialog_item`, `axf decision-dialog item --id` | `decisions.next` |
| List waiting | Settings → Decision dialog, menu badge | `GET list` | `decision_dialog_list` | "what's waiting" → list |
| Answer | dialog / panel buttons | `POST answer {id, button, option, note}` or `{id?, text}` | `decision_dialog_answer` | `decisions.answer:<id|latest|N>:pick option 2` / `POST answer {text}` |
| Later | Later button | `POST later` | `decision_dialog_later` | "later" |
| Raise (sources) | `axf:decision` event | `POST raise` | `decision_dialog_raise`, `decisions@1` | n/a |
| Settings | switches | `GET/PUT settings` | `decision_dialog_settings(-set)` | `decisions.popup|notify:<type|all>:<on|off>` |

## Tests
- `decision-dialog/test.py` 37 checks (queue, refresh by ref, notify, answers by id / latest / place, pick by number,
  required notes, handler missing = 409, tap-only = 403, Later, withdraw, settings, words).
- `decision-dialog/test.mts` 10 (pop-up order, counter, parseAnswer, button aliases); `approvals-banner/test.mts` + 3
  (offer / withdraw diff); `ui-review/test.py` + 8 (submit raises, pictures by src only, answer lands, decided withdraws).
- check-theme, check-controls, check-toolbars, check-chrome-assets, plugin-commands (all), plugin-lifecycle
  (decision-dialog, ui-review, approvals-banner), help-coverage 100%, `tsc --noEmit`: all pass.

## Screenshots
Captured headless (rebuild-shots, `AXF_APPEARANCE_HUB=off`) after a real UI Review submit with three options:
the pop-up over Build orchestrator (desktop + phone) and the control panel (desktop + phone). Waiting in UI Review as `r-20261113-89d7348e` (PR #635).

## Not done / deferred
- **AmberX phone overlay** showing decisions: no new Android work; recorded in `framework/spec/PORTING.md` as a
  deferred twin. The phone gets UI Review's notification as before.
- Server-side sources other than UI Review (orchestrator model upgrades, merge queue clashes, systems-check keys,
  passes) have the type, buttons and API (`decisions@1`, `POST raise`, MCP, CLI) but don't raise yet: each needs a
  one-line call in that source.
- "Open in UI Review" opens the queue page, not the single item (UI Review has no item deep link yet).

## Incident
The dispatcher started two sessions on this build in the same worktree (agents Paulie and Sully, 18:19 and 18:20).
Sully overwrote `decision-dialog/server/__init__.py`, added `server/queue.py` and rewrote `ui-review/server/decisions.py`
with a different API, then ended at 18:25 without committing. This session restored its own tested versions and
removed the orphan module; nothing of Sully's is in the branch. Cost: about 10 minutes.
