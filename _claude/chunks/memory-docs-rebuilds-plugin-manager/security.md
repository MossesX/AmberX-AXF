<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md lines=125-132 tokens=145 -->
## Security
- Every Opus guard kept: console token on every plugin route, 404 while disabled, not on MCP, folder pattern, log level
  whitelist, no symlinks followed, env values never serialised, read-only server part, data dir confined to
  `.axf-console/plugins/<folder>`.
- `GET /records` exposes exactly what `/inventory` already did (env set/unset only, no values), under the same guards.
- The Android enable/disable goes through the kernel's `PluginLoader` (placeholder until a platform provides one);
  compiled modules can't be switched off at runtime (no switch shown).
