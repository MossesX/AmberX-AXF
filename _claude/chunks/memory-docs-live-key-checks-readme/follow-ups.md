<!-- memory-chunk@1 source=_claude/memory/docs/live-key-checks/README.md tokens=162 -->
## Follow-ups
- Push banner, auto-merge, branch cleanup, CI helpers: build their client from `axf.github@1` (orchestrator s12, owned
  by `claude/pr-only-merge`; don't edit push-banner from this build).
- axHub: add `pulls/merge` and `git/delete-ref` to its github service (allow policy for the console's client) so those
  writes can go through the hub too.
- After `claude/pr-only-merge` lands: move the push banner's token check onto health@1 (orchestrator step s7).
- enterprise-branding (`claude/enterprise-branding-3`) restyles these banners: the UI uses framework controls, theme
  tokens and the existing `axp-systems-check-*` classes only.
