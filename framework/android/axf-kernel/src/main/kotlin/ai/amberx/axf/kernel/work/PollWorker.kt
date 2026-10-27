package ai.amberx.axf.kernel.work

/**
 * A poll job any module can offer at runtime — typically a plugin registered after the app's modules — by contributing it
 * on `axf.workers` (`ExtensionPoints.WORKERS`):
 *
 * ```kotlin
 * ctx.extensions.contribute(ExtensionPoints.WORKERS, id, PollWorker(spec) { runOnce() })
 * ```
 *
 * The background host (Android lib-work) picks up contributions present when it registers and every later one, and drops
 * the job again when the contribution is withdrawn (the module stops). Starting the job stays the module's call (lib-work's
 * `PollJobs.start`), or happens by itself after a boot when [JobSpec.restartOnBoot] is set and the conditions hold.
 * Pure Kotlin: the host adds platform pieces (on Android, the ongoing notification of a `foreground` job).
 */
public class PollWorker(
    public val spec: JobSpec,
    /** the conditions' flags ([RunCondition]s), read from the module's own storage */
    public val flags: () -> Map<String, Boolean> = { emptyMap() },
    /** the user's interval choice (clamped into the spec's bounds), or null for the default */
    public val intervalMs: () -> Long? = { null },
    /** one run; returns an outcome name the spec maps (a throw counts as `error`) */
    public val body: suspend () -> String,
) {
    public val id: String get() = spec.id
}
