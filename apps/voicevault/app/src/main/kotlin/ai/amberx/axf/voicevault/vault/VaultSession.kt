package ai.amberx.axf.voicevault.vault

import android.content.Context
import android.speech.SpeechRecognizer
import androidx.fragment.app.FragmentActivity
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.lock.AppLock
import ai.amberx.axf.lock.LockGate
import ai.amberx.axf.lock.LockMode
import ai.amberx.axf.lock.LockResult
import ai.amberx.axf.lock.PersistedLockout
import ai.amberx.axf.lock.SecretKind
import ai.amberx.axf.lock.SecretState
import ai.amberx.axf.lock.StoredSecret
import ai.amberx.axf.lock.lockGate
import ai.amberx.axf.lock.message
import ai.amberx.axf.platform.SensitiveClipboard
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.Heard
import ai.amberx.axf.voice.PhraseMatcher
import ai.amberx.axf.voice.SpeechInput
import ai.amberx.axf.voice.SpokenText
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** Why the vault can't be used right now. */
enum class BrokenReason {
    /** vault.bin exists but can't be decrypted (Keystore key reset, file damaged). */
    VAULT_UNREADABLE,
    /** vault.bin exists but the unlock code is gone: never offer a new code for an old vault. */
    CODE_MISSING,
    /** The secure store couldn't be read. Retry; never treat it as "no code yet". */
    STORAGE_ERROR,
}

/** Where the voice flow is. */
sealed interface Stage {
    /** Still starting: settings and secure storage not read yet. */
    data object Starting : Stage
    /** First run: no unlock code and no vault yet. */
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
    data class Editing(val site: String, val password: String, val replacing: VaultEntry?) : Stage {
        override fun toString(): String = "Editing(site=$site, replacing=${replacing?.id})"
    }
    /** Banner at the top: say or tap Confirm to copy this entry's password. */
    data class Confirm(val entry: VaultEntry) : Stage
    /** Several sites sound alike: pick one. */
    data class Choose(val matches: List<VaultEntry>, val heard: String) : Stage
    data class Broken(val reason: BrokenReason) : Stage
}

/** True for stages where the vault is open. */
fun Stage.isUnlocked(): Boolean = when (this) {
    Stage.Ready, is Stage.AskSite, is Stage.AskPassword, is Stage.Editing, is Stage.Confirm, is Stage.Choose -> true
    else -> false
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

/** App settings / storage keys. */
object Keys {
    const val CLIPBOARD = "voicevault.clipboardClear"
    const val HANDS_FREE = "voicevault.handsFree"
    const val IDLE = "voicevault.idleLock"
    const val UNLOCK_CODE = "voicevault.unlockCode"
    const val CODE_LOCKOUT = "voicevault.codeLockout"
}

/**
 * The whole voice flow as one state machine. Entries live in memory only while unlocked and are
 * dropped on lock. Every doubtful case fails closed: unreadable storage, a vault without a code,
 * an unavailable second step. Passwords are never spoken back, logged or put in notes.
 */
class VaultSession(
    private val context: Context,
    private val scope: CoroutineScope,
    private val voice: AxfVoice?,
    private val lock: AppLock?,
    private val secure: SecureStore?,
    private val kv: KeyValueStore?,
    /** The app has started every module (settings loaded), so the lock mode can be trusted. */
    private val ready: StateFlow<Boolean>,
    private val config: () -> Config?,
) {
    private val store = VaultStore(context)
    private val clipboard = SensitiveClipboard(context, scope, CLIP_TAG)
    /** Failed unlock codes, persisted (`failures:lockedUntil` under [Keys.CODE_LOCKOUT], same as before). */
    private val codeLockout = PersistedLockout(kv, Keys.CODE_LOCKOUT)
    /** The spoken unlock code: only a salted PBKDF2 hash, in the secure store; heard and typed codes normalize alike. */
    private val unlockCode = StoredSecret(secure, Keys.UNLOCK_CODE, SecretKind.passphrase(SpokenText::code))
    /**
     * Auto-lock (lib-lock): away for Settings → Unlock's delay (a timer, so entries leave memory even if the app is
     * never reopened) or idle for [idleMinutes]. The voice code always comes first, so it never opens by itself, and
     * without lib-lock leaving locks at once.
     */
    val gate: LockGate = lockGate(lock, scope, firstStep = true, idleMinutes = { idleMinutes })
    private val writes = Mutex()
    /** Bumped on every lock; a write that finishes after a lock must not reopen anything. */
    @Volatile private var epoch = 0

    private val _stage = MutableStateFlow<Stage>(Stage.Starting)
    val stage: StateFlow<Stage> = _stage.asStateFlow()
    private val _entries = MutableStateFlow<List<VaultEntry>>(emptyList())
    val entries: StateFlow<List<VaultEntry>> = _entries.asStateFlow()
    private val _note = MutableStateFlow<Note?>(null)
    val note: StateFlow<Note?> = _note.asStateFlow()
    private val _listening = MutableStateFlow(false)
    /** True while the voice loop runs (the mic button shows it). */
    val listening: StateFlow<Boolean> = _listening.asStateFlow()

    val unlocked: Boolean get() = _stage.value.isUnlocked()

    private var activity: WeakReference<FragmentActivity>? = null
    private var visible = false
    private var foreground = true
    private var pendingSay: String? = null
    private var loop: Job? = null
    private var spokenFor: Stage? = null
    private var pinAnswer: CompletableDeferred<String?>? = null

    private fun setting(key: String): String? = config()?.string(key)
    private val clearAfterSec: Int get() = setting(Keys.CLIPBOARD)?.toIntOrNull() ?: 30
    private val handsFree: Boolean get() = setting(Keys.HANDS_FREE)?.toBooleanStrictOrNull() ?: true
    private val idleMinutes: Int get() = setting(Keys.IDLE)?.toIntOrNull() ?: 5

    init {
        // The gate locks on leaving / idle; the session then drops the entries.
        gate.onLock { reason -> lock(reason) }
        scope.launch { refreshStart() }
    }

    /** Decides the starting stage. Setup only when there is neither a code nor a vault. */
    suspend fun refreshStart() {
        val vaultExists = withContext(Dispatchers.IO) { store.exists }
        _stage.value = when (unlockCode.state()) {
            is SecretState.Present -> Stage.Locked
            SecretState.Missing -> if (vaultExists) Stage.Broken(BrokenReason.CODE_MISSING) else Stage.Setup
            SecretState.Error -> Stage.Broken(BrokenReason.STORAGE_ERROR)
        }
        if (_stage.value == Stage.Locked && visible && handsFree) startListening()
    }

    /* ---------------- host hooks (MainActivity / HomeView) ---------------- */

    fun attach(a: FragmentActivity) { activity = WeakReference(a) }
    fun detach(a: FragmentActivity) { if (activity?.get() === a) activity = null }

    fun onBackground(now: Long = System.currentTimeMillis()) {
        foreground = false
        stopListening(); voice?.speaker?.stop()
        gate.onLeave(now)
    }

    fun onForeground(now: Long = System.currentTimeMillis()) {
        gate.onReturn(now) // may lock (away too long); listening restarts when the screen shows again
        foreground = true
    }

    /** The voice screen is showing; hands-free mode starts listening by itself. */
    fun onScreenVisible(isVisible: Boolean) {
        visible = isVisible
        if (isVisible) { if (handsFree) startListening() } else stopListening()
    }

    fun touch() { gate.touch() }
    fun clearNote() { _note.value = null }

    /* ---------------- unlock code ---------------- */

    /** Saves the unlock code: on first run (no vault yet) or while unlocked. Returns an error or null. */
    suspend fun setUnlockCode(code: String): String? {
        unlockCode.check(code)?.let { return it }
        val c = SpokenText.code(code)
        if (voice?.commands?.match(listOf(c), threshold = 0.9) != null) return "That sounds like one of your voice triggers. Pick something else."
        val firstRun = _stage.value == Stage.Setup
        if (firstRun) {
            // Re-check: a vault or a code that appeared since means this is not a first run.
            if (withContext(Dispatchers.IO) { store.exists } || unlockCode.state() !is SecretState.Missing) { refreshStart(); return "A vault already exists. Unlock it first." }
        } else if (!unlocked) return "Unlock first."
        unlockCode.save(code, failMessage = "Couldn't save the unlock code.")?.let { return it }
        if (firstRun) { openVault(); say("Unlock code saved.") }
        return null
    }

    /** Typed fallback for the spoken unlock code (noisy rooms, no on-device recognizer). */
    fun unlockTyped(code: String) { if (_stage.value == Stage.Locked) scope.launch { tryUnlock(listOf(code)) } }

    private suspend fun tryUnlock(heard: List<String>) {
        try { unlockSteps(heard) } finally {
            // Interrupted mid-check: never stay half-unlocked.
            if (_stage.value == Stage.Verifying || _stage.value is Stage.PinEntry) { pinAnswer = null; _stage.value = Stage.Locked }
        }
    }

    private suspend fun unlockSteps(heard: List<String>) {
        val now = System.currentTimeMillis()
        codeLockout.remainingMs(now).takeIf { it > 0 }?.let { show("Too many tries. Wait ${it / 1000 + 1} s.", Tone.WARN); return }
        val stored = when (val cs = unlockCode.state()) {
            is SecretState.Present -> cs.hash
            else -> { refreshStart(); return }
        }
        _stage.value = Stage.Verifying
        val ok = unlockCode.matchesAny(heard, stored, max = 3)
        if (!ok) {
            codeLockout.onFailure(now)
            _stage.value = Stage.Locked
            show(if (codeLockout.remainingMs(now) > 0) "Too many tries. Wait ${codeLockout.remainingMs(now) / 1000 + 1} s." else "That's not the unlock code.", Tone.WARN)
            return
        }
        codeLockout.onSuccess()
        // The lock mode is a saved setting: wait until settings have loaded before trusting it.
        if (withTimeoutOrNull(10_000) { ready.first { it } } == null) { _stage.value = Stage.Locked; show("Still starting. Try again in a moment.", Tone.WARN); return }
        when (val r = secondStep()) {
            LockResult.Passed -> openVault()
            else -> { _stage.value = Stage.Locked; show(r.message() ?: "Not unlocked.", Tone.WARN) }
        }
    }

    /** The second step from Settings → Unlock. Fails closed: only "voice code only" passes without it. */
    private suspend fun secondStep(): LockResult {
        val l = lock ?: return LockResult.Unavailable("App lock isn't installed.")
        return when (l.mode) {
            LockMode.NONE -> LockResult.Passed
            LockMode.BIOMETRIC -> {
                val a = activity?.get() ?: return LockResult.Unavailable("Open the app to use your fingerprint.")
                val problem = l.biometricProblem(a)
                when {
                    problem == null -> l.biometric(a, "Unlock Voice Vault", "Confirm it's you")
                    l.hasPin() -> pinStep(l)
                    else -> LockResult.Unavailable("$problem Use the PIN instead after setting one, or erase the vault.")
                }
            }
            LockMode.PIN -> if (l.hasPin()) pinStep(l) else LockResult.Unavailable("No PIN is set, so the vault can't be opened with a PIN.")
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
        val myEpoch = epoch
        try {
            val loaded = writes.withLock { withContext(Dispatchers.IO) { store.load() } }
            if (epoch != myEpoch) return
            _entries.value = loaded
            _stage.value = Stage.Ready
            gate.unlock()
            show("Unlocked.", Tone.OK)
            if (visible && handsFree) startListening()
        } catch (e: VaultUnreadable) {
            _entries.value = emptyList(); _stage.value = Stage.Broken(BrokenReason.VAULT_UNREADABLE)
            show(e.message ?: "The vault can't be opened.", Tone.ERROR)
        }
    }

    /** Locks now. [clearClipboard] also wipes a copied password (explicit "lock" only, so a paste in another app still works). */
    fun lock(reason: String? = null, clearClipboard: Boolean = false) {
        if (locking) return // the gate's onLock calls back in here; run the body once
        locking = true
        try { lockSteps(reason, clearClipboard) } finally { locking = false }
    }

    private var locking = false

    private fun lockSteps(reason: String?, clearClipboard: Boolean) {
        epoch++
        gate.lockNow(reason)
        pinAnswer?.complete(null); pinAnswer = null
        _entries.value = emptyList()
        if (clearClipboard) clipboard.clearNow()
        if (_stage.value !is Stage.Broken && _stage.value != Stage.Setup && _stage.value != Stage.Starting) _stage.value = Stage.Locked
        spokenFor = null
        show(reason ?: "Locked.", Tone.INFO)
        if (visible && handsFree && foreground) startListening()
    }

    /**
     * Erases the vault file and its key, plus the unlock code when [alsoCode]. Destructive, never
     * reveals anything: it is the way out of a broken vault or a forgotten code. Ends in Setup or Locked.
     */
    fun erase(alsoCode: Boolean) {
        lock("Erasing…")
        scope.launch {
            writes.withLock { withContext(Dispatchers.IO) { store.erase() } }
            if (alsoCode) secure?.remove(Keys.UNLOCK_CODE)
            codeLockout.reset()
            refreshStart()
            show(if (_stage.value == Stage.Setup) "Vault erased. Choose a new unlock code." else "Vault erased. Unlock to start a new one.", Tone.OK)
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
        val myEpoch = epoch
        scope.launch {
            var updated = false
            val ok = writes.withLock {
                if (epoch != myEpoch || !unlocked) return@withLock false
                val list = _entries.value
                val same = list.firstOrNull { it.id == replacingId } ?: list.firstOrNull { PhraseMatcher.normalizeLabel(it.site) == PhraseMatcher.normalizeLabel(s) }
                updated = same != null
                val now = System.currentTimeMillis()
                val next = (if (same != null) list.map { if (it.id == same.id) it.copy(site = s, password = password, updatedAt = now) else it }
                    else list + VaultEntry(UUID.randomUUID().toString(), s, password, now)).sortedBy { it.site.lowercase() }
                runCatching { withContext(Dispatchers.IO) { store.save(next) } }.isSuccess.also { saved ->
                    if (saved && epoch == myEpoch) _entries.value = next
                }
            }
            if (epoch != myEpoch || !unlocked) return@launch
            if (ok) { go(Stage.Ready); show(if (updated) "Updated $s." else "Saved $s.", Tone.OK); say("Saved.") }
            else show("Couldn't save the vault.", Tone.ERROR)
        }
        return null
    }

    fun delete(id: String) {
        if (!unlocked) return
        touch()
        val myEpoch = epoch
        scope.launch {
            val ok = writes.withLock {
                if (epoch != myEpoch || !unlocked) return@withLock false
                val next = _entries.value.filter { it.id != id }
                runCatching { withContext(Dispatchers.IO) { store.save(next) } }.isSuccess.also { saved -> if (saved && epoch == myEpoch) _entries.value = next }
            }
            if (epoch != myEpoch || !unlocked) return@launch
            if (ok) { show("Deleted.", Tone.OK); if ((_stage.value as? Stage.Confirm)?.entry?.id == id) go(Stage.Ready) }
            else show("Couldn't save the vault.", Tone.ERROR)
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
        else -> null // Starting, Setup, Verifying, PinEntry, Editing, Broken: taps only
    }

    private suspend fun runLoop() {
        val v = voice ?: return
        if (!v.ensureMic()) { show("Microphone permission is off. Allow it to use voice.", Tone.WARN); return }
        var silences = 0
        var failures = 0
        while (currentCoroutineContext().isActive) {
            val st = _stage.value
            val ask = askFor(st) ?: return
            val prompt = listOfNotNull(pendingSay, ask.prompt.takeIf { spokenFor != st }).joinToString(" ").ifEmpty { null }
            pendingSay = null; spokenFor = st
            when (val h = v.ask(prompt, secret = ask.secret)) {
                Heard.Silence -> if (++silences >= MAX_SILENCES) { show("Stopped listening. Tap the mic to start again.", Tone.INFO); return }
                is Heard.Failed -> {
                    if (h.code == SpeechInput.NO_ON_DEVICE) {
                        // Secrets are never sent to an online recognizer: switch to typing.
                        if (st is Stage.AskPassword) { editNew(st.site); show("Type the password: this phone has no on-device speech recognition.", Tone.INFO) }
                        else show("Type your unlock code below: this phone has no on-device speech recognition (or allow online recognition in Settings → Voice).", Tone.INFO)
                        return
                    }
                    show(h.message, Tone.WARN)
                    if (h.code == -1 || h.code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS || ++failures >= MAX_FAILURES) return
                    delay(1_500)
                }
                is Heard.Text -> { silences = 0; failures = 0; if (_stage.value == st) handle(st, h.alternatives) }
            }
        }
    }

    private suspend fun handle(st: Stage, heard: List<String>) {
        val cmds = voice?.commands
        when (st) {
            // Run the unlock outside the loop's job, so a fingerprint sheet pausing the screen can't cancel it.
            Stage.Locked -> scope.launch { tryUnlock(heard) }.join()
            Stage.Ready -> when (cmds?.match(heard, listOf(Cmd.STORE, Cmd.RETRIEVE, Cmd.LOCK))?.commandId) {
                Cmd.STORE -> startStore()
                Cmd.RETRIEVE -> startRetrieve()
                Cmd.LOCK -> lock(clearClipboard = true)
                else -> show("Heard “${heard.first()}”. Say a trigger from Settings → Voice triggers.", Tone.INFO)
            }
            is Stage.AskSite -> {
                if (cmds?.match(heard, listOf(Cmd.CANCEL), 0.9) != null) { cancel(); return }
                touch()
                if (st.forStore) go(Stage.AskPassword(SpokenText.site(heard.first()))) else findSite(heard)
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

    private companion object {
        const val MAX_SILENCES = 6
        const val MAX_FAILURES = 3
        /** Clipboard tag key, unchanged from the app's own clipboard helper. */
        const val CLIP_TAG = "ai.amberx.axf.voicevault.copy"
    }
}
