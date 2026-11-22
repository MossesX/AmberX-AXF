package ai.amberx.axf.phoneconnect.link

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** What the screens show about the link: set by the pairing screen and the watch service. */
object LinkState {
    private val mutable = MutableStateFlow("Not paired")
    val status: StateFlow<String> = mutable
    fun set(text: String) { mutable.value = text }

    /** What every surface says once the console refused this phone's key. */
    const val DISCONNECTED = "Disconnected: tap to re-pair"
}
