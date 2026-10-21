# Rebuild log

Every rebuild (Fable rebuilds and all later ones) gets a line here, newest first, plus a full differences report
`<pending-id>.md` in this folder and, when any GUI changed, before/after screenshots in `<pending-id>/shots/`.
Rule: `_claude/rules/RULES.md` → "Every rebuild ends with a differences report" and "Rebuild log with screenshots".

| Date | Item | Model | Branch / commits | Report | Screenshots | Summary |
|---|---|---|---|---|---|---|
| 2026-10-20 | plugin-manager | Fable | `fable/plugin-manager` (468df70, 62b7610) | [report](plugin-manager.md) | web: [28 pairs](plugin-manager/shots/); Android: see report | plugin-inventory@1 engine on web, Android and Python; Android Plugin Manager; every `axf init` app ships Settings with a Plugins tab. Tests 46 → 62. |
| 2026-10-20 | lib-mcp | Fable | `fable/lib-mcp` (d5b3495, 2a2d0f8, f9bd410) | [report](lib-mcp.md) | web: [6 pairs](lib-mcp/shots/); Android: after-side build failed in CI (errors now reported to "CI build errors") | MCP client library on web, Android and Python from one fixture; call gate + Keystore tokens; console plugin rebuilt on it. Tests 8 → 24 plugin + 210 per port. |
| 2026-10-20 | widget-assets | Fable | `fable/banner-widgets` (6438b3b, 3a58c1d, ad0e8b0) | [report](widget-assets.md) | web: [pairs](widget-assets/shots/); Android: with banner-assets | Host engine read from asset-types.json (open registry), validated attachments, Android widgets + live search (`k.search` built). check-widgets 93. |
| 2026-10-20 | banner-assets | Fable | `fable/banner-widgets` (same) | [report](banner-assets.md) | web: [pairs](banner-assets/shots/); Android: [android.md](banner-assets/android.md) (first automatic run) | Android Compose banner (logo, search, clock) built and shown in the Android console; fixtures unchanged. |
| 2026-10-20 | agent-manager-plugin | Fable | `fable/agent-manager` (f372502, c38adb8) | [report](agent-manager-plugin.md) | web: [15 pairs](agent-manager-plugin/shots/); Android: no screens | agent-definition@1 contract on web, Python and Android; live validation; streamed workflows. Tests 92 → 116. |
| 2026-10-20 | ai-assistant-plugin | Fable | `fable/ai-assistant` (1ec6e3f … 2827059) | [report](ai-assistant-plugin.md) | web: [8 pairs](ai-assistant-plugin/shots/); Android: no screens | assistant@1 contract + shared provider registry + AssistantClient; open live-session hosts; interrupted replies kept. Tests 111 → 137. |
