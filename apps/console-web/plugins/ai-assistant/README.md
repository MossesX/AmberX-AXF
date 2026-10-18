# AI assistant (console plugin)

`ai.amberx.axf.console.ai-assistant` · built on Opus (Oct 18 2026) · Fable rebuild pending (`ai-assistant-plugin`).
Ported from xGallery's assistant and extended. Web console only for now.

## Where it is
- **Chat page:** nav → Plugins → AI assistant. **Chat dialog:** from anywhere with `rt.openDialog('ai-assistant.chat')` or the action `ai-assistant.open[:prompt]`.
- **In-chat settings dialog:** the sliders button in the chat header (agent, provider, model, temperature, tokens, tools, thinking, instructions for this conversation).
- **Settings → AI assistant:** setup wizard · providers · behaviour & defaults · prompt library · usage · install & uninstall.

## Providers
Anthropic, Claude Code (subscription token + `claude` CLI on the server, read-only repo tools), OpenAI, xAI Grok, Google
Gemini, Mistral, Groq, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, Cerebras, Azure OpenAI (v1),
Ollama, LM Studio, and any OpenAI-compatible server. Several at once; a default plus a fallback chain. Keys are stored
server-side (0600) or read from environment variables, and never sent back to the browser.

## Features beyond xGallery
Profiles + fallback · live model lists + connection tests · streaming with tool activity · regenerate · edit & resend ·
fork · delete message · pin / archive / rename / search · export Markdown/JSON and import · image and text-file attachments ·
console-view context · slash prompts and commands (`/new /settings /compare /export /system /agent`) · prompt library ·
model comparison (2–4 side by side) · usage per day/provider/model and a daily token budget · secret redaction ·
auto-titles · extended thinking / reasoning effort · web fetch (public hosts only) · agent mode.

## Integration (capability services, never folder names)
- Provides **`axf.llm@1`**: `profiles()`, `complete(messages, system, profile, model, tools, params)`, `embed(texts, profile, model)`.
- Consumes **`axf.agents@1`** when available: pick an agent in the chat header; its prompt, tools and memory are used and each turn is recorded to its memory.

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/ai-assistant/` (`config.json`, `usage.json`, `conversations/`).
```bash
node apps/console-web/plugins/ai-assistant/install.mjs
node apps/console-web/plugins/ai-assistant/uninstall.mjs            # data only (backed up)
node apps/console-web/plugins/ai-assistant/uninstall.mjs --all      # + code + doc lines (add --publish to push the removal)
python3 apps/console-web/plugins/ai-assistant/test.py               # self-test, fake providers
```
