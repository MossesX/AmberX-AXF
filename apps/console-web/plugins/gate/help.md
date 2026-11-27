# VPS Configuration

Builds → **VPS Configuration**. The rules a pull request must pass before it lands on main, the auto-lander that lands it,
and the history of every change to either. Contract: `framework/spec/GATE.md` (gate-rules@1).

## Rules
Each row is one rule: CI green, tests after regeneration, theme tokens, framework controls, toolbars, UI Review, no
code clash with main, and "only the lander merges". The switch turns a rule on or off. The chip is its severity:
**block** (the PR waits), **warn** (it lands and History says so), **info** (recorded only). The sliders button opens
the rule's settings under its row. **Reset to defaults** puts every rule back (it asks first). **Check a PR** answers
"can this PR land?" from what the lander knows, rule by rule, without changing anything.

## Auto-lander
**Merge queue** is the one switch: on, ready PRs go through the stacked merge queue and the one-at-a-time lander is
off; off (the default), the auto-lander lands each finished build one at a time: main merged in first, clashes fixed,
then landed. Flipping it takes effect at once and is written to History. The status card says whether the lander is
running, paused, idle or off, and which PR is landing. **Waiting** lists every PR in line with the rule that holds it
and why. **Land now** (or a row's **Land next**) puts a PR at the head of the line; it still passes every rule.
**Pause** stops anything new from starting (what is in flight finishes); **Resume** carries on in the current mode.

## History
Every rule change and lander action: who, when, what it was before and after, and why. Filter by kind.

## Without the screen
- CLI: `axf gate rules list`, `axf gate rules off ui-review`, `axf gate check 705`, `axf gate lander mode on`,
  `axf gate lander pause --why "…"`, `axf gate history --kind lander`.
- MCP: `gate_rules_list`, `gate_rules_toggle`, `gate_check_pr`, `lander_status`, `lander_land_now`, `lander_pause`, …
- REST: `/api/plugins/gate/rules`, `/check?pr=`, `/lander`, `/lander/mode`, `/history`, `/settings`.
- Voice: "open the gate", "turn off the UI Review rule", "can 705 land", "pause the lander", "land 705 now".

## Settings
Settings → Plugins → VPS Configuration: how often the open tab refreshes, how many History entries are kept, which tab it opens on.
