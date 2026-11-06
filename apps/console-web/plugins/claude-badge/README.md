# Claude badge (console plugin)

`ai.amberx.axf.console.claude-badge` · built on Opus.

On every console load it tests the AI connection (one tiny request through the AI assistant's `axf.llm@1`) and attaches a
**badge asset** (framework type `badge`, id `claude`) to the **banner** (framework type `banner`, left side):

- connected: green, and a tooltip pops out to its right for 5 seconds: “Powered by Claude Opus 5.5” (the model that answered);
- not connected (no assistant, no key, provider error): grey, “AI unavailable”.

A second **VPS connection** badge (`badge/claude-vps`) watches the Claude Code login on the VPS, read with plain code, zero
tokens (`GET /vps`: `claude auth status` on the host through `axf.claude-accounts@1`, the limit mark through `axf.ai-keys@1`;
the console re-reads it every 60 s while the page and the badge are showing):

- logged in: green, with the email, plan and how long the login is good;
- limit hit or out of credits: amber. A hit is marked when a headless build stops on a limit and it stays amber for 24 hours
  (the window AI keys uses) unless the account changes. A limit hit in an interactive session leaves no mark, so it can't show;
- not logged in or expired: red;
- the VPS can't be read (Terminal VPS host not set up, accounts plugin off, no answer): grey. It never reads as logged out.

Both badges have their own settings: **Show on the banner**, **Icons only** and an icon for each state (ok / no credit /
error). Hiding the console badge also stops its load-time test, so it spends no tokens; Test again still works.

Tap a badge for Settings → Plugins → Claude badge (Test again, Check now, last results, install & uninstall).
Routes (console token, 404 when disabled): `POST /test`, `GET /status`, `GET /vps`. Data: `.axf-console/plugins/claude-badge/status.json`
(no reply text, no keys). Removing the plugin removes only the Claude badge; the banner, badge and clock types are permanent
parts of the framework.

Self-test: `python3 apps/console-web/plugins/claude-badge/test.py`.
