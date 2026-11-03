# Quick docs

Quick notes for later reference. New items go at the bottom, newest last.

---

## 2026-10-28 — Retrieve Claude Tokens
`cat ~/.claude.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('oauthAccount', {})))"`
**What it does:** Extract your token details from your local configuration file (~/.claude.json) using Python or by inspecting the credential store. Prints only the `oauthAccount` block of ~/.claude.json: the Claude account the CLI is signed in with (email, account and org IDs, display name). The OAuth token itself is not in this file; it lives in ~/.claude/.credentials.json.
**When to use:** checking which Claude account a box is signed in to, or whether it's signed in at all (`{}` = no Claude plan sign-in, run `claude` then `/login`).
**Parts:** `cat ~/.claude.json` = the CLI's config file · `python3 -c` = run inline Python · `json.load(sys.stdin)` = parse it · `d.get('oauthAccount', {})` = take only the account block, empty if missing · `json.dumps` = print it as JSON
**Safe?** Read only, changes nothing. Prints account details, not the token. Never cat ~/.claude/.credentials.json into chat or logs; for a long-lived token use `claude setup-token` and paste it only where it's needed.
**Docs:** https://docs.anthropic.com/en/docs/claude-code/settings · https://docs.python.org/3/library/json.html
**Script:** none
**Process returned data:** no

## 2026-10-28 — Claude Credentials
`cat ~/.claude/.credentials.json | python3 -m json.tool`
**What it does:** prints the Claude Code sign-in file (~/.claude/.credentials.json) as indented JSON. That file holds the live OAuth access token, refresh token, expiry, scopes and plan.
**When to use:** checking Claude Code is signed in, when the token expires, or which plan it's on.
**Parts:** cat = read the file · | = pass it on · python3 -m json.tool = indent the JSON so it's readable
**Safe?** Read only, changes nothing, but it PRINTS SECRETS. Run it yourself in Moshi only: never through axHub vps.run, an agent, a script or a Run button, and never paste the output into chat, docs or logs. Anyone holding the refresh token can use the Claude account. To see the field names without values: `python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.claude/.credentials.json')));print({k:(list(v) if isinstance(v,dict) else type(v).__name__) for k,v in d.items()})"`. For a token to use elsewhere, make a separate one with `claude setup-token`.
**Docs:** https://docs.python.org/3/library/json.html#module-json.tool · https://docs.claude.com/en/docs/claude-code/iam
**Script:** none
**Process returned data:** no
