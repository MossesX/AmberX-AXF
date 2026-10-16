package ai.amberx.axf.kernel.contract

import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.flow.Flow

/*
 * Work/scheduler engine contract (kernel API level 1). Every library that needs "run this later,
 * periodically, or in the background" codes against this; the Android implementation (WorkManager +
 * AlarmManager + foreground services) lands in axf-platform-android. Until then the kernel answers
 * with the NotImplemented placeholder for capability `axf.work`.
 */

public enum class WorkPolicy { KEEP, REPLACE, APPEND }
public enum class BackoffPolicy { LINEAR, EXPONENTIAL }
public enum class NetworkType { NONE, ANY, UNMETERED }
public enum class WorkState { ENQUEUED, RUNNING, SUCCEEDED, FAILED, BLOCKED, CANCELLED }

public data class WorkConstraints(
    val network: NetworkType = NetworkType.NONE,
    val charging: Boolean = false,
    val idle: Boolean = false,
    val batteryNotLow: Boolean = false,
    val storageNotLow: Boolean = false,
)

/**
 * One unit of work. `worker` is a registered worker id (see [WorkRegistry]); `input` is JSON text so
 * it survives process death on every port. `unique` + [WorkPolicy] de-duplicate scheduled work.
 */
public data class WorkSpec(
    val worker: String,
    val input: String = "{}",
    val unique: String? = null,
    val policy: WorkPolicy = WorkPolicy.KEEP,
    val initialDelayMs: Long = 0,
    /** null = one-off; otherwise periodic with this interval (platform minimum applies, 15 min on Android) */
    val periodMs: Long? = null,
    val constraints: WorkConstraints = WorkConstraints(),
    val backoff: BackoffPolicy = BackoffPolicy.EXPONENTIAL,
    val backoffDelayMs: Long = 30_000,
    /** true: must run with user-visible progress (foreground service on Android) */
    val expedited: Boolean = false,
    val tags: List<String> = emptyList(),
    val module: String = "app",
)

public data class WorkInfo(val id: String, val spec: WorkSpec, val state: WorkState, val attempts: Int, val progress: String? = null, val output: String? = null, val error: String? = null)

public sealed class WorkOutcome {
    public data class Success(val output: String = "{}") : WorkOutcome()
    public data class Retry(val reason: String) : WorkOutcome()
    public data class Failure(val reason: String) : WorkOutcome()
}

/** The code behind a worker id. Suspending, cancellable, main-safe. */
public fun interface Worker { public suspend fun run(input: String, progress: suspend (String) -> Unit): WorkOutcome }

/** Modules register workers by id at `register()` time; the scheduler resolves ids when work runs (after process death too). */
public class WorkRegistry {
    private val workers = LinkedHashMap<String, Worker>()
    public fun register(id: String, worker: Worker) { workers[id] = worker }
    public fun get(id: String): Worker? = workers[id]
    public fun ids(): List<String> = workers.keys.toList()
}

/** Capability id `axf.work`. */
public interface WorkScheduler {
    public suspend fun enqueue(spec: WorkSpec): AxfResult<String>
    public suspend fun cancel(id: String): AxfResult<Unit>
    public suspend fun cancelUnique(unique: String): AxfResult<Unit>
    public suspend fun cancelByTag(tag: String): AxfResult<Unit>
    public fun info(id: String): Flow<WorkInfo?>
    public fun infoByTag(tag: String): Flow<List<WorkInfo>>
    /** One-shot alarm at a wall-clock time (exact only when the platform allows it). */
    public suspend fun alarm(atEpochMillis: Long, spec: WorkSpec, exact: Boolean = false): AxfResult<String>
}
