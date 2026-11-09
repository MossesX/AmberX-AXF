# Saved Claude logins never end up on a spent refresh token (saved-claude-logins-never-end-up-on-a-spent-refr)

Built Nov 9 2026 on Opus, branch `claude/saved-claude-logins-never-end-up-on-a-spent-refr`.

Brett (Nov 9 2026, 20:14): "Why is it expiring when it gets a new refresh token every time? ... Okay, we need to do
something about that so it doesn't happen."

## Why it "expired"
It didn't time out. A Claude refresh token works **once**: renewing spends it and returns a new one. One login was
held in several places at the same time: every running build's private copy (`<worktree>/.axf-claude/<session>`), the
VPS live login (`~/.claude`), the saved login (`~/.claude-accounts/<name>`) and AI keys' saved pair. When the access
token ran low, whichever holder renewed first got the new token. Every other holder still had the spent one, and its
next renewal failed with "OAuth session expired and could not be refreshed". Anthropic may also revoke the whole chain
when a spent token is reused.

Claude Code prevents this itself, but only for processes that share **one** config folder: it has a refresh lock and
re-reads the credentials file before renewing (verified in 2.1.319). Each build gets its own copy, so that protection
never applied. The save-back added on Nov 6 only copied a rotation from a copy back to the stores. It never moved the
other running copies onto the new token, so two builds on one account could still spend the same token.

## What changed
The host now does what Claude Code does across its own processes (`deploy/claude-token-save.mjs`):
- **One host lock** (`~/.claude-accounts/.token-save.lock`) around every read-decide-write of a store or running copy.
  It is re-entrant in one process, and a lock left by a dead process (or older than 60 s) is taken over.
- **Running copies are registered** (`~/.claude-accounts/.copies/`). Every rotation, whatever it comes from (a build,
  the live login, AI keys, the keeper), is written into every running copy still on a spent token. So all copies of a
  login always hold the newest pair.
- **The keeper:** a build's watcher renews its copy's pair itself, under the lock, 60 min before it runs out. Claude
  Code waits until about 5 min and AI keys' thread until 30 min. One holder renews and every other holder gets the new pair
  before it would have renewed. Three keepers at once still call Anthropic once (tested against a fake grant that
  refuses any reuse).
- **Lineage** (`.lineage.json`, hashes only): spent → successor. A store that missed several rotations (for example,
  restored from a backup) still catches up.
- **Before every launch** the saved login is checked (`claude-login.mjs snapshot` → `claude-token-save.mjs freshen`).
  A pair with less than 90 min left is renewed once, so a normal build never renews on its own. Any pending AI keys
  renewal is taken in first. A copy is made under the lock, after the live login's latest renewal went out.
- **Dead logins:** when Anthropic refuses a refresh (`invalid_grant`) and no other holder renewed it meanwhile, the
  login is marked dead (`.dead.json`, hashes only). It stays dead until it is signed in again, not on a timer:
  - the launch fails with exit 5 and no run is burned on it; `claude-headless.sh` moves to the next worker, or doesn't
    start when there is none;
  - the worker router treats it as out (`limited.kind: dead`);
  - the Claude accounts systems check gets an **error** alert naming the account, with how to sign it in again. The
    banner reaches the phone through this alert.
- **Every path where a rotation was lost:**
  - crash, reboot or a dead watcher: the minute sweep now saves back every registered copy;
  - kill: unchanged, the watcher makes one last pass;
  - exit 1 or a failed save-back: `release` keeps the copy instead of deleting the only live token, and the pipeline's
    one-shot calls no longer delete a kept copy;
  - a copy changing between watcher passes: the copy is watched with fs.watch and saved at once;
  - a snapshot taken while the sweep was a minute behind: the live login is synced first, under the lock;
  - two builds renewing at once: handled by the lock, the copy registry and the keeper.

## Tests
- `node deploy/claude-token-save.test.mjs`: 53 checks. It covers two copies, three keepers at once, the watcher-keeper,
  crash + sweep, lineage catch-up, a stuck lock and a stale lock, a dead login (refused, skipped, cleared by signing in
  again), renewal before launch, and two AI keys races.
- `node deploy/claude-login.test.mjs`: 57. `node deploy/claude-workers.test.mjs`: 69 (dead login skipped, alert, back
  once signed in). `node deploy/worker-routing.test.mjs`: 44. `pipeline.test.mjs`: 35.
- Test fixtures run with `AXF_TOKEN_KEEP=off` or a fake refresher (`AXF_TOKEN_REFRESHER`), so fake tokens never reach Anthropic.

## How it is reached (no new UI)
- CLI: `node deploy/claude-login.mjs accounts` (shows `[dead: sign in again]`) and
  `node deploy/claude-token-save.mjs freshen --file <credentials.json>`. `node deploy/claude-workers.mjs status|alerts`
  shows `limited: dead` and the alert.
- REST / MCP / voice: the Claude accounts `routing` view (accounts → `limited`, `alerts`) and its systems check carry the
  dead state. They are the same data the console, MCP console actions and AmberX already read.

## For Brett
- account-1 and account-3 are probably already on spent tokens. This fix can't revive a spent login. The first launch
  on each one will mark it dead and raise the alert. Sign them in again (Settings → Claude accounts → Sign in, or
  `node deploy/claude-workers.mjs signin account-1`).
- Not covered: AI keys' pairs live in the console container, outside the host lock. That race is kept away by timing
  (the host renews 60 min ahead, AI keys 30 min), and the host takes in AI keys' renewals before every refresh. A login
  is never marked dead when AI keys renewed it at the same moment.
