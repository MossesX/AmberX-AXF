package ai.amberx.axf.kernel.state

import ai.amberx.axf.kernel.platform.KeyValueStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/*
 * State management engine (the Android equivalent of a Redux/NgRx/Zustand store).
 * The kernel's own AxfState/AxfRuntime is one instance of this pattern; apps and libraries create
 * their own stores for app data. Reactivity/change detection is Compose's job: a store exposes
 * StateFlows, screens collect them (collectAsStateWithLifecycle) and recompose on change — no separate
 * change-detection engine is needed on Android.
 *
 *   val store = AxfStore(initial = TodoState(), reducer = ::reduce, middleware = listOf(LoggingMiddleware(log)))
 *   store.dispatch(TodoAction.Add("milk"))
 *   val titles: StateFlow<List<String>> = store.select(scope) { it.todos.map(Todo::title) }
 */

public fun interface Reducer<S, A> { public fun reduce(state: S, action: A): S }

/** Middleware sees every action before the reducer; it may transform, swallow (return null) or trigger side effects. */
public fun interface Middleware<S, A> { public fun apply(store: AxfStore<S, A>, action: A, next: (A) -> Unit) }

/** Persists a store's state across process death (JSON text through KeyValueStore). */
public class StatePersistence<S>(private val kv: KeyValueStore, private val key: String, private val encode: (S) -> String, private val decode: (String) -> S?) {
    public fun load(): S? = kv.get(key)?.let(decode)
    public fun save(s: S): Unit = kv.put(key, encode(s))
}

public class AxfStore<S, A>(
    initial: S,
    private val reducer: Reducer<S, A>,
    private val middleware: List<Middleware<S, A>> = emptyList(),
    private val persistence: StatePersistence<S>? = null,
    /** keep the last N states for undo and the devtools time-travel panel (0 = off) */
    private val historyLimit: Int = 0,
) {
    private val _state = MutableStateFlow(persistence?.load() ?: initial)
    public val state: StateFlow<S> get() = _state.asStateFlow()
    public val current: S get() = _state.value
    private val past = ArrayDeque<S>()
    private val future = ArrayDeque<S>()
    private val listeners = mutableListOf<(A, S) -> Unit>()
    public val actionLog: ArrayDeque<A> = ArrayDeque()

    public fun dispatch(action: A) {
        var i = -1
        fun next(a: A) {
            i++
            if (i < middleware.size) middleware[i].apply(this, a, ::next) else commit(a)
        }
        next(action)
    }

    private fun commit(action: A) {
        val before = _state.value
        val after = reducer.reduce(before, action)
        if (after === before) return
        if (historyLimit > 0) { past.addLast(before); while (past.size > historyLimit) past.removeFirst(); future.clear() }
        _state.value = after
        persistence?.save(after)
        actionLog.addLast(action); while (actionLog.size > 200) actionLog.removeFirst()
        listeners.forEach { it(action, after) }
    }

    /** Replace state wholesale (hydration, time-travel). Bypasses middleware and reducers. */
    public fun replace(s: S) { _state.value = s; persistence?.save(s) }
    public fun canUndo(): Boolean = past.isNotEmpty()
    public fun canRedo(): Boolean = future.isNotEmpty()
    public fun undo(): Boolean { val p = past.removeLastOrNull() ?: return false; future.addLast(_state.value); _state.value = p; persistence?.save(p); return true }
    public fun redo(): Boolean { val f = future.removeLastOrNull() ?: return false; past.addLast(_state.value); _state.value = f; persistence?.save(f); return true }
    public fun history(): List<S> = past.toList()
    public fun subscribe(fn: (A, S) -> Unit): () -> Unit { listeners += fn; return { listeners -= fn } }

    /** A derived, de-duplicated view — the reactive "selector". Collect it in Compose; it only emits when the selection changes. */
    public fun <T> select(selector: (S) -> T): Flow<T> = state.map(selector).distinctUntilChanged()
}

/** Logs every action and resulting state through the kernel logger. */
public class LoggingMiddleware<S, A>(private val log: (String) -> Unit) : Middleware<S, A> {
    override fun apply(store: AxfStore<S, A>, action: A, next: (A) -> Unit) { next(action); log("$action → ${store.current}") }
}

/** Runs side effects for matching actions after the reducer (thunks/epics equivalent). */
public class EffectMiddleware<S, A>(private val effect: (action: A, state: S, dispatch: (A) -> Unit) -> Unit) : Middleware<S, A> {
    override fun apply(store: AxfStore<S, A>, action: A, next: (A) -> Unit) { next(action); effect(action, store.current, store::dispatch) }
}
