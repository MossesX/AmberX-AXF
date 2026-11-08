<!-- memory-chunk@1 source=_claude/memory/docs/assistant-approvals.md tokens=148 -->
# Approvals in the assistant's title bar (lib-approvals)

Brett, Oct 28 2026 19:19 EDT: "Make approvals pop up in the assistant's title bar, click to approve" — the same
mechanism for the Dev Console's AI assistant and the AmberX app's assistant, both powered by axHub.

Built on Opus as refactor-all s77–s80 (group assistant-approvals), branch `refactor-all/assistant-approvals`. Brett
skipped the Fable contract step (approval-badge@1), so there is **no new cross-port engine or fixture**: a small shared
web library over what already existed (lib-hub `hub.ts` feed + `veto.ts` held calls).
