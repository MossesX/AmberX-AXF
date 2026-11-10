# ai-keys-new-format: accept Anthropic's new API key format

Build `ai-keys-new-format` (Opus), branch `claude/ai-keys-new-format-r4` (runs r1-r3 stopped on usage limits / sign-in; r4 finished it, reusing r3's draft module).

## Brett said (verbatim)
Source: voice · At: 2026-11-05

> Put someone else on it.

(Context: a real API key made at console.anthropic.com/settings/keys starts `sk-ant-usr…`; the console's AI keys page refused it with "unknown key type".)

## Cause
`apps/console-web/plugins/ai-keys/server/__init__.py` `kind_of()` only knew `sk-ant-oat` (subscription) and `sk-ant-api` / `sk-ant-admin` (API). Anything else, including `sk-ant-usr…`, was "unknown key type". The same one-prefix test (`startswith("sk-ant-api")`) sat in the assistant host, the AI assistant store and the AmberX server.

## Fix
- **New `framework/python/axf/anthropic_keys.py`**: one prefix table (`sk-ant-api`, `sk-ant-usr` → API key; `sk-ant-oat` → subscription login; `sk-ant-ort` refresh token; `sk-ant-admin` Admin key; `sk-ant-sid` browser cookie). Any other `sk-ant-` prefix falls back to *API key (new format)*: accepted and verified live, never refused for its prefix. Plus `refusal()` (plain reason, never the key), `mask()` (last 4), `scrub()` and `live_check()`.
- **Live check on save** (`live_check`): `GET /v1/models` (free, proves the key), then a 1-token turn on the cheapest listed model (only a real turn shows a credit problem). Answers `ok` / `invalid` (401/403) / `no-credit` / `error`. The key never appears in the answer.
- **ai-keys plugin 0.4.1**: classification through the module; API keys tested with the live check. A `no-credit` key is real, so it is saved (re-test after a top-up) but never made active by itself. Admin keys, refresh tokens alone and cookies get a plain refusal. Errors are scrubbed of any key. Web: the key row shows *Works* / *Invalid* / *No credit*; the field placeholder is `sk-ant-…` with a hint naming the formats.
- `axf.assistant_host.providers` (subscription driver) and the AI assistant store use `is_api_key()` instead of `startswith("sk-ant-api")`; AmberX server treats every non-`oat`/`ort` `sk-ant-` key as an API key.
- `deploy/forensics.sh` mask: was `sk-ant-[a-z0-9]+-…`, which missed keys with no dash after a lowercase prefix; now masks every `sk-ant-` token.
- Docs: help text (console.json + help-src), plugin description, `install_instructions.md` key table and API-key section.

## Tests (fake keys only, nothing reaches Anthropic)
| Suite | Before | After |
|---|---|---|
| `framework/python/axf/test_anthropic_keys.py` (new, in CI) | – | 30 checks: every prefix, unknown fallback, oat stays subscription, cut-off/whitespace, mask/scrub, live check OK / invalid / no credit / error / rate-limited |
| `apps/console-web/plugins/ai-keys/test.py` | 75 | 85 (usr key saved, unknown prefix saved after live pass, failing new key refused, no-credit kept not active, admin/refresh refused, wizard) |
| ai-assistant test.py | 143 | 143 |
| assistant_host test.py | 58 | 58 |
| amberx server | 159 | 159 |
| console-terminal | 139 | 139 |
| check-help, check-theme, check-controls | green | green |

## Not changed / gaps
- No UI layout change (text and one status word), so no UI Review submission.
- Keys already stored keep their kind; nothing to migrate.
- The live check costs a fraction of a cent per save/re-test (one 1-token turn).
