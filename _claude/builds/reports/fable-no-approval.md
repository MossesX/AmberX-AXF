# fable-no-approval — Fable upgrades need no approval

Build `fable-no-approval` (Current profile), Opus, branch `claude/fable-no-approval`. Booked on Snap Sully (Janitor Joey
and Ping Paulie were both on other jobs; the launcher had already set `AXF_AGENT=sully`).

## What Brett said (verbatim, Nov 4 2026, voice)

> I don't want the approvals. Just put everything that needs to be on Fable on Fable. No more approvals. If it needs Fable, set it to be Fable. And what about yesterday? Was anything that needed to be Fable done with Opus?

## What changed

**New owner-only Claude setting** `builds.fableUpgradeApproval`, *Fable upgrades need my approval* (Settings → Plugins
→ Claude → Builds), toggle, **default off**. Only Brett's own console click changes it (the existing owner test in
`claude-settings/core.mjs`); a session, agent or tool can't, in either direction.

**Policy in the model-switch module** (`framework/core/model-switch.mjs`): `setUpgradePolicy` / `upgradePolicy` /
`upgradeNeedsApproval`, `phaseApproved` and `heldSteps` take the policy, `switchRule()` gives the brief line for it
(`SWITCH_RULE` unchanged for "on", new `SWITCH_RULE_AUTO` for "off"). The pure module is **strict until set**, so a
caller that never reads the setting can't let an upgrade through by accident.

**Reader** `framework/cli/upgrade-policy.mjs`: reads the hub's Claude settings document
(`/projects/_shared/_data/claude/settings.json`, or `AXF_CLAUDE_SETTINGS_FILE`). No document or key = default (off).
`AXF_FABLE_UPGRADE_APPROVAL=1` can only make it stricter (tests); nothing in the environment turns it off when Brett
has it on. `node framework/cli/upgrade-policy.mjs [--json|--rule]`.

**Who follows it:**
- Orchestrator core: with approvals off an upgrade phase is clear; ticking its first step (or `request-upgrade`)
  records the switch: `approvals[]` `{kind: upgrade, by: auto, via: policy, note}`, a build note
  (`Model switch: phase N Opus → Fable. …`), open requests on that phase closed. Raising a step to Fable needs nobody.
  `deny-upgrade` and the real approval path (console click, `axf.orchestrator_upgrade_approve`) still need Brett and
  are kept for when the setting is on.
- Orchestrator CLI loads the policy, returns it with `state` (the console page takes it from there), and
  `request-upgrade` says "carry on" instead of "stop" when it is off.
- Console Build orchestrator → Approvals: the header and badges say which mode is on; automatic upgrades show
  "Upgrade: automatic / Upgraded by itself".
- Launch gate (`model-gate.mjs launch`): an upgrade phase starts by itself. The **step pin still holds**: launching
  an Opus step on Fable is refused with "set its steps to Fable first (no approval needed)". `audit` labels automatic
  upgrades.
- Swarm planner (`agent-swarm/swarm.mjs`) loads the policy: no held steps while off.
- Headless briefs (`deploy/claude-headless.sh`) carry the rule line for the policy in force (`upgrade-policy.mjs
  --rule`), falling back to the strict line. Console MCP instructions updated.

**Rule** in `_claude/rules/RULES.md` ("Model switches: no Fable approvals"), the Nov 3 rule now says it applies only
while the setting is on. Decision in `_claude/memory/decisions.md`. The shared rules file
(`_claude/shared/rules/RULES.md`) still has the Nov 3 wording: claude-sync holds it (changed on both sides), so it
wasn't edited here.

## Applied now

Upgrade phases that were waiting with no approval, now recorded as automatic upgrades (via policy) with a build note:

| Build | Profile | Phase | Steps |
|---|---|---|---|
| toolbar-tap-confirm | urgent | 2 (Contracts) | s13, s14 (drag-and-drop contracts) |
| browser-automation | current | 2 | s5 |
| batch-manager | angel | 2 | s2–s7 |
| grid-sort-filter | angel | 2, 4, 6 | s2–s3, s5–s6, s9 |
| plugin-cleanup | angel | 2 | s2 |
| transcription-engine | angel | 3 | s4 |

`windows-terminal` (archived) left alone. No open upgrade requests were in the store.

**toolbar-tap-confirm:** its phase 2 is now clear, but the reconciler keeps the build `complete` (PR #272 merged) with
s9–s21 still open, so nothing picks s13–s14 up from it. Running them needs a follow-up build (Brett's call: a new
`toolbar-tap-confirm-2` with s9–s21, s13–s14 on Fable).

## "What about yesterday?" — Opus-built foundation work, Nov 3–4

Yes. These were built on Opus, and their reports say they should get a Fable review. They are all queued as the
Fable build **`fable-review-nov3`** (Current profile, 7 Fable steps, ~3 h 15 min, read-and-fix, merges when green):

1. banner-ref-links (#287): ref@1 matching rules (cross-app GUI behaviour contract).
2. plugin-settings-placement (#289): settings-placement@1.
3. molly-console-commands (#288): Molly ↔ app messages (embed@1 front-message addition).
4. molly-nav-submenus (#295): nav-style contract (its report asks for a Fable review).
5. smart-menus (#281): smart-menu engine contract, plus the `menu-style` asset type from Addendum 3 that was skipped
   *because* a new asset type needed an upgrade approval.
6. crew-live (parked part): the avatar `agent` source asset-type change.
7. Report + PR.

(hub-look-all-assets / one-look-opus were Nov 1 and already had their Fable review in `one-look-default`.)

## Tests

| Check | Before | After |
|---|---|---|
| `framework/spec/check-model-policy.mjs` | 16 | 18 |
| `build-orchestrator/test.mjs` | 1 check fails on live store data* | +3 policy checks pass |
| `build-orchestrator/server/test_upgrade.py` | 12 | 12 (pinned to approvals on) |
| `agent-swarm/test.mjs` | 100 | 100 |
| `claude-settings/test.mjs` / `test.py` | 46 / 21 | 46 / 21 |
| `check-builds-store.mjs`, `check-ui-predict.mjs` | 37 / 12 | 37 / 12 |

\* `repo store: orchestrator builds are valid and small-stepped` fails on `console-wake-finish` (a step over 30 min
in the live store the session-start hook synced in). That's data, not this change.

**CI (first run, PR #319):** red on *Web Dev Console + Python API*, at `ai-assistant/test.py` → "CLI gets the console
tools over MCP; its own Edit/Bash stay off" (the fake Claude CLI bridge). This diff doesn't touch it, it passes
locally (143/143), and `profile-lists-home-card`, `crew-profiles` and `bugs-board` went red in the same window. The
loop stops at the first failing plugin test, so `build-orchestrator/server/test_upgrade.py` never ran there (it
passes locally). Gradle, AmberX and the build engine sweep passed.

## Known gaps

- Change-log entries for each automatic switch: recorded in the build notes, `approvals[]` and the builds store
  journal. The core can't write the Codebase changes log (another plugin), so it isn't written there per switch. This
  session's change-log entry lists them.
- Kotlin: none needed (orchestrator and gate are web/Node only).
