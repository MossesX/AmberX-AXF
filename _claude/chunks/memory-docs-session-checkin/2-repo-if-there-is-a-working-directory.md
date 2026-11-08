<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md tokens=133 -->
### 2. Repo (if there is a working directory)
- **Show:**
  - `git remote get-url origin`, the branch and short HEAD
  - clean or dirty
  - ahead or behind `origin`
- **Expected:** `MossesX/AmberX-AXF` unless Brett names another repo.
- **Options:**
  - **This repo is right:** the detected one.
  - **A different repo:** he names it; Claude switches to it, or clones it if it's missing.
  - **No repo for this session.**
- **On a mismatch, or when behind `origin`:** say so before doing anything else, and offer to pull or switch.
