<!-- memory-chunk@1 source=_claude/memory/docs/build-steps.md lines=33-50 tokens=409 -->
## Pending items (all Fable)

| Item | Old → new | Steps | Needs Brett |
|---|---|---|---|
| `named-asset-rule` Every UI element is a named asset | 6 h → **7.5 h** | 15 | step 2: rename vs alias the starter ids; element assets required or opt-in |
| `asset-designer` Asset Designer plugin | 2 d → **1 d** | 16 | — |
| `asset-browser` Asset Browser plugin | 6 h → **5 h** | 10 | — |
| `asset-templates` 10+ templates per type | 1 d → **7 h** | 14 | — |
| `app-port-engine` Port a non-AXF app (bake/rebuild) | 2 d → **1 d** | 16 | step 13: attach MossesX/xGallery and review its report; step 14 pushes a branch there |
| `lib-clone` Clone an install with data | 1 d → **6 h** | 12 | step 1: which data is copied by default; users/members kept?; step 10: attach xGallery |
| `plugin-conflicts` Conflict alarm + AI patches (**unsafe**) | 6 h → **6.5 h** | 13 | steps 1–2 are the design notes; step 3: Brett approves the design (conflict kinds, overlay patches, backup + reinstall) before it leaves `unsafe` |
| `axhub-agent-host` Agents + sessions on axHub | 2 d → **1.5 d** | 20 | step 1: attach MossesX/axHub; step 19: approve the hub redeploy and run a turn from the phone |
| `console-android-app-tabs` (already split by the other session) | 1.5 d → **1 d** | 10 → 19 | — (every step was over 30 min; re-cut 1a/1b/2a… keeping the original numbering) |
| `console-android-native-tabs` (already split) | 7.5 d → **2.5 d** | 12 → 39 | — (same; the old 1.5 d / 1 d steps became 4–6 pieces each) |

Complete items untouched. Every open item now has an estimate. **Time left on the pending list: Fable 11.5 d**
(`pending.mjs --check-steps`).
