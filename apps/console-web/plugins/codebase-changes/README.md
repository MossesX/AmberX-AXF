# Codebase changes

Every request to Claude to build, edit, remove or fix something is an entry (`change-log@1`): opened by the Claude Code
hook (`changes.mjs hooks install`), filled in step by step, closed out with its result. Entries live on axHub
(`/projects/amberx-axf/_data/changes`, one file each). Console: **Builds → Codebase changes**, plus the banner.

## Chat log view

An expanded entry reads like the Chat viewer (Brett, Nov 4 2026: "This needs to be displayed like the chat log."):

- **Brett**: his words from the brief's *What Brett said* block, and each addendum as its own bubble with its time.
- **Amber**: the brief, rendered as Markdown and collapsed to a few lines (*Show full brief*). The session rules every
  launch appends (watch live, agent cap, model switches) sit behind *Session rules*.
- **Agent** (named agent's avatar when the session recorded `AXF_AGENT` as `who.agent`): each step with its state,
  time taken and checks, then commits, the pull request and the result.
- **System lines**: started, closed.

The facts (opened, updated, repo, branch, model, where, PR, banner, id) are one row of chips above it. *Classic view*
switches back to the old layout, per browser (setting `codebase-changes.chatLog`, Settings → Plugins → Codebase
changes). *To carry on* stays under the log, collapsed.

The pieces are the framework's, not this plugin's: `framework/core/build-chat.mjs` turns an entry into messages
(`timeline`), `BuildChatLog` / `ChatBubble` (`framework/react/components/ChatLog.tsx`) draw them. The Chat viewer, the
Build manager and the Builds page use the same component, each with its own Chat log / Classic view switch.

Older entries stored the prompt on one line; `reflow` puts the headings, bullets and session rules back on their own
lines. New entries keep the prompt's line breaks.

## Checks

```bash
node apps/console-web/plugins/codebase-changes/test.mjs
node framework/spec/check-build-chat.mjs
```
