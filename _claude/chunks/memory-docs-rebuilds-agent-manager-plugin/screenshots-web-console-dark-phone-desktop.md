<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-manager-plugin.md tokens=710 -->
## Screenshots (web console, dark, phone + desktop)
Captured with `framework/cli/rebuild-shots.mjs` (`agent-manager-plugin/shots/shots.json`), 15 screens × 2 viewports, before = commit d2f58a9 (Opus build), after = this branch.

| Screen | Before | After |
|---|---|---|
| Agents list | ![before](agent-manager-plugin/shots/before/agents-list-phone.png) | ![after](agent-manager-plugin/shots/after/agents-list-phone.png) |
| Agent editor (Mosses) | ![before](agent-manager-plugin/shots/before/agent-editor-phone.png) | ![after](agent-manager-plugin/shots/after/agent-editor-phone.png) |
| Prompt & tools | ![before](agent-manager-plugin/shots/before/agent-prompt-desktop.png) | ![after](agent-manager-plugin/shots/after/agent-prompt-desktop.png) |
| Skills library | ![before](agent-manager-plugin/shots/before/skills-library-desktop.png) | ![after](agent-manager-plugin/shots/after/skills-library-desktop.png) |
| Tools (container_write) | ![before](agent-manager-plugin/shots/before/tools-tab-phone.png) | ![after](agent-manager-plugin/shots/after/tools-tab-phone.png) |
| Training | ![before](agent-manager-plugin/shots/before/training-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/training-tab-desktop.png) |
| Workflows | ![before](agent-manager-plugin/shots/before/workflows-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/workflows-tab-desktop.png) |
| Memory | ![before](agent-manager-plugin/shots/before/memory-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/memory-tab-desktop.png) |
| Add-ons | ![before](agent-manager-plugin/shots/before/addons-tab-desktop.png) | ![after](agent-manager-plugin/shots/after/addons-tab-desktop.png) |
| Wizard: agent builder | ![before](agent-manager-plugin/shots/before/wizard-builder-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-builder-phone.png) |
| Wizard: new skill | ![before](agent-manager-plugin/shots/before/wizard-skill-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-skill-phone.png) |
| Wizard: new tool | ![before](agent-manager-plugin/shots/before/wizard-tool-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-tool-phone.png) |
| Wizard: training | ![before](agent-manager-plugin/shots/before/wizard-training-phone.png) | ![after](agent-manager-plugin/shots/after/wizard-training-phone.png) |
| Settings → Safety | ![before](agent-manager-plugin/shots/before/settings-safety-desktop.png) | ![after](agent-manager-plugin/shots/after/settings-safety-desktop.png) |
| Settings → Add-on agents | ![before](agent-manager-plugin/shots/before/settings-addons-desktop.png) | ![after](agent-manager-plugin/shots/after/settings-addons-desktop.png) |

The other viewport of each pair is in the same folders. Android: no screens affected (kernel contract only, no Compose UI) — Android screenshots pending CI.
