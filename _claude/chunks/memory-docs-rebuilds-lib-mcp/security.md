<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/lib-mcp.md tokens=226 -->
## Security

Kept: console token on every route, 404 when disabled, not on the console MCP, tokens never to the browser, env-var
tokens preferred, 0600 data file, id/env/url validation, length caps, no new-server overwrite, remote content as text.
Added/tightened: redirects are never followed on any port (3xx → `invalid`; a bearer header can't leak to another host);
the UI can't call write/destructive tools without the matching permission (`denied`, never silently downgraded);
destructive tools need an explicit confirmation on every port (`confirmation_required` from `AxfMcp.callTool` until
confirmed); call-log rows are capped at 300 chars and never contain tokens (tested); Android tokens live only in the
Keystore-backed secure store, records never carry them (tested); server→client requests (sampling/elicitation) are
ignored, never auto-answered; per-request timeout + abort on every port.
