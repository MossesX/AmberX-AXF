# lib-work (0.1.1, work@1)

The Android host for work@1 poll jobs: `PollService` (foreground, special use) drives every registered `PollJob` through
the kernel's `WorkEngine` state machine (`JobRunner` carries out the effects), `WorkBootReceiver` restarts jobs after a
reboot or update, `PollJobs` is the process-wide registry (`axf.work.poll` service) with `start` / `checkNow` / `stop` /
`setInterval`, running-state and state flows. See `library.json` for the full description and placeholders.

## App jobs

Pass them to the constructor, so they exist before any receiver or sticky restart needs them:

```kotlin
WorkModule(jobs = listOf(PollJob(spec, flags, body, foreground)))
```

## Jobs from plugins and other late modules (`axf.workers`, 0.1.1)

A module registered later — a plugin — contributes a kernel `PollWorker` (pure Kotlin, `ai.amberx.axf.kernel.work`) on
the `axf.workers` extension point:

```kotlin
override fun register(ctx: ModuleContext) {
    ctx.extensions.contribute(ExtensionPoints.WORKERS, id, PollWorker(spec, flags = { mapOf("enabled" to on) }) { runOnce() })
}
// start it when the user turns it on (Context from the app / plugin host):
ctx.service(PollJobs::class)?.start(context, spec.id)
```

- `WorkModule` registers every `PollWorker` (or `PollJob`) on `axf.workers` with `PollJobs`: those present when it
  registers **and every later contribution** (it listens with `ExtensionRegistry.onChange`). A withdrawn contribution —
  including all of a module's when it stops (`removeAllFrom` now notifies listeners) — is unregistered. Stop a running
  job yourself (`PollJobs.stop`) before withdrawing it; unregistering doesn't stop a runner the service already holds.
- `spec.foreground = true` needs an ongoing notification: give the module a factory,
  `WorkModule(jobs, workerForeground = { spec -> ForegroundSpec(id, channels) { ctx, state -> … } })`. Without one, such
  workers are skipped. `WorkModule.skippedWorkers()` lists skipped/invalid contributions (id → why);
  `contributedJobs()` lists the ids hosted from `axf.workers`. A worker can't take an id the app already registered.
- Other value types on `axf.workers` (a host-specific worker class) are ignored by lib-work.
- Calling `PollJobs.register(PollJob(...))` directly still works for code that can see lib-work.

The kernel's `WorkRegistry` (service `axf.workers`, id → `Worker`) belongs to the WorkManager-style `WorkScheduler`
contract (`axf.work`), which is still a placeholder (`axf.work.manager`).
