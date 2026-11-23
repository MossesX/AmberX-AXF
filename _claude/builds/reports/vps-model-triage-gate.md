# vps-model-triage-gate

Hand build, Nov 23 2026. Plans: "VPS model triage gate" (Nov 21) and "Fable profiling" (Nov 19).

## Result

The orchestrator no longer picks models. One gate on the VPS does, for every lane.

- Orchestrator steps, emergency builds, hand builds and lander fix sessions all ask the same gate.
- Every decision is on the step (model, rule, why), in the build's notes and in the gate's log.
- New tab: Builds → VPS Configuration → Model triage. It shows the rules and the last decisions and sends edits to the VPS. No logic in the console.

## The flow now

Plan Studio sends → the orchestrator splits and writes the steps → the gate assigns each step's model → the dispatcher runs them → Plan Studio ticks them off.

## The rules (starting numbers, all editable)

An explicit override always wins: a pin on the step, a brief that names its model, or the build-wide model in Claude settings. Then the first rule that matches:

1. CI failures → Fable
2. Merge clashes → Fable
3. Second try (one failed session) → Fable
4. Contracts (schemas, specs, builds store, shared core) → Fable
5. Blast radius (10 files depend on it, measured on the VPS) → Fable
6. Size (400 lines or 8 files) → Fable
7. Cross-cutting (3 areas, or architecture words) → Fable
8. The splitter's own judgement stands (Fable or Opus)
9. The model policy's "might need Fable" words → Fable
10. The model policy's "clearly simple" words → Opus

No rule matched: Fable (your Nov 21 rule, "unsure = Fable").

## Calls I made (change any of them in the tab)

- **Default is Fable.** That is your Nov 21 rule, but it costs more than before: Pipeline 2.0 used to default to Opus. One select on the tab flips it ("When no rule matches").
- **A hand launch's model is a floor.** The gate can raise a hand build to Fable, never lower it. A brief that says "Model: Opus" still wins.
- **The splitter's model is a suggestion, not a pin.** Rules 1 to 7 can still raise a step the splitter called Opus.
- **Second try moves up after the first failed session.** Before, the watchdog only raised a step after every attempt was used.
- **"Fable upgrades need my approval" is respected.** Off (now): upgrades run. On: the gate holds the step on the lower model and the decision says it wanted Fable.
- **`builds.defaultModel`** stays, with new wording: "Per step" = the gate decides; Opus or Fable = every step runs on that, as an override.

## What changed

- New engine `framework/core/model-triage.mjs` and VPS side `framework/cli/model-triage.mjs` (rules, measured facts, decision log, CLI).
- `pipeline2.mjs`: split, assigning-models and retries ask the gate. `modelFor` is gone from the pipeline contract.
- `deploy/claude-headless.sh`: a hand launch asks the gate before anything else looks at its model.
- `deploy/lander/fix-session.mjs`: fix sessions ask the gate.
- Gate plugin: the tab, 5 REST routes, 5 MCP tools (`vps_model_triage*`), `axf gate model-triage`, voice actions, help.
- Builds store steps keep `pin` and `triage`.
- Spec `framework/spec/MODEL-TRIAGE.md`. Kotlin twin deferred (PORTING.md).

## Tests

- `p2-triage.test.mjs` (new, 38 checks): each lane gets its model from the gate, overrides win, decisions are on the step and in the log, second try, approval hold, rule edits.
- `check-model-triage.mjs` (new, 14 checks) with a fixture.
- Launcher test: a real hand launch runs on the gate's model and is logged (17 pass).
- Lander: 70 pass. Gate plugin: 26 + 66 routes pass. Pipeline 2.0 suites, watchdog, fill-slots, launch-retry, build rules, model policy: pass.
- Console build and typecheck clean. Theme, controls, toolbars, chrome, help coverage, plugin lifecycle: clean.

## Not checked here

- `check-builds-store.mjs` did not finish on the VPS: it hung over 10 minutes on a call to the live data store. I stopped it. CI runs it.
- `check-agent-slots.mjs` failed once on a 20 second timing check under load (load average 9), then passed twice, with my hook on and off.

## Not in this build

- The Fable profiling plan's profiles (named rule sets as assets), the "choosing CI model" status and the Fable review step. The rules are one ordered list with a lane switch per rule instead of two separate lists.
- Splitting the rest of VPS Configuration into more tabs (the plan's open step). Only the Model triage tab was added.
- The watchdog's last-resort raise to Fable still writes the model itself. It only ever raises, so it does not fight the gate.
- The old one-session pipeline: its split asks the gate, its phase launches are unchanged.

## Found on the way

- The budget settings (`builds.budgetPerBuildUsd`, `builds.budgetDailyUsd`) are stored but no code reads them. Nothing stops a build at its budget today. The gate did not change that.

## UI Review

Desktop and phone shots of the tab (rules and decisions) are waiting in UI Review.
