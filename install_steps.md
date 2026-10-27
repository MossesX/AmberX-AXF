# Install steps: AmberX framework, axHub and the Dev Console on a new host

Step by step, from new accounts to your first development session. Do the steps in order; each one needs the ones
before it. Details on every key and why it's needed: [install_instructions.md](install_instructions.md).

Throughout, replace:

| Placeholder | Example |
| --- | --- |
| `<you>` | your GitHub account (`MossesX`) |
| `<domain>` | your domain (`amberxai.com`) |
| `<vps-ip>` | the VPS's public IP |

Keep a password manager open. Every secret you make goes straight into it and into its destination, nowhere else.

**Time:** about 2–3 hours. Most of it is waiting for builds.

---

## Part A: Accounts

### Step 1. GitHub account

1. Sign up at github.com (or use your existing account). Turn on two-factor authentication.
2. Get the code into your account:
   - **Your own copy:** create two **private** repos, `AmberX-AXF` and `axHub`, then import each one
     (github.com/new/import) from the source the owner gives you access to. Or ask to be added as a collaborator
     and fork.
   - **Working on Brett's:** ask Brett to add you as a collaborator on `MossesX/AmberX-AXF` and `MossesX/axHub`.
3. If the owner isn't `MossesX`, note it. You'll pass it to the installers (`REPO=`) and to claude-sync
   (`CLAUDE_SYNC_OWNERS=<you>`).
4. Make a **fine-grained token** now ([install_instructions §12](install_instructions.md#12-github)): your
   account, both repos, Contents + Pull requests + Actions read/write, Metadata read, 90 days. Save it.

### Step 2. Claude account

1. Sign up at claude.ai and choose a **Pro or Max** plan. Claude Code runs on it.
2. Optional: an Anthropic API organization at console.anthropic.com, if you want pay-per-use keys as a fallback
   ([§7](install_instructions.md#7-anthropic-api-keys)).

### Step 3. Hostinger account, domain and VPS

1. Sign up at hostinger.com.
2. Buy or transfer your domain (`<domain>`) and keep its DNS at Hostinger.
3. Buy a **KVM VPS** (KVM 2 or bigger: 8 GB RAM is comfortable). For the OS, pick **Ubuntu 24.04 with Coolify**
   if it's offered, otherwise plain Ubuntu 24.04.
4. Set a strong **root password** (save it) and note `<vps-ip>`.
5. Make a **Hostinger API token**: hPanel → Profile → API → New token. Save it.

---

## Part B: The server

### Step 4. Firewall

hPanel → VPS → **Firewall** → create a rule set and attach it to the VPS:

| Protocol | Port | Why |
| --- | --- | --- |
| TCP | 22 | SSH |
| TCP | 80, 443 | Websites (Traefik) |
| TCP | 8000 | Coolify's first setup (remove after step 7) |
| UDP | 60000-61000 | mosh (Moshi) |

### Step 5. DNS records

hPanel → Domains → `<domain>` → **DNS records**. Add `A` records pointing at `<vps-ip>`, TTL 3600:

`axhub`, `console`, `coolify`, `axf`, `pilot`, `patches`

(Or one wildcard `*` record to `<vps-ip>` covers them all.)

### Step 6. Coolify

Skip 6.1 if the VPS template already installed Coolify.

1. Open Hostinger's **browser terminal** (hPanel → VPS → Terminal) and run:
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```
2. Open `http://<vps-ip>:8000` and create the Coolify admin account. Save the password. Turn on 2FA (profile).
3. Choose **localhost** as the server when it asks. Coolify starts its Traefik proxy, which owns ports 80/443.

### Step 7. Give Coolify its domain and API

[install_instructions §3](install_instructions.md#3-make-coolify-reachable):

1. Coolify → **Settings** → Instance's Domain = `https://coolify.<domain>` → Save. Open it to check HTTPS.
2. **Settings → API** → **API Access** on.
3. **Keys & Tokens → API Tokens** → create one with **write** (or **deploy**) permission. Save it as the Coolify
   token.
4. Remove the TCP 8000 rule from the firewall.

### Step 8. Connect Coolify to GitHub

Coolify → **Sources** → **+ Add** → **GitHub App** → follow the steps on GitHub. Install the app on `<you>` with
access to **only** `axHub` and `AmberX-AXF`. With a GitHub App, Auto Deploy works by itself.

(A deploy key works too: [axHub's deploy/coolify.md](https://github.com/MossesX/axHub/blob/main/deploy/coolify.md)
step 3.)

---

## Part C: axHub

### Step 9. Make axHub's secrets

In Coolify → **Servers → localhost → Terminal**, run each one and save the output:

```bash
openssl rand -base64 48   # AXHUB_MCP_TOKEN
openssl rand -base64 32   # AXHUB_VAULT_KEY  (keep this one extra safe)
```

Pick a temporary admin password too.

### Step 10. Create the axHub app

Coolify → **Projects → + Add** (name it `amberx`) → **+ New → Resource → Private Repository (with GitHub App)**:

1. Repository `<you>/axHub`, branch `main`, **Build Pack** `Dockerfile`.
2. **Ports Exposes** `8080`.
3. **Domains** `https://axhub.<domain>`. Delete the auto `sslip.io` and `www.` entries.
4. **Environment Variables** (tick **Is Secret** on the secrets, never **Build Variable**):

   | Name | Value |
   | --- | --- |
   | `AXHUB_MCP_TOKEN` | from step 9 |
   | `AXHUB_VAULT_KEY` | from step 9 |
   | `AXHUB_PUBLIC_URL` | `https://axhub.<domain>` |
   | `AXHUB_ALLOWED_ORIGINS` | `https://axhub.<domain>` |
   | `AXHUB_COOKIE_DOMAIN` | `.<domain>` |
   | `AXHUB_ADMIN_PASSWORD` | the temporary admin password |
   | `AXHUB_LOG_LEVEL` | `info` |
   | `PORT` | `8080` |

5. **Persistent Storage → + Add → Volume**: name `axhub-data`, path `/app/data`. Add a second volume: name
   `axhub-projects`, path `/projects`.
6. **Healthcheck:** on, HTTP, host `127.0.0.1`, port `8080`, path `/healthz`.
7. **Advanced:** **Auto Deploy** on.
8. **Deploy.** Wait for `axHub listening` in the logs.

### Step 11. First sign-in

1. Open `https://axhub.<domain>/healthz` and check it shows `"status":"ok"`.
2. Open `https://axhub.<domain>/auth/login`, sign in as `admin` with the temporary password, and pick your own
   (8+ characters). Save it.
3. Back in Coolify, **delete** `AXHUB_ADMIN_PASSWORD` and redeploy.
4. Check OAuth is on: `https://axhub.<domain>/.well-known/oauth-authorization-server` shows JSON.

### Step 12. Put your service keys in axHub's vault

In Coolify → axHub → **Terminal** (values are typed at a hidden prompt):

```bash
axhub vault set github-token       # the GitHub token from step 1
axhub vault set hostinger-token    # the Hostinger token from step 3
```

The repo's `examples/README.md` has the commands that register the `github` and `hostinger` services if they
aren't listed in `axhub services list`.

---

## Part D: The VPS shell and tools

From here on, use an SSH session: Hostinger's browser terminal for now, Moshi after step 15.

### Step 13. Base tools and GitHub access

```bash
apt-get update && apt-get install -y git mosh jq curl
ufw allow 60000:61000/udp || true
# Node 22 (Claude Code, claude-sync, the CLIs)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
# GitHub CLI
apt-get install -y gh || (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y gh)
gh auth login        # GitHub.com → HTTPS → paste the fine-grained token (or log in with the browser)
gh auth setup-git    # git can now clone and push your private repos
```

### Step 14. axHub's VPS shell

```bash
git clone https://github.com/<you>/axHub /root/axHub
sudo bash /root/axHub/deploy/ssh-shell.sh
```

This lets axHub's `vps` service run commands on the host, each one approved by you.

### Step 15. Moshi

1. Install **Moshi** on your phone → **Keys** → **+** → Ed25519 → copy the public key.
2. On the VPS: `echo '<the public key line>' >> /root/.ssh/authorized_keys`
3. In Moshi, add a host: `<vps-ip>`, user `root`, port 22, that key, mosh on. Connect.

([install_instructions §13](install_instructions.md#13-moshi))

---

## Part E: The Dev Console and the framework

### Step 16. Install the console

```bash
git clone https://github.com/<you>/AmberX-AXF /opt/axf
REPO=https://github.com/<you>/AmberX-AXF.git DOMAIN=console.<domain> GITHUB_TOKEN='<the GitHub token>' \
  bash /opt/axf/deploy/install-console.sh
```

The script builds the console image, runs it behind Traefik at `https://console.<domain>`, makes `AXF_TOKEN`
(saved in `/opt/axf/.axf-console/env`), mounts axHub's `axhub-projects` volume, installs the 5-minute auto-update
and turns on axHub's sign-in wall once the hub can sign you in. It's safe to re-run.

### Step 17. Connect the console and the hub

1. Copy the wall secret into axHub: `cat /opt/axf/.axf-console/wall-secret`. In Coolify → axHub → Environment
   Variables, add `AXHUB_WALL_SECRET` = that value. Also add:

   | Name | Value |
   | --- | --- |
   | `AXHUB_DATA_ORIGINS` | `https://console.<domain>,https://pilot.<domain>` |
   | `AXHUB_APPROVALS_FRAME_ANCESTORS` | `https://console.<domain>` |
   | `AXHUB_APPS_FRAME_ANCESTORS` | `https://console.<domain>` |

   Redeploy axHub.
2. Re-run the installer once so the wall switches on:
   `bash /opt/axf/deploy/install-console.sh`
3. Open `https://console.<domain>`. You're sent to axHub's sign-in, then back to the console.

### Step 18. Fill in the console's keys

The **Keys needed** banner lists what's missing. Tap it and enter each one. Each is tested on save:

| Key | Value |
| --- | --- |
| GitHub token | from step 1 |
| Hostinger API token | from step 3 |
| Coolify URL | `http://coolify:8080` |
| Coolify API token | from step 7 |
| axHub URL | `https://axhub.<domain>` |
| axHub token | `AXHUB_MCP_TOKEN` |
| Moshi public key | from step 15 |
| Anthropic API key | optional |

Then open the **systems check** and press **Fix all**. Approve the VPS fixes on axHub as they pop up.

### Step 19. Claude Code on the VPS

```bash
npm install -g @anthropic-ai/claude-code
bash /opt/axf/deploy/claude-pick.sh --install    # `claude` starts on your plan + Opus; installs claude-sync and the hooks
exec bash -l
node /root/axHub/clients/claude-code/claude-sync.mjs install
CLAUDE_SYNC_OWNERS=<you> claude-sync login          # paste AXHUB_MCP_TOKEN (stored 0600)
node /opt/axf/apps/console-web/plugins/codebase-changes/changes.mjs hooks install # axf-plugin:codebase-changes
cd /opt/axf && claude                               # starts on your Claude plan with Opus (no questions); /login once
```

### Step 20. Make your subscription the active one

1. On the VPS: `cat ~/.claude/.credentials.json` and copy the whole file.
2. Console → long-press → **AI keys** → Add → **Credentials file** → paste it → label it → Save → **Use this one**.
3. Run `/login` again in Claude Code on the VPS if it now says the token is invalid. The console writes the
   renewed pair back by itself (approve it on axHub).

([install_instructions §6](install_instructions.md#6-claude-subscription-tokens))

---

## Part F: claude.ai

### Step 21. Connectors

On claude.ai in a browser → **Settings → Connectors**:

1. **GitHub:** connect as `<you>`. On GitHub, give the **Claude** app access to `AmberX-AXF` and `axHub`.
2. **axHub:** **Add custom connector** → name `axHub`, URL `https://axhub.<domain>/mcp`, Advanced settings left
   empty → Add → **Connect** → sign in to axHub → **Allow**. (claude.ai registers itself with the hub.)
3. **Hostinger:** add it from the connector list and sign in with the Hostinger token.

### Step 22. The project

1. In the console: **Tools → Claude handoff → Assemble prompt**. This writes the kit to `_claude/handoff/`.
2. claude.ai → **Projects → New project** → name `AmberX AXF`.
3. **Instructions:** paste `_claude/handoff/INSTRUCTIONS.md` (everything below its line).
4. **Knowledge:** upload every file in `_claude/handoff/context/`.

### Step 23. Cloud sessions (claude.ai/code)

1. Open claude.ai/code → pick the repo `<you>/AmberX-AXF`.
2. In the environment settings, add variables `AXHUB_TOKEN` (= `AXHUB_MCP_TOKEN`) and `AXF_TOKEN` (from
   `/opt/axf/.axf-console/env`). Optionally add `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.
3. Network access: **Trusted** or **Full**, so it can reach `axhub.<domain>`.

---

## Part G: Deploys and checks

### Step 24. Automatic deploys

- axHub and other Coolify apps: **Auto Deploy** on (step 10.7).
- Optional GitHub Actions deploy ([install_instructions §4b](install_instructions.md#4b-github-actions-calls-coolifys-deploy-webhook)).
- The console updates itself every 5 minutes from `main`.
- Android APK signing (optional): make a debug keystore, then
  `base64 -w0 debug.keystore` → repo secret `ANDROID_DEBUG_KEYSTORE`.

### Step 25. Check everything

| Check | Expect |
| --- | --- |
| `https://axhub.<domain>/healthz` | `"status":"ok"` |
| claude.ai chat: "Use axHub's list_services" | `axhub`, `vps`, `github`, `hostinger` |
| claude.ai chat: "Call axhub.ping" | `pong: true` |
| Console banner | Claude badge green, no Keys needed banner |
| Systems check | all green, or only items you chose to skip |
| On the VPS: `cd /opt/axf && node framework/cli/project.mjs validate --all` | passes |
| `node framework/cli/pending.mjs` | lists the pending builds |
| `claude-sync status` | the repo's projects, nothing held |
| New Claude Code session: "What are the rules before a build?" | model pick, pending list, one agent, threads file |

---

## Part H: Start developing

### Step 26. First session

In Moshi (`cd /opt/axf && claude`) or a claude.ai/code session in the repo, start with:

> Read CLAUDE.md, the rules and `_claude/THREADS.md`. Tell me what's open and what you'd do first.

From then on:

- Every session reads `_claude/THREADS.md` first and keeps it current
  ([install_instructions §10](install_instructions.md#10-the-threads-file)).
- Claude asks which model to use before each build. Pick Fable, Opus or Sonnet.
- Builds happen on branches with PRs. Merges to `main` deploy by themselves.
- Anything that touches the VPS shows up as an approval on axHub (the console banner, the AXHub app or
  `https://axhub.<domain>/auth/admin/approvals`).
- To move work to another Claude account, use the handoff
  ([install_instructions §11](install_instructions.md#11-handing-off-sessions)).
