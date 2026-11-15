# DATA-STORE — axf-data holds all console data (data-store@1)

Status: contract, Phase 1 of build `data-container-axf-data-holds-all` (Fable, Nov 15 2026). Reference client
`framework/core/data-store.mjs` (HTTP, local-file and memory backends, one API), mode machine
`framework/core/data-store-mode.mjs`, constants mirrored in `framework/schemas/data-store.json`. Check:
`node framework/spec/check-data-store.mjs` (fixtures `framework/spec/fixtures/data-store.json`,
`data-store-migration.json`, `data-store-mode.json`). No Kotlin twin: this is console infrastructure, nothing an Android
app renders (deferred gap in `PORTING.md`).

## Why

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

Today the console container owns most of what it writes: plugin data folders under `.axf-console/plugins/<folder>`,
the builds store in the repo checkout (`_claude/builds`), SQLite ledgers, UI Review items. The rest sits on axHub's
data server (`/projects/<project>/_data`, 64 KB per file) or in the shared Claude files (`/projects/_shared/_claude`).
When the console is rebuilt, moved or down, those files are unreachable and a running build stalls on the first write.

`axf-data` is one small container that owns the data volume and nothing else. It never ships UI, never runs builds,
never restarts for a console deploy. The console, axHub, the orchestrator's headless sessions, the CLI and every plugin
are clients of the same API. The console going down then costs the console's screens and nothing more: notes are
readable through the API, builds keep writing their store and journal, and the next console comes up on the same
data.

## Vocabulary

| Word | Meaning |
|---|---|
| **namespace** | one area of data with its own grants, limits and migration manifest (`notes`, `builds`, …) |
| **key** | `<namespace>/<path>`; `path` is `/`-separated segments of `[A-Za-z0-9._-]{1,80}`, no `.`/`..` segments, ≤ 512 chars |
| **record** | one JSON document (object or array) ≤ 1 MiB. The unit of optimistic writes |
| **blob** | bytes with a content type (screenshots, SQLite files, tar archives) ≤ 256 MiB. Same rev/etag rules as a record |
| **journal** | an append-only stream of JSON entries. Entries get a sequence number; nothing is rewritten or removed |
| **rev** | whole number, 1 on create, +1 on every accepted write of that key; a delete bumps it and leaves a tombstone |
| **etag** | `"<rev>-<sha256 of the body, first 16 hex>"`; what `If-Match` carries |
| **cursor** | the store-wide change sequence (every put / delete / append moves it); what `watch` and `since` use |

## Namespaces

The registry lives in `framework/schemas/data-store.json` (`namespaces`). A client refuses a namespace not in it;
plugin namespaces are open under one prefix so a new plugin needs no registry change.

| Namespace | Holds today (source → key) | Kinds |
|---|---|---|
| `notes` | Brett's notes, `/projects/_shared/_claude/notes/<folder>/<name>.md` → `notes/<folder>/<name>.md`; note history → `notes/_history/<folder>/<name>.jsonl` | blob (Markdown), journal |
| `builds` | builds@1 `_claude/builds/store.json` → `builds/store.json`; journal `_claude/builds/journal/<month>.jsonl` → `builds/journal/<month>`; `store.json.exports.json`, `origins.json`, `orchestrator.json`, `shipped/*.json`, `reports/*`, `progress/*`, `profiles/*` keep their relative paths; `/projects/amberx-axf/_data/pipeline` and `_data/builds` → `builds/pipeline/…`, `builds/reconcile/…` | record, journal, blob |
| `settings` | hub-settings@1 documents `/projects/_shared/_data/settings/**` → `settings/<same path>`; `_shared/_data/claude/settings.json` → `settings/claude/settings.json` | record |
| `planner` | plan@1 store `/projects/amberx-axf/_data/plan-studio/**` → `planner/<same path>`; `shipped-log.jsonl` is a journal | record, journal |
| `ui-review` | ui-review-item@1 `items.json`, `kinds.json`, screenshots → `ui-review/items.json`, `ui-review/kinds.json`, `ui-review/shots/<file>` | record, blob |
| `plugins/<folder>` | plugin-lifecycle@1 `lifecycle.dataDir` (`.axf-console/plugins/<folder>/**`) → `plugins/<folder>/<same path>`; a SQLite file is one blob | record, blob, journal |
| `changes` | the codebase changes log `/projects/amberx-axf/_data/changes/<yyyy>/<mm>/<id>.json` → `changes/<yyyy>/<mm>/<id>.json` | record |
| `sessions` | session@1 archives `/projects/amberx-axf/_data/sessions/**` and the claude.ai drop folder → `sessions/<same path>` | record, blob |
| `console` | the rest of the console's own hub data: `home-cards`, `agents`, `agent-slots`, `agent-swarm`, `listeners`, `token-log`, `tracker.json`, `companion`, `walkthrough`, `amberx-notes` tables → `console/<folder>/<same path>` | record, journal |
| `_meta` | the store's own state: `_meta/mode` (data-store-mode@1 per namespace), `_meta/manifests/<id>`, `_meta/tokens` (issued token ids, never the tokens) | record |

A namespace's `kinds` says which kinds a key may be; a journal key cannot later become a record. `plugins/<folder>`
takes `folder` from plugin-lifecycle@1 (`[a-z0-9][a-z0-9-]*`); the framework never names a plugin folder, the plugin
asks for its own namespace through `ctx.dataDir` and the reference client maps that folder.

## Frames

Every answer is JSON with `$axf`. Bodies of blobs are bytes; their metadata frame comes as headers (`ETag`,
`X-Axf-Rev`, `X-Axf-At`, `X-Axf-By`, `Content-Type`) and as `data-record@1` with `data` omitted on `?meta=1`.

```
data-record@1  = { $axf, ns, path, kind: record | blob, rev, etag, at, by, size, contentType, deleted: false, data? }
data-entry@1   = { $axf, ns, path, seq, at, by, entry }                 one journal line (seq is per key, from 1)
data-list@1    = { $axf, ns, prefix, items: [data-record@1 without data…], next: cursor | '' , total? }
data-change@1  = { $axf, cursor, ns, path, kind, op: put | delete | append, rev, etag, seq?, at, by }
data-manifest@1= { $axf, id, at, by, mode, namespaces: { <ns>: { count, bytes, hash, journals: { <path>: { entries, hash } } } } }
data-error@1   = { $axf, code, message, ns?, path?, rev?, etag?, retryAfterMs? }
```

`by` is the caller the token names (`svc:console`, `svc:orchestrator`, `svc:axhub`, `svc:cli`, `svc:plugin:<folder>`),
plus an optional `X-Axf-Actor` (a session id, a person's id) kept verbatim after a `/`. `at` is the server's clock, ISO
UTC, millisecond precision; clients never set it.

### Manifest hash

Per namespace: sort every live key by path (bytewise), one line per key `"<path>\t<etag>\n"`, SHA-256 of the whole
text, hex. `count` is the number of live keys, `bytes` their total body size. A journal contributes its path with
`etag = "<entries>-<sha256 of all entry lines, first 16 hex>"`. The same function runs over a source folder before a
migration and over the namespace after it, so equal manifests mean equal data (see Migration).

## Operations

Base path `/v1`. Namespaces and paths are URL segments as written above (`/v1/plugins/ui-review/items.json`).

| Op | HTTP | Answer | Notes |
|---|---|---|---|
| get | `GET /v1/<key>` | body + metadata headers, or `data-record@1` with `?frame=1` | `If-None-Match` → 304 |
| put | `PUT /v1/<key>` | `data-record@1` (no data) | `If-Match: <etag>` or `If-Match: <rev>` for an update; `If-None-Match: *` for a create. **No precondition = refused** (`precondition_required`) for a record, allowed for a blob only with `?force=1` |
| delete | `DELETE /v1/<key>` | `data-record@1` with `deleted: true` | same preconditions; the tombstone keeps `rev`, `at`, `by`; 30 days later it is purged |
| list | `GET /v1/<ns>?prefix=&after=&limit=` | `data-list@1` | metadata only, path order, `limit` ≤ 1000, `after` is the last path seen; `?deleted=1` includes tombstones |
| append | `POST /v1/<key>:append` | `{ $axf: 'data-append@1', ns, path, first, last, count }` | body `{ entries: [ … ] }` ≤ 4 MiB, each entry ≤ 256 KiB; the key becomes a journal on first append; `Idempotency-Key` header makes a retry safe (same key → same `first`) |
| read journal | `GET /v1/<key>?since=<seq>&limit=` | `{ $axf: 'data-entries@1', entries: [data-entry@1…], next }` | `since` exclusive, `limit` ≤ 5000; `?tail=n` for the last n |
| watch | `GET /v1/watch?ns=a,b&prefix=&since=<cursor>` | SSE of `data-change@1`, event `change`, `id` = cursor | a reconnect sends `Last-Event-ID`; a `cursor` older than the retained feed (30 days) answers `cursor_expired` so the client lists instead |
| snapshot | `POST /v1/snapshot` `{ namespaces?: [ns…] }` | `data-manifest@1` | writes `_meta/manifests/<id>` and `/v1/snapshot/<id>.tar` (every live body, one file per key, `manifest.json` inside); `GET /v1/snapshot/<id>` reads the manifest |
| manifest | `GET /v1/<ns>:manifest` | one namespace of `data-manifest@1` | computed live, cached by cursor |
| health | `GET /v1/health` | `{ $axf: 'data-health@1', ok, cursor, uptimeMs, volume: { freeBytes, totalBytes }, keys: { verified, fetchedAt } }` | the one route without a token (internal network only) |

Writes are atomic per key (write to a temp file on the volume, fsync, rename; the index row and the change feed line
move in the same critical section). Journals append under a per-key lock; `seq` never has gaps. The server keeps the
last 30 days of `data-change@1` in its own journal (`_meta/changes`); everything older is reachable only through list +
get.

### Optimistic writes

A client reads (gets `etag`), changes, writes with `If-Match`. If someone else wrote first the answer is `409 conflict`
with the current `rev` and `etag`; the client re-reads, applies its change again, retries (the reference client's
`update(key, fn)` does this up to 5 times with jitter, then throws the conflict). Journals never conflict: appends
serialise.

A record's `rev` is per key; there is no store-wide transaction. Data that must move together is one record (the
builds store already is) or a journal entry.

## Errors

| code | HTTP | retry | when |
|---|---|---|---|
| `invalid_key` | 400 | no | namespace unknown, bad segment, too long, kind mismatch (`put` on a journal) |
| `invalid_body` | 400 | no | not JSON for a record, bad `entries`, bad frame |
| `too_large` | 413 | no | over the kind's limit |
| `precondition_required` | 428 | no | record `put` / `delete` without `If-Match` or `If-None-Match` |
| `unauthorized` | 401 | after re-issue | no token, expired, bad signature, unknown `kid` |
| `forbidden` | 403 | no | token has no grant for this namespace / op |
| `not_found` | 404 | no | no such key (a tombstone answers 404 unless `?deleted=1`) |
| `conflict` | 409 | re-read first | `If-Match` does not match the current etag / rev |
| `exists` | 409 | no | `If-None-Match: *` and the key exists |
| `read_only` | 423 | after mode change | the namespace is frozen (migration, `cutover` in progress, local in `cutover` mode) |
| `cursor_expired` | 410 | list instead | `watch` / `since` older than the retained feed |
| `rate_limited` | 429 | `retryAfterMs` | one caller over its budget |
| `unavailable` | 503 | `retryAfterMs` | volume not mounted, fsck, startup |
| `internal` | 500 | once | anything else; logged with a request id in `message` |

`data-error@1` is the body of every non-2xx answer. The reference client turns `unauthorized` into one token re-issue
and one retry, `conflict` into the re-read loop, `rate_limited` / `unavailable` into backoff (250 ms × 2ⁿ, 5 tries, ≤ 8 s),
and everything else into a thrown `DataStoreError` with the same `code`.

## Auth

`axf-data` listens on the deploy's internal docker network only. It is never published on a host port and the console's
reverse proxy has no route to it. Anything outside the network reaches data only through the console API, axHub or the
MCP tools, which carry their own auth.

Inside the network every request carries `Authorization: Bearer <service token>` (except `/v1/health`). A service token
is issued from axHub's keys:

```
data-token@1 (compact JWS, EdDSA, header { alg: 'EdDSA', kid, typ: 'axf-data+jwt' })
  iss: 'axhub'                     the issuer; its key set is GET <hub>/.well-known/axf-keys.json
  aud: 'axf-data'
  sub: 'svc:<service>'             console | orchestrator | axhub | cli | plugin:<folder>
  jti: <id>                        recorded in _meta/tokens on first use (revocation list, never the token)
  iat, exp                         ≤ 24 h apart; a service re-issues before expiry
  grants: { '<ns or ns/prefix>': ['read' | 'write' | 'append' | 'admin'…] }
```

`axf-data` loads the key set at boot, refreshes it hourly and keeps the last good copy on the volume
(`_meta/keys.json`), so verification works with axHub down. `admin` is needed for `snapshot`, `_meta/*` writes and
mode changes. Grants are per namespace or per prefix (`plugins/ui-review`): a plugin's token sees its own folder and
nothing else; the console's token holds every namespace a plugin may ask through it; the orchestrator's holds
`builds`, `planner`, `ui-review`, `changes`, `console/agent-slots` and append on `sessions`.

Issuing: `POST <hub>/api/data-tokens { service, grants, ttl }` on an axHub session with admin, or from the deploy
scripts with axHub's own key (the installer issues the console's and the orchestrator's token into their env files,
the same way `AXHUB_TOKEN` reaches a headless session today). Revocation: `DELETE /v1/_meta/tokens/<jti>` with admin
on axf-data; a revoked `jti` answers `unauthorized`.

## Limits

| What | Limit |
|---|---|
| record body | 1 MiB |
| blob body | 256 MiB |
| journal entry | 256 KiB; one append ≤ 4 MiB |
| key | 512 chars, segment 80 chars |
| list page | 1000 |
| journal page | 5000 entries |
| change feed retained | 30 days |
| tombstones kept | 30 days |
| watch connections per token | 32 |

## Migration

Design in Phase 1 step s3 (this section is written there): every data source the console writes today, its namespace,
the per-namespace count + hash manifest check, and the rollback rule. Fixture: `framework/spec/fixtures/data-store-migration.json`.

## Modes

Design in Phase 1 step s4 (`framework/core/data-store-mode.mjs`, fixture `framework/spec/fixtures/data-store-mode.json`):
`local → shadow → cutover`, with `rollback` from any of the later two.

## What this phase does not do

No container, no server code, no UI: Phase 1 is the contract, the reference client with a local-file backend, the
migration plan and the mode machine. Nothing the console writes today moves. The API rule (everything with a UI has full
API control) has nothing to attach to yet; the modes switch and the manifests get console, MCP, CLI and voice surfaces in
the phase that ships the container.
