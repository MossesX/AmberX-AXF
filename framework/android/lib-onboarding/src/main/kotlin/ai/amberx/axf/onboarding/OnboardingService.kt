package ai.amberx.axf.onboarding

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The app's onboarding, as a service (`axf.onboarding`, registered by [OnboardingModule]): the spec, the persisted
 * "done" flag ([OnboardingStore]) and an observable [done] so [OnboardingGate] switches the moment it changes.
 */
public class OnboardingService(public val spec: OnboardingSpec, private val store: OnboardingStore) {
    private val _done = MutableStateFlow(store.isDone(spec))
    public val done: StateFlow<Boolean> = _done.asStateFlow()

    public fun isDone(): Boolean = _done.value

    public fun markDone() { store.markDone(spec); _done.value = true }

    /** Ask again on the next gate (Settings → Setup → Run setup again). */
    public fun reset() { store.reset(spec.appId); _done.value = false }
}
