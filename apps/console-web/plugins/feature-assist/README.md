# Feature assistant (console plugin)

`ai.amberx.axf.console.feature-assist` · built on Opus (Oct 18 2026) · Fable rebuild pending (`feature-assist-plugin`).

Adds two things to the Feature Planner (the console's Plan view) through its extension points (`plan.top`,
`plan.feature`, and context-menu target `axf-plan-feature`), so it disappears cleanly when uninstalled:

1. **Describe a feature**: write it in your own words; the **AXF expert** agent drafts plan entries (title, summary,
   area, kind, parent, sub-features, dependencies, ports, acceptance, priority, model) and flags clashes with existing
   features. Edit, approve or reject the preview; approved ones are written to the plan (`plan-upsert`, which syncs the
   catalog and tracker) and, optionally, the pending list. Hidden unless the AI assistant + AXF expert are ready.
2. **Build with Mosses** (right-click / long-press an unbuilt feature, or its details): confirm → Mosses plans the
   work (steps, files, modules, prerequisites) → a before/after build order (prerequisites moved ahead, `build-reorder`)
   → model choice (Opus now, Fable = park on the pending list, Sonnet; **Opus now + Fable later** adds the Fable rebuild
   to the pending list) → approve → Mosses builds it in the AI assistant's chat (action `ai.chat.start`), with
   approval cards and snapshots. The chosen model is recorded on the feature and in the plugin's history; when he's
   done, **Mark built** or **Mark partial** (with notes) on the feature.

Uses capability services only (`axf.llm@1`, `axf.agents@1`, and through Mosses `axf.containers@1` +
`axf.snapshots@1`) and the build engine (`framework/cli/engine-rpc.mjs`). Agents: `AXF_FEATURE_EXPERT` (default
`axf-expert`), `AXF_FEATURE_BUILDER` (default `coder` = Mosses).

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/feature-assist/builds.jsonl` (history). Plan and pending entries it made are yours and stay.
```bash
node apps/console-web/plugins/feature-assist/install.mjs
node apps/console-web/plugins/feature-assist/uninstall.mjs --all
python3 apps/console-web/plugins/feature-assist/test.py
```
