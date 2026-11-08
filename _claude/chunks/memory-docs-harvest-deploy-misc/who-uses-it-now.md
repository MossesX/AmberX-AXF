<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=21-29 tokens=127 -->
## Who uses it now

- `deploy/install-console.sh` sources `framework/deploy/axf-deploy.sh` (from the clone it just updated).
- `web-fastapi-wall` bakes `framework/deploy` into the app (`src/axf/deploy`, hashed in `axf.lock.json`); its
  `deploy/install.sh` sources it.
- Build Pilot: not switched (read-only here). Steps in `framework/deploy/README.md` → "Adopting it in Build Pilot".

Nothing deleted: the console installer's inline copies were replaced by calls; Build Pilot keeps its own until adopted.
