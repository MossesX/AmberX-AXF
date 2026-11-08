<!-- memory-chunk@1 source=_claude/memory/docs/priority-tags.md lines=19-30 tokens=174 -->
## Use it

```bash
node framework/cli/build-priority.mjs list --open
node framework/cli/build-priority.mjs get skins
node framework/cli/build-priority.mjs set "banner widgets" urgent
```

Run from a shell, the CLI sees only the store, the agent queue and plan dependencies. The full list comes from the console: `GET /priority`, `GET /priority/<build>`, `POST /priority {builds, priority}` on the Build orchestrator's server part, which are also the plugin commands `priority-list`, `priority-get` and `priority-set` for voice and MCP.

Bulk: on the Builds page, select steps and use **Set priority…**; it applies to the builds those steps belong to. `set` and `POST /priority` take many builds.
