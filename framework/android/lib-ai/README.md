# lib-ai — AI sessions on axHub (ai-modes@1)

Any AXF Android app gets AI through this module. Brett's rules apply as code:

- **Every AI session is live and runs on the hub side.** The app only follows it. Closing the app, the screen or
  the phone detaches; it never closes anything. Only `close(id)` ends a session.
- **Anyone with a hub account can use it.** Non-admins get plain chat (`ai.chat`). Anything more is granted per user
  through UAC (the hub's users page, or the local role / principal).

Contract: `framework/spec/ASSISTANT.md` → "AI modes — ai-modes@1", `framework/spec/LIVE-SESSIONS.md`.
Kotlin contract: `axf-kernel` `ai.amberx.axf.kernel.ai` (`AiModes.kt`).

## Where sessions run

The assistant host today is the console's AI assistant plugin (`apps/console-web/plugins/ai-assistant`, the
live-session@1 `LocalHost`), reached **through axHub's sign-in wall**: Traefik asks axHub `/auth/verify` before every
request. So the hub account decides who may chat (and the plugin enforces its own per-user rules). Routes are listed
in `AiWire.kt`. When axHub runs its own session workers, only `assistant`/`prefix` change.

Credentials come from lib-hub's `HubCredentials` seam. By default that is the WebView cookie store for the assistant's
origin: the `axhub_session` cookie the wall checks, left there when the user signs in through the wall in a
`LockedWebView`/`HubSignInView`. A bearer token works too. Redirects are never followed, and a wall redirect reads as
"signed out" (`AxfFailure.Denied("axhub.signin")`). Writes made with a cookie carry the assistant's Origin. Nothing is
stored by this module except per-session resume cursors (last seq seen) in the key-value store.

## Install

```kotlin
override fun modules() = listOf(HubModule(), AiModule())   // AiModule(assistant = "https://console.amberxai.com")
```

`AiModule` registers:

| Service | Capability | What |
| --- | --- | --- |
| `HubAiSessionClient` (as `AiSessionClient`) | `axf.ai.session` | replaces the kernel placeholder |
| `AiService` | `axf.ai` | the facade apps use |
| settings group `ai` | — | Mode (`axf.ai.mode`), Model (`axf.ai.model`, empty = automatic), Read replies aloud (`axf.ai.readAloud`) |

On start it reads `GET /me` once (`AiService.refreshAccount()`). Call that again after a sign-in.

## API

```kotlin
val ai = kernel.services.get<AiService>()!!
ai.availableModes()                          // what this user may use (chat only for non-admins by default)
ai.resolve(override = "ai.build-request")    // ModeResolution: override → requested (Mode setting) → chat
val started = ai.start(AiRequestInput("Summarise my notes", context))       // AxfResult<AiStarted>
ai.start(ai.inputFrom(triggerCommand))       // triggers@1: args.mode = per-trigger override, args.prompt|text
ai.replies(id).collect { u -> show(u.text, u.status); if (ai.shouldReadAloud(u)) speak(u.text) }
ai.send(id, AiRequestInput("and the todo list?"))
ai.stop(id)   // stops the running turn; the session stays open
ai.close(id)  // ends it on the hub
```

- `HubAiSessionClient.events(id, after): Flow<AiStreamItem>` (`Replay`, `Event`, `Idle`, `Reconnecting`, `Failed`,
  `Ended`). It follows for as long as it is collected. When the hub ends a stream (caught up), it polls again with
  backoff (`AiLiveOptions`: 2 s → 15 s). When the connection drops, it reconnects from the last seq with backoff up to
  30 s, and drops duplicate seqs. `gap`/`reset` mean "reload the conversation". It ends only on a deliberate close
  (`Ended`) or a failure retrying can't fix (`Failed`: signed out, no rights, session gone).
- `attach(id, after, onEvent, onReplay)` is the same, callback style. `LiveDetach.detach()` only stops following.
- `AiService.replies(id)` folds turn events into the kernel's `LiveReply` (`text`, `status`, `error`, `done` snapshots).
  It saves the cursor as events arrive, so the next call after an app restart replays only what was missed.
  `finished` is true once per reply.
- UAC (`AiPolicies.local`): `admin` = role permissions hold `*` or `ai.admin` (or the principal has role `admin`).
  Extra modes come from the principal attribute `ai.modes` (comma list) or permissions `ai.mode.<id>`, and each mode
  still needs its `requiresPermission` (`ai.read`, `ai.build`). Once the hub account is known, its answer replaces
  the local view. Picking a model needs `assistant.models` (or admin).
- Each turn carries its mode as `mode`, `sessionKind`, `readOnly`, `needsApproval` and `triggerId`, and as
  `context.extra.aiMode`. The hub decides what to do with `needsApproval` (live-session `wait`).

Reading replies aloud is only a flag here. Speaking is speech@1 (`axf.speech`, lib-speech).

## Tests

`src/test`: `AiWireTest`, `HubAiSessionClientTest`, `AiServiceTest` (21 tests) run against `FakeHubTransport`, a
scripted hub. They cover start/send/list/stream/stop/close, typed failures, reconnect and resume without duplicates,
reset, idle polling, sign-out, a gone session, gating, trigger overrides, settings, the reply fold, cursors and
read-aloud. CI: `:lib-ai:testDebugUnitTest`.

## Not yet

- AXPP transport (`axf.hub.axpp`) and axHub's own session workers. The transport is an interface (`AiHubTransport`),
  so either one plugs in.
- Model list from the hub (pass `models` to `AiModule` meanwhile; empty = the hub's default model).
- Compose chat UI (apps build theirs on `replies`).
