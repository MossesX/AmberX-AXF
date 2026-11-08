<!-- memory-chunk@1 source=_claude/memory/docs/live-key-checks/README.md tokens=133 -->
# Live key + health checks in the banners (Angel `live-key-checks`, Oct 30 2026)

Brett (voice): the console's `GITHUB_TOKEN` went dead (GitHub 401) and nothing told him. "You need to make sure things
like that go into one of the banners. I need to see that kind of shit."

Built in the systems-check plugin (it owns both the Keys banner and the systems check banner). Details and the
health@1 API: the plugin README (section *Live key + health checks*). Rule:
`_claude/shared/rules/RULES.md` → *Broken = a banner item with a fix*.
