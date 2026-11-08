<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=148 -->
## Status (as of Oct 21 2026)

- **Launcher: plan or API key (Oct 18 2026, built on Opus):** `deploy/claude-pick.sh` (installed as `claude` by `--install`) now asks first how to sign in: Claude plan (default; unsets any stray `ANTHROPIC_API_KEY`) or an Anthropic API key read from `~/.anthropic-key` (0600, `ANTHROPIC_KEY_FILE` overrides) and exported only for that `claude` process; option 3 saves/replaces the key (pasted hidden). `claude-pick --set-key | --remove-key | --key-status`. `AXF_CLAUDE_AUTH=plan|api` skips the question (also applies to `-p` runs). The key never goes in a repo.
