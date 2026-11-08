<!-- memory-chunk@1 source=_claude/THREADS.md lines=404-410 tokens=284 -->
### Molly (`molly-opus`, Big Dog, Opus) — branch `claude/project-thread-nxdu3m`, PR #230
- Asked: "Can we combine amberx, axhub, and console into 1 interface but still keep separate apps"; "Build new build profile for it called Big Dog"; "Do it in opus, I'll do another one in fable later, call the opus one molly at molly.amberxai.com". Brett said go (Nov 2) and that it can run without his approval.
- Done: profile `big-dog`; app `apps/molly` (manifest, shared assets, nav/app-menu/toolbar assets, kept-alive frames in `src/molly/FrameDeck.tsx`, deep links `#/<app>/<route>`, Dockerfile + nginx, CI build step); axHub web + AmberX `frame-ancestors` allow molly. Steps s1–s8 ticked. <!-- axf-plugin:build-orchestrator -->
- Left: s9 deploy (Coolify app from `apps/molly/Dockerfile`, DNS A record `molly` → VPS, DNS log line, redeploy axHub web + AmberX for the header), s10 UI Review shots.
- Checks: `cd apps/molly && npm run build`; `node framework/cli/shared-assets.mjs check --all`; `node framework/cli/project.mjs validate --all`.
- First message: "Carry on molly-opus (Big Dog) from s9 on branch claude/project-thread-nxdu3m."
