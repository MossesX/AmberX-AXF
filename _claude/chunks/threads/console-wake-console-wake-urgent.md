<!-- memory-chunk@1 source=_claude/THREADS.md lines=288-292 tokens=186 -->
### Console wake (`console-wake`, Urgent)
- **Asked:** a console command must reach a console no matter what: queue + deliver on reconnect, fix the drop when approving inside the console, wake a closed console through AmberX, settings, toast, delivery in the MCP result, tests, report, PRs.
- **State:** all steps done; PRs open (AmberX-AXF `claude/console-wake`, axHub #35). Report `_claude/builds/reports/console-wake.md`.
- **Waits on:** CI + UI Review approval (auto-merge); Brett installing the new AmberX APK (checklist-one).
- **Checks:** `python <console plugins>/console-commands/server/test_console_commands.py` (66) · `node <console plugins>/console-commands/test.mjs` · axHub `npx vitest run packages/server/test/amberx.test.ts`.
