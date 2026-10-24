package ai.amberx.axf.readaloud

import android.content.Context
import android.content.Intent
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** A voice the TTS engine offers (Android `Voice`), flattened so screens and settings can list it. */
public data class VoiceInfo(val name: String, val language: String, val quality: Int, val network: Boolean, val installed: Boolean)

/** A TTS engine installed on the phone (Android `TextToSpeech.EngineInfo`). */
public data class EngineInfo(val packageName: String, val label: String)

/** What the player is doing, for screens, banners and the notification. [word] is the range inside the current utterance. */
public data class ReadAloudState(
    val queue: ReadQueue = ReadQueue(),
    val speaking: Boolean = false,
    val paused: Boolean = false,
    val rate: Double = 1.0,
    val word: IntRange? = null,
    val error: String? = null,
    val voices: List<VoiceInfo> = emptyList(),
    val engines: List<EngineInfo> = emptyList(),
    val defaultEngine: String = "",
    val sleepAt: Long = 0L,
) {
    public val utterance: Utterance? get() = queue.current?.utterances?.getOrNull(queue.position)
    public val active: Boolean get() = queue.current != null
}

/**
 * Read-aloud facade (capability `axf.readaloud`): start reading any text from anywhere in the app (a selection-menu
 * activity, a button, an action), control playback and watch [state]. Playback runs in [ReadAloudService] (foreground,
 * media playback) so it keeps going after the caller closes. Preferences come from [configure] (a plugin points it at
 * its settings under its own key prefix); without it the defaults apply.
 */
public object ReadAloud {
    internal val _state = MutableStateFlow(ReadAloudState())
    public val state: StateFlow<ReadAloudState> = _state.asStateFlow()

    @Volatile private var prefsSource: () -> ReadAloudPrefs = { ReadAloudPrefs.DEFAULT }
    @Volatile internal var notificationTitle: String = "Read aloud"
    @Volatile internal var openApp: Intent? = null

    /** Where preferences come from: `prefix` + a lookup (usually the kernel Config). [title] heads the notification. */
    public fun configure(prefix: String, title: String = "Read aloud", open: Intent? = null, get: (String) -> String?) {
        prefsSource = { ReadAloudPrefs.from(prefix, get) }
        notificationTitle = title
        openApp = open
    }

    public fun prefs(): ReadAloudPrefs = runCatching { prefsSource() }.getOrDefault(ReadAloudPrefs.DEFAULT)

    /** Read [text] aloud (queue policy from the prefs, or [policy]). [slow] = the slow rate ("Read slowly" entries). */
    public fun read(context: Context, text: String, title: String = "", slow: Boolean = false, source: String = "", policy: QueuePolicy? = null) {
        val i = command(context, ACTION_READ).putExtra(EXTRA_TEXT, text).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_SLOW, slow).putExtra(EXTRA_SOURCE, source)
        policy?.let { i.putExtra(EXTRA_POLICY, it.id) }
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i)
    }

    public fun pause(context: Context): Unit = send(context, ACTION_PAUSE)
    public fun resume(context: Context): Unit = send(context, ACTION_RESUME)
    public fun toggle(context: Context): Unit = send(context, ACTION_TOGGLE)
    public fun stop(context: Context): Unit = send(context, ACTION_STOP)
    public fun next(context: Context): Unit = send(context, ACTION_NEXT)
    public fun previous(context: Context): Unit = send(context, ACTION_PREV)
    public fun faster(context: Context): Unit = send(context, ACTION_FASTER)
    public fun slower(context: Context): Unit = send(context, ACTION_SLOWER)
    public fun skipItem(context: Context): Unit = send(context, ACTION_SKIP_ITEM)
    /** Ask the service for the installed engines and voices (fills [state] `engines` / `voices`). */
    public fun refreshVoices(context: Context): Unit = send(context, ACTION_VOICES)

    /** Commands for a service that's already running; a stopped service ignores them (nothing to control). */
    private fun send(context: Context, action: String) {
        if (action != ACTION_VOICES && !_state.value.active) return
        runCatching { context.startService(command(context, action)) }
    }

    internal fun command(context: Context, action: String): Intent = Intent(context, ReadAloudService::class.java).setAction(action)

    internal fun update(f: (ReadAloudState) -> ReadAloudState) { _state.update(f) }

    public const val ACTION_READ: String = "ai.amberx.axf.readaloud.READ"
    public const val ACTION_PAUSE: String = "ai.amberx.axf.readaloud.PAUSE"
    public const val ACTION_RESUME: String = "ai.amberx.axf.readaloud.RESUME"
    public const val ACTION_TOGGLE: String = "ai.amberx.axf.readaloud.TOGGLE"
    public const val ACTION_STOP: String = "ai.amberx.axf.readaloud.STOP"
    public const val ACTION_NEXT: String = "ai.amberx.axf.readaloud.NEXT"
    public const val ACTION_PREV: String = "ai.amberx.axf.readaloud.PREV"
    public const val ACTION_FASTER: String = "ai.amberx.axf.readaloud.FASTER"
    public const val ACTION_SLOWER: String = "ai.amberx.axf.readaloud.SLOWER"
    public const val ACTION_SKIP_ITEM: String = "ai.amberx.axf.readaloud.SKIP_ITEM"
    public const val ACTION_VOICES: String = "ai.amberx.axf.readaloud.VOICES"
    public const val EXTRA_TEXT: String = "text"
    public const val EXTRA_TITLE: String = "title"
    public const val EXTRA_SLOW: String = "slow"
    public const val EXTRA_SOURCE: String = "source"
    public const val EXTRA_POLICY: String = "policy"
}
