package ai.amberx.axf.hub

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Hub watching settings in plain SharedPreferences, so a boot receiver or a background service can read them before the
 * kernel has started (apps mirror their Settings entries into here). Holds no secrets: the hub session lives in the
 * [HubSession] store. [file] is the preferences file name, so an app that had its own copy keeps its saved values.
 */
public class WatchPrefs(context: Context, file: String = DEFAULT_FILE) {
    private val p: SharedPreferences = context.applicationContext.getSharedPreferences(file, Context.MODE_PRIVATE)

    /** The hub address; anything that isn't a plain https hub is never saved. */
    public var base: String
        get() = HubRules.normalize(p.getString(K_BASE, null)) ?: HubRules.DEFAULT
        set(v) { HubRules.normalize(v)?.let { p.edit().putString(K_BASE, it).apply() } }
    /** Off until the app (or the user) turns it on; after the user chooses, that choice sticks ([watchingChosen]). */
    public var watching: Boolean
        get() = p.getBoolean(K_WATCH, false)
        set(v) { p.edit().putBoolean(K_WATCH, v).putBoolean(K_CHOSEN, true).apply() }
    public val watchingChosen: Boolean get() = p.getBoolean(K_CHOSEN, false)
    public var intervalSec: Int
        get() = p.getInt(K_INTERVAL, 30).coerceIn(MIN_INTERVAL, MAX_INTERVAL)
        set(v) { p.edit().putInt(K_INTERVAL, v.coerceIn(MIN_INTERVAL, MAX_INTERVAL)).apply() }
    public var fullScreen: Boolean
        get() = p.getBoolean(K_FULL, true)
        set(v) { p.edit().putBoolean(K_FULL, v).apply() }

    /** Ids already alerted, oldest first (older builds kept an unordered set: read once, then rewritten in order). */
    public fun seen(): List<String> {
        val ordered = p.getString(K_SEEN_LIST, null)
        if (ordered != null) return ordered.split('\n').filter { it.isNotEmpty() }
        return (p.getStringSet(K_SEEN, emptySet()) ?: emptySet()).toList().sorted()
    }

    public fun alerted(id: String): Boolean = id in seen()

    /**
     * Records what is waiting now and returns what to do: [SeenPlan.fresh] (alert these once), [SeenPlan.gone] (decided
     * elsewhere or expired: clear their alerts). Bounded to [HubRules.SEEN_CAP] ids.
     */
    public fun track(current: List<String>): SeenPlan {
        val plan = HubRules.seenPlan(seen(), current)
        p.edit().putString(K_SEEN_LIST, plan.next.joinToString("\n")).remove(K_SEEN).apply()
        return plan
    }

    public companion object {
        public const val DEFAULT_FILE: String = "axf_hub_watch"
        public const val K_BASE: String = "base"
        public const val K_WATCH: String = "watching"
        public const val K_INTERVAL: String = "interval"
        public const val K_FULL: String = "fullScreen"
        public const val K_SEEN: String = "seen"
        public const val K_SEEN_LIST: String = "seenList"
        public const val K_CHOSEN: String = "watchingChosen"
        public const val MIN_INTERVAL: Int = 15
        public const val MAX_INTERVAL: Int = 300
    }
}

/** What the app knows about its hub right now; services and screens share it. */
public object HubState {
    private val _feed = MutableStateFlow<HubFeed?>(null)
    public val feed: StateFlow<HubFeed?> = _feed.asStateFlow()
    private val _lastCheck = MutableStateFlow(0L)
    public val lastCheck: StateFlow<Long> = _lastCheck.asStateFlow()
    private val _watcherRunning = MutableStateFlow(false)
    public val watcherRunning: StateFlow<Boolean> = _watcherRunning.asStateFlow()
    private val _page = MutableStateFlow<Pair<String?, Long>>(null to 0L)
    /** The hub page an in-app [LockedWebView] shows next, plus a counter so opening the same page again reloads it. */
    public val page: StateFlow<Pair<String?, Long>> = _page.asStateFlow()

    public fun update(f: HubFeed) { _feed.value = f; _lastCheck.value = System.currentTimeMillis() }
    public fun signedOut(base: String) { update(HubRules.feedOf(base, HubFeedStatus.SIGNED_OUT)) }
    public fun setRunning(on: Boolean) { _watcherRunning.value = on }
    public fun open(url: String?) { _page.value = url to System.nanoTime() }
}
