<!-- memory-chunk@1 source=_claude/memory/docs/axf-architecture.md tokens=55 -->
## Deploying the web demo (xaf.amberxai.com)

`.github/workflows/deploy.yml` builds `apps/demo` on every push to `main` and publishes `dist/` to the `site`
branch; the VPS pulls it (one-time setup: `deploy/install.sh`).
