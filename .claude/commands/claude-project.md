---
description: Make this folder (or another) a Claude project and give it a home on GitHub, the VPS or this device; offers to port non-AXF apps to AmberX AXF
argument-hint: [dir] [name="My App"] [where=github,vps,device] [port=bake|rebuild|no]
---

Make a folder a Claude project with AmberX AXF's `claude-project` command. Arguments: $ARGUMENTS

1. The folder is the one named in the arguments, else the current working directory.
2. Run `claude-project <dir> --dry-run --yes` to see what it finds (stack, whether it is built on AXF, an existing
   manifest). If `claude-project` is not on the PATH, run `node <AXF>/framework/cli/claude-project.mjs` instead, where
   `<AXF>` is the first of `$AXF_HOME`, `~/AmberX-AXF`, `~/amberx-axf`, `/home/user/amberx-axf` that exists.
3. Ask Brett in ONE short message for what the arguments don't give, with the defaults shown:
   - name (default: the folder or package name) and one sentence on what it is for;
   - where the repo lives: `github` (creates the repo and gives the Claude GitHub app access, so it shows in
     Claude.ai), `vps` (private git remote `/srv/git/<name>.git` + working folder `~/projects/<name>` on the VPS),
     `device` (stays here) — several allowed;
   - only if it is NOT built on AXF: port it to AXF? `bake` (bake AXF into this code), `rebuild` (new AXF app from a
     boilerplate, old code kept as reference) or `no`. A port is parked on the AXF pending list for Fable, not done now.
   Then wait for his answer.
4. Run `claude-project <dir> --yes --display "<name>" --description "<sentence>" --where <where> --port <port>`
   (add `--vps-host <host>` only when running somewhere other than the VPS). It needs `GITHUB_TOKEN` or `gh auth`
   for github; never print or store the token.
5. Report phone-readable: where it lives now (GitHub URL, VPS folder), whether the Claude app can see it (if not, the
   link it printed), files it added, anything it refused to commit, and the next step: open Claude Code in that
   folder (or pick the repo on Claude.ai) and paste `docs/FIRST_SESSION.md`. If it parked a port, say so and that
   AmberX-AXF has a pending-list change to commit.
