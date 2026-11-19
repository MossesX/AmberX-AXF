# DATA-STORE — axf-data holds all console data (data-store@1)

Status: contract, Phase 1 of build `data-container-axf-data-holds-all` (Fable, Nov 15 2026). Reference client
`framework/core/data-store.mjs` (HTTP, local-file and memory backends, one API), mode machine
`framework/core/data-store-mode.mjs`, constants mirrored in `framework/schemas/data-store.json`. Check:
`node framework/spec/check-data-store.mjs` (fixtures `framework/spec/fixtures/data-store.json`,
`data-store-migration.json`, `data-store-mode.json`). No Kotlin twin: this is console infrastructure, nothing an Android
app renders (deferred gap in `PORTING.md`).

Inventory of every JSON/JSONL data file and its target Postgres table: `framework/spec/DATA-INVENTORY.md` (Nov 18 2026).

## Rule: no runtime data in JSON files (no-json-data@1, Nov 18 2026)

Brett: "I don't want any data stored in JSON period. Everything needs to be a Postgres table." Runtime data (state,
queues, logs, journals, settings, records of any kind) lives in axf-data's Postgres tables and is read and written only
through data-store@1 (`data-files.mjs`, `persist.mjs` readData/writeData, `builds-store.mjs`, `data_store.py`). A document
gets a table (`services/axf-data/tables.py`: DocTable for a document with lists, one row per item; RecordTable for one row
per document) and moves local → shadow → cutover per key or namespace (DATA-INVENTORY.md lists every file and its table).

Enforced by `framework/spec/check-json-data-writes.mjs` (CI): a new direct JSON/JSONL write in runtime code fails the
build. The writes that existed when the rule began are a per-file baseline (`json-data-writes.baseline.json`) that may
only go down. Not data, and so not counted when marked `// axf-data: not data (<reason>)`: build-time generators,
read-only exports generated from the tables (the builds projection, orchestrator exports), fixtures, the check's own
baseline. Secrets never go in the data DB.

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
| **record** | one JSON document (object or array) ≤ 32 MiB (the live builds store is 9 MB and must stay one record). The unit of optimistic writes |
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
| `sessions` | session@1 archives `/projects/amberx-axf/_data/sessions/**` and the claude.ai drop folder → `sessions/<same path>` | record, blob, journal |
| `console` | the rest of the console's own hub data: `home-cards`, `agents`, `agent-slots`, `agent-swarm`, `listeners`, `token-log`, `tracker.json`, `companion`, `walkthrough`, `amberx-notes` tables → `console/<folder>/<same path>`; `_shared/_data/{handoff,notifications,dns}` → `console/shared/…`; `state.json` and the deploy log from the console's own volume | record, journal, blob |
| `phone` | phone-connect@1 (PHONE-CONNECT.md): the plugin folder `phone-connect` is this namespace, like `ui-review`: `devices/<deviceId>.json` (phone-device@1), `pairings/<code>.json` (phone-pairing@1), `commands/<id>.json` (phone-command@1 + its results) → `phone/<same path>`; `log.jsonl` → journal `phone/log`. Nothing to migrate: the namespace is new with the plugin. | record, journal |
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
data-drift@1   = { $axf, at, op: read | write | append, key, kind, local, remote, error? }   shadow mode's diff log (Modes)
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
| patch | `POST /v1/<key>:patch` | `data-patch@1` = `{ $axf, record: data-record@1, applied, added, journal: data-append@1 \| null }` | body `{ head?: { … }, lists: { <list>: [{ key, ifRev?, item }] }, journal?: { path, entry, idem? } }` on a table-backed record whose list has a key (the builds store: `builds` keyed by `id`). Only the named items are written and, on Postgres, only their rows are locked (`SELECT … FOR UPDATE`); `head` sets the record's other fields (rev, updatedAt, meta…); the journal line lands in the same transaction. `ifRev: n` = the item must still be at rev n (an item without a whole-number rev counts as 1), `null` = must not exist, absent = no check. A failed check is `409 conflict` naming the items and nothing is written. Needs `write` on the key and `append` on the journal path. The record's rev and etag move as on a put (the etag is of the assembled record), so readers using `If-Match` are unaffected |
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

### Row-level writes (data-patch@1, Nov 18 2026)

The builds store is one record read by everyone and written by every session, so a whole-record `put` with `If-Match`
made every tick wait on every other tick and ship 14 MB. `patch` is the row-level write for such a record: the writer
sends only the items it changed, each with the rev it read them at, plus the head fields that changed and the journal line.
On Postgres (`services/axf-data/pg.py` `PgStore.patch`) that is one transaction that locks the named `builds` rows and no
others, so two sessions changing two builds never wait on each other, and a session that read a build before someone else
changed it gets `conflict` for that build only (re-read, re-apply, retry: `framework/cli/builds-store.mjs` does this up to
5 times). The SQLite engine answers the same patch on the document (`store.py` `Store.patch`): read, check each item's rev,
replace, write with the etag read, append the line; same answers, no row locks. `services/axf-data/tables.py`
(`check_patch`, `rev_conflicts`, `apply_patch_doc`) is the one definition both engines use.

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
| record body | 32 MiB (over 1 MiB is flagged `large` in the migration report; the builds store and orchestrator.json are the known ones) |
| blob body | 256 MiB |
| journal entry | 256 KiB; one append ≤ 4 MiB |
| key | 512 chars, segment 80 chars |
| list page | 1000 |
| journal page | 5000 entries |
| change feed retained | 30 days |
| tombstones kept | 30 days |
| watch connections per token | 32 |

## Reference client (`framework/core/data-store.mjs`)

```js
import { createDataStore, fileBackend, httpBackend, pluginKey } from 'framework/core/data-store.mjs';
const store = createDataStore({ backend: await fileBackend({ dir: '.axf-console/data-store' }), by: 'svc:console' });
const rec = await store.get('builds/store.json');                       // null when missing; rec.data, rec.etag, rec.rev
await store.put('builds/store.json', doc, { ifMatch: rec.etag });       // conflict → DataStoreError('conflict')
await store.update('builds/store.json', (doc) => ({ ...doc, rev: doc.rev + 1 }));   // re-reads and retries on conflict
await store.append('builds/journal/2026-11', [entry], { idempotencyKey: id });
const { entries, next } = await store.read('builds/journal/2026-11', { since: 0 });
const w = store.watch({ ns: ['builds', 'plugins/ui-review'], since: cursor }, (change) => …); w.close();
await store.manifest('plugins/ui-review'); await store.snapshot(['builds', 'notes']);
```

- Backends: `httpBackend({ url, token, actor })` (axf-data), `fileBackend({ dir })` (the contract on local files:
  `<dir>/data/<ns>/<path>` bodies, `<dir>/meta/<ns>/<path>.json` metadata, `<dir>/_changes.jsonl` the feed, atomic
  rename writes), `memoryBackend()` (tests). File and memory share one engine and answer alike; the fixture replays the
  same scenario on both.
- `put` without `ifMatch` / `create` is `precondition_required`; a blob may pass `force`. `update(key, fn)` is the easy
  path: read, apply, write with the etag read, re-read and retry up to `RETRY.conflictTries` on `conflict`.
- Retries follow the error table: `unauthorized` → `onUnauthorized()` once and retry; `rate_limited` / `unavailable`
  → `retryAfterMs` or `backoffMs(n)`; `internal` → once; everything else throws at once.
- `pluginKey(folder, rel)` maps a plugin-lifecycle@1 data file onto its `plugins/<folder>/…` key.
- A `plugins` list or manifest without a folder covers every plugin folder (console / admin use); a plugin's own token
  is granted `plugins/<folder>` and sees only that.

## Migration

The map of every data source the console writes today is `framework/spec/fixtures/data-store-migration.json`
(data-store-migration@1, checked by `check-data-store-migration.mjs`): 44 sources, each with its namespace, key
template, kind, policy, writers and count check; plus the excluded paths and why. Sizes measured on Nov 15 2026.

**Where the data is today** (four roots): `<projects>` = axHub's volume mounted at `/projects` (`<project>/_data`,
`_shared/_data`, `_shared/_claude`), `<repo>` = the console's checkout (`_claude/builds`), `<plugins>` =
`.axf-console/plugins/<folder>` (plugin-lifecycle@1 dataDir), `<data>` = the console's own volume (`state.json`,
`deploys/log.jsonl`). The SQLite ledgers (`shipped-features/ledger.sqlite`, `chat-viewer/chats.db`) live in plugin data
folders.

**Policies**: `copy` (key for key), `journal` (line for line), `blob-sqlite` (the file as one blob, plus per-table row
counts), `rebuild` (not copied: the app catalog's 630 MB of CI bundles and the plugin catalog come back from GitHub after
the cutover), `skip` (git-tracked projections, secrets, locks). A `.json` file becomes a record, `.jsonl` / `.ndjson` a
journal, anything else a blob (`kindOfFile`). The `ui-review` plugin folder is its own namespace; every other plugin folder
is `plugins/<folder>/…` (`pluginKey`).

**Order**: `settings, changes, notes, planner, ui-review, sessions, console, plugins, builds`: small and rarely written
first, builds last because the orchestrator writes it every minute and its journal is the biggest source (654 MB).

### Count + hash manifest

One namespace moves at a time. Before the copy the migration computes **M0** over the source with the same mapping the
copy uses; after the copy it asks the target for **M1** (`GET /v1/<ns>:manifest`). Both are `data-manifest@1` namespace
blocks: `count` live keys, `bytes`, `hash` = SHA-256 over sorted `"<path>\t<etag>\n"` lines, and `journals` with
`entries` per journal. A fresh target has `rev` 1 on every key, so M0 is computed with rev 1: a record's etag is
`etagOf(1, canonical(parsed JSON))` (whitespace and key order in the source file never matter), a blob's
`etagOf(1, bytes)`, a journal's `journalEtag(parsed lines)`. `sameManifest(M0, M1).equal` gates the namespace; the
fixture's `example` block shows a faithful copy (reformatted JSON still equal), a lost file (count and hash differ) and an
extra journal entry (same count, hash differs). `blob-sqlite` sources add a row count per listed table, read on both sides.

A `.json` that does not parse stops the namespace (listed `unparseable`) unless the namespace holds blobs, in which case it
moves as a blob and is listed `asBlob`. Records over 1 MiB are listed `large` (the builds store and `orchestrator.json`
today) and move as one record under the 32 MiB limit. Both manifests and the report are written to `_meta/manifests`
and `<data>/migration/<ns>.json`.

### Rollback rule

- **During the copy** the namespace is in `local` mode and nothing reads the target: a mismatch purges the target prefix,
  keeps the report and leaves the mode at `local`.
- **In shadow** local is still the read side: stop mirroring (mode back to `local`), purge the target prefix, keep the
  drift log for the report.
- **After cutover** local is the read-only backup: replay axf-data's change feed since the cutover cursor onto it, check
  the manifests are equal, then flip the mode to `local`. If the feed no longer reaches back (`cursor_expired`, > 30
  days) restore the cutover snapshot tar plus the latest snapshot and list every key changed since as the gap.
- **Never** truncate a journal on either side: a rollback appends what the other side has.

## Modes (data-store-mode@1, `framework/core/data-store-mode.mjs`)

```
local ──start-shadow──▶ shadow ──cut-over──▶ cutover ──roll-back──▶ rollback ──finish-rollback──▶ local
  ▲                       │                     ▲                       │
  └─────back-to-local─────┘                     └────cancel-rollback────┘
```

One mode per namespace (`plugins/<folder>` is one namespace here) over a store-wide default. The document is
`data-store-mode@1` (`{ mode, since, by, cursor, manifest, namespaces: { <ns>: { mode, since, cursor, manifest, drift,
lastDriftAt, keys? } } }`), kept at `_meta/mode` on axf-data and as `<data>/data-store/mode.json` locally; a client reads it
before every write (`readPlan`, `writePlan`).

**Key-level modes** (Nov 18 2026, Brett: "builds store first, then every JSON data file"). A namespace entry may carry
`keys: { '<path>' | '<prefix>/': { mode: local | shadow | cutover, since, by, verified } }`: one record (`store.json`) or
one prefix (`journal/`) of a namespace moves ahead of the rest of it. Paths are relative to the namespace id (for
`plugins/<folder>`, after the folder); the longest match wins; without a match the namespace mode applies, then the store
default (`modeOf(state, ns, path)`, `keyOverride`). A key has no 30-minute shadow guard: the tool that moves it holds the
writer's lock while it copies and verifies (a record: the same canonical body on both sides; a journal: every entry equal,
line by line) and must pass `verified: { at, how, counts }`, which is kept on the entry (`transitionKey`). Back to local is
always allowed; rollback is a namespace move. The first keys moved: `builds/store.json` and `builds/journal/`
(`node framework/cli/builds-data.mjs cutover --apply`), while `builds/pipeline/*`, `reconcile/*`, `shipped/*`, reports and
progress stay local until their own steps. Every client honours key modes: `framework/core/data-files.mjs` (Node, sync and
async), `apps/console-web/server/data_store.py` (console), `framework/cli/builds-store.mjs` (its own store and journal keys).

| Mode | Reads | Writes | Local copy |
|---|---|---|---|
| `local` | local | local | the store |
| `shadow` | local, then axf-data is read too and any difference is a drift entry | local first (required), then axf-data (a failure is drift, never an error for the caller) | the store |
| `cutover` | axf-data | axf-data only | read-only backup taken at the cut (`read_only` on write) |
| `rollback` | axf-data | refused on both sides (`read_only`) while the local copy catches up | being replayed from the change feed since `cursor` |

**Drift log** (`data-drift@1`: `{ at, op: read | write | append, key, kind, local, remote, error? }`, kinds
`missing-remote`, `missing-local`, `etag`, `entries`, `write-failed`, `append-failed`), appended to the local
`_meta/drift/<ns>` journal; `applyDrift` counts it on the namespace (`drift`, `lastDriftAt`). A read that finds the
same etag on both sides logs nothing; `rev` may differ (axf-data's rev restarts at 1 after the copy).

**Guards** (`canTransition`, pure; the host passes `ctx = { manifests: { local, remote }, now, remoteOk, replayed,
acceptDrift, minDriftFreeMs }`):

- `start-shadow`: axf-data reachable and the two manifests equal (the migration copy checked out).
- `cut-over`: manifests equal at the cut, every drift entry read and accepted (`acceptDrift` lists them, else zero
  drift), and no drift for `DRIFT_FREE_MS` (30 min) since the later of the shadow start and the last drift.
- `back-to-local`, `roll-back`, `cancel-rollback`: always allowed.
- `finish-rollback`: the feed since the cutover cursor is replayed onto local (`replayed: true`) and the manifests are
  equal again.
- Anything else (`local → cutover`, `cutover → local`) is refused: shadow first, roll back first.

`transition(state, { ns | [ns…] | '*', to, at, by, cursor, manifest, ctx })` applies a guarded move and returns the new
document plus the changes made (one per namespace); a refused guard throws `invalid_body` with the reason. `nextStep`
says what each namespace can do next (`shadow`, `wait`, `cutover`, `replay`, `local`, `done`), `summary` is one plain
line per namespace. Fixture: `framework/spec/fixtures/data-store-mode.json` (every transition, every guard, routes,
drift entries, a whole-store move).

Surfaces (Phase 2, with the container): `axf data mode [<ns>] <shadow|cutover|rollback|local>` on the CLI, the same
as a console action and MCP tool, the mode and drift counts on the Systems check page, and a voice line for Amber.

## Engine: Postgres, real tables (build axf-data-postgres-real-tables-own, Nov 15 2026)

Brett, Nov 15 2026: "Yeah, I want to migrate everything to a database in its own container. Land it, and then follow it
up with Postgres." (Postgres was his Nov 6 choice.)

axf-data's store is Postgres in its own container (`axf-data-db`, `postgres:16-alpine`, volume `axf-data-pg`, never
published; `services/axf-data/compose.yaml`, `deploy/install-data.sh`). The contract above does not change: the same
keys, revs, etags, journals, feed, history, manifests and errors; every client is untouched. What changes is the
storage (`services/axf-data/pg.py`, `tables.py`):

| Table | Holds |
|---|---|
| `keys` | one row per key: kind, rev, etag, at, actor, size, content type, tombstone, which table holds the body |
| `builds`, `build_steps`, `build_notes` | the builds store (`builds/store.json`): one row per build **keyed by its id** (`rid`; `pos` keeps the array order; id, title, status, pr, branch, dates… lifted), its steps and notes as child rows under the id; the rest of the document (rules, meta, drafts, rev) in `store_heads`. The row is the unit of `patch` and of the `FOR UPDATE` lock (tables version 2, Nov 18 2026; a version-1 database is re-keyed on the first connect, `tables.migrate_v2`) |
| `journal` (+ view `build_journal`) | every journal line: `entry JSONB` plus the stored line; a trigger refuses UPDATE / DELETE |
| `history` | earlier revs of records and blobs (restore) |
| `ui_review_items` | `ui-review/items.json`: one row per item (kind, name, app, screen, group, status, build, branch…) |
| `planner_items` | `planner/plans/<id>.json`, `planner/projects/<p>/plans/<id>.json`: one row per plan |
| `settings` | one row per settings document (`$axf` lifted) |
| `notes` (+ view `note_history`) | one row per note, Markdown text, not an opaque blob |
| `control_targets`, `control_tabs` | the API / control registry (`console/control/inventory.json`): one row per target, generated from each plugin's registered targets, never hand-edited (the file is no longer committed) |
| `ledger_*`, `chats_*` | the Shipped features ledger and the Chat viewer db, mirrored table for table from the SQLite files the console still writes (`mirror_runs` records each run and its counts) |
| `records`, `blobs`, `changes`, `idem`, `meta` | everything else: records as JSONB, blobs content-addressed, the feed |

**Rows, not copies.** A document whose arrays become rows is decomposed on PUT (only rows whose hash changed are
rewritten) and assembled on GET; its etag is computed on the assembled body, so what a reader's `If-Match` names is
what it will read. Lifted columns are typed; a value that does not fit (a PR number that is `""` in one build and
`705` in another) stays in the row's `extra` JSONB with the column NULL: nothing coerced, nothing lost. Reformatted
JSON, key order and `1.0` vs `1` never matter (canonical form, as everywhere in this contract).

**SQLite mirrors.** `plugins/shipped-features/ledger.sqlite` arrives as a blob (blob-sqlite) and is exploded into
`ledger_<table>` rows in the same transaction (full refresh, row counts checked, virtual FTS tables skipped); the blob is
kept once (no history copies) so `sqliteHydrate` still works. `chats.db` is bigger than a blob may be: `mirror_sync.py`
(nightly cron, `POST /v1/_meta/tables/sync`, `axf data tables --sync chats`) reads the mounted file instead. Until those
two plugins write rows themselves, their SQLite files stay the writers' truth and the rows are the queryable copy.

**Engine move** (`services/axf-data/engine.py`, `data-engine@1`): `sqlite → shadow → postgres`, inside the service.
`migrate_pg.py` copies a SQLite axf-data over (backup first, every key with its rev / etag / at / by, journal lines
verbatim, history, feed, idempotency keys) and refuses unless keys per namespace, journal lines and the manifest of every
namespace are equal on both sides. In `shadow`, reads come from SQLite and every write also lands on Postgres with the
same precondition; a difference is a `data-drift@1` line (`<data>/engine-drift.jsonl`). `cut-over` needs zero drift since
shadow started (or `acceptDrift` after reading it); `back-to-sqlite` and `roll-back` (postgres → shadow) are always
allowed. A fresh install has nothing to move and runs on Postgres directly. Surfaces: `GET/POST /v1/_meta/engine`,
`GET /v1/_meta/tables`, `axf data tables|engine`, the health frame's `engine`, and the console's data settings tab with
its plugin commands and voice lines ("what tables are there", "which engine", "cut over to postgres", "sync the chats").

**Backups**: `backup.py` runs `pg_dump --format=custom` (same tar.gz shape, `axf-data.pgdump` + `backup.json` with counts
per namespace, journal lines and rows per table), verifies with `pg_restore --list` and counts against the live database,
restores with `pg_restore --clean`. Daily at 03:17 UTC; the SQLite mirrors run at 03:40.

Checks: `python3 services/axf-data/test_pg.py` (the whole `test_store.py` suite replayed on Postgres, plus tables,
mirrors, migration, engine moves, backups, and `check-data-store.mjs --http` against a Postgres-backed server; CI starts
a postgres container). The Node client and fixtures are unchanged: an engine is invisible on the wire.

## The builds store on the tables (build urgent-all-data-to-postgres-builds-store, s2, Nov 18 2026)

Brett, Nov 18 2026: "I don't want any data stored in JSON period. Everything needs to be a Postgres table."

The first data that is a table and nothing else: `builds/store.json` (rows `builds`, `build_steps`, `build_notes`,
head in `store_heads`) and `builds/journal/*` (rows in `journal`, view `build_journal`). The cut
(`node framework/cli/builds-data.mjs cutover --apply`) runs under the store's writer lock: the live file is put once, every
hub journal part is compared with axf-data line by line and only the lines it lacks are appended (oversized entries as
`builds/journal-large/*` records with a pointer line), the counts (builds, steps, notes; rows per table when the token may
read `_meta/tables`; entries per journal part) must agree, then the two keys flip to `cutover` (`verified` on the entry).
`builds-data.mjs status` shows both sides; `builds-data.mjs local --apply` brings everything back to the files.

After the cut `builds-store.mjs` reads the record (assembled from the rows, cached by etag on the server) and writes a
`patch` of the builds it changed (row-level, see above); the console server reaches the store through the same CLI
(`orchestrator.mjs`), so console, CLI, MCP and headless sessions share the one set of rows. Processes on the VPS host itself
(sessions in worktrees, the gate runner, cron) find axf-data through `conf/env/host.env` (fixed address on the internal
network, the orchestrator's token; `deploy/install-data.sh`, `data-files.mjs remoteConfig`) and read the console's mode
document from the main checkout's `.axf-console` (`data-files.mjs roots`), so a worktree never runs on a mode of its own.

Known cost: a patch still assembles the whole record once to compute its etag (about 3–4 s for 1 000 builds); an incremental
etag is a later step. The namespace's other keys (pipeline, reconcile, shipped, reports, progress, origins, exports) are
still files and move in their own steps (DATA-INVENTORY.md).

### After the flip (s3, Nov 19 2026)

- **No file lock, no file write.** In cutover `withStore` takes no `store.json.lock` (the rev check on each row is the lock),
  `exportNow` reads the record without it, and `mergeRetiredNow` (a one-off on the raw file) stands down.
  `builds-data.mjs clean [--apply]` removes `store.json.tmp-*` files of dead writers and an unheld lock; a successful
  flip runs it.
- **The file is a read-only projection.** After every write that changed a build, the console checkout's `store.json`
  (the main checkout's, wherever the writer runs; `AXF_CONSOLE_ROOT` overrides) and its orchestrator exports are
  rewritten from the record (`projectConsole`), never to an older rev than the file holds. Console screens that still
  read the file (activity, crew-live, the Builds page's change watch, ref-links, projects) keep showing the live store
  until each reads the store itself; nothing reads the file as the store, and an edit to it is overwritten.
- **Writers from before the cut.** A session still on code from before key-level modes keeps writing its own copy and
  publishes it to main through builds-live. Every new-code write flushes to main and pulls main back; in cutover that
  pull (`adoptStore` → `adoptRemote`) takes only the builds main holds newer (per build and per step, builds-merge-core)
  into the tables as one row-level patch (`by: builds-live`, `action: adopt`). Nothing older than the tables is taken, so
  the changeover loses no tick. builds-live leaves the console checkout to the projection in cutover.
- **The exports stay, generated from the tables.** `orchestrator.json`, `pending.json` and `build-queue.json` still have
  readers (console views, pending.mjs, build-queue.mjs, handoff, feature matrix, …), so every write regenerates them from
  the record the rows assemble, as before. They are read-only projections; a direct edit is absorbed into the tables.
  They are dropped once their readers ask the store (s4/s5).
- **Console focus** (`console-focus@1`) reads build ids through `data_store` (the tables in cutover, cached 30 s).

## Agent slots on the tables (s4.1, Nov 19 2026)

`console/agent-slots/state.json` is the DocTable `agent_slots` (services/axf-data/tables.py): one row per entry, its
list (`running`, `queue`, `heavy`, `done`) as the section, the rest in `store_heads`. `agent-slots.mjs` reads and writes
the state by the key's mode: local = the file under the mkdir lock; shadow = the file, then the same document on
axf-data; cutover = axf-data only, the lock replaced by a rev check (get with etag, apply, put if-match, re-read on a
conflict, 8 tries); rollback = writes refused. `agent-slots.mjs data cutover --apply` copies, reads back, compares and
flips the key under the mkdir lock; `data local --apply` goes back. The flip waits until every checkout that runs
`agent-slots.mjs` (each worktree runs its own copy) has this code.

## What the first phase did not do

Phase 1 of `data-container-axf-data-holds-all` was the contract, the reference client with a local-file backend, the
migration plan and the mode machine; Phase 2 shipped the container (SQLite), the clients, the modes and the surfaces;
`axf-data-postgres-real-tables-own` moved the store onto Postgres as above. Nothing the console writes today moves until
its namespace is shadowed and cut over on purpose (`axf data mode`).
