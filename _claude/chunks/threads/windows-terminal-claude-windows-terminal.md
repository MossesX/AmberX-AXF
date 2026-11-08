<!-- memory-chunk@1 source=_claude/THREADS.md tokens=285 -->
### windows-terminal (claude/windows-terminal)
- **Asked (Brett, Oct 28 2026, claude.ai):** see orchestrator build `windows-terminal` detail (full request there).
- **Model:** Opus s1–s5 (console-terminal upgrade), Fable s6–s12 (window engine physics, settings-ui@1 levels contract, level toolbar + editor). Approval card at the switch.
- **Read first:** apps/console-web/plugins/console-terminal (README, web/, server/), framework/core/engines/windows.ts, framework/react/windows/WindowHost.tsx, framework/core/engines/settingsui.ts, framework/libs/settings.
- **Done:** s1–s5 (Opus) on `claude/windows-terminal`.
- **Next:** Fable phase s6–s12 on a new branch `fable/windows-terminal` from main after the Opus PR merges: `node orchestrator.mjs brief windows-terminal`. Waits on: Brett's approval of the Opus → Fable switch. <!-- axf-plugin:build-orchestrator -->
- **First message for a new session (Fable):** "Carry on orchestrator build windows-terminal (refactor): the Fable phase s6–s12, on branch fable/windows-terminal from main. Read the brief with orchestrator.mjs brief windows-terminal." <!-- axf-plugin:build-orchestrator -->
