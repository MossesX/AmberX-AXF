<!-- memory-chunk@1 source=_claude/shared/rules/RULES.md tokens=52 -->
## Memory, rules and decisions

- If sync **holds** a file (changed in two places, or deleted on one side), ask him which copy to keep, then `claude-sync resolve <id> --keep local|hub`. Never pick for him.
