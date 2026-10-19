# Claude badge (console plugin)

`ai.amberx.axf.console.claude-badge` · built on Opus.

On every console load it tests the AI connection (one tiny request through the AI assistant's `axf.llm@1`) and attaches a
**badge asset** (framework type `badge`, id `claude`) to the **banner** (framework type `banner`, left side):

- connected: green, and a tooltip pops out to its right for 5 seconds: “Powered by Claude Opus 5.5” (the model that answered);
- not connected (no assistant, no key, provider error): grey, “AI unavailable”.

Tap the badge for Settings → Plugins → Claude badge (Test again, last result, install & uninstall).
Routes (console token, 404 when disabled): `POST /test`, `GET /status`. Data: `.axf-console/plugins/claude-badge/status.json`
(no reply text, no keys). Removing the plugin removes only the Claude badge; the banner, badge and clock types are permanent
parts of the framework.

Self-test: `python3 apps/console-web/plugins/claude-badge/test.py`.
