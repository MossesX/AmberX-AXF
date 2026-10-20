package ai.amberx.axf.axhubandroid.hub

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The watcher's settings, kept in plain SharedPreferences as well as in the framework's settings, so the
 * boot receiver and the service can read them before the kernel has started. AppModule mirrors every
 * change from Settings into here. Holds no secrets (the hub session lives in the WebView cookie store).
 */
class WatchPrefs(context: Context) {
    private val p: SharedPreferences = context.applicationContext.getSharedPreferences("axhub_watch", Context.MODE_PRIVATE)

    var base: String
        get() = HubAddress.normalize(p.getString(K_BASE, null)) ?: HubAddress.DEFAULT
        set(v) { HubAddress.normalize(v)?.let { p.edit().putString(K_BASE, it).apply() } }
    var watching: Boolean
        get() = p.getBoolean(K_WATCH, true)
        set(v) { p.edit().putBoolean(K_WATCH, v).apply() }
    var intervalSec: Int
        get() = p.getInt(K_INTERVAL, 30).coerceIn(15, 300)
        set(v) { p.edit().putInt(K_INTERVAL, v.coerceIn(15, 300)).apply() }
    var fullScreen: Boolean
        get() = p.getBoolean(K_FULL, true)
        set(v) { p.edit().putBoolean(K_FULL, v).apply() }

    /** Ids already alerted, so each approval rings once (bounded). */
    fun alerted(id: String): Boolean = id in (p.getStringSet(K_SEEN, emptySet()) ?: emptySet())
    fun markAlerted(ids: Collection<String>, keepOnly: Collection<String>) {
        val next = ((p.getStringSet(K_SEEN, emptySet()) ?: emptySet()).filter { it in keepOnly } + ids).takeLast(200).toSet()
        p.edit().putStringSet(K_SEEN, next).apply()
    }

    companion object {
        const val K_BASE = "base"; const val K_WATCH = "watching"; const val K_INTERVAL = "interval"; const val K_FULL = "fullScreen"; const val K_SEEN = "seen"
    }
}

/** What the app knows right now; the service and the screens share it. */
object HubState {
    private val _feed = MutableStateFlow<Feed?>(null)
    val feed: StateFlow<Feed?> = _feed.asStateFlow()
    private val _lastCheck = MutableStateFlow(0L)
    val lastCheck: StateFlow<Long> = _lastCheck.asStateFlow()
    private val _watcherRunning = MutableStateFlow(false)
    val watcherRunning: StateFlow<Boolean> = _watcherRunning.asStateFlow()
    /** The page the in-app hub view shows next (sign-in, the list, or one approval). */
    private val _page = MutableStateFlow<String?>(null)
    val page: StateFlow<String?> = _page.asStateFlow()

    fun update(f: Feed) { _feed.value = f; _lastCheck.value = System.currentTimeMillis() }
    fun setRunning(on: Boolean) { _watcherRunning.value = on }
    fun open(url: String?) { _page.value = url }
}
