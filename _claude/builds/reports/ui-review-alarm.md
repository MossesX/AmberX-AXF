# ui-review-alarm — UI Review alarm (report)

Build `ui-review-alarm` (Angel profile, Opus), branch `claude/ui-review-alarm`, Nov 4 2026.

## What Brett said (verbatim, Nov 4 2026, voice)

> From now on, open UI Review, but if they don't get approved in 30 minutes, set an alarm off on my phone, a loud-ass
> alarm. That gives me five more minutes before it gets approved. … After 30 minutes, if it's not been reviewed, it
> needs to do a loud alarm five minutes before it's gonna be run. And if the alarm is unanswered, then don't run it.
> No, then run it. Make it a switch. Either or.

Addenda 1–5 (sort by PR, newest-first default, live previews, per-item theme pickers, Layout Apply) and the
three-layouts addendum are in the build's origin.

## Done in this PR (steps s1–s5)

| Step | What |
| --- | --- |
| s1 | `server/alarm.py` pure core (ui-review-alarm@1): window 30 min → alarm → grace 5 min → switch (approve / hold); answered = paused; quiet hours (silent / hold, IANA zone, wraps midnight); scope all / blocking; clock starts at max(submittedAt, since, undo) so already-waiting items don't ring on deploy. |
| s2 | Router + 30 s ticker: `GET alarm`, `GET/PUT alarm/settings`, `POST alarm/answer`, `alarm/undo`, `alarm/tick`. Alarm = `critical` console alert with `meta.alarm` + `meta.native` (VetoAlarm config: tone, volume, vibration, repeat, throughSilent, fullScreen) + Follow Amber show. Auto-approval = decision by `ui-review-alarm`, comment "auto-approved after alarm went unanswered", Breakroom notice (new `axf.crew@1` `say()` → swarm `notice` action, posted by Boss), Undo re-opens. Hold = history line, item stays waiting. |
| s3 | Open UI Review on every new item (submit hook → Follow Amber show + phone notice). plugin-commands@1 items (REST/MCP/CLI, `forFramework`), voice examples ("don't auto-approve UI reviews" = `unanswered: hold`). CLI `review.mjs alarm [status] / set k=v / answer / undo`. |
| s4 | List (addenda 1 + 2): default order = time added, newest first, ↑/↓ toggle, *Pin waiting on top* (on). Sort/group switch Flat · By PR · By date · By build · By type (remembered; groups ordered by their newest item). Every row: PR link, added time (relative, exact on hover), short copyable item id, alarm chip (countdown / ringing / answered / auto-approved / unanswered). Search matches id, PR number, build. Deep links `ui-review?item=<id>` (opens, highlights, answers a ringing alarm) and `?pr=<n>`. |
| s5 | Settings → Plugins → UI Review → **Review alarm** panel; README section; help entries. |

## Not done yet (left open on the build)

- **s6–s8, addenda 3–5 + layouts:** live previews in the active theme, per-item Color/Style/Layout dropdowns (Layout =
  only the screen's 3 generated layouts, from `three-layouts-per-screen`, not merged yet), compare, Layout Apply →
  follow-up step/build. Not started. The RULES.md line "every UI Review submission ships a live preview fixture"
  waits for s7, so no rule was added for a feature that doesn't exist yet.
- **s9 — NEEDS A NEW AMBERX APK:** the phone gets the alarm today only as a *critical notice* (ntfy / web push /
  AmberX notice). The loud full-screen alarm through silent mode needs AmberX to ring `VetoAlarm` for alerts with
  `meta.alarm` (USE_FULL_SCREEN_INTENT + alarm channel) — native code, new APK, then Brett installs it.

## Tests

- `python3 apps/console-web/plugins/ui-review/test.py`: 196 → **227** checks (31 new: timer on a fake clock —
  29/30 min, grace, approve / hold, answered, stop on manual decision, since, undo, off, scope, quiet silent / hold,
  midnight wrap, tick, due_at; routes: settings validation, open-on-new, ring, auto-approve logged, Breakroom notice,
  undo, answer, 404).
- `npx tsx apps/console-web/plugins/ui-review/test.mts`: 23 → **24** checks (sort default newest, pinned, added ≠
  updated, By PR / By date grouping and order, id / PR / build search, deep links, ago, shortId).
- agent-swarm `test.mjs` 100 passed; `tsc --noEmit` clean; check-theme, check-controls, check-toolbars,
  help-coverage, check-plugin-commands, plugin-commands tests, check-control all green.

## Screenshots

`shots/` (mock data, vite preview): `by-pr-{desktop,phone}.png`, `alarm-item-{desktop,phone}.png`,
`alarm-settings-{desktop,phone}.png`. Submitted to UI Review.
