<!-- memory-chunk@1 source=_claude/memory/todo/install-keys.md tokens=289 -->
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
