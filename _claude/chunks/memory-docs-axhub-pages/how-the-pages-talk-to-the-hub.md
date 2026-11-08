<!-- memory-chunk@1 source=_claude/memory/docs/axhub-pages.md lines=22-28 tokens=123 -->
## How the pages talk to the hub

`/auth/api/*` (hub `web.ts`, `approvals-web.ts`): browser session cookie only (the MCP bearer token never reaches it),
writes need the hub's own Origin, a JSON body and `X-AxHub-CSRF` = the session's CSRF value from `/auth/api/session`;
no CORS. Approve and the rest still go through `applyApprovalAction`, the revision check, compare-and-set, the audit
log and the approvals log. Client: `apps/axhub-web/src/hub/api.ts` (one retry on an expired CSRF value).
