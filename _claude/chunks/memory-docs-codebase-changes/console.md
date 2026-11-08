<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md lines=64-77 tokens=299 -->
## Console

- **Banner** (order 4.7, after Activity and the Build manager): shows on every load while any entry isn't closed:
  count, how many are in progress / failed, the newest titles. The drop-down lists each open entry (kind badge, title,
  state, time, steps n/m, result or current step) with ✕ (closed everywhere), **Open the log** and **Close all**; tapping
  an entry opens it in the log. There is no "hide for now": it stays until entries are closed (Settings has a per-browser
  off switch).
- **Builds → Codebase changes**: filters (text, kind, state, in banner / closed, repo, date range), counts, rows with
  kind/state/time/steps/repo/"in banner", tap for the detail: the request, facts, steps timeline with times and notes,
  result (summary, branch, commits linked to GitHub, files, tests table, links; repo paths open on GitHub), **Close
  (everywhere)** / **Show in the banner again**, Copy id. 30 per page, **Load more**.
- Action `codebase-changes.open[:<id>]`, search provider (every entry seen), "Codebase changes" in the default context menu.
- **Settings → Plugins → Codebase changes**: banner switch, where the log lives, the hook install command, Install & uninstall.
