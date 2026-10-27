package ai.amberx.axf.axnotes.plugins.buildbridge

import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.result.AxfFailure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Sends build requests and watches them. Each request opens one ai.build-request session on the AI session host
 * (axHub); the host holds it in `waiting` until Brett approves it in axHub (approval link + AXHub app push). The
 * controller polls each active request on [ApprovalPoll]'s schedule and stops when it is over. Records live in the KV
 * store under this plugin's prefix only.
 */
internal class BridgeController(private val host: PluginHost, private val scope: CoroutineScope, private val clock: () -> Long = System::currentTimeMillis) {
    private val _requests = MutableStateFlow(load())
    val requests: StateFlow<List<BuildRequest>> = _requests.asStateFlow()
    private var loop: Job? = null
    private val kick = MutableStateFlow(0L)
    private var counter = 0

    /** Null when this user may send build requests, else why not (non-admins never can). */
    fun denied(): String? = BridgeGate.check(host.policy(), host.modes())

    /** Sends a draft for approval. Returns the error shown to the user, or null when it was sent. */
    fun submit(d: BuildDraft): String? {
        denied()?.let { return it }
        if (d.body.isBlank()) return "Say or type what to build."
        if (d.noteId != null && _requests.value.any { it.noteId == d.noteId && it.status != RequestStatus.FAILED && it.status != RequestStatus.CANCELLED }) return "This note was already sent."
        val now = clock()
        val r = BuildRequest("br-${now.toString(36)}-${counter++}", d.title, d.body, d.source, now, now, noteId = d.noteId, message = "Sending to axHub…")
        upsert(r)
        scope.launch { open(r) }
        return null
    }

    private suspend fun open(r: BuildRequest) {
        val ai = host.ai()
        if (!ai.available()) { upsert(r.copy(status = RequestStatus.FAILED, message = "axHub isn't connected: set up AI in Settings, then send it again.")); return }
        val draft = BuildDraft(r.title, r.body, r.source, r.noteId)
        val built = AiModes.buildRequest(host.modes(), host.policy(), emptyList(), AiRequestInput(BuildPrompt.of(draft), ChatContext(view = "ai-build-bridge", title = r.title), requested = AiModes.BUILD_REQUEST, title = r.title))
        val req = built.request?.takeIf { it.mode == AiModes.BUILD_REQUEST && it.needsApproval }
        if (req == null) { upsert(r.copy(status = RequestStatus.FAILED, message = BridgeGate.DENIED)); return }
        ai.start(req)
            .onOk { info ->
                val now = clock()
                val started = ApprovalEvents.fromInfo(r.copy(sessionId = info.id, status = RequestStatus.PENDING_APPROVAL, message = "Waiting for the approval link…", updatedAt = now, nextPollAt = now + ApprovalPoll.delayMs(0)), info)
                upsert(started)
                wake()
            }
            .onErr { upsert(r.copy(status = RequestStatus.FAILED, message = message(it), updatedAt = clock())) }
    }

    /** Polls the request that is due first, again and again, while any request is active. A wake re-plans the wait. */
    fun wake() {
        kick.value = kick.value + 1
        if (loop?.isActive == true) return
        loop = scope.launch {
            while (isActive) {
                val seen = kick.value
                val next = ApprovalPoll.due(_requests.value)
                if (next == null) { if (kick.value == seen) break else continue }
                val wait = (next.nextPollAt ?: 0) - clock()
                if (wait > 0 && withTimeoutOrNull(wait) { kick.first { it != seen } } != null) continue
                poll(next.id)
            }
        }
    }

    private suspend fun poll(id: String) {
        val r = _requests.value.firstOrNull { it.id == id } ?: return
        val sid = r.sessionId ?: return
        val ai = host.ai()
        var cur = r
        var finished = false
        ai.stream(sid, r.lastSeq).onOk { replay ->
            val f = ApprovalEvents.fold(cur, replay.events, clock())
            cur = f.request; finished = f.justFinished
        }.onErr { cur = cur.copy(message = "Couldn't reach axHub (${message(it)}); trying again.") }
        if (cur.status.active) ai.list().onOk { infos -> infos.firstOrNull { it.id == sid }?.let { cur = ApprovalEvents.fromInfo(cur, it) } }
        cur = ApprovalPoll.afterPoll(cur, clock())
        upsert(cur)
        if (finished) {
            host.dispatchIfHandled(HOOK_FINISHED, RequestCodec.finishedHook(cur))
            host.runtime?.toast("Build finished: ${cur.title}", ToastKind.SUCCESS)
        }
    }

    /** Polls now (the "Check now" button); the schedule carries on from there. */
    fun checkNow(id: String) {
        _requests.value.firstOrNull { it.id == id && it.status.active } ?: return
        upsert(_requests.value.first { it.id == id }.copy(nextPollAt = clock()))
        wake()
    }

    /** Cancels a request still waiting: closes its hub session (nothing reaches the orchestrator). */
    fun cancel(id: String) {
        val r = _requests.value.firstOrNull { it.id == id } ?: return
        if (r.status != RequestStatus.PENDING_APPROVAL && r.status != RequestStatus.SUBMITTING) return
        upsert(r.copy(status = RequestStatus.CANCELLED, nextPollAt = null, message = "Cancelled.", updatedAt = clock()))
        r.sessionId?.let { sid -> scope.launch { host.ai().close(sid) } }
    }

    /** Forgets a request that is over. */
    fun forget(id: String) {
        _requests.update { l -> l.filterNot { it.id == id && !it.status.active } }
        save()
    }

    fun clearAll() { loop?.cancel(); _requests.value = emptyList() }

    private fun upsert(r: BuildRequest) {
        _requests.update { l -> RequestCodec.keep(l.filterNot { it.id == r.id } + r) }
        save()
    }

    private fun save() { host.putString(KEY_REQUESTS, RequestCodec.listToJson(_requests.value).toString()) }

    private fun load(): List<BuildRequest> = runCatching { RequestCodec.listFromJson(host.getString(KEY_REQUESTS)?.let { PluginHost.json.parseToJsonElement(it) }) }.getOrDefault(emptyList())

    private fun message(f: AxfFailure): String = when (f) {
        is AxfFailure.NotImplemented -> "axHub sessions aren't set up in this app yet"
        else -> f.message
    }

    companion object {
        const val KEY_REQUESTS: String = "requests"
        /** Hook action dispatched (payload = [RequestCodec.finishedHook]) when the orchestrator reports a build done. */
        const val HOOK_FINISHED: String = "ai-build-bridge.finished"
    }
}
