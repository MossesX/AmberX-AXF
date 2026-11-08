<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/ai-assistant-plugin.md lines=115-133 tokens=480 -->
## Screenshots (web, no provider configured)
| | before | after |
| --- | --- | --- |
| Chat page (desktop) | ![before](ai-assistant-plugin/shots/before/chat-page-desktop.png) | ![after](ai-assistant-plugin/shots/after/chat-page-desktop.png) |
| Chat page (phone) | ![before](ai-assistant-plugin/shots/before/chat-page-phone.png) | ![after](ai-assistant-plugin/shots/after/chat-page-phone.png) |
| Chat dialog (desktop) | ![before](ai-assistant-plugin/shots/before/chat-dialog-desktop.png) | ![after](ai-assistant-plugin/shots/after/chat-dialog-desktop.png) |
| Chat dialog (phone) | ![before](ai-assistant-plugin/shots/before/chat-dialog-phone.png) | ![after](ai-assistant-plugin/shots/after/chat-dialog-phone.png) |
| Settings sub-tab + wizard (desktop, full page) | ![before](ai-assistant-plugin/shots/before/settings-tab-desktop.png) | ![after](ai-assistant-plugin/shots/after/settings-tab-desktop.png) |
| Settings sub-tab + wizard (phone, full page) | ![before](ai-assistant-plugin/shots/before/settings-tab-phone.png) | ![after](ai-assistant-plugin/shots/after/settings-tab-phone.png) |
| Live sessions panel (desktop) | ![before](ai-assistant-plugin/shots/before/live-sessions-desktop.png) | ![after](ai-assistant-plugin/shots/after/live-sessions-desktop.png) |
| Live sessions panel (phone) | ![before](ai-assistant-plugin/shots/before/live-sessions-phone.png) | ![after](ai-assistant-plugin/shots/after/live-sessions-phone.png) |

Visible changes: the chat page/dialog setup state mentions the shared registry (same layout); the Live sessions
panel shows contract chips, host availability and the host-registry note. The chat with a provider (tags row,
live pill, Continue, interrupted marker) needs a configured provider and isn't captured here.

Android: no screens affected (kernel contract + `AssistantClient` only, no Compose UI yet) — Android screenshots
pending CI once an Android assistant UI exists.
