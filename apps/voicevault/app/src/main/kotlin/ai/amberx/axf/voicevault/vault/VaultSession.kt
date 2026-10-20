package ai.amberx.axf.voicevault.vault

import android.content.Context
import androidx.fragment.app.FragmentActivity
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.lock.AppLock
import ai.amberx.axf.lock.LockMode
import ai.amberx.axf.lock.LockResult
import ai.amberx.axf.lock.Lockout
import ai.amberx.axf.lock.PinHasher
import ai.amberx.axf.lock.message
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.Heard
import ai.amberx.axf.voice.PhraseMatcher
import java.lang.ref.WeakReference
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Where the voice flow is. */
sealed interface Stage {
    /** First run: no unlock code yet. */
    data object Setup : Stage
    /** Listening for the unlock code. */
    data object Locked : Stage
    /** Checking the code, or the fingerprint sheet is up. */
    data object Verifying : Stage
    /** PIN second step; the UI answers with [VaultSession.submitPin]. */
    data class PinEntry(val previous: LockResult?) : Stage
    /** Unlocked, listening for a key (store / retrieve / lock). */
    data object Ready : Stage
    data class AskSite(val forStore: Boolean) : Stage
    data class AskPassword(val site: String) : Stage
    /** Both fields filled from speech; the user edits and taps Save. Not listening. */
    data class Editing(val site: String, val password: String, val replacing: VaultEntry?) : Stage
    /** Banner at the top: say or tap Confirm to copy this entry's password. */
    data class Confirm(val entry: VaultEntry) : Stage
    /** Several sites sound alike: pick one. */
    data class Choose(val matches: List<VaultEntry>, val heard: String) : Stage
    /** The vault file can't be decrypted on this phone. */
    data object Broken : Stage
}

enum class Tone { INFO, OK, WARN, ERROR }
data class Note(val text: String, val tone: Tone = Tone.INFO)

/** Voice command ids registered by this app. */
object Cmd {
    const val STORE = "vault.store"
    const val RETRIEVE = "vault.retrieve"
    const val CONFIRM = "vault.confirm"
    const val CANCEL = "vault.cancel"
    const val LOCK = "vault.lock"
}

/** App settings keys. */
object Keys {
    const val CLIPBOARD = "voicevault.clipboardClear"
    const val HANDS_FREE = "voicevault.handsFree"
    const val IDLE = "voicevault.idleLock"
    const val UNLOCK_CODE = "voicevault.unlockCode"
}

/**
 * The whole voice flow as one state machine. Entries live in memory only while unlocked and are
 * dropped on lock. Speech for the password and the unlock code is requested as `secret` (on-device
 * recognizer when the phone has one). Passwords are never spoken back, logged or put in notes.
 */
class VaultSession(
    private val context: Context,
    private val scope: CoroutineScope,
    private val voice: AxfVoice?,
    private val lock: AppLock?,
    private val secure: SecureStore?,
    private val config: () -> Config?,
) {
    private val store = VaultStore(context)
    private val clipboard = SecretClipboard(context, scope)
    private val codeLockout = Lockout()

    private val _stage = MutableStateFlow<Stage>(Stage.Locked)
    val stage: StateFlow<Stage> = _stage.asStateFlow()
    private val _entries = MutableStateFlow<List<VaultEntry>>(emptyList())
    val entries: StateFlow<List<VaultEntry>> = _entries.asStateFlow()
    private val _note = MutableStateFlow<Note?>(null)
    val note: StateFlow<Note?> = _note.asStateFlow()
    private val _listening = MutableStateFlow(false)
    /** True while the voice loop runs (the mic button shows it). */
    val listening: StateFlow<Boolean> = _listening.asStateFlow()

    val unlocked: Boolean get() = _stage.value !in setOf(Stage.Setup, Stage.Locked, Stage.Verifying, Stage.Broken) && _stage.value !is Stage.PinEntry

    private var activity: WeakReference<FragmentActivity>? = null
    private var visible = false
    private var foreground = true
    private var pendingSay: String? = null
    private var loop: Job? = null
    private var spokenFor: Stage? = null
    private var pinAnswer: CompletableDeferred<String?>? = null
    private var lastActivity = System.currentTimeMillis()
    private var backgroundAt = 0L

    private fun setting(key: String): String? = config()?.string(key)
    private val clearAfterSec: Int get() = setting(Keys.CLIPBOARD)?.toIntOrNull() ?: 30
    private val handsFree: Boolean get() = setting(Keys.HANDS_FREE)?.toBooleanStrictOrNull() ?: true
    private val idleMinutes: Int get() = setting(Keys.IDLE)?.toIntOrNull() ?: 5

    init {
        scope.launch { _stage.value = if (hasUnlockCode()) Stage.Locked else Stage.Setup }
        scope.launch {
            while (isActive) {
                delay(30_000)
                if (unlocked && foreground && idleMinutes > 0 && System.currentTimeMillis() - lastActivity > idleMinutes * 60_000L) lock("Locked after ${idleMinutes} min without use.")
            }
        }
    }

    /* ---------------- host hooks (MainActivity / HomeView) ---------------- */

    fun attach(a: FragmentActivity) { activity = WeakReference(a) }
    fun detach(a: FragmentActivity) { if (activity?.get() === a) activity = null }

    fun onBackground(now: Long = System.currentTimeMillis()) { foreground = false; backgroundAt = now; stopListening(); voice?.speaker?.stop() }
    fun onForeground(now: Long = System.currentTimeMillis()) {
        val minutes = lock?.autoLockMinutes ?: 0
        if (unlocked && backgroundAt > 0 && now - backgroundAt >= minutes * 60_000L) lock("Locked while the app was away.")
        backgroundAt = 0
        foreground = true
        touch()
    }

    /** The voice screen is showing; hands-free mode starts listening by itself. */
    fun onScreenVisible(isVisible: Boolean) {
        visible = isVisible
        if (isVisible) { if (handsFree) startListening() } else stopListening()
    }

    fun touch() { lastActivity = System.currentTimeMillis() }
    fun clearNote() { _note.value = null }

    /* ---------------- unlock code ---------------- */

    suspend fun hasUnlockCode(): Boolean = secure?.get(Keys.UNLOCK_CODE)?.getOrNull() != null

    /** Saves the unlock code (first run, or while unlocked). Returns an error or null. */
    suspend fun setUnlockCode(code: String): String? {
        val c = SpokenText.code(code)
        if (c.length < 6) return "Use at least 6 letters or numbers (two or more words works best)."
        if (voice?.commands?.match(listOf(c), threshold = 0.9) != null) return "That sounds like one of your voice triggers. Pick something else."
        val wasSetup = _stage.value == Stage.Setup
        if (!wasSetup && !unlocked) return "Unlock first."
        val s = secure ?: return "Secure storage isn't available."
        val hashed = withContext(Dispatchers.Default) { PinHasher.hash(c) }
        if (!s.put(Keys.UNLOCK_CODE, hashed).isOk) return "Couldn't save the unlock code."
        if (wasSetup) { openVault(); say("Unlock code saved. Say store password or retrieve password.") }
        return null
    }

    /** Typed fallback for the spoken unlock code (noisy rooms). */
    fun unlockTyped(code: String) { if (_stage.value == Stage.Locked) scope.launch { tryUnlock(listOf(code)) } }

    private suspend fun tryUnlock(heard: List<String>) {
        try { unlockSteps(heard) } finally {
            // Left mid-check (screen closed, loop cancelled): never stay half-unlocked.
            if (_stage.value == Stage.Verifying || _stage.value is Stage.PinEntry) { pinAnswer = null; _stage.value = Stage.Locked }
        }
    }

    private suspend fun unlockSteps(heard: List<String>) {
        val now = System.currentTimeMillis()
        codeLockout.remainingMs(now).takeIf { it > 0 }?.let { show("Too many tries. Wait ${it / 1000 + 1} s.", Tone.WARN); return }
        val stored = secure?.get(Keys.UNLOCK_CODE)?.getOrNull() ?: run { _stage.value = Stage.Setup; return }
        _stage.value = Stage.Verifying
        val ok = withContext(Dispatchers.Default) { heard.map(SpokenText::code).distinct().take(3).any { it.isNotEmpty() && PinHasher.verify(it, stored) } }
        if (!ok) {
            codeLockout.onFailure(now)
            _stage.value = Stage.Locked
            show(if (codeLockout.remainingMs(now) > 0) "Too many tries. Wait ${codeLockout.remainingMs(now) / 1000 + 1} s." else "That's not the unlock code.", Tone.WARN)
            return
        }
        codeLockout.onSuccess()
        when (val r = secondStep()) {
            LockResult.Passed -> openVault()
            else -> { _stage.value = Stage.Locked; show(r.message() ?: "Not unlocked.", Tone.WARN) }
        }
    }

    /** Runs the second step from Settings → Unlock. Misconfigured steps (no PIN set, no fingerprint enrolled) fall back with a warning. */
    private suspend fun secondStep(): LockResult {
        val l = lock ?: return LockResult.Passed
        return when (l.mode) {
            LockMode.NONE -> LockResult.Passed
            LockMode.BIOMETRIC -> {
                val a = activity?.get() ?: return LockResult.Unavailable("Open the app to use your fingerprint.")
                val problem = l.biometricProblem(a)
                if (problem != null) {
                    if (l.hasPin()) pinStep(l) else { show("$problem Unlocked with the voice code only — set a PIN in Settings.", Tone.WARN); LockResult.Passed }
                } else l.biometric(a, "Unlock Voice Vault", "Confirm it's you")
            }
            LockMode.PIN -> if (l.hasPin()) pinStep(l) else { show("No PIN set. Unlocked with the voice code only — set one in Settings → Unlock.", Tone.WARN); LockResult.Passed }
        }
    }

    /** PIN loop: the UI answers each [Stage.PinEntry] through [submitPin]; null = cancelled. */
    private suspend fun pinStep(l: AppLock): LockResult {
        var previous: LockResult? = null
        while (true) {
            val d = CompletableDeferred<String?>()
            pinAnswer = d
            _stage.value = Stage.PinEntry(previous)
            val pin = d.await() ?: return LockResult.Cancelled
            _stage.value = Stage.Verifying
            when (val r = l.checkPin(pin)) {
                is LockResult.Wrong, is LockResult.LockedOut -> previous = r
                else -> return r
            }
        }
    }

    fun submitPin(pin: String?) { pinAnswer?.complete(pin); pinAnswer = null }

    private suspend fun openVault() {
        try {
            _entries.value = withContext(Dispatchers.IO) { store.load() }
            _stage.value = Stage.Ready
            touch()
            show("Unlocked.", Tone.OK)
            if (visible && handsFree) startListening()
        } catch (e: VaultUnreadable) {
            _entries.value = emptyList(); _stage.value = Stage.Broken
            show(e.message ?: "The vault can't be opened.", Tone.ERROR)
        }
    }

    fun lock(reason: String? = null) {
        pinAnswer?.complete(null); pinAnswer = null
        _entries.value = emptyList()
        _stage.value = Stage.Locked
        spokenFor = null
        show(reason ?: "Locked.", Tone.INFO)
        if (visible && handsFree) startListening()
    }

    /** Erases an unreadable vault (and its key) so a new one can start. The unlock code stays. */
    fun eraseBrokenVault() {
        if (_stage.value != Stage.Broken) return
        scope.launch {
            withContext(Dispatchers.IO) { store.erase() }
            _entries.value = emptyList(); _stage.value = Stage.Ready
            show("Started a new, empty vault.", Tone.OK)
        }
    }

    /* ---------------- actions (voice or taps) ---------------- */

    fun startStore() { if (unlocked) { touch(); go(Stage.AskSite(forStore = true)) } }
    fun startRetrieve() { if (unlocked) { touch(); if (_entries.value.isEmpty()) show("No passwords saved yet.", Tone.INFO) else go(Stage.AskSite(forStore = false)) } }
    fun cancel() { if (unlocked) { touch(); go(Stage.Ready) } }

    /** Moves to the store form without speaking (tap path, or "type instead"). */
    fun editNew(site: String = "") { if (unlocked) { touch(); go(Stage.Editing(site, "", null)) } }

    /** Opens a saved entry in the store form. */
    fun editEntry(entry: VaultEntry) { if (unlocked) { touch(); go(Stage.Editing(entry.site, entry.password, entry)) } }

    fun save(site: String, password: String, replacingId: String? = null): String? {
        if (!unlocked) return "Unlock first."
        val s = site.trim(); if (s.isEmpty()) return "Enter the site."
        if (password.isEmpty()) return "Enter the password."
        touch()
        val now = System.currentTimeMillis()
        val list = _entries.value
        val same = list.firstOrNull { it.id == replacingId } ?: list.firstOrNull { PhraseMatcher.normalizeLabel(it.site) == PhraseMatcher.normalizeLabel(s) }
        val next = if (same != null) list.map { if (it.id == same.id) it.copy(site = s, password = password, updatedAt = now) else it }
            else list + VaultEntry(UUID.randomUUID().toString(), s, password, now)
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { store.save(next.sortedBy { it.site.lowercase() }) } }
                .onSuccess { _entries.value = next.sortedBy { it.site.lowercase() }; go(Stage.Ready); show(if (same != null) "Updated $s." else "Saved $s.", Tone.OK); say("Saved.") }
                .onFailure { show("Couldn't save the vault.", Tone.ERROR) }
        }
        return null
    }

    fun delete(id: String) {
        if (!unlocked) return
        touch()
        val next = _entries.value.filter { it.id != id }
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { store.save(next) } }
                .onSuccess { _entries.value = next; show("Deleted.", Tone.OK); if ((_stage.value as? Stage.Confirm)?.entry?.id == id) go(Stage.Ready) }
                .onFailure { show("Couldn't save the vault.", Tone.ERROR) }
        }
    }

    fun pick(entry: VaultEntry) { if (unlocked) { touch(); go(Stage.Confirm(entry)) } }

    /** Copies the confirmed entry's password; it is cleared from the clipboard after the set delay. */
    fun confirm() {
        val st = _stage.value as? Stage.Confirm ?: return
        copy(st.entry)
        go(Stage.Ready)
        say("Copied.")
    }

    /** Direct copy from the Saved sites list (the tap is the confirmation). */
    fun copy(entry: VaultEntry) {
        if (!unlocked) return
        touch()
        clipboard.copy("Voice Vault", entry.password, clearAfterSec)
        show(if (clearAfterSec > 0) "Password for ${entry.site} copied. Clipboard clears in $clearAfterSec s." else "Password for ${entry.site} copied.", Tone.OK)
    }

    /* ---------------- the voice loop ---------------- */

    fun toggleListening() { if (_listening.value) stopListening() else startListening() }

    fun startListening() {
        if (voice == null || loop?.isActive == true || !visible) return
        loop = scope.launch {
            _listening.value = true
            try { runLoop() } finally { _listening.value = false }
        }
    }

    fun stopListening() { loop?.cancel(); loop = null; voice?.speaker?.stop() }

    private data class Ask(val prompt: String, val secret: Boolean = false)

    private fun askFor(st: Stage): Ask? = when (st) {
        Stage.Locked -> Ask("Say your unlock code.", secret = true)
        Stage.Ready -> Ask("Store password, or retrieve password?")
        is Stage.AskSite -> Ask("Which site?")
        is Stage.AskPassword -> Ask("Say the password for ${st.site}.", secret = true)
        is Stage.Confirm -> Ask("Copy the password for ${st.entry.site}? Say confirm or cancel.")
        is Stage.Choose -> Ask("Which one? ${st.matches.joinToString(", ") { it.site }}.")
        else -> null // Setup, Verifying, PinEntry, Editing, Broken: taps only
    }

    private suspend fun runLoop() {
        val v = voice ?: return
        if (!v.ensureMic()) { show("Microphone permission is off. Allow it to use voice.", Tone.WARN); return }
        var silences = 0
        while (currentCoroutineContext().isActive) {
            val st = _stage.value
            val ask = askFor(st) ?: return
            val prompt = listOfNotNull(pendingSay, ask.prompt.takeIf { spokenFor != st }).joinToString(" ").ifEmpty { null }
            pendingSay = null; spokenFor = st
            when (val h = v.ask(prompt, secret = ask.secret)) {
                Heard.Silence -> {
                    if (++silences >= MAX_SILENCES) { show("Stopped listening. Tap the mic to start again.", Tone.INFO); return }
                }
                is Heard.Failed -> {
                    show(h.message, Tone.WARN)
                    if (h.code == -1 || h.code == android.speech.SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return
                    delay(1_500)
                }
                is Heard.Text -> { silences = 0; if (_stage.value == st) handle(st, h.alternatives) }
            }
        }
    }

    private suspend fun handle(st: Stage, heard: List<String>) {
        val cmds = voice?.commands
        when (st) {
            Stage.Locked -> tryUnlock(heard)
            Stage.Ready -> when (cmds?.match(heard, listOf(Cmd.STORE, Cmd.RETRIEVE, Cmd.LOCK))?.commandId) {
                Cmd.STORE -> startStore()
                Cmd.RETRIEVE -> startRetrieve()
                Cmd.LOCK -> lock()
                else -> show("Heard “${heard.first()}”. Say a trigger from Settings → Voice triggers.", Tone.INFO)
            }
            is Stage.AskSite -> {
                if (cmds?.match(heard, listOf(Cmd.CANCEL), 0.9) != null) { cancel(); return }
                touch()
                if (st.forStore) {
                    val site = SpokenText.site(heard.first())
                    go(Stage.AskPassword(site))
                } else findSite(heard)
            }
            is Stage.AskPassword -> {
                touch()
                val pw = SpokenText.password(heard.first())
                val replacing = _entries.value.firstOrNull { PhraseMatcher.normalizeLabel(it.site) == PhraseMatcher.normalizeLabel(st.site) }
                go(Stage.Editing(st.site, pw, replacing))
                show(if (replacing != null) "Check both fields, then tap Save. This replaces the saved password for ${replacing.site}." else "Check both fields, then tap Save.", Tone.INFO)
            }
            is Stage.Confirm -> when (cmds?.match(heard, listOf(Cmd.CONFIRM, Cmd.CANCEL))?.commandId) {
                Cmd.CONFIRM -> confirm()
                Cmd.CANCEL -> cancel()
                else -> show("Say confirm or cancel.", Tone.INFO)
            }
            is Stage.Choose -> {
                if (cmds?.match(heard, listOf(Cmd.CANCEL), 0.9) != null) { cancel(); return }
                PhraseMatcher.best(heard, st.matches, 0.75, { it.site })?.let { pick(it.item) } ?: show("Tap the one you want.", Tone.INFO)
            }
            else -> Unit
        }
    }

    private fun findSite(heard: List<String>) {
        val ranked = PhraseMatcher.ranked(heard, _entries.value, 0.72) { it.site }
        when {
            ranked.isEmpty() -> { go(Stage.Ready); show("No saved site sounds like “${heard.first()}”.", Tone.WARN) }
            ranked.size == 1 || ranked[0].score - ranked[1].score >= 0.08 -> go(Stage.Confirm(ranked[0].item))
            else -> go(Stage.Choose(ranked.take(4).map { it.item }, heard.first()))
        }
    }

    /* ---------------- helpers ---------------- */

    private fun go(next: Stage) { _stage.value = next; if (next !is Stage.Editing) clearNoteIfInfo(); if (visible && handsFree && askFor(next) != null) startListening() }
    private fun clearNoteIfInfo() { if (_note.value?.tone == Tone.INFO) _note.value = null }
    private fun show(text: String, tone: Tone) { _note.value = Note(text, tone) }
    /** Short spoken confirmation; inside the voice loop it is said just before the next prompt. */
    private fun say(text: String) {
        val v = voice ?: return
        if (!v.speakPrompts || !visible) return
        if (loop?.isActive == true) pendingSay = text else scope.launch { v.speaker.say(text, v.language) }
    }

    private companion object { const val MAX_SILENCES = 6 }
}
