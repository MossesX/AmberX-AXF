# Brett's rules (every project, every device)

Shared memory (claude-fs@1): this folder syncs with `/Claude/_memory/shared/` on the hub and with
`_memory/shared/` in every project. Edit it in any project, then run `claude-sync sync`. Never store secrets.

## Before building anything
- **Pick the model first.** Recommend Fable / Opus / Sonnet and say why, ask Brett to choose, and wait. Only the top three models. Fable for the strongest reasoning (kernel internals, cross-port contracts, heavy refactors). Opus for everything else, including anything security-adjacent (servers, shells, auth, deploy). Sonnet only when you're sure Opus isn't needed. You can't switch models yourself: if his pick differs, ask him to run `/model <name>`.
- **Check the pending build list** before building. Builds parked until their model is available are listed in AmberX-AXF (`node framework/cli/pending.mjs`, MCP `pending_list`, console → Pending builds) and on the claude.ai Pending Builds page (https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye, db collection `builds`). "Add it to the pending list" means park it, don't build it.
- Questions, explanations and quick lookups need no model pick.

## How to work with him
- He works mostly from his phone (Samsung Galaxy S26 Ultra), often in **Moshi** (mosh) on his Hostinger VPS where Claude Code runs. Lead with the result, short paragraphs, phone-readable.
- When he says "wait until I say continue", do nothing more until he does.

## Memory, rules and decisions
- Everything a later session needs lives in `_memory/` (this project) or `_memory/shared/` (all projects), synced with `/Claude` on the hub. Phone, VPS, desktop and claude.ai sessions don't share chat history.
- When he states a rule, preference or decision, save it to the right section: `rules/`, `instructions/`, `memory/`, `decisions/` (shared/ if it applies everywhere). Then `claude-sync sync`, and commit.
- If sync **holds** a file (changed in two places, or deleted on one side), ask him which copy to keep, then `claude-sync resolve <id> --keep local|hub`. Never pick for him.
- Deleting files on the hub through axHub needs his approval.

## Repos, servers, credentials
- GitHub account `MossesX`. A new repo must exist on GitHub before a session can push to it. Don't create repos he hasn't asked for. Commit and push often; keep each repo's `CLAUDE.md` Status current.
- VPS: Hostinger, runs **Coolify**; its Traefik proxy owns 80/443, so web apps go behind it as Coolify apps (no separate nginx). Domain `amberxai.com`.
- **axHub** (`MossesX/axHub`, https://axhub.amberxai.com/mcp) is his connector hub: use its tools (`list_services`, `describe_service`, `call`) to reach his services instead of asking for credentials.
- **No secrets** in repos, logs, chat, `_memory/` or `/Claude`: environment variables or GitHub Actions secrets only.
