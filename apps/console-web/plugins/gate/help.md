# Gate & rules

Builds → **Gate & rules**. What a build must pass before it lands on main, who lands it, and everything that changed.
The screen only shows what the server answers and sends your taps to it. Contract: `framework/spec/GATE.md`
(gate-rules@1).

## Overview
The pipeline at a glance: the lander, what is landing, the merge line, how many gates and build rules are on. Tap a
tile to open its tab. **Run now**, **Pause lander** / **Resume lander** and **Check a PR** are here too.

## Gates
Every gate rule, in four groups: Checks (CI green, tests), UI standards (theme tokens, controls, toolbars), Approvals
(UI Review) and Landing policy (no clash with main, only the lander merges). The switch on a row turns the rule on or
off. Tap a row for its severity (**block**: the PR waits; **warn**: it lands and History says so; **info**: recorded
only), who runs it and its settings, each with what it does and its default. **Reset this rule** and **Reset to
defaults** put the defaults back (they ask first). **Check a PR** answers "can this PR land?" rule by rule and changes
nothing. **Add a policy** adds a custom rule.

## Build rules
Every rule a build follows, grouped by when it applies. A VPS rule is done by the VPS and never reaches a session; a
session rule rides in the session's brief. Filter by who, when, kind, state or a search. Tap a rule for its text, last
runs and changes; **Edit** opens the rule dialog (Delete is there). **Run a build's rules** runs one phase for a build
(dry run first). **Preview a session's brief** shows exactly what a session would be told.

## Merge line
**Merge queue** is the one switch: on, ready PRs go through the stacked merge queue; off (the default), each finished
build lands one at a time: main merged in first, clashes fixed, then landed. **Waiting to land** lists every PR in line
with the rule that holds it and why; tap one for **Land next** (it still passes every rule) and **Check this PR**.
**Pause** stops anything new from starting; **Resume** carries on. **Last runs** shows what the line did.

## Lander
The VPS lander that fixes and lands finished builds by itself. The tiles say whether its service is up, down or
paused and what is landing. Tap a build for its PRs, steps, what failed and its status log; **Retry** makes its next
attempt due now, **Fix now** starts a fix session. The lander decides when those can be pressed.

## Limits
The lander's limits: lines one PR may carry (the size cap), retries and waits, timeouts, the merge method and the CI
workflow, and **Land by itself**.

## Model triage
Kept for the VPS model triage gate, which is not built yet.

## History
Three lists in one dropdown: gate and merge line changes (who, when, before and after), build rule changes, and build
rule runs. Filter by rule, PR, action, build, result or a date.

## Without the screen
- CLI: `axf gate rules list`, `axf gate rules off ui-review`, `axf gate check 705`, `axf gate lander mode on`,
  `axf gate lander pause --why "…"`, `axf gate history --kind lander`, `axf gate auto-lander status`.
- MCP: `gate_rules_list`, `gate_rules_toggle`, `gate_check_pr`, `lander_status`, `lander_land_now`, `lander_pause`, …
- REST: `/api/plugins/gate/rules`, `/check?pr=`, `/lander`, `/lander/mode`, `/history`, `/settings`, `/auto-lander`.
- Voice: "open the gate", "turn off the UI Review rule", "can 705 land", "pause the lander", "land 705 now".

## Settings
Settings → Plugins → Gate: how often the open tab refreshes, how many History entries are kept, which tab it opens
on, how the lists are drawn, and the lander's limits.
