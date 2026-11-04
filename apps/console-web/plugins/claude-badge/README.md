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

## Follow Amber, looks and animations (Nov 4 2026)

Tap the badge to switch Follow Amber (when that plugin is on; action `followAmber.toggle`, shared key `followAmber.enabled`). While it's on the badge draws two-tone and animated, and pulses when Amber opens something (counter `followAmber.opened`). Right-click / long-press: open again what Amber opened last, the recent list, Change badge, Pick a brand icon, Test the AI connection, settings.

Looks are badge assets in `looks.json` (20, brand-icon looks among them); the icon can be any logo mark, animated logo or icon-pack glyph in the registry. The style lives in the data folder (`style.json`): `GET styles-list`, `GET style`, `POST style-set {look?, icon?, tone2?, color2?, animations?}`, `POST animation-set {state, motion?, speed?, intensity?, loop?}` (MCP `claude_badge_*`, CLI `axf claude-badge …`).
