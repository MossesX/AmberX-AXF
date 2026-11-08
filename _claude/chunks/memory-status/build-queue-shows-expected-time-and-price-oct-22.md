<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=174 -->
## Status (as of Oct 21 2026)

- **Build queue shows expected time and price (Oct 22 2026, Opus):** every step in the console's Build queue (`src/views/BuildManager.tsx`) shows its expected build time (its estimate or its small steps added up; "left" once steps are ticked; the whole estimate on built steps; "no estimate" flagged) and price; Next up shows the same; Progress adds time left + price per model and an **All of it** total (with how many steps have no estimate); the copied brief includes it. Price = minutes × the model's cost of one working minute from `framework/schemas/model-pricing.json` (the heuristic `estimateCost()` uses: Fable ~$0.28, Opus ~$0.14, Sonnet ~$0.07 a minute).
