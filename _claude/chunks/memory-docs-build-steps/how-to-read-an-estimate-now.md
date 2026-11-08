<!-- memory-chunk@1 source=_claude/memory/docs/build-steps.md lines=25-32 tokens=136 -->
## How to read an estimate now

The new total of a split build is its steps added up, and every step is capped at 30 min. That is the honest budget
for "work on it a little at a time": a step that runs over 30 minutes is split again, not stretched. Where the old
estimate was a day-sized block (2 d, 7.5 d) the step list came out shorter because it counts concrete pieces, not
sessions; where it was tight (named-asset-rule, plugin-conflicts) the list came out longer because design and review
steps were missing. Treat totals as "at least".
