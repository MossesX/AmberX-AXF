<!-- memory-chunk@1 source=_claude/memory/docs/assistant-approvals.md tokens=210 -->
## Where

| Piece | Where |
| --- | --- |
| Library | `framework/libs/approvals` (`core.ts` pure, `index.ts` watcher, `react.tsx` badge + popover, `approvals.css`, `library.json`), baked into console-web and amberx-droid; README section in `framework/libs/README.md` |
| Self-test | `npx -y tsx framework/spec/check-approvals.mts` (62 checks; in CI next to check-hubstatus) |
| Console | the AI assistant plugin's chat header (`web/chat.tsx`), toggle Settings → Plugins → AI assistant → Title bar; plugin 0.2.1 |
| AmberX | `src/plugins/ai/web/index.tsx` (Ask my notes header, toggle `amberx.ai.approvals`, action `approvals.popover[:<id>]`), `src/plugins/approvals/web/deny.ts` `decideFromPhone` + `setApprovalsHost` in its `register`, `src/plugins/monitor/web/index.tsx` (`approvalIdOf`: an approval notification tap opens the popover) |
