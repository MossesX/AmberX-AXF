# Rebuild report — `agent-swarm-fable-rebuild` (Agent swarm, Fable rebuild Nov 3 2026)

Branch `claude/agent-swarm-fable-rebuild`, profile Breakroom, steps s1–s6 on Fable, s7 (this report) written by the
same Fable session on Brett's voice instruction "do every step it lists" (the step is pinned to Opus in the
orchestrator). Replaces the parts of the Opus build of Oct 31 2026 (`claude/agent-swarm`, PR #196, 19 steps) that the
Fable review of Nov 1 2026 flagged (`_claude/builds/reports/fable-review.md` §6): the swarm's data contracts lived only
inside the console plugin. agent-card@1 passed the review and was not rebuilt; job-type@1 was already on the model policy.

## Summary

The agent swarm keeps every feature, route, view, setting and data file of the Opus build. What changed is **where the
truth lives**: the seven swarm records (agent@1, agent-skill@1, swarm-roster@1, swarm-state@1, swarm-job@1, swarm-run@1,
swarm-report@1), the group chat contract and the vibe engine are now **framework engines** under
`framework/core/engines/` with one registry each, normalizers, validators that name the field, JSON Schemas, a registry
snapshot written by `axf schemas`, fixtures under `framework/spec/fixtures/` and one CI check
(`framework/spec/check-swarm.mts`, 223 checks). The console plugin (`apps/console-web/plugins/agent-swarm`) re-exports
them; the check proves the plugin's functions *are* the framework's (never a copy), so the contracts cannot drift again.
Every model choice goes through model-policy@1. The planner, the context packer and the avatar were reviewed and
replaced where the review found them weak. Self-tests: plugin 80 → 87 checks, agent-card 61 → 84, new swarm check 223.

## Removed
- The plugin's own copies of the contracts: `normAgent`, `normRoster`, `parseSkill`, `checkRoster`'s rules, `normAgentState`,
  `normState`, `normChat`, `normMsg`, `normChatSettings`, `normCardDesign`, `normCards`, `parseReport`, `emptyUsage`,
  `budgetTokens`, the status table, chat kinds, sliders, presets, avatar enums, `SHARED_FILES` (all in `web/swarm-core.mjs`).
- The planner's dead Haiku/Sonnet word lists (`TIER_WORDS.haiku`, `CHEAP_SKILLS`, the two-pass `requiredTier(step, skill)`).
- The avatar's hard-coded SVG paths and per-gear JSX branches in `web/cards.tsx`.
- Inline Boss strings in `applyChange`, `tick`, `recordRun`, `payCheck`, `jobs.mjs` (hire) and `swarm.mjs` (agent cap wait).
- The chat engine's own `post`, `chatOn`, line builders, banter bank, `reactors`, `banterPrompt`, `parseBanter`; the vibe
  engine's word lists and functions (both moved, see Added).
- Nothing user-visible was removed. Every tab (Crew, ID cards, Agents, Jobs, Build plan, Cost, Group chat, Chat settings),
  action, CLI command, settings key, data file and API route of the Opus build still exists with the same name.

## Kept (unchanged ids and behaviour)
- Plugin id `ai.amberx.axf.console.agent-swarm`, folder, `plugin.json` (provides `view:agent-swarm`, `settings-tab:agent-swarm`,
  `service:agent-jobs@1`), lifecycle data dir, env names; `swarm.mjs` commands and `--json` shapes; `jobs.mjs` and the
  `agent-job.mjs` router; the Python server part (reads through the CLI only).
- Data files and their shapes: `agents/roster.json` (swarm-roster@1; gains an optional `fallback`), `agents/skills/*.md`,
  `state.json` (swarm-state@1), `runs.json` (swarm-runs@1 of swarm-run@1), `merges.json`, `pilot-*.json`. Old files load
  unchanged: every normalizer fills defaults and drops junk exactly as before (the fixture pins the outputs).
- agent-card@1: the four starters, `cardModel`, `AgentCard.tsx`, `.fx-idcard` (tokens only). The ID card layout was
  checked and left alone.
- The Breakroom's looks: the avatar draws the same paths with the same classes and tokens, so every screen is pixel
  identical to the Opus build (see Screenshots).
- The banter bank's lines, the presets (All business / Work crew / Break room / Off the rails), the vibe scale 1–500,
  the cussing bands (34 / 67), the drama threshold (30), the chattiness bands (20 / 60), the daily banter budget rule.

## Changed
- **Models (s1, s2):** `requiredTier(step)` = the step's orchestrator pin (any spelling, through `modelKey` + `coerceModel`),
  else the policy's own `modelForWork` (foundation words → Fable, the rest → Opus). Before: a Fable pin only counted when the
  step text also matched a private regex, and a text about "engines" forced Opus even when pinned to Fable. A raw record
  naming Sonnet or Haiku is refused by name by the validators (stored ones still load, coerced up).
- **Planner (s2):** a step no skill matches goes to the roster's `fallback` agent when it names one, else the most
  capable agent (largest token budget), never the cheapest by accident (before: the $5 docs agent took every unmatched
  step). `leasesOverlap` also catches a folder lease against a glob rooted inside it (`apps/console-web/` vs `apps/*/src/`).
  One agent works one job at a time across builds (before: only within one build). Every job is shaped by `normJob`.
- **Context packer (s3):** `extractSnippet` scores each hit line (one per distinct task word, +1 for a definition line;
  task words on more than a quarter of the file's lines are ignored) and keeps the best within the 120-line cap, printed
  in file order (before: first hits in file order, so the right function at the end of a long file was cut off).
  Area-leased jobs now get an outline of each leased folder (own files, subfolders with counts, 60 lines shared across
  folders) and the prefix lets them read inside their leased folders (before: an area job got no context at all and was
  told not to explore). Measured on this build's own s3 job: prompt 4 321 → 352 tokens; the shared prefix is 442 tokens,
  skills 120–225.
- **Avatar (s4):** drawn from `avatarModel(agent.avatar)` in the card rules: a part list (bg, shirt, face, hair, eyes,
  mouth, gear) with role paints and the two theme tokens the hue picks. The React `Avatar` only renders the list.
  `AGENT_CARD_SAMPLE` carries an `avatar` and its favourite model is Opus (was Sonnet).
- **Chat (s5):** every Boss line and crew line is a builder in `swarm-chat.mjs`; `messageErrors` enforces who may post
  which kind and that a job line names its job. Found and fixed: Boss's "clean up this clash" line is a `handoff`, which
  the speaker table did not allow Boss until the fixture caught it.
- **Vibe (s6):** the word lists are a registry (`VIBE_WORDS`, `VIBE_WEIGHTS`, `VIBE_LEVELS`) and `post` takes the filter
  as a hook, so a port can replay the same fixture.

## Added
- `framework/core/engines/swarm-rules.mjs` (+ `.d.mts`): `SWARM` registry, `TAGS`, normalizers and validators for the
  seven records, `swarmErrors` / `normSwarm` front doors, `parseReport`, `budgetTokens`, `jsonSchemas()`; swarm-roster@1
  `fallback`; swarm-run@1 is one record for the swarm runner (kind `build`) and agent jobs (kind `job`).
- `framework/core/engines/swarm-chat.mjs` (+ `.d.mts`) and `framework/core/engines/swarm-vibe.mjs` (+ `.d.mts`).
- `framework/core/engines/agent-card-rules.mjs`: `AVATAR_BOX`, `AVATAR_HAIR`, `AVATAR_FACE_SHAPES`, `AVATAR_GEAR_PARTS`,
  `AVATAR_PAINTS`, `avatarColors`, `avatarModel`.
- `framework/schemas/swarm.json` (registry snapshot) and seven JSON Schemas in `framework/schemas/json/` (`agent`,
  `agent-skill`, `swarm-roster`, `swarm-state`, `swarm-job`, `swarm-report`, `swarm-run`), written by `axf schemas`.
- Fixtures `framework/spec/fixtures/swarm.json`, `swarm-chat.json`, `swarm-vibe.json`, and `avatar` in `agent-card.json`.
- `framework/spec/check-swarm.mts` (CI, `android.yml`): fixture replay for every normalizer, validator, builder and vibe
  rule; the snapshot and schemas current; the shipped roster and skills valid and on allowed models; the plugin's core
  re-exports the framework's functions.
- Plugin core: `folderIndex`, `indexBlocks`, `FOLDER_INDEX_MAX`; `swarm.mjs listFolder`. Planner tests for the policy, the
  fallback, cross-build sequencing, folder-vs-glob overlap and the job contract; packer tests for best-hit snippets and outlines.

## Contract / API / asset / fixture changes
- New record contracts (framework-owned now): agent@1, agent-skill@1, swarm-roster@1 (+ `fallback`), swarm-state@1,
  swarm-job@1, swarm-run@1 (+ `kind`), swarm-report@1. Validators return `{ field, code: missing|invalid, message }`.
- No asset type was added or changed. agent-card@1's schema and starters are untouched; its fixture gained `avatar`.
- Deferred Kotlin twins recorded in `framework/spec/PORTING.md`: `SwarmRules`, `SwarmChat`, `SwarmVibe`, a Compose
  `Avatar` drawing `avatarModel`'s parts (Android on hold).

## Migrations and compatibility
- No data migration. Existing `state.json`, `runs.json` and `roster.json` load as before; `normRoster` adds `fallback: ''`.
- Plugin code importing `./web/swarm-core.mjs` keeps every export it used (`avatarColors`, `post`, `assignLine`,
  `reportLines(run, roster)`, `mergeLines(res, roster)`, `leaseLines(plan, roster)`, `vibeFilter`, …). New code should
  import the framework engines directly.
- `requiredTier` lost its second argument (the skill); `fixerJob` runs on the policy default.

## Tests before vs after
| Check | Before | After |
|---|---|---|
| `node apps/console-web/plugins/agent-swarm/test.mjs` | 80 | 87 |
| `npx -y tsx framework/spec/check-swarm.mts` | — | 223 |
| `npx -y tsx framework/spec/check-agent-card.mts` | 61 | 84 |
| `node framework/spec/check-model-policy.mjs` | 12 | 12 |
| `node framework/cli/check-theme.mjs` / `check-controls.mjs` (plugin) | pass | pass |
| `cd apps/console-web && npm run typecheck` | clean | clean |

## Screenshots
Same pixels as the Opus build (the avatar draws the same paths with the same classes and tokens; no other visible
change), so no UI Review item was raised. A `rebuild-shots` run was attempted for Crew, ID cards and Group chat
(before = origin/main, after = this branch, `agent-swarm-fable-rebuild/shots.json`): the console under Playwright on
this headless box only shows the "Waiting for axHub" banner, because the look comes from axHub alone (no local
fallback, Brett's rule) and the sandbox browser cannot reach the hub. The captures were discarded rather than kept as
blank pages; the shots list stays in the folder so a session with hub access (or the console container) can run it.

## Known gaps
- No before/after screenshots: the Breakroom cannot render without axHub in this sandbox (see Screenshots); the screens
  are pixel identical by construction (same SVG paths, same classes, same tokens).
- The zero-score fallback still needs a roster `fallback` to be meaningful on this repo (none set): until then an
  unmatched step goes to the agent with the largest budget (Kotlin Kat), with the "name files in the step" warning.
- `stepFiles` still takes a bare file name in step text (e.g. `LOG.md`) as a repo-root lease.
- Kotlin twins deferred (Android on hold).
