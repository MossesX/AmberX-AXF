"""Python ports of the framework's cross-port contracts (pure: no I/O, stdlib only).

Each module is the Python copy of a TS reference engine in framework/core and the matching Kotlin kernel package, and
replays the same fixture in framework/spec/fixtures (run `python3 framework/python/axf/contracts/test.py`):

  assistant   assistant@1          framework/core/assistant.ts  = ai.amberx.axf.kernel.assistant  = spec/fixtures/assistant.json
  agents      agent-definition@1   framework/core/agents.ts     = ai.amberx.axf.kernel.agents     = spec/fixtures/agents.json

Hosts import them (`from axf.contracts import assistant, agents`): the console's ai-assistant and agent-manager plugins,
Build Pilot's server (which bakes copies with scripts/bake-contracts.mjs). A new contract = one module here + the
reference + the Kotlin port + a fixture; never a copy inside an app.
"""
