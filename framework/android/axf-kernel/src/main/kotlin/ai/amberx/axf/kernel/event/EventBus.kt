package ai.amberx.axf.kernel.event

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.filterIsInstance

/** Base type of every event on the bus. Events are immutable data. `topic` is namespaced like every other id. */
public interface AxfEvent { public val topic: String }

/** Standard kernel events. Modules define their own by implementing AxfEvent. */
public sealed interface KernelEvent : AxfEvent {
    public data class AssetSwapped(val type: String, val from: String?, val to: String) : KernelEvent { override val topic: String = "axf.asset.swapped" }
    public data class AssetImported(val type: String, val id: String) : KernelEvent { override val topic: String = "axf.asset.imported" }
    public data class RoleChanged(val from: String, val to: String) : KernelEvent { override val topic: String = "axf.uac.role" }
    public data class Navigated(val from: String, val to: String) : KernelEvent { override val topic: String = "axf.nav" }
    public data class ActionDispatched(val spec: String, val ok: Boolean) : KernelEvent { override val topic: String = "axf.action" }
    public data class ModuleStateChanged(val module: String, val state: String, val error: String?) : KernelEvent { override val topic: String = "axf.module.state" }
    public data class FlagChanged(val flag: String, val enabled: Boolean) : KernelEvent { override val topic: String = "axf.flag" }
    public data class Lifecycle(val phase: String) : KernelEvent { override val topic: String = "axf.lifecycle" }
    public data class Toast(val message: String, val kind: String, val title: String?) : KernelEvent { override val topic: String = "axf.toast" }
}

/**
 * Typed event bus (Foundations: f.eventbus). Ordering: events are delivered in emission order per
 * collector. Replay: the last `replay` events are delivered to late subscribers (sticky), and
 * `latest(topic)` gives the most recent event of a topic synchronously.
 */
public class EventBus(replay: Int = 32) {
    private val flow = MutableSharedFlow<AxfEvent>(replay = replay, extraBufferCapacity = 256)
    private val latest = LinkedHashMap<String, AxfEvent>()
    private val history = ArrayDeque<AxfEvent>()
    public var historyLimit: Int = 500

    public val events: SharedFlow<AxfEvent> get() = flow
    public inline fun <reified T : AxfEvent> of(): Flow<T> = events.filterIsInstance()

    /** Non-suspending emit; drops only if the buffer is full (256 pending), which is logged by the runtime. */
    public fun emit(e: AxfEvent): Boolean {
        latest[e.topic] = e
        history.addLast(e); while (history.size > historyLimit) history.removeFirst()
        return flow.tryEmit(e)
    }
    public fun latest(topic: String): AxfEvent? = latest[topic]
    public fun history(): List<AxfEvent> = history.toList()
}
