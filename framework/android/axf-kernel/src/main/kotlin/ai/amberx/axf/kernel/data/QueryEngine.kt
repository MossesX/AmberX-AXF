package ai.amberx.axf.kernel.data

import ai.amberx.axf.kernel.platform.AxfClock
import ai.amberx.axf.kernel.platform.SystemClock
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/*
 * Data fetching & cache engine (the Android equivalent of TanStack Query / SWR / Apollo cache).
 * Keyed queries with stale-while-revalidate, request de-duplication, TTL, retries, invalidation,
 * optimistic mutations and offline persistence hooks. Pure Kotlin; axf-network supplies fetchers and
 * axf-data the disk cache. Screens collect `query.state` and recompose as data moves through
 * loading → data (fresh/stale) → error.
 */

public enum class Freshness { FRESH, STALE, NONE }

public data class QueryState<T>(
    val data: T? = null,
    val error: AxfFailure? = null,
    val loading: Boolean = false,
    val fetching: Boolean = false,
    val updatedAtMillis: Long = 0,
    val freshness: Freshness = Freshness.NONE,
) {
    public val hasData: Boolean get() = data != null
}

public data class QueryOptions(
    /** data older than this is served immediately but refetched in the background */
    val staleMs: Long = 30_000,
    /** data older than this is dropped from the cache */
    val cacheMs: Long = 5 * 60_000,
    val retries: Int = 2,
    val retryDelayMs: Long = 1_000,
    /** refetch when the app returns to foreground / network returns (the platform calls [QueryClient.resume]) */
    val refetchOnResume: Boolean = true,
    val persist: Boolean = false,
)

public fun interface Fetcher<T> { public suspend fun fetch(): AxfResult<T> }

/** Optional disk layer (axf-data implements it with the JSON document store). */
public interface QueryPersistence {
    public suspend fun read(key: String): Pair<String, Long>?
    public suspend fun write(key: String, json: String, updatedAtMillis: Long)
    public suspend fun remove(key: String)
}

public class Query<T> internal constructor(
    public val key: String,
    private val fetcher: Fetcher<T>,
    public val options: QueryOptions,
    private val client: QueryClient,
) {
    private val _state = MutableStateFlow(QueryState<T>())
    public val state: StateFlow<QueryState<T>> get() = _state.asStateFlow()
    private var inflight: Deferred<AxfResult<T>>? = null
    private val mutex = Mutex()

    internal fun freshness(now: Long): Freshness = when {
        _state.value.data == null -> Freshness.NONE
        now - _state.value.updatedAtMillis <= options.staleMs -> Freshness.FRESH
        else -> Freshness.STALE
    }

    /** Serve cached data at once; fetch if there is none or it is stale. De-duplicates concurrent callers. */
    public suspend fun get(force: Boolean = false): AxfResult<T> {
        val now = client.clock.nowMillis()
        val f = freshness(now)
        _state.update { it.copy(freshness = f) }
        if (!force && f == Freshness.FRESH) return AxfResult.ok(_state.value.data!!)
        return refetch()
    }

    public suspend fun refetch(): AxfResult<T> {
        val job = mutex.withLock {
            inflight ?: client.scope.async {
                _state.update { it.copy(loading = it.data == null, fetching = true) }
                var attempt = 0
                var result: AxfResult<T>
                while (true) {
                    result = fetcher.fetch()
                    if (result.isOk || attempt >= options.retries || result.failureOrNull()?.retryable != true) break
                    attempt++; kotlinx.coroutines.delay(options.retryDelayMs * attempt)
                }
                val now = client.clock.nowMillis()
                when (result) {
                    is AxfResult.Ok -> _state.update { it.copy(data = result.value, error = null, loading = false, fetching = false, updatedAtMillis = now, freshness = Freshness.FRESH) }
                    is AxfResult.Err -> _state.update { it.copy(error = result.failure, loading = false, fetching = false) }
                }
                mutex.withLock { inflight = null }
                result
            }.also { inflight = it }
        }
        return job.await()
    }

    /** Optimistic update: set data now; the next refetch reconciles. */
    public fun setData(data: T) { _state.update { it.copy(data = data, error = null, updatedAtMillis = client.clock.nowMillis(), freshness = Freshness.FRESH) } }
    public fun invalidate() { _state.update { it.copy(freshness = Freshness.STALE, updatedAtMillis = 0) }; client.scope.launch { refetch() } }
    public fun clear() { _state.value = QueryState() }
}

/** One per app (registered as service `axf.queries`). Holds every query by key. */
public class QueryClient(
    public val scope: CoroutineScope,
    public val clock: AxfClock = SystemClock,
    public val defaults: QueryOptions = QueryOptions(),
    public val persistence: QueryPersistence? = null,
) {
    private val queries = LinkedHashMap<String, Query<*>>()

    @Suppress("UNCHECKED_CAST")
    public fun <T> query(key: String, options: QueryOptions = defaults, fetcher: Fetcher<T>): Query<T> =
        queries.getOrPut(key) { Query(key, fetcher, options, this) } as Query<T>

    public fun get(key: String): Query<*>? = queries[key]
    public fun keys(): List<String> = queries.keys.toList()
    /** Invalidate every query whose key starts with the prefix (`"todos"`, `"user:42"`). */
    public fun invalidate(prefix: String) { queries.filterKeys { it == prefix || it.startsWith("$prefix:") || it.startsWith("$prefix/") }.values.forEach { it.invalidate() } }
    /** Drop entries older than their cacheMs. */
    public fun gc() { val now = clock.nowMillis(); queries.values.forEach { q -> if (q.state.value.updatedAtMillis > 0 && now - q.state.value.updatedAtMillis > q.options.cacheMs) q.clear() } }
    /** Called by the platform on foreground / network regained: refetch stale queries that opted in. */
    public fun resume() { val now = clock.nowMillis(); queries.values.forEach { q -> if (q.options.refetchOnResume && q.freshness(now) == Freshness.STALE) scope.launch { q.refetch() } } }
    public fun remove(key: String) { queries.remove(key)?.clear() }
    public fun clear() { queries.values.forEach { it.clear() }; queries.clear() }
}

/** A mutation with optimistic update + rollback, invalidating related queries on success. */
public class Mutation<I, O>(
    private val client: QueryClient,
    private val run: suspend (I) -> AxfResult<O>,
    private val invalidates: List<String> = emptyList(),
    private val optimistic: ((I) -> Unit)? = null,
    private val rollback: ((I) -> Unit)? = null,
) {
    private val _state = MutableStateFlow(QueryState<O>())
    public val state: StateFlow<QueryState<O>> get() = _state.asStateFlow()
    public suspend fun execute(input: I): AxfResult<O> {
        optimistic?.invoke(input)
        _state.update { it.copy(loading = true, fetching = true, error = null) }
        val r = run(input)
        when (r) {
            is AxfResult.Ok -> { _state.update { it.copy(data = r.value, loading = false, fetching = false, updatedAtMillis = client.clock.nowMillis()) }; invalidates.forEach(client::invalidate) }
            is AxfResult.Err -> { rollback?.invoke(input); _state.update { it.copy(error = r.failure, loading = false, fetching = false) } }
        }
        return r
    }
}
