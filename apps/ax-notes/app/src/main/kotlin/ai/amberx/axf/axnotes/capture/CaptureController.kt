package ai.amberx.axf.axnotes.capture

import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.axnotes.model.Dictation
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.ListRules
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.model.NoteTriggers
import ai.amberx.axf.axnotes.model.ReadBack
import ai.amberx.axf.axnotes.model.ReadTarget
import ai.amberx.axf.axnotes.model.Text
import ai.amberx.axf.axnotes.model.TriggerDef
import ai.amberx.axf.axnotes.model.TriggerHit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

/** What the capture flow is doing. */
sealed interface CaptureState {
    data object Idle : CaptureState
    data class Dictating(val text: String) : CaptureState
    data class Saved(val note: Note) : CaptureState
}

/**
 * Voice → transcript → note. Every final transcript chunk (from [NoteCapture], a [TriggerSink] hit, or the typed box)
 * goes through [heard]: while dictating it is added to the note until an end phrase; otherwise it is matched against
 * the trigger data and the matching command runs. Replies go to the [Speaker].
 */
class CaptureController(
    private val store: NotesStore,
    private val scope: CoroutineScope,
    val capture: NoteCapture,
    val speaker: Speaker,
    private val sink: TriggerSink,
    private val ai: NoteAi,
    val triggers: List<TriggerDef>,
    private val navigate: (String) -> Unit,
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) {
    private val dictation = Dictation(NoteTriggers.phrasesOf(NoteTriggers.NOTE_END, triggers), NoteTriggers.phrasesOf(NoteTriggers.NOTE_CANCEL, triggers))
    private val _state = MutableStateFlow<CaptureState>(CaptureState.Idle)
    val state: StateFlow<CaptureState> = _state.asStateFlow()
    /** Recent lines: what was heard (›) and what was answered (‹). Newest last, at most [LOG_MAX]. */
    private val _log = MutableStateFlow<List<String>>(emptyList())
    val log: StateFlow<List<String>> = _log.asStateFlow()

    fun start() { sink.register(triggers) { onTrigger(it) } }

    fun listen() { capture.start { heard(it) } }
    fun stopListening() { capture.stop() }

    /** One final chunk of speech (or typed as if spoken). */
    fun heard(text: String) {
        if (text.isBlank()) return
        line("› ${text.trim()}")
        if (dictation.active) { feed(text); return }
        val hit = NoteTriggers.match(text, triggers)
        if (hit == null) { say("I didn't catch a command. Say “take a note” to dictate."); return }
        onTrigger(hit)
    }

    private fun feed(text: String) {
        when (val s = dictation.feed(text)) {
            is Dictation.Step.Continue -> _state.value = CaptureState.Dictating(s.text)
            is Dictation.Step.Finished -> saveDictated(s.text)
            Dictation.Step.Cancelled -> { _state.value = CaptureState.Idle; say("Note discarded.") }
        }
    }

    fun startDictation(initial: String = "") {
        dictation.start(initial)
        _state.value = CaptureState.Dictating(dictation.text)
        say("Listening. Say “end note” when you're done.")
    }

    /** Done button: save what was dictated so far. */
    fun finishDictation() { if (dictation.active) saveDictated(dictation.finish()) }

    fun cancelDictation() { dictation.cancel(); _state.value = CaptureState.Idle; say("Note discarded.") }

    private fun saveDictated(text: String) {
        if (text.isBlank()) { _state.value = CaptureState.Idle; say("Nothing to save."); return }
        val n = store.createNote(text, source = NoteSource.VOICE)
        _state.value = CaptureState.Saved(n)
        say("Saved: ${n.title}.")
    }

    private fun onTrigger(hit: TriggerHit) {
        val arg = hit.arg
        when (hit.def.id) {
            NoteTriggers.NOTE_TAKE -> startDictation()
            NoteTriggers.NOTE_END -> if (dictation.active) finishDictation() else say("No note is being dictated.")
            NoteTriggers.NOTE_CANCEL -> if (dictation.active) cancelDictation()
            NoteTriggers.NOTE_QUICK -> { val n = store.createNote(arg, source = NoteSource.VOICE); _state.value = CaptureState.Saved(n); say("Noted.") }
            NoteTriggers.READ_BACK -> say(ReadBack.notes(ReadTarget.parse(arg, store.categories.value), store.notes.value, store.categories.value, LocalDate.now(zone()), zone()))
            NoteTriggers.SUMMARIZE -> summarize(arg)
            NoteTriggers.OPEN_NOTES -> navigate("home")
            NoteTriggers.TODO_ADD -> addTodo(arg)
            NoteTriggers.TODO_CHECK -> checkOff(arg)
            NoteTriggers.LIST_READ -> readList(arg)
            NoteTriggers.LIST_NEW -> newList(arg, hit.phrase)
            else -> say("“${hit.phrase}” isn't something AX Notes does yet.")
        }
    }

    private fun summarize(arg: String) {
        val cats = store.categories.value
        val target = if (arg.isBlank()) null else ReadTarget.parse(arg, cats)
        val (label, notes) = when (target) {
            null, ReadTarget.Last -> "All notes" to store.notes.value
            ReadTarget.Today -> {
                val (from, to) = ListRules.dayRange(LocalDate.now(zone()), zone())
                "Today" to store.notes.value.filter { it.createdAt in from..to }
            }
            is ReadTarget.InCategory -> target.category.name to store.notes.value.filter { it.category == target.category.id }
            is ReadTarget.Unknown -> { say(ReadBack.notes(target, store.notes.value, cats, LocalDate.now(zone()), zone())); return }
        }
        scope.launch {
            val answer = if (ai.available && notes.isNotEmpty()) runCatching { ai.summarize(label, notes) }.getOrNull() else null
            say(answer ?: ReadBack.localSummary(label, notes))
        }
    }

    // ---------------------------------------------------------------- lists by voice (s22)

    private fun todoLists() = store.lists.value.filter { it.kind == ListKind.TODO }

    private fun addTodo(arg: String) {
        val (text, target) = ListRules.splitTarget(arg, todoLists())
        val list = target ?: todoLists().firstOrNull { it.id == NotesStore.TODO } ?: todoLists().firstOrNull()
            ?: store.createList("To-do", ListKind.TODO)
        val item = store.addTodo(list.id, text) ?: run { say("I couldn't add that."); return }
        say("Added ${item.text} to ${list.name}.")
    }

    private fun checkOff(arg: String) {
        val lists = todoLists()
        val owner = HashMap<String, String>()
        for (l in lists) for (i in l.items) owner[i.id] = l.id
        when (val r = ListRules.checkOff(arg, lists.flatMap { it.items })) {
            is ListRules.CheckOff.Found -> { store.setDone(owner.getValue(r.item.id), r.item.id, true); say("Checked off ${r.item.text}.") }
            is ListRules.CheckOff.Ambiguous -> say("Which one: ${r.items.take(3).joinToString(" or ") { it.text }}?")
            is ListRules.CheckOff.AlreadyDone -> say("${r.item.text} is already done.")
            ListRules.CheckOff.None -> say("I couldn't find “$arg” on your to-do lists.")
        }
    }

    private fun readList(arg: String) {
        val l = ListRules.findList(arg, store.lists.value) ?: run {
            say("I don't have a list called $arg." + store.lists.value.takeIf { it.isNotEmpty() }?.let { all -> " Lists: ${all.joinToString(", ") { it.name }}." }.orEmpty())
            return
        }
        say(if (l.kind == ListKind.TODO) ReadBack.todoList(l, store.categories.value) else ReadBack.noteList(l, store.notes.value, store.categories.value))
    }

    private fun newList(arg: String, phrase: String) {
        var name = arg.trim()
        val todo = Text.normalize(phrase).contains("todo") || Text.normalize(name).startsWith("todo ")
        if (Text.normalize(name).startsWith("todo ")) name = name.substringAfter(' ')
        if (name.isBlank()) { say("Say the list's name too."); return }
        ListRules.findList(name, store.lists.value)?.let { say("You already have ${it.name}."); return }
        val l = store.createList(name, if (todo) ListKind.TODO else ListKind.NOTES)
        say("Made ${if (todo) "to-do list" else "list"} ${l.name}.")
    }

    // ----------------------------------------------------------------

    private fun say(text: String) { line("‹ $text"); speaker.speak(text) }
    private fun line(s: String) { _log.update { (it + s).takeLast(LOG_MAX) } }

    companion object { const val LOG_MAX = 30 }
}
