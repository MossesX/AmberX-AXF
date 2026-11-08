<!-- memory-chunk@1 source=_claude/memory/docs/patches-banners.md lines=27-38 tokens=199 -->
## Buttons
- New framework icon `minimize` (an underscore, `framework/react/components/Icon.tsx`).
- **Activity** and **Build manager** (the two building banners), **Systems check** and **Keys needed** (error
  banners): the ✕ is now **_**, which folds the banner to its one-line summary (tap the summary to expand). It never
  hides the banner.
- **Codebase changes:** a **_** under the entries' ✕ column (bottom right, in the footer row) folds the list.
- **Every banner launches expanded** (activity, build manager, codebase changes, approvals, systems check, keys,
  What's new). Activity still only appears while something runs or just finished.

Build manager + codebase changes edits sit on top of PR #6 (branch `feat/patches-banners-bm`), since PR #6 rewrote
the build manager's banner.
