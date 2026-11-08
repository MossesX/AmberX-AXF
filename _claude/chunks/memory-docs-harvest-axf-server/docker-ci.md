<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md lines=87-96 tokens=172 -->
## Docker / CI

- `apps/console-web/server/Dockerfile`: `ENV PYTHONPATH=/axf/framework/python` and an import check of every module at
  build time. `deploy/install-console.sh` needs no change: the image copies the whole repo and the host clone mounted
  over `/axf` contains `framework/python`; `server/axf_framework.py` covers bare runs and tests. (No Docker daemon in the
  build sandbox: verified by booting `main` in the image's layout — repo at a scratch `/axf`, `PYTHONPATH`, server
  folder as cwd — 18 plugins loaded, no errors.)
- `.github/workflows/android.yml`: engine job runs `check-axf-server.mjs`; console job runs it plus
  `python framework/python/axf_server/test.py`.
