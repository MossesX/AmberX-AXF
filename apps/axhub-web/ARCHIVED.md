# axHub web app: archived and retired (Nov 20 2026)

Brett, Nov 19 2026: fold the axHub web UI into the console. Every page this app had is now a console plugin in the
**axHub** module (nav → axHub, app menu → Apps → axHub), each installable and uninstallable on its own:

| This app's page | Console plugin | Console view |
| --- | --- | --- |
| Approvals, Request, Approvals log (held calls, auto-approve) | `axhub-approvals` | `axhub-approvals`, `axhub-approval`, `axhub-approvals-log` |
| Go pass, Passes | `gate` (VPS Configuration → Passes; was `axhub-passes` until Nov 21 2026) | `axhub-go-pass`, `axhub-passes` |
| Apps | `axhub-apps` | `axhub-apps` |
| Users | `axhub-users` | `axhub-users` |
| Handoff, Handoff run | `axhub-handoff` | `axhub-handoff`, `axhub-handoff-run` |
| Hub, Account | `axhub-account` | `axhub-hub`, `axhub-account` |

They share the console's hub-pages kit (`apps/console-web/src/hubPages`) and reach the hub's `/auth/api/*` through the
console server's relay (`apps/console-web/server/hub_pages.py`): a wall admin's browser only, with its own hub session
or the console's owner sign-in, never the console token. The axHub server is unchanged.

Not carried over, on purpose:
- the "Coming" placeholders (Services, Jobs, Audit, Vault, Projects, Devices): notes with no feature behind them;
- the demo dialogs (New file, Delete item, Developer console) from the app template;
- `scripts/refresh-check.mts` (a Node render test of this app's shell; the console's browser tests cover its screens).
The rule tests (`test.mjs`) moved to `apps/console-web/src/hubPages/test.mjs`.

## Archive

The last live version is commit `001611f987760f132367cb92ed40436102224d8b` (main, Nov 20 2026). The source below stays frozen as it was there: CI no
longer builds or tests it, and no catalog plugin installs into it. Restore it from that commit with
`git checkout 001611f987760f132367cb92ed40436102224d8b -- apps/axhub-web`.

## Retire on the VPS

The systems check shows **axHub web app retired (VPS clean-up)** until the container is gone:
`bash /opt/axf/deploy/console-doctor.sh --fix host-axhub-web-retired` (or `docker rm -f axhub-web && rm -f
/etc/cron.d/axhub-web /usr/local/bin/axhub-web-update`). Rollback: `bash /opt/axf/apps/axhub-web/deploy/install.sh`.

Deleting this folder from the repo is a follow-up: about 60 framework files still list it (schemas' app lists, shared
assets, fixtures, a Kotlin conformance test), and those are contract changes for their own step.
