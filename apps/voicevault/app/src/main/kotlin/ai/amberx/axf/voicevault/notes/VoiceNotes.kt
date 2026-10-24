package ai.amberx.axf.voicevault.notes

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import ai.amberx.axf.hub.HubOrigin
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.Heard
import ai.amberx.axf.voice.ListenOptions
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.PI
import kotlin.math.sin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext

/** Where a note is right now, for the Voice notes screen and the background notification. */
sealed interface NoteStep {
    data object Idle : NoteStep
    data class Recording(val text: String) : NoteStep
    data class Asking(val prompt: String) : NoteStep
    data object Saving : NoteStep
    data class Saved(val where: String, val text: String, val at: Long) : NoteStep
    data class Stopped(val why: String, val at: Long) : NoteStep
}

/**
 * Voice notes in Voice Vault: the listener for the console's Voice notes setup (Dev Console → Settings → Plugins →
 * Voice notes, kept on axHub). Start trigger → beep → the note until the stop trigger (cut from the text) → "where
 * should I store it?" (a list's number or name, or the list-of-lists trigger to hear them read out) → the list's
 * subcategory and question sets → saved to axHub, read back as a confirmation.
 *
 * Separate from the vault: no entry, code or password is ever read, spoken or sent here, and it works with the vault
 * locked. Speech is recognised on the phone (the same on-device recognizer the background listener uses); only the
 * note's text and answers go to axHub. No audio is kept: the recognizer hands back text only, so "cut it from the
 * recording" is met by never keeping a recording (`keepAudio` isn't supported on the phone yet).
 */
class VoiceNotes(private val scope: CoroutineScope, private val voice: AxfVoice?, private val config: () -> Config?, private val device: String) {
    private fun setting(key: String): String? = config()?.string(key)
    /** Settings → Voice notes → Listen for voice notes (this phone). The hub's own on/off is on top of this. */
    val listenOn: Boolean get() = setting(KEY_LISTEN)?.toBooleanStrictOrNull() ?: true
    val hubAddress: String get() = HubOrigin.normalize(setting(KEY_HUB)) ?: HubOrigin.DEFAULT

    private var hubFor = ""
    private var hubClient: NotesHub? = null
    val hub: NotesHub get() = synchronized(this) {
        val h = hubAddress
        hubClient?.takeIf { hubFor == h } ?: NotesHub(h, cookieCredentials { hubAddress }, APP_ID, device).also { hubClient = it; hubFor = h; _hubs.value = it }
    }
    private val _hubs = MutableStateFlow<NotesHub?>(null)
    /** The current hub client (changes when the address does), for screens that follow its state. */
    val hubs: StateFlow<NotesHub?> = _hubs.asStateFlow()

    private val _step = MutableStateFlow<NoteStep>(NoteStep.Idle)
    val step: StateFlow<NoteStep> = _step.asStateFlow()
    private val running = Mutex()
    val busy: Boolean get() = running.isLocked

    /** The setup as last read, when it's on (this phone + the hub's switch) and has start triggers; else null. */
    fun ready(): NotesSettings? {
        if (!listenOn) return null
        val st = hub.state.value as? HubNotesState.Ready ?: return null
        return st.settings.takeIf { it.enabled && it.startTriggers.isNotEmpty() }
    }

    fun refresh() { scope.launch { runCatching { hub.load() } } }

    /** True when [heard] contains one of the start triggers (the background listener asks this). */
    fun isStart(heard: List<String>): Boolean { val s = ready() ?: return false; return heard.any { NotesRules.isStart(it, s) } }

    /** Runs one note from the beep to the save. Waits for nothing else: a second call while one runs is ignored. */
    suspend fun take(): NoteStep {
        if (!running.tryLock()) return _step.value
        try { return conversation().also { _step.value = it } }
        catch (e: CancellationException) { _step.value = NoteStep.Stopped("Stopped: the app came on screen or listening stopped.", now()); throw e }
        catch (e: HubUnavailable) { return NoteStep.Stopped("Not saved: ${e.message}", now()).also { _step.value = it } }
        catch (e: Exception) { return NoteStep.Stopped("Not saved: ${e.message ?: e.javaClass.simpleName}", now()).also { _step.value = it } }
        finally { running.unlock() }
    }

    fun takeNow() { scope.launch { take() } }

    private fun now() = System.currentTimeMillis()

    private suspend fun conversation(): NoteStep {
        val v = voice ?: return NoteStep.Stopped("Voice isn't available on this phone.", now())
        if (!v.hasMic()) return NoteStep.Stopped("Needs the microphone permission.", now())
        val st = hub.load()
        val s = (st as? HubNotesState.Ready)?.settings ?: return NoteStep.Stopped(when (st) {
            is HubNotesState.SignedOut -> st.why
            is HubNotesState.Unreachable -> "axHub can't be reached, so there's nowhere to put the note (${st.why})."
            else -> "axHub isn't ready."
        }, now())
        val lists = (st as HubNotesState.Ready).lists
        if (!s.enabled) return NoteStep.Stopped("Voice notes are switched off in the console's Voice notes settings.", now())

        if (s.beep.on) beep(s.beep)
        val text = record(v, s) ?: return NoteStep.Stopped("Cancelled.", now())
        if (s.endBeep && s.beep.on) beep(s.beep)
        if (text.isBlank()) { say(v, s, "I didn't hear a note."); return NoteStep.Stopped("Nothing was said before the stop trigger.", now()) }

        // where to store it
        var list: NoteList? = null
        var tries = 0
        var prompt = s.askPrompt + if (s.readListsFirst && lists.isNotEmpty()) " " + NotesRules.readLists(s, lists).joinToString(". ") else ""
        while (list == null && tries <= s.retries) {
            val reply = ask(v, s, prompt) ?: return NoteStep.Stopped("Cancelled after recording; the note wasn't saved.", now())
            when {
                NotesRules.asksForLists(reply, s) -> { prompt = if (lists.isEmpty()) "There are no lists yet. Add them in the console." else NotesRules.readLists(s, lists).joinToString(". "); if (lists.isEmpty()) break }
                else -> { list = NotesRules.pickList(reply, lists); if (list == null) { tries++; prompt = "I didn't catch a list. " + s.askPrompt } }
            }
        }
        if (list == null) list = lists.firstOrNull { it.id == s.fallbackList }
        if (list == null) { say(v, s, "No list picked, so the note wasn't saved."); return NoteStep.Stopped("No list picked; the note wasn't saved (no fallback list set).", now()) }

        // subcategory
        var sub: Subcategory? = null
        if (list.askSubcategory && list.subcategories.isNotEmpty()) {
            val reply = ask(v, s, list.subcategoryPrompt.replace("{list}", list.name) + " " + list.subcategories.joinToString(". ") { "${it.number}: ${it.name}" })
                ?: return NoteStep.Stopped("Cancelled; the note wasn't saved.", now())
            sub = NotesRules.pickSubcategory(reply, list)
        }

        // questions: the "always" set, then one a number or a phrase opens
        val answers = LinkedHashMap<String, String>()
        val sets = mutableListOf<QuestionSet>()
        list.questionSets.firstOrNull { it.trigger.kind == TriggerKind.ALWAYS }?.let { sets += it }
        if (list.questionSets.any { it.trigger.kind != TriggerKind.ALWAYS }) {
            val reply = ask(v, s, list.questionPrompt) ?: return NoteStep.Stopped("Cancelled; the note wasn't saved.", now())
            if (!NotesRules.saysNone(reply)) NotesRules.pickQuestionSet(reply, list)?.takeIf { it.trigger.kind != TriggerKind.ALWAYS }?.let { sets += it }
        }
        for (set in sets) {
            if (sub == null && set.subcategory.isNotEmpty()) sub = list.subcategories.firstOrNull { it.id == set.subcategory }
            for (q in set.questions) {
                val a = ask(v, s, q.ask.ifBlank { "Answer?" }) ?: return NoteStep.Stopped("Cancelled; the note wasn't saved.", now())
                answers[q.field.ifBlank { q.id }] = a
            }
        }

        _step.value = NoteStep.Saving
        hub.save(hub.newNote(list, sub, text, answers))
        val where = list.name + (sub?.let { " › ${it.name}" } ?: "")
        if (s.confirm) say(v, s, NotesRules.confirmText(s, list, sub))
        return NoteStep.Saved(where, text, now())
    }

    private fun options(v: AxfVoice, s: NotesSettings, onPartial: ((String) -> Unit)? = null) =
        ListenOptions(language = s.language, preferOffline = true, secret = true, allowOnlineSecret = v.allowOnlineSecret, maxResults = 3, onPartial = onPartial)

    private suspend fun say(v: AxfVoice, s: NotesSettings, text: String) { v.speaker.say(text, s.language) }

    /** Speaks [prompt], listens once; null = a cancel trigger or nothing heard after a second try. */
    private suspend fun ask(v: AxfVoice, s: NotesSettings, prompt: String): String? {
        repeat(2) {
            _step.value = NoteStep.Asking(prompt)
            say(v, s, prompt)
            when (val h = v.input.listen(options(v, s))) {
                is Heard.Text -> return if (NotesRules.isCancel(h.best, s)) null else h.best
                is Heard.Failed -> return null
                Heard.Silence -> Unit
            }
        }
        return null
    }

    /**
     * The note itself: listens in turns (the recognizer ends a turn at a pause) and adds each turn to the text until a
     * stop trigger is heard (also mid-turn, from partial results), the time limit passes, or — when set — the silence
     * limit. Null = cancelled (a turn that is only a cancel trigger).
     */
    private suspend fun record(v: AxfVoice, s: NotesSettings): String? {
        val sb = StringBuilder()
        val started = now()
        var quietSince = now()
        _step.value = NoteStep.Recording("")
        while (now() - started < s.maxSeconds * 1000L) {
            var stopIn: String? = null
            val heard: Heard? = coroutineScope {
                lateinit var listen: Deferred<Heard>
                listen = async {
                    v.input.listen(options(v, s) { partial ->
                        _step.value = NoteStep.Recording("$sb $partial".trim())
                        if (stopIn == null && NotesRules.stripStopTrigger("$sb $partial", s.stopTriggers).cut != null) { stopIn = partial; listen.cancel() }
                    })
                }
                try { listen.await() } catch (e: CancellationException) { if (stopIn != null) null else throw e }
            }
            val turn = stopIn ?: (heard as? Heard.Text)?.best
            if (heard is Heard.Failed) return sb.toString().takeIf { it.isNotBlank() }?.let { NotesRules.stripStopTrigger(it, s.stopTriggers).text }
            if (turn != null) {
                if (sb.isEmpty() && NotesRules.norm(turn) in s.cancelTriggers.map(NotesRules::norm)) return null
                if (sb.isNotEmpty()) sb.append(' ')
                sb.append(turn)
                quietSince = now()
                _step.value = NoteStep.Recording(sb.toString())
                val cut = NotesRules.stripStopTrigger(sb.toString(), s.stopTriggers)
                if (cut.cut != null) return cut.text
            } else if (s.silenceSeconds > 0 && sb.isNotEmpty() && now() - quietSince >= s.silenceSeconds * 1000L) break
        }
        return NotesRules.stripStopTrigger(sb.toString(), s.stopTriggers).text
    }

    /** A sine beep at the setup's pitch, length and volume (notification stream, so it follows the phone's sound settings). */
    private suspend fun beep(b: Beep) = withContext(Dispatchers.Default) {
        runCatching {
            val rate = 22_050
            val n = rate * b.ms / 1000
            val pcm = ShortArray(n) { i ->
                val fade = minOf(1.0, i / (rate * 0.005), (n - i) / (rate * 0.005))
                (sin(2 * PI * b.hz * i / rate) * fade * b.volume * Short.MAX_VALUE).toInt().toShort()
            }
            val track = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(n * 2).setTransferMode(AudioTrack.MODE_STATIC).build()
            track.write(pcm, 0, n)
            track.play()
            delay(b.ms + 60L)
            track.release()
        }
        Unit
    }

    companion object {
        const val APP_ID = "voice-vault"
        const val KEY_LISTEN = "voicevault.notes.listen"
        const val KEY_HUB = "voicevault.notes.hub"
        const val ROUTE = "voice-notes"
        const val SIGN_IN_ROUTE = "voice-notes-hub"
        val DEVICE: String get() = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }
}
