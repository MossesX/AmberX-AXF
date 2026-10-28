# Install instructions: keys, tokens, connectors and how it all fits

This file covers every key, token, secret, password, connector and plugin the AmberX framework, axHub and the
Dev Console need. For each one it says how to get it, where it goes, what it does and why it's needed. For a
fresh install on new accounts, follow [install_steps.md](install_steps.md) top to bottom. It points back here for
the details.

**The one rule for every secret:** values go only in the places named below (Coolify environment variables,
GitHub Actions secrets, the axHub vault, the console's credential store, Claude's connector fields, or 0600
files on the VPS). Never put them in a repo, `_claude/`, `_data`, `/projects`, a chat, a commit message or a
log. When a step says "copy it", paste it straight into its destination or into your password manager.

---

## Contents

1. [How the pieces connect](#1-how-the-pieces-connect)
2. [Every secret at a glance](#2-every-secret-at-a-glance)
3. [Make Coolify reachable](#3-make-coolify-reachable)
4. [Make Coolify actions reachable (deploys from GitHub and from Claude)](#4-make-coolify-actions-reachable)
5. [axHub: environment variables, the OAuth client and the claude.ai connector](#5-axhub)
6. [Claude subscription tokens (access + refresh)](#6-claude-subscription-tokens)
7. [Anthropic API keys](#7-anthropic-api-keys)
8. [Several Claude accounts: picking which one the assistant and the VPS use](#8-several-claude-accounts)
9. [Make every Claude account read the repo's rules](#9-make-claude-read-the-rules)
10. [The threads file: what Claude must log and when](#10-the-threads-file)
11. [Handing a session to another Claude account](#11-handing-off-sessions)
12. [GitHub](#12-github)
13. [Moshi (phone terminal)](#13-moshi)
14. [Hostinger and the VPS](#14-hostinger-and-the-vps)
15. [The Dev Console's own tokens and the sign-in wall](#15-the-dev-console)
16. [Vinny, Mosses and axHub's VPS shell](#16-vinny-mosses-and-the-vps-shell)
17. [tmux, ntfy and Tailscale](#17-tmux-ntfy-and-tailscale)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. How the pieces connect

```
 Phone (Moshi, Claude app, browser)
        │
        ├─ Moshi (mosh/SSH) ─────────────► Hostinger VPS ── Claude Code sessions (your subscription)
        │                                      │
        ├─ claude.ai / Claude app ─ connector ─┼─► axHub  https://axhub.amberxai.com/mcp
        │                                      │     ├─ vault (GitHub token, Hostinger token, …)
        │                                      │     ├─ vps    (root shell, every command approved by you)
        │                                      │     ├─ github (REST, writes approved)
        │                                      │     ├─ tmux   (sessions on the VPS, through vps; changes approved)
        │                                      │     ├─ ntfy   (push to your phone, listed topics only)
        │                                      │     ├─ tailscale (devices, routes, DNS; changes approved)
        │                                      │     └─ /projects (rules, memory, shared data for every project)
        │                                      │
        └─ browser ────────────────────────────┼─► Dev Console https://console.amberxai.com (behind axHub's sign-in)
                                               │     ├─ AI keys (which Claude account is active)
                                               │     ├─ systems check (credentials, Auto fix)
                                               │     └─ Coolify API (redeploys)
                                               └─► Coolify (builds and runs axHub, the console and the apps)
                                                     ▲
 GitHub (MossesX/AmberX-AXF, MossesX/axHub) ─────────┘ (deploy key / GitHub App, auto-deploy, Actions)
```

- **GitHub** holds the code and is the memory between sessions (repo files, branches, PRs, `_claude/THREADS.md`).
- **Hostinger** is the VPS and the DNS for `amberxai.com`.
- **Coolify** runs on the VPS, builds each app from GitHub and runs it behind its Traefik proxy (HTTPS).
- **axHub** is the connector hub. Claude talks to one MCP server, and axHub reaches GitHub, Hostinger, the VPS
  shell and the projects tree for it. The credentials stay in axHub's vault, and every risky call waits for
  your approval.
- **The Dev Console** is the framework's control app: credentials, AI keys, build manager, terminal, handoff.
  Its **Connections** plugin lists every app and service wired through axHub (and the ones you could add).
- **tmux** keeps Claude Code and long jobs running on the VPS when Moshi drops or the phone sleeps. **ntfy**
  pushes approvals, build results and alerts to your phone. **Tailscale** puts the VPS, your phone and your
  computers on one private network, so SSH, mosh and the console can stay off the public internet.
- **Claude** shows up in four places: claude.ai and the Claude app (chats and Projects), Claude Code on the VPS,
  Claude Code cloud sessions (claude.ai/code), and the console's AI assistant. Each one signs in on its own.

---

## 2. Every secret at a glance

| Name | What it is | Made where | Stored where | Used by |
| --- | --- | --- | --- | --- |
| `AXHUB_MCP_TOKEN` | Bearer token for axHub's `/mcp` | `openssl rand -base64 48` | Coolify → axHub env; password manager | Claude Code, claude-sync, the console (`AXHUB_TOKEN`) |
| `AXHUB_VAULT_KEY` | Master key that encrypts axHub's vault | `openssl rand -base64 32` | Coolify → axHub env; password manager (separate from backups) | axHub only |
| `AXHUB_OAUTH_CLIENT_ID` | Optional fixed OAuth client (not needed: claude.ai registers itself) | You pick, e.g. `claude-ai` | Coolify → axHub env; connector's Advanced settings | claude.ai connector sign-in |
| `AXHUB_OAUTH_CLIENT_SECRET` | Password of that optional client | `openssl rand -hex 32` | Coolify → axHub env; connector's Advanced settings | claude.ai connector sign-in |
| `AXHUB_ADMIN_PASSWORD` | First admin's temporary password | You pick | Coolify → axHub env, **removed after first start** | First sign-in only |
| `AXHUB_WALL_SECRET` | Signs who's signed in, for walled apps | Console installer | Coolify → axHub env = `/opt/axf/.axf-console/wall-secret` | axHub ↔ console |
| `AXF_TOKEN` | Dev Console API + `/mcp` token | Console installer | `/opt/axf/.axf-console/env` (0600) | console panel, `.mcp.json`, scripts |
| `GITHUB_TOKEN` | Fine-grained GitHub token | github.com → Settings → Developer settings | console credentials; axHub vault `github-token` | console (CI, PRs, catalog), axHub `github` service |
| `HOSTINGER_API_TOKEN` | Hostinger API | hPanel → Profile/Account → API | axHub vault `hostinger-token`; console credentials; claude.ai Hostinger connector | DNS + VPS reads |
| `COOLIFY_URL` + `COOLIFY_TOKEN` | Coolify API address + token | Coolify → Keys & Tokens → API tokens | console credentials; GitHub Actions secrets (optional) | redeploys |
| Claude access token `sk-ant-oat…` | Signs Claude Code in to your subscription (about 8 h) | `~/.claude/.credentials.json` after `/login` | console AI keys (paired) | assistant, VPS Claude Code |
| Claude refresh token `sk-ant-ort…` | Gets new access tokens without signing in again | same file | console AI keys (paired) | console renews the pair |
| Claude long-lived token `sk-ant-oat01…` | One-year Claude Code token | `claude setup-token` | console Terminal settings; cloud env `CLAUDE_CODE_OAUTH_TOKEN` | headless / terminal Claude Code |
| `ANTHROPIC_API_KEY` `sk-ant-api…` | Pay-per-use API key | console.anthropic.com → API keys | console AI keys or credentials; `~/.anthropic-key` | API-key features, claude-pick API mode |
| `AXHUB_PUSH_NTFY_TOPIC` | Long random ntfy topic for axHub's approval pushes (works like a password) | `openssl rand -hex 16` | Coolify → axHub env; the ntfy app on your phone | axHub approval push |
| `AXHUB_PUSH_NTFY_TOKEN` | ntfy access token (only for a protected ntfy server) | `ntfy token add <user>` on that server | Coolify → axHub env | axHub approval push |
| ntfy access token `tk_…` | Same token for the `ntfy` service (optional) | as above | axHub vault `ntfy-token`; console Settings → Alerts → ntfy | `ntfy.publish` / `poll`, console alerts |
| `TAILSCALE_API_TOKEN` `tskey-api-…` | Tailscale API access token (90 days max) | Tailscale admin → Settings → Keys | axHub vault `tailscale-token`; console credentials | `tailscale` service, Connections plugin |
| Tailscale auth key `tskey-auth-…` | Joins a machine to your tailnet once | Tailscale admin → Settings → Keys | typed once on the VPS (`tailscale up --auth-key`), then deleted | VPS joining the tailnet |
| `MOSHI_SSH_PUBKEY` | Moshi's **public** key (not secret) | Moshi app → Keys | console credentials → VPS `authorized_keys` | Moshi sign-in |
| `ANDROID_DEBUG_KEYSTORE` | Stable signing key for app APKs (base64) | `keytool` | GitHub Actions secret | `android.yml` |

---

## 3. Make Coolify reachable

**Why:** Coolify's dashboard and API start out at `http://<VPS IP>:8000`, plain http on a raw port. Giving it a
domain with HTTPS lets you reach it safely from your phone, and lets GitHub Actions call its API. The console
doesn't need this, because it reaches Coolify inside the VPS at `http://coolify:8080`.

1. **DNS record.** In hPanel → Domains → `amberxai.com` → DNS records, add an `A` record `coolify` → the VPS IP,
   TTL 3600. Skip this if a wildcard `*` record already points at the VPS.
2. **Give Coolify its domain.** Open Coolify at `http://<VPS IP>:8000` → **Settings** → **Instance's Domain** (FQDN)
   → `https://coolify.amberxai.com` → Save. Traefik gets the HTTPS certificate within a minute or two.
3. **Check it.** Open `https://coolify.amberxai.com` and sign in.
4. **Lock it down.**
   - Use a long password, and turn on **two-factor authentication** in your Coolify profile.
   - In Hostinger's VPS firewall (hPanel → VPS → Firewall), close port `8000` once the domain works. Coolify
     stays reachable through Traefik on 443.
   - Don't put Coolify behind axHub's sign-in wall. If the hub goes down you'd be locked out of the tool that
     redeploys it.
5. **Turn the API on.** Coolify → **Settings** → **API**: switch **API Access** on. Leave **Allowed IPs**
   empty if GitHub Actions will call it, because GitHub's runners use many IP addresses. If only the console
   will call the API, you can allow just the VPS's own IP.

---

## 4. Make Coolify actions reachable

There are three ways a redeploy can happen without you tapping **Redeploy** yourself. Use one, or combine them.

### 4a. Auto Deploy (simplest: every merge to `main` deploys)

- **What it does:** Coolify watches the repo and redeploys whenever `main` changes.
- **Why:** when Claude merges a PR, the live app updates with no extra step.
- **How:** Coolify → the app (axHub, for example) → **Advanced** (or **General → Git**) → **Auto Deploy** on.
  This needs Coolify to hear about pushes. With a **GitHub App** source that works by itself. With a **deploy key**
  (how axHub was set up), also add the webhook: the app's **Webhooks** page shows a GitHub webhook URL and secret.
  Add them in GitHub → the repo → **Settings → Webhooks → Add webhook** (content type `application/json`, push
  events only).

### 4b. GitHub Actions calls Coolify's deploy webhook

- **What it does:** a workflow in the repo calls Coolify's API to redeploy, on push to `main` or by hand
  (**Run workflow**).
- **Why:** Claude can trigger it from anywhere it can reach GitHub (cloud sessions, claude.ai with GitHub), even
  where the VPS is blocked. It also leaves a log of every deploy in GitHub.
- **How:**
  1. Coolify → **Keys & Tokens → API Tokens** → **Create**. Name it `github-actions`, permission **deploy** (or
     **write**). Copy it once.
  2. Coolify → the app → **Webhooks** → copy the **Deploy Webhook** URL. It looks like
     `https://coolify.amberxai.com/api/v1/deploy?uuid=<app uuid>&force=false`.
  3. GitHub → the repo → **Settings → Secrets and variables → Actions → New repository secret**. Add
     `COOLIFY_TOKEN` (the token) and `COOLIFY_DEPLOY_URL` (the URL).
  4. Add `.github/workflows/coolify-deploy.yml`:

     ```yaml
     name: Deploy on Coolify
     on:
       push:
         branches: [main]
       workflow_dispatch:
     jobs:
       deploy:
         runs-on: ubuntu-latest
         steps:
           - name: Ask Coolify to redeploy
             env:
               COOLIFY_TOKEN: ${{ secrets.COOLIFY_TOKEN }}
               COOLIFY_DEPLOY_URL: ${{ secrets.COOLIFY_DEPLOY_URL }}
             run: |
               test -n "$COOLIFY_TOKEN" && test -n "$COOLIFY_DEPLOY_URL" || { echo "Coolify secrets not set"; exit 1; }
               curl -fsS --max-time 60 -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_DEPLOY_URL"
     ```
  - Needs step 3 of [section 3](#3-make-coolify-reachable): Coolify must answer on its public domain.
  - Don't combine this with 4a for the same app, or each merge deploys twice.

### 4c. From the Dev Console or through axHub (no public Coolify needed)

- **What it does:** the console's Container access plugin redeploys Coolify apps through Coolify's API from inside
  the VPS (`COOLIFY_URL=http://coolify:8080`). Through axHub, Claude can also run a redeploy command on the VPS
  with `vps.run`, and you approve it on axHub.
- **Why:** this works even when Coolify isn't public, and every action goes to an audit log.
- **How:** in the console, open the **systems check** (Keys needed banner) and set `COOLIFY_URL` =
  `http://coolify:8080` and `COOLIFY_TOKEN` = a Coolify API token with **write** or **deploy** permission. For
  Claude to use it, the axHub connector has to work in that session ([section 5](#5-axhub)).

**What Claude can do once these are set:** merge a PR and know it deploys (4a), deploy any branch merge from a
cloud session (4b), redeploy or restart a container from the console or through axHub with your approval (4c).
Without one of these, a merged change only goes live when someone presses **Redeploy** in Coolify.

---

## 5. axHub

### 5a. Environment variables (Coolify → axHub → Environment Variables)

Required:

| Variable | Value | Why |
| --- | --- | --- |
| `AXHUB_MCP_TOKEN` | `openssl rand -base64 48` | The bearer token machines use on `/mcp`. Without it the hub refuses MCP clients. |
| `AXHUB_VAULT_KEY` | `openssl rand -base64 32` | Encrypts every secret in the vault. **Losing it means re-entering every stored secret.** |
| `AXHUB_PUBLIC_URL` | `https://axhub.amberxai.com` | The hub's own address, used for links and OAuth. |
| `AXHUB_ALLOWED_ORIGINS` | `https://axhub.amberxai.com` | Browsers from other sites can't use `/mcp`. |
| `PORT` | `8080` | **Set it yourself.** Otherwise Coolify injects 3000 and the health check fails. |
| `AXHUB_COOKIE_DOMAIN` | `.amberxai.com` | One hub sign-in covers the console and other walled apps. |
| `AXHUB_WALL_SECRET` | contents of `/opt/axf/.axf-console/wall-secret` | Lets the console trust who's signed in. |
| `AXHUB_LOG_LEVEL` | `info` | |

First start only (delete after you sign in):

| Variable | Value | Why |
| --- | --- | --- |
| `AXHUB_ADMIN_PASSWORD` | a temporary password | Creates the first admin (`admin`). You pick a new password at the first sign-in, within 3 days. |
| `AXHUB_SEED_USERS` | JSON list, optional | Extra accounts, also with temporary passwords. |

For the claude.ai connector (OAuth, decisions #97 and #98). **Nothing is required:** with `AXHUB_PUBLIC_URL` and
`AXHUB_MCP_TOKEN` set, OAuth is on and claude.ai registers itself when you tap Connect.

| Variable | Value | Why |
| --- | --- | --- |
| `AXHUB_OAUTH_REGISTRATION` | optional; `on` (default) or `off` | Lets a connector added with no Client ID register itself. `off` = only the fixed client below. |
| `AXHUB_OAUTH_CLIENT_ID` | optional; a name, e.g. `claude-ai` | A fixed client, for clients that can't register themselves. You'd type the same value in the connector's Advanced settings. |
| `AXHUB_OAUTH_CLIENT_SECRET` | optional; `openssl rand -hex 32` (32+ characters) | That fixed client's secret. |
| `AXHUB_OAUTH_REDIRECT_URIS` | optional; default allows `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` | Where axHub may send you back after sign-in. Set it only if Anthropic changes the address. |
| `AXHUB_OAUTH_ACCESS_HOURS` / `AXHUB_OAUTH_REFRESH_DAYS` | optional; default 1 hour / 30 days | How long the connector's tokens last. claude.ai renews the access token by itself; after 30 days unused you tap Connect again. |

For the console and Patches: `AXHUB_DATA_ORIGINS`, `AXHUB_APPROVALS_FRAME_ANCESTORS`, `AXHUB_APPS_FRAME_ANCESTORS`,
`AXHUB_EMBED_FRAME_ANCESTORS` (each `https://console.amberxai.com` and/or `https://patches.amberxai.com`) let
those sites read hub data or show hub pages inside them.

Tick **Is Secret / Locked** on every secret. Never tick **Build Variable**, because build variables can end up
inside image layers. Every change needs a **Redeploy** (or Restart) to take effect.

### 5b. What OAuth does and why it's set up this way

It's still a normal Claude connector. When you tap **Connect**:

1. claude.ai reads axHub's discovery documents (`/.well-known/oauth-protected-resource`,
   `/.well-known/oauth-authorization-server`) to find the sign-in, token and **registration** addresses.
2. With no Client ID typed in, it **registers itself** at `/oauth/register`. axHub hands back a client ID that only
   works with claude.ai's own return address, carries no secret, and is sealed so it can't be edited or forged.
3. It sends your browser to `/oauth/authorize` with that client ID and a one-time **PKCE** challenge.
4. You sign in to axHub as an admin and tap **Allow**.
5. axHub sends your browser back to claude.ai with a one-use code.
6. claude.ai's server swaps that code, plus the PKCE proof, for tokens at `/oauth/token`.
7. claude.ai gets an access token (1 hour) and a refresh token (renewed on each use; reusing an old one ends the
   whole sign-in).

**Why this is safe with no secret:** a code only ever goes to claude.ai's own return address, and it's useless
without the PKCE proof held by whoever started that sign-in. Only a hub admin who signs in and taps Allow can
connect anything. axHub stores only hashes of the tokens, and every risky call still waits for your approval,
exactly like the MCP token.

### 5c. Add the connector in claude.ai

1. Make sure axHub runs the current version (decision #98 or later). Check that
   `https://axhub.amberxai.com/.well-known/oauth-authorization-server` shows JSON with a `registration_endpoint`.
2. On claude.ai (app or browser): **Settings → Connectors → Add custom connector**.
3. **Name** `axHub`, **URL** `https://axhub.amberxai.com/mcp`. Leave **Advanced settings** empty.
4. **Add**, then **Connect**. Sign in on axHub's page and tap **Allow**.
5. In a chat, tap **+ → Connectors** and make sure axHub is on. Ask: "Use axHub's list_services."

To end a connection: in the hub's terminal run `axhub oauth list`, then `axhub oauth revoke <id>` (or `--all`).
If a connector was added before decision #98, remove it and add it again, so it registers.

### 5d. Claude Code sessions (bearer token instead of OAuth)

- **On the VPS or any computer:**
  ```bash
  export AXHUB_TOKEN='…'   # better: claude-sync login, which stores it 0600 in ~/.config/axhub/token
  claude mcp add --scope user --transport http axhub https://axhub.amberxai.com/mcp \
    --header 'Authorization: Bearer ${AXHUB_TOKEN}'
  ```
- **Cloud sessions (claude.ai/code):** the repo's `.mcp.json` points at `${AXHUB_TOKEN}`. Add an environment
  variable `AXHUB_TOKEN` in the cloud environment's settings. The value is `AXHUB_MCP_TOKEN`.
- **The console:** systems check → `AXHUB_URL` and `AXHUB_TOKEN`.

### 5e. Services inside the hub

Run these in Coolify → axHub → **Terminal**, or from the VPS shell with `~/hub/bin/axhub …`. Values are typed
at a hidden prompt, never as arguments.

```bash
axhub vault set github-token        # paste the GitHub token (section 12)
axhub vault set hostinger-token     # paste the Hostinger API token (section 14)
axhub vault set tailscale-token     # paste the Tailscale API token (section 17)
axhub vault set ntfy-token          # only for a protected ntfy server (section 17)
axhub confirmations approve <id>    # approve a waiting call from the terminal
axhub users passwd admin            # reset the admin password
```

The `vps` service needs a one-time host setup: `sudo bash deploy/ssh-shell.sh` from the axHub repo on the VPS
([section 16](#16-vinny-mosses-and-the-vps-shell)).

---

## 6. Claude subscription tokens

### What they are

When Claude Code signs in to a Claude plan (Pro or Max) with `/login`, it saves a pair in
`~/.claude/.credentials.json`:

| Token | Starts with | Lasts | Job |
| --- | --- | --- | --- |
| **Access token** | `sk-ant-oat…` | about 8 hours | Sent with every request; says which subscription pays. |
| **Refresh token** | `sk-ant-ort…` | until used (it rotates) | Swapped for a new access token (and a new refresh token) before the old one expires. |

**Why both are needed:** an access token alone stops working within hours. With the refresh token, the console
renews the pair by itself every 10 minutes when it's close to expiry, so the assistant and Claude Code on the VPS
keep working without anyone signing in again. Each renewal **replaces** the refresh token, so the old copy stops
working. Keep one live copy, the one in the console.

Separately, `claude setup-token` makes a **long-lived** token (`sk-ant-oat01…`, about a year, no refresh token).
It's handy for a single Claude Code process (the console's Terminal tab, cloud sessions, CI), but the AI keys
plugin needs the pair.

### Get the pair

1. On any machine with Claude Code, sign in to the account you want: run `claude`, then `/login`, then pick the
   **Claude account** (subscription) option and finish in the browser.
2. Show the file: `cat ~/.claude/.credentials.json`. It looks like
   `{"claudeAiOauth": {"accessToken": "sk-ant-oat…", "refreshToken": "sk-ant-ort…", "expiresAt": …}}`.
   On macOS the pair is in the Keychain instead. Sign in on the VPS or a Linux box to get the file.
3. Copy the whole file content (long-press, select all in Moshi). Don't paste it anywhere but the console.

### Put it in the console

1. Open the console → right-click (long-press on the phone) → **AI keys**. It's also under the application
   menu **Plugins › AI keys** and **Settings → Plugins → AI keys**.
2. **Add a key** → **Credentials file** → paste the whole file. Or choose **Access + refresh** and paste the two
   tokens. Give it a label such as `Brett — Max`.
3. **Save.** The console tests the pair: the access token answers, the refresh token gets a new access token,
   and the new one answers. A pair that fails isn't saved.
4. Tap **Use this one** to make it active.

**What happens next:** the active pair is used by the console's AI assistant for its Claude Code subscription
profiles. It's also written to `/root/.claude/.credentials.json` on the VPS, directly when the console can reach
that file (`AXF_CLAUDE_CREDENTIALS`), otherwise by Vinny through axHub `vps.run` (you approve it; no token is in
the command). Claude Code sessions on the VPS then run on that subscription. **Write to the VPS now** forces the
copy.

Because the check renews the pair, the copy you pasted from stops working on the machine it came from. Run
`/login` there again if you still use it.

### The long-lived token, where it's used

| Place | Where to enter it |
| --- | --- |
| Console **Terminal** → Claude Code tab | Settings → Plugins → Terminal → **Claude Code token** |
| Claude Code cloud sessions | cloud environment variable `CLAUDE_CODE_OAUTH_TOKEN` |
| GitHub Actions running Claude Code | repo secret `CLAUDE_CODE_OAUTH_TOKEN` |

---

## 7. Anthropic API keys

- **What:** pay-per-use access to the Claude API (`sk-ant-api…`). It's billed separately from any subscription.
- **Get one:** sign in at `console.anthropic.com` (an organization with billing set up) → **API keys** →
  **Create key**. Copy it once.
- **Where it goes:**
  - Console **AI keys** → Add → **API key**. Use this one to make it the active `Anthropic` key for the
    assistant's API profiles.
  - Console systems check → `ANTHROPIC_API_KEY`, for features that call the API directly.
  - VPS Claude Code in API mode: `claude-pick --set-key` saves it in `~/.anthropic-key` (0600). Choose
    **API key** when `claude` starts, or set `AXF_CLAUDE_AUTH=api`.
- **Why separate from the subscription:** when a subscription runs out of usage, the assistant can switch to an
  API key (the systems check's Claude credits check does that among saved keys). An API key set anywhere in Claude
  Code's environment overrides the subscription and bills the key. `claude-pick --auth-check` shows where one is
  still set.

---

## 8. Several Claude accounts

Each Claude account (yours, a second Max plan, Conrad's) is one saved pair in **AI keys**, with a label. One account
is active at a time, and it drives **both** the console and the VPS.

- **Switch accounts:** console → long-press → **AI keys** → the account's row → **Use this one**. The console's
  assistant switches at once, and the console logs the VPS's Claude Code into the same account by writing that pair
  to `/root/.claude/.credentials.json` (directly, or through Vinny with your approval on axHub; **Write to the VPS
  now** forces it). Every new Claude Code session on the VPS, and every headless session the console or axHub starts,
  then runs on that account.
- **Add an account:** sign in to it once with `/login` in Claude Code anywhere, copy `~/.claude/.credentials.json`,
  and paste it into AI keys → Add → **Credentials file** ([section 6](#6-claude-subscription-tokens)).
- **Commands on the VPS through axHub** (Vinny, Auto fix, `vps.run`) don't use a Claude account: they run as root
  over axHub's SSH service after your approval. Only the Claude Code a command *starts* uses the active account.
- **See which account is live:** the **Claude badge** on the banner (green = working, amber = out of credits).
  Vinny's "retrieve email address" skill shows the email the VPS is signed in with.
- **Out of credits:** the systems check's `claude-credits` check tests the active account and, when it's out, makes
  the first saved account that answers active (console and VPS together), then opens AI keys so you can see or
  change the pick.

---

## 9. Make Claude read the rules

Every Claude account, on every surface, needs to start from the same rules. Here's how each surface picks them up.

| Surface | How it reads the rules | Set-up |
| --- | --- | --- |
| Claude Code (VPS, computers) | Loads `CLAUDE.md`, which imports `_claude/shared/rules/RULES.md` and `_claude/rules/RULES.md`. The claude-sync SessionStart hook pulls the latest `_claude/` from the hub first. | `bash deploy/claude-pick.sh --install` once per machine (`claude` then starts on your plan with Opus, no questions), then `claude-sync login` (axHub token) |
| Claude Code cloud (claude.ai/code) | Loads the repo's `CLAUDE.md` when the session starts in the repo. | Give the Claude GitHub app access to the repo; start sessions **in** `MossesX/AmberX-AXF`, never a fork |
| claude.ai Project (chats) | Project instructions + knowledge files. It can't read the repo by itself. | Paste `_claude/handoff/INSTRUCTIONS.md` (below its line) into the Project's **Instructions**; upload `_claude/handoff/context/*` as knowledge; refresh them after rule changes |
| Console assistant / Mosses | The plugin's own settings and add-ons | nothing extra |

**Keep them current:** when a rule changes, the session saves it in `_claude/`, runs `claude-sync sync` and
commits. Every Claude Code session gets it at the next start. claude.ai Projects only get it when you refresh the
instructions (the console's **Tools → Claude handoff** kit rebuilds `INSTRUCTIONS.md` and `context/`, and reminds
you every 6 hours).

**For a second account:** do the same set-up on that account (its own claude.ai Project, its own connector, its
own Claude Code sign-in). The repo files are the same for every account, so the rules are too.

**Check it:** start a session and ask "What are the rules before a build?". It should answer with the model pick,
the pending list check, one agent only and the threads file.

---

## 10. The threads file

`_claude/THREADS.md` is the log of every thread and build. **Why:** sessions on the phone, the VPS, the cloud and
different Claude accounts share no chat history. The repo is the only memory they all have. If a session runs out
of credits, gets cut off or is handed to another account, the next one picks up from this file instead of
guessing.

**Every session reads it before doing anything,** then updates the row, commits and pushes:

| When | State to set | Write in "Queued / next" |
| --- | --- | --- |
| A thread starts or a new build is asked for | `working` (new row) | what was asked, model |
| It starts a step (build, edit, tests, push, pull, merge) | `working` | the step it's on |
| A build completes | `working` → next state | build result |
| Tests start | `testing` | which tests |
| Tests pass / fail / stop part way | `working` / `failed` / `stopped` | counts, the failing test, where it stopped |
| It needs to push, or a push or pull completes or fails | `working` / `failed` | branch, the error |
| A PR is opened | `review` | PR number |
| It needs a merge | `review` | "Merge PR #…" |
| A merge completes or fails | `done` / `failed` | the error or the merge commit |
| A deploy is needed | `deploy` | which app, how |
| Something fails | `failed` | the error, what was tried |
| It runs out of credits or hits a usage limit | `stopped` | "Out of credits at <step>", how to resume |
| It needs Brett | `blocked` | the exact question |
| It's queued for later | `queued` | what's waiting |
| It's finished | move to **Done** | result |

If a session can't push (no access, no network), it says so in its reply and puts the row in the change-log
entry, so the next session can copy it in. The rule is also in `_claude/rules/RULES.md` ("Threads log in the
repo").

---

## 11. Handing off sessions

A handoff moves the work to another Claude account (a new subscription, a fresh account, another person) with
everything it needs.

**From the console:**

1. Open the console → **Tools → Claude handoff** → **Assemble prompt**. The console rebuilds the kit in
   `_claude/handoff/` (rules, instructions, memory, open threads, secret *names* only, set-up checklist) and
   records the run on axHub.
2. It opens the run's page on the hub, `https://axhub.amberxai.com/handoff/<id>`, which shows every step.
3. Tap **Continue installation and handoff**. Pick the new account's session (likely ones first). It copies the
   prompt or a ready command and opens it where it can.
4. Paste it into the new account's Claude (a claude.ai/code session in `MossesX/AmberX-AXF`, or Claude Code on the
   VPS signed in to that account) and tap **I've sent it**.
5. The new account's Claude reports each of the 13 handoff steps back (with the one-run key in the prompt), and
   they tick off on the page.
6. Make the new account's subscription active in **AI keys** ([section 8](#8-several-claude-accounts)) if it
   should also drive the VPS.

**What carries over:** the repo (branches, open PRs, `THREADS.md`), `_claude/` (rules, decisions, memory), the
Codebase changes log (each entry has a **Copy resume prompt**; `changes.mjs resume <id> --prompt`), the pending
list and build queue on axHub. **What doesn't:** chat history, and secrets. The new account asks for each secret
by name (`_claude/handoff/SECRETS.md`), and you enter it in its destination yourself.

---

## 12. GitHub

| Need | How | Where it goes |
| --- | --- | --- |
| **Fine-grained token** (console, axHub) | github.com → Settings → Developer settings → Fine-grained tokens → Generate. Owner `MossesX`; repos AmberX-AXF, axHub, Build-Pilot; permissions **Contents** read/write, **Pull requests** read/write, **Actions** read/write, **Metadata** read; 90 days | Console systems check `GITHUB_TOKEN`; axHub `axhub vault set github-token`; optional `GITHUB_TOKEN=… bash deploy/install-console.sh` |
| **Claude GitHub app** (claude.ai/code, claude.ai) | claude.ai → Settings → Connectors → GitHub → connect as MossesX; on GitHub, give the **Claude** app access to the repos | GitHub → Settings → Applications |
| **gh on the VPS** | `gh auth login` (GitHub.com, HTTPS, browser or token), then `gh auth setup-git` | `~/.config/gh` (0600) |
| **Coolify's access to the repo** | GitHub App source in Coolify (preferred), or a deploy key: Coolify → Keys & Tokens → Private Keys → ED25519 → public half in the repo's **Settings → Deploy keys** (read-only) | Coolify |
| **Actions secrets** | repo → Settings → Secrets and variables → Actions | `ANDROID_DEBUG_KEYSTORE`, optional `COOLIFY_TOKEN`, `COOLIFY_DEPLOY_URL`, `CLAUDE_CODE_OAUTH_TOKEN` |

**Why the permissions:** Contents to push branches and commit; Pull requests to open and merge PRs; Actions to
read CI results and start builds (app APKs, rebuild screenshots). When the token expires, the systems check flags
it, and Keys needed → **Auto fix** opens GitHub's form already filled in.

---

## 13. Moshi

Moshi is the phone app for mosh/SSH into the VPS. mosh keeps the session alive when the phone sleeps or switches
networks.

1. **Make a key in Moshi:** Moshi → **Keys** → **+** → Ed25519. Copy its **public** key (one line starting with
   `ssh-ed25519`).
2. **Put it on the VPS**, using one of these:
   - Console systems check → **Moshi public key** (`MOSHI_SSH_PUBKEY`) → Save, then the `moshi-key` row → **Auto
     fix**. It adds the line to root's `authorized_keys` through axHub after you approve.
   - Or in Hostinger's browser terminal: `echo 'ssh-ed25519 AAAA… moshi' >> /root/.ssh/authorized_keys`.
3. **mosh on the VPS:** `apt-get install -y mosh`, and open UDP `60000-61000` (`ufw allow 60000:61000/udp` and the
   same in hPanel → VPS → Firewall). The systems check flags both and has Auto fix for them.
4. **Add the host in Moshi:** host `31.97.13.252` (or `vps.amberxai.com` if you add that A record), user `root`,
   port 22, the key from step 1, mosh on.
5. **Once in:** run `claude` (claude-pick asks plan or API key and the model) in `/opt/axf` or your checkout.

---

## 14. Hostinger and the VPS

- **API token:** hPanel → **Profile** (or Account) → **API** → **New token**. Copy it once.
  - axHub vault: `axhub vault set hostinger-token`. The hub's `hostinger` service then reads VPS, DNS and domain
    data (read-only).
  - Console systems check: `HOSTINGER_API_TOKEN`.
  - claude.ai: **Settings → Connectors → Hostinger** (the hosted connector) for DNS changes from chats.
- **Why:** sessions do DNS themselves (shared rule "DNS: do it yourself") and check the VPS without asking you.
- **VPS root access:** keep the root password in your password manager. Day to day you use Moshi's key and
  axHub's `vps` service.
- **Firewall (hPanel → VPS → Firewall):** allow TCP 22, 80, 443 and UDP 60000-61000. Allow 8000 only until
  Coolify has its domain.

---

## 15. The Dev Console

| Secret | Made by | Lives in | What it does |
| --- | --- | --- | --- |
| `AXF_TOKEN` | `install-console.sh` | `/opt/axf/.axf-console/env` (0600) | Opens the console API, `/mcp` and plugin routes for machines and the panel. Reset: Settings → Account & security → Console token → **Reset token**. |
| Wall secret | `install-console.sh` | `/opt/axf/.axf-console/wall-secret` | Must equal `AXHUB_WALL_SECRET` on the hub. Lets the console trust who's signed in. |
| Credentials | you, in the systems check | `/opt/axf/.axf-console/secrets.env` (0600) | `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `HOSTINGER_API_TOKEN`, `COOLIFY_URL`, `COOLIFY_TOKEN`, `AXHUB_URL`, `AXHUB_TOKEN`, `MOSHI_SSH_PUBKEY` |
| AI keys | you, in AI keys | `.axf-console/plugins/ai-keys/keys.json` (0600) | Claude pairs and API keys ([sections 6](#6-claude-subscription-tokens)–[8](#8-several-claude-accounts)) | <!-- axf-plugin:ai-keys -->

**Where to type them:** the **Keys needed** banner (or the systems check dialog) asks for exactly the missing or
refused ones, tests each on save, and never sends a value back to a browser. With Claude connected, **Auto fix**
opens the page where each key is made.

**The sign-in wall:** with the wall on, only signed-in hub admins reach the console in a browser. Machines still
use `AXF_TOKEN` on `/api` and `/mcp`. If the hub is down and you're locked out, run
`AXF_WALL=off bash /opt/axf/deploy/install-console.sh` from Moshi. `AXF_WALL=on` turns it back on.

**Claude Code in cloud sessions** reaching the console: set `AXF_TOKEN` in the cloud environment's variables
(the repo's `.mcp.json` reads it).

---

## 16. Vinny, Mosses and the VPS shell

- **axHub `vps` service:** a root SSH shell from the hub container to the VPS. One-time setup on the VPS:
  ```bash
  git clone https://github.com/MossesX/axHub /root/axHub   # gh auth first if the repo is private
  sudo bash /root/axHub/deploy/ssh-shell.sh               # --remove undoes it
  ```
  `vps.check` runs fixed read-only checks. `vps.logs` and `vps.run` always wait for your approval at
  `https://axhub.amberxai.com/auth/admin/approvals/<id>` (or the AXHub web app / phone app).
- **Vinny** (console agent manager) is the VPS operator. His command book maps phrases and Auto fix keys to fixed
  commands, and each one goes through axHub `vps.run` for your approval. No Claude model runs.
- **Mosses** is the coding agent. He uses the same `axhub_call` tool when a fix needs judgment.
- **Why:** sessions don't hand you chores (shared rule). Anything on the VPS goes through one approval screen,
  logged, and the AI never approves its own call.

---

## 17. tmux, ntfy and Tailscale

All three are wired through axHub (decision #99 in the axHub repo), so Claude, the console and Vinny reach them
the same way they reach GitHub: one approval screen, credentials only in the vault. The console's **Connections**
plugin shows each one with its state, keys and a Configure button.

### 17a. tmux

**What:** a terminal multiplexer on the VPS. A Claude Code session started in tmux keeps running when Moshi
disconnects, and any device can attach to it later.

1. **Install:** `apt-get install -y tmux` (the systems check flags it if missing; its Auto fix sends that exact
   command to axHub's `vps.run` for your approval).
2. **Use it from Moshi:** `tmux new -s claude` then `claude`; detach with `Ctrl-b d`; come back with
   `tmux attach -t claude`. `tmux ls` lists sessions.
3. **Through axHub (no setup, it rides the `vps` service):**
   - `vps.check tmux_sessions` / `tmux_windows` list sessions and panes with no approval.
   - `vps.logs tmux_capture` reads what a pane shows (asks first: panes can show secrets).
   - `vps.tmux` starts (`new_session`), types into (`send_keys`), renames or kills a session. Every call
     waits for your approval and the approval shows the exact session and keys.
- **Why:** sessions survive the phone sleeping, and Claude can check on a long build in a pane without you
  re-opening Moshi.

### 17b. ntfy

**What:** push notifications to the ntfy app on your phone. The hub uses it two ways:

1. **Approval pushes (built in, decision #89).** Pick a long random topic (`openssl rand -hex 16`). In Coolify →
   axHub → Environment Variables set `AXHUB_PUSH_NTFY_TOPIC=<topic>` (and `AXHUB_PUSH_NTFY_URL` +
   `AXHUB_PUSH_NTFY_TOKEN` only for your own ntfy server), then redeploy. In the ntfy app → **+** → subscribe to
   that topic. Every approval request now pings your phone; tapping opens it.
2. **The `ntfy` service (for Claude, Vinny and the console).** In Coolify → axHub → Terminal:
   ```bash
   axhub vault set ntfy-token     # only for a protected server
   axhub services add --json '{"namespace":"ntfy","type":"plugin","displayName":"ntfy","address":"https://ntfy.sh","credentialRef":"ntfy-token","config":{"kind":"ntfy","topics":["<topic>"]}}'
   ```
   Tools: `ntfy.publish`, `ntfy.poll`, `ntfy.health`, only to the topics listed in `config.topics`.
3. **Console alerts:** Settings → **Alerts** → ntfy: same server and topic (and token), then **Test**.

- **Why:** you hear about approvals, failed builds and finished jobs wherever you are, without keeping the
  console open. A topic on ntfy.sh is readable by anyone who knows its name, so treat it like a password.

### 17c. Tailscale

**What:** a private network (tailnet) between the VPS, your phone and your computers.

1. **Account:** sign up at tailscale.com (GitHub sign-in works). Install the Tailscale app on your phone and
   sign in.
2. **Join the VPS:** Tailscale admin → Settings → **Keys** → **Generate auth key** (one-off, 1 day). On the VPS:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   tailscale up --auth-key=<tskey-auth-…> --ssh --hostname=vps
   ```
   The key is used once; don't save it anywhere. `tailscale ip -4` shows the VPS's 100.x address.
3. **API token for axHub:** Tailscale admin → Settings → Keys → **Generate access token** (90 days). In Coolify →
   axHub → Terminal:
   ```bash
   axhub vault set tailscale-token
   axhub services add --json '{"namespace":"tailscale","type":"plugin","displayName":"Tailscale","address":"https://api.tailscale.com","credentialRef":"tailscale-token","config":{"kind":"tailscale","tailnet":"-"}}'
   ```
   Reads run directly (`tailscale.devices`, `device`, `device_routes`, `keys`, `dns`, `acl`); changes
   (`authorize_device`, `set_device_tags`, `set_device_routes`, `delete_device`) always ask. Put the same token in
   the console's systems check as `TAILSCALE_API_TOKEN` so the Connections plugin can show its state.
4. **Moshi over the tailnet (optional):** in Moshi, edit the host to `vps` (MagicDNS) or its 100.x address. Once
   that works you can close port 22 and UDP 60000-61000 on the public firewall (hPanel → VPS → Firewall); keep
   80/443 open for Coolify. Do this only after Moshi connects over Tailscale, or you lock yourself out (Hostinger's
   browser terminal still works).
- **Why:** SSH and mosh off the public internet, and every device you own can reach the VPS by name.
- **Renewing:** the API token lasts 90 days. When it expires the systems check flags it and Keys needed asks for a
  new one; set it again with `axhub vault set tailscale-token`.

---

## 18. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| claude.ai connector "connect incomplete" / "Couldn't register" | axHub older than decision #98, or `AXHUB_OAUTH_REGISTRATION=off` | Redeploy axHub (or remove that variable), check `registration_endpoint` in 5c, remove and re-add the connector |
| Sign-in page says "isn't registered" | The connector registered with an older MCP token | Remove and re-add the connector |
| Sign-in page says redirect not allowed | Redirect address changed | Set `AXHUB_OAUTH_REDIRECT_URIS` to the address claude.ai uses |
| `/mcp` answers 401 | Missing/wrong token or missing `Bearer ` | Re-enter the token |
| Traefik "no available server" for axHub | `PORT` not set to 8080 | Add `PORT=8080`, redeploy |
| AI keys refuses a pair | Refresh token already used elsewhere | `/login` again, paste the fresh file |
| VPS Claude Code still on the old account | Credentials not written yet | AI keys → **Write to the VPS now**, approve on axHub |
| Merged but nothing changed live | No auto deploy | [Section 4](#4-make-coolify-actions-reachable) |
| Locked out of the console | Hub down, wall on | `AXF_WALL=off bash /opt/axf/deploy/install-console.sh` |
| claude-sync holds a file | Changed in two places | Pick a copy: `claude-sync resolve <id> --keep local\|hub` |
| `tmux_sessions` says "no server running" | No tmux session yet | `tmux new -s claude` in Moshi, or `vps.tmux new_session` |
| `ntfy.publish` denied | Topic not in `config.topics` | Re-add the service with that topic listed |
| No approval pushes | `AXHUB_PUSH_NTFY_TOPIC` unset, or phone not subscribed | Set it (16-64 letters/digits), redeploy, subscribe in the ntfy app |
| `tailscale.*` answers denied | API token expired (90 days) | New access token → `axhub vault set tailscale-token` |
| Moshi can't connect after closing port 22 | Moshi still uses the public IP | Hostinger browser terminal → `ufw allow 22`; switch Moshi to the tailnet name |
