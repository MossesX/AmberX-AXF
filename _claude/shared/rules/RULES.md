# Brett's rules (every project, every device)

These are shared files (axhub-projects@1). This folder syncs with `/projects/_shared/_claude/` on the hub and with
`_claude/shared/` in every project. Edit it in any project, then run `claude-sync sync`. Never store secrets.

## Before building anything
- **Pick the model first.** Recommend Fable / Opus / Sonnet and say why, ask Brett to choose, and wait. Only the top three models. Fable for the strongest reasoning (kernel internals, cross-port contracts, heavy refactors). Opus for everything else, including anything security-adjacent (servers, shells, auth, deploy). Sonnet only when you're sure Opus isn't needed. You can't switch models yourself: if his pick differs, ask him to run `/model <name>`.
- **Check the pending build list** before building. Builds parked until their model is available are listed in AmberX-AXF (`node framework/cli/pending.mjs`, MCP `pending_list`, console → Pending builds) and on the claude.ai Pending Builds page (https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye, db collection `builds`). "Add it to the pending list" means park it, don't build it.
- Questions, explanations and quick lookups need no model pick.

## Projects
- **Every project has a manifest**, `project.manifest.json` (`project-manifest@1`, schema and rules in AmberX-AXF; rules are managed in the Dev Console → Standards). It names the project, its repo (even one that doesn't exist yet, for future naming) and its shared data. Its `name` is the project's folder on the hub, `/projects/<name>/`.
- **No project is loaded or compiled without a valid manifest.** The AXF build engine, the Dev Console and every template refuse to work on a project whose manifest fails validation.
- Every project has `_claude/` (memory/, instructions/, rules/, shared/) synced with `/projects/<name>/_claude/`, and its manifest's `data.shared` files synced with `/projects/<name>/_data/<same path>`.

## How to work with him
- He works mostly from his phone (Samsung Galaxy S26 Ultra), often in **Moshi** (mosh) on his Hostinger VPS where Claude Code runs. Lead with the result, short paragraphs, phone-readable.
- When he says "wait until I say continue", do nothing more until he does.

## Memory, rules and decisions
- Everything a later session needs lives in `_claude/` (this project) or `_claude/shared/` (all projects), synced with the hub. Phone, VPS, desktop and claude.ai sessions don't share chat history.
- When he states a rule, preference or decision, save it to the right section: `rules/`, `instructions/`, `memory/` (decisions go in `memory/decisions.md`; use `shared/` if it applies everywhere). Then `claude-sync sync`, and commit.
- If sync **holds** a file (changed in two places, or deleted on one side), ask him which copy to keep, then `claude-sync resolve <id> --keep local|hub`. Never pick for him.
- Deleting files on the hub through axHub needs his approval.

## Repos, servers, credentials
- GitHub account `MossesX`. A new repo must exist on GitHub before a session can push to it. Don't create repos he hasn't asked for. Commit and push often; keep each repo's `CLAUDE.md` Status current.
- VPS: Hostinger, runs **Coolify**; its Traefik proxy owns 80/443, so web apps go behind it as Coolify apps (no separate nginx). Domain `amberxai.com`.
- **axHub** (`MossesX/axHub`, https://axhub.amberxai.com/mcp) is his connector hub: use its tools (`list_services`, `describe_service`, `call`) to reach his services instead of asking for credentials.
- **Approvals (Oct 20 2026):** whenever an axHub call needs his approval, open the approval screen for him (a browser tool when one reaches his device); otherwise give the direct one-tap link to that approval (`https://axhub.amberxai.com/auth/admin/approvals/<id>`) first, with the Coolify-terminal command as the fallback.
- **No secrets** in repos, logs, chat, `_claude/`, `_data` or `/projects`: environment variables or GitHub Actions secrets only.
