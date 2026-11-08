<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=21-22 tokens=142 -->
## Framework

- Oct 18 2026 (built on Opus): developer alerts are a **framework library** (`ai.amberx.axf.alerts`), not a console plugin, so any AXF app can install it; the engine is a cross-port contract (TS reference, Kotlin, and the console's Python server all match one fixture). Brett picked all three channels (console bell, ntfy, web push) and every source: CI failures, deploys, systems check, builds + plugins, system conflicts and crashes. Conflicts between modules (same asset id, setting key, settings id) are reported by the runtime itself as diagnostics.
