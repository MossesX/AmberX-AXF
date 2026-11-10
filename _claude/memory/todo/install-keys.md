# To-do: Install keys

Goal: Hostinger runs through axHub on the VPS (vault key), then the direct Claude Hostinger connector gets removed. Nov 5 2026.

Status: axHub vault is configured but holds 3 secrets, none for Hostinger. `hostinger.*` calls fail with "credential not available". DNS for molly is already correct (molly A -> 31.97.13.252, checked via the Claude connector).

## Steps

- [ ] 1. Find the exact vault key name the axHub `hostinger` service reads (Amber: read the service config on the VPS). Write it here: `________`
- [ ] 2. Get a Hostinger API token: hPanel -> Account -> API -> create token (read access to DNS, VPS, domains is enough; the service is read-only).
- [ ] 3. Open the console -> Terminal (VPS).
- [ ] 4. Run: `docker exec -it jghxpzuudkahgznvffiwtwmj-20261104T141721 axhub vault set <key-name-from-step-1>` (container name may change after a redeploy; check with `docker ps | grep jghx`).
- [ ] 5. Paste the token when it prompts. Never paste it in chat.
- [ ] 6. Run: `docker exec <same container> axhub vault status` and check the secret count went from 3 to 4.
- [ ] 7. If the service is off, enable it: `docker exec <same container> axhub services enable hostinger`.
- [ ] 8. Tell Amber. Amber reruns `hostinger.DNS_getDNSRecordsV1` for amberxai.com through axHub. Pass = molly record comes back.
- [ ] 9. Only after step 8 passes: claude.ai -> Settings -> Connectors -> remove the Hostinger connector.
- [ ] 10. Amber confirms Hostinger still answers through axHub after the connector is gone.

## Follow-ups

- Console Vault page build (queued, waits for Brett's go): add / swap / test keys from Settings, no terminal.
- Health check that alerts when any axHub service is missing its key.
- DKIM TXT record `mail._domainkey` is a placeholder ("the long v=DKIM1 ... line from the file"); mail signing likely broken.

## Test login for headless builds (added Nov 5)

- [ ] 11. After build `headless-test-login` lands: create the axHub TEST user (not your own login) and put its username + password in the axHub vault under the key names in the instructions. Instructions: https://github.com/MossesX/AmberX-AXF/blob/main/_claude/memory/docs/headless-test-login.md (exists once the build's PR merges). Paste values yourself in the console Terminal, never in chat.
