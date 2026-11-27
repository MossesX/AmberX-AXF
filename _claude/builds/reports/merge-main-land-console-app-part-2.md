# merge-main-land-console-app-part-2

Merge main into `claude/console-app-part-2-native-floating-2` (PR #639) and get its "Web Dev Console (React/TS) + Python API" check green, so auto-land can land it.

Brett, Nov 15 2026 (verbatim): "split the console wrapper so it runs on four slots at the same time" — plus the failing-check note for that job on the merged head.

## What was done

- Merged `origin/main` into the PR branch head (`97f7081a9`). The merge was clean; only builds-live files changed (`_claude/THREADS.md`, `_claude/builds/*`). Pushed as `3df4d05b3`.
- **Failing check:** CI run 43654242684 on `ec1d7c4d9` failed `check-token-registry.mjs`. The four `--fx-safe-*` inset tokens that part 1 added to `framework/ui/axf.css` were not registered. `c2e6821d0` (already on the branch before this build) registers them. On the merged head: `token-registry@1: 326 tokens registered … fixture current`.
- The CI step runs under `bash -e`, so in CI nothing ran after the token registry failure. To catch anything it was hiding, I ran the whole "Alerts + MCP client + axf_server" step locally on the merged head:
  - Every Node and TS check passed.
  - Every Python test passed: axf_server, console server tests, plugin commands, console-control, MCP tools, AmberX server and the rest.
  - `console-control-parity.mjs` passed: 14 cases, 132 comparisons.
  - `check-headless-context.mjs` passed: 38 checks.
- `tracker.mjs --check`, `check-theme.mjs` and `check-controls.mjs` pass.

## "Four slots at the same time"

The console wrapper is already split into four builds that run in parallel slots, each with its own PR:

| Part | Build | PR |
| --- | --- | --- |
| 1 | `console-android-app-thin-webview-wrapper` (WebView shell, safe-area insets) | #637 |
| 2 | `console-app-part-2-native-floating-2` (floating toolbar, approvals bar, `overlay@1`) | #639 |
| 3 | `console-app-part-3-native-bridge-mic` (native bridge, mic, recorder, open_url, wake) | #633 |
| 4 | `console-app-part-4-console-side-safe` (console side, safe areas) | #640 |

This build lands part 2. It adds no new UI or API. Part 2's API reach (REST `native.overlay:<verb>`, MCP `console_action`, CLI `axf console action`, voice) is documented in `apps/console-droid/OVERLAY.md`.

## Local test environment notes (not branch defects)

- When I first ran `console-control-parity.mjs` on the default port 7097, 6–9 of 14 cases failed, and the count changed from run to run. Plain `origin/main` failed the same way. Other sessions on this VPS use the same fixed port. With a free port (`CC_PARITY_PORT`) it passes 14/14. A follow-up could have the script pick a free port.
- `check-headless-context.mjs` failed one case once while the VPS was under load. Run on its own, it passes 38/38.
- `test_wall_users.py` needs the built `apps/console-web/dist`. CI builds it in an earlier step.

## Next

Auto-land and the merge queue land PR #639 by themselves.
