package ai.amberx.axf.phoneconnect.overlay

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject

/** One popup on screen: an approval (approve / deny in place), an alert or a notification. */
data class Popup(
    val id: String,
    val kind: String,           // approval, alert, notification
    val title: String,
    val body: String = "",
    val url: String = "",
    val actions: List<String> = emptyList(), // approve, deny, shelve, open, dismiss
)

/**
 * The overlay's live state: expanded or collapsed, the button's spot, the badge, the popups and the synced config.
 * The spot and the expanded state survive restarts (prefs); the config is the last one the console sent.
 */
class OverlayStore(context: Context) {
    private val prefs = context.getSharedPreferences("phone-connect.overlay", Context.MODE_PRIVATE)

    private val _expanded = MutableStateFlow(prefs.getBoolean("expanded", false))
    val expanded: StateFlow<Boolean> = _expanded.asStateFlow()
    private val _popups = MutableStateFlow<List<Popup>>(emptyList())
    val popups: StateFlow<List<Popup>> = _popups.asStateFlow()
    private val _badge = MutableStateFlow(0)
    val badge: StateFlow<Int> = _badge.asStateFlow()
    private val _config = MutableStateFlow(OverlayConfig.parse(prefs.getString("config", null)?.let { runCatching { JSONObject(it) }.getOrNull() }))
    val config: StateFlow<OverlayConfig> = _config.asStateFlow()

    var spotX: Int
        get() = prefs.getInt("x", Int.MIN_VALUE)
        set(v) { prefs.edit().putInt("x", v).apply() }
    var spotY: Int
        get() = prefs.getInt("y", Int.MIN_VALUE)
        set(v) { prefs.edit().putInt("y", v).apply() }

    fun setExpanded(on: Boolean) { _expanded.value = on; prefs.edit().putBoolean("expanded", on).apply() }
    fun setBadge(n: Int) { _badge.value = n.coerceAtLeast(0) }

    fun show(p: Popup) = _popups.update { list -> (list.filterNot { it.id == p.id } + p).takeLast(4) }
    fun dismiss(id: String) = _popups.update { list -> list.filterNot { it.id == id } }

    /** A config from the console (phone-overlay@1): applied at once, kept for the next start. */
    fun applyConfig(json: JSONObject) {
        _config.value = OverlayConfig.parse(json)
        prefs.edit().putString("config", json.toString()).apply()
    }

    companion object {
        @Volatile private var instance: OverlayStore? = null
        fun of(context: Context): OverlayStore = instance ?: synchronized(this) { instance ?: OverlayStore(context.applicationContext).also { instance = it } }
    }
}
