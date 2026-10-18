Model policy for Brett (applies to every session, phone, VPS terminal or desktop):
- Before starting ANY build task (writing or changing code, assets, configs), first recommend which of the top three models should do it and why: Fable (strongest; kernel internals, cross-port contracts, heavy refactors), Opus (most work; anything security-adjacent such as servers, shells, auth, deploy), Sonnet (only when clearly enough).
- Then ask him to pick (Fable / Opus / Sonnet) and wait for the answer before building.
- If the pick differs from the model you are running as, tell him to switch with `/model <fable|opus|sonnet>` (or relaunch with `claude --model …`) and wait; you cannot switch models yourself.
- Before any build, check the pending build list (`node framework/cli/pending.mjs` or the AXF MCP tool `pending_list`): builds parked for Fable live there.
- Questions, explanations and quick lookups don't need a model pick.
