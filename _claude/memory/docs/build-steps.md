# Build steps — small steps for big builds (Oct 21 2026, Fable)

Rule (`_claude/rules/RULES.md`): every build estimated at more than 30 minutes is split into steps of 30 minutes or
less, each with its own estimate, so it can be worked on little by little. Builds of 30 minutes or less stay whole.

## Where the steps live

- **Pending items** (`framework/plan/pending.json`): the sub prompts *are* the steps: `subPrompts[] = { text, at, estimate?, done?, doneAt? }`.
  Tick one off with `pending_change(action="step", id, index, done=true)` (MCP), `{action:'step', id, index, done}` on
  `POST /api/pending`, or the checkbox in the console's Pending builds view. `pending_steps(id)` lists them numbered
  with the time left. `update` takes `subPrompts` to replace the whole list (re-splitting).
- **Build-queue steps** (`framework/plan/build-queue.json` → `steps[epicId]`): `estimate?` and `steps?: [{ text, estimate?, done?, doneAt? }]`.
  Edit with `build_steps(id, …)` (MCP), `POST /api/build-queue/steps`, engine-rpc `build-steps`, or
  `stepsAction` in `build-queue-core.mjs`. The queue view carries `estimate`, `steps`, `stepsDone`, `minutesLeft`,
  `needsSplit`, `splitReasons` per step and `minutesLeftByModel` + `unsplit` overall.
- **Validator**: `splitCheck(entry)` / `needsSplit(entry)` in `pending-core.mjs` (works on a pending item or a queue
  record) = estimate over 30 min with no steps, a step over 30 min, or a step without an estimate on a big build.
  `stepsProgress(entry)` = done/total + minutes left. Console rows show "needs splitting" and "n/m steps · time left".
- **CI** (`android.yml`, node job): `node framework/spec/check-build-steps.mjs` (40 core checks, fails),
  `node framework/cli/pending.mjs --check-steps` and `node framework/cli/build-queue.mjs --check-steps` (list what is
  unsplit; warn only, `--strict` fails).
- Plan epics that mirror a pending item (`x.assets.designer/browser/templates`) carry the same steps as the item;
  tick them in one place (the pending item) and mark the epic built at the end.

## How to read an estimate now

The new total of a split build is its steps added up, and every step is capped at 30 min. That is the honest budget
for "work on it a little at a time": a step that runs over 30 minutes is split again, not stretched. Where the old
estimate was a day-sized block (2 d, 7.5 d) the step list came out shorter because it counts concrete pieces, not
sessions; where it was tight (named-asset-rule, plugin-conflicts) the list came out longer because design and review
steps were missing. Treat totals as "at least".

## Pending items (all Fable)

| Item | Old → new | Steps | Needs Brett |
|---|---|---|---|
| `named-asset-rule` Every UI element is a named asset | 6 h → **7.5 h** | 15 | step 2: rename vs alias the starter ids; element assets required or opt-in |
| `asset-designer` Asset Designer plugin | 2 d → **1 d** | 16 | — |
| `asset-browser` Asset Browser plugin | 6 h → **5 h** | 10 | — |
| `asset-templates` 10+ templates per type | 1 d → **7 h** | 14 | — |
| `app-port-engine` Port a non-AXF app (bake/rebuild) | 2 d → **1 d** | 16 | step 13: attach MossesX/xGallery and review its report; step 14 pushes a branch there |
| `lib-clone` Clone an install with data | 1 d → **6 h** | 12 | step 1: which data is copied by default; users/members kept?; step 10: attach xGallery |
| `plugin-conflicts` Conflict alarm + AI patches (**unsafe**) | 6 h → **6.5 h** | 13 | steps 1–2 are the design notes; step 3: Brett approves the design (conflict kinds, overlay patches, backup + reinstall) before it leaves `unsafe` |
| `build-pilot-contract` Build Pilot contract (Fable rebuild) | 5 h → **4.5 h** | 9 | step 1: attach MossesX/Build-Pilot |
| `axhub-agent-host` Agents + sessions on axHub | 2 d → **1.5 d** | 20 | step 1: attach MossesX/axHub; step 19: approve the hub redeploy and run a turn from the phone |
| `console-android-app-tabs` (already split by the other session) | 1.5 d → **1 d** | 10 → 19 | — (every step was over 30 min; re-cut 1a/1b/2a… keeping the original numbering) |
| `console-android-native-tabs` (already split) | 7.5 d → **2.5 d** | 12 → 39 | — (same; the old 1.5 d / 1 d steps became 4–6 pieces each) |

Complete items untouched. Every open item now has an estimate. **Time left on the pending list: Fable 11.5 d**
(`pending.mjs --check-steps`).

## Build-queue steps (plan epics; first estimates, they had none)

| Step | Estimate | Steps | Model | Note |
|---|---|---|---|---|
| `x.modules` Module system on web + python | 4 h | 8 | Fable | |
| `x.state` State, cache, events, flags, config, migrations on web | 4 h | 8 | Fable | |
| `x.uikits` UI-kit switching + fallback on web | 3.5 h | 7 | Opus | |
| `x.plugins` Plugin runtime (PACK kind real, MODULE/SCRIPT stay placeholders) | 5 h | 10 | Fable | |
| `x.work` Background work scheduler | 3 h | 6 | Fable | |
| `x.session` Session, principal, audit log (+ axHub provider) | 3.5 h | 7 | Opus | |
| `x.libs.core` admin, accounts, profile, billing real | 6 h | 12 | Opus | Play Billing parked as its own feature |
| `x.python.port` Python / PyQt6 port | 1 d | 17 | Fable | |
| `x.engine.uiport` import-ui on a real library | 2.5 h | 5 | Opus | |
| `x.engine.dev` live reload end to end | 2 h | 4 | Opus | |
| `x.console.repo` console in its own repo | 2.5 h | 5 | Opus | **step 1 needs Brett** (he said "not yet"; also picks tag-tarball vs submodule) |
| `x.deploy.console` | 30 min | whole | Opus | **needs Brett**: confirm the 5-minute cron on the VPS, then mark done |
| `x.showcase.packs` | 3 h | 6 | Opus | step 5: Brett checks the packs on his phone |
| `x.lib.media/location/editor/ai/vps/github/notifications/sensors/files/charts` | 3 h each | 6 each | Opus | scaffold → 3 specific pieces → demo app → tests/status |
| `x.assets.designer` / `.browser` / `.templates` | 1 d / 5 h / 7 h | mirror the pending items | Fable | |
| `x.plugins.manager` | 30 min | whole | Fable | already built (pending `plugin-manager` complete): mark the epic built |

**Time left on the queue: Fable 6.5 d · Opus 6 d** (`build-queue.mjs --check-steps`).

## Everything that needs Brett, in one list

1. `named-asset-rule` step 2 — two decisions (rename vs alias; element assets required or opt-in).
2. `lib-clone` step 1 — what a clone copies by default; users/members kept or not.
3. `plugin-conflicts` step 3 — approve the design notes before the item leaves `unsafe`.
4. Repos to attach when their step comes: Build-Pilot (`build-pilot-contract` 1), axHub (`axhub-agent-host` 1), xGallery (`app-port-engine` 13, `lib-clone` 10).
5. `axhub-agent-host` step 19 — approve the hub redeploy, run one turn from the phone.
6. `x.console.repo` step 1 — say go (and pick the dependency style).
7. `x.deploy.console` — confirm the VPS cron, then it's done.
8. `x.showcase.packs` step 5 — look at the packs on the S26 Ultra.

## Artifact sync

The claude.ai Pending Builds page mirrors `subPrompts` (with `estimate`, `done`, `doneAt` as epoch ms) and `estimate`
per item. The per-item payload to push is in the session scratch file `artifact-sync.json` (produced by the split
run; regenerate with `toArtifact` from `pending-core.mjs` if needed).
