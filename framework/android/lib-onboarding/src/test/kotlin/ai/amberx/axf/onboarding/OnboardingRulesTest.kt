package ai.amberx.axf.onboarding

import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingRulesTest {
    private val svc = "com.example.app.MyAccessibilityService"
    private val mic = PermissionRequest.microphone("voice")
    private val cam = PermissionRequest.camera("gestures", required = false)
    private val a11y = PermissionRequest.accessibility(svc, "taps")
    private val notif = PermissionRequest.notifications("status")
    private val battery = PermissionRequest.battery("background")
    private val spec = OnboardingSpec("notes", "Notes", listOf(mic, cam, a11y, notif, battery))

    private fun grants(vararg granted: PermissionRequest): Map<GrantKey, Boolean> =
        spec.requests.associate { OnboardingRules.key(it) to (it in granted) }

    @Test fun stepsFollowSpec() {
        assertEquals(listOf(OnboardingStep.Welcome, OnboardingStep.Checklist, OnboardingStep.AccessibilityGuide(a11y), OnboardingStep.Finish), OnboardingRules.steps(spec))
        val bare = OnboardingSpec("x", "X", emptyList())
        assertEquals(listOf(OnboardingStep.Welcome, OnboardingStep.Finish), OnboardingRules.steps(bare))
        val onlyBattery = OnboardingSpec("y", "Y", listOf(battery))
        assertEquals(listOf(OnboardingStep.Welcome, OnboardingStep.Finish), OnboardingRules.steps(onlyBattery))
        assertEquals(OnboardingStep.Finish, OnboardingRules.next(onlyBattery, OnboardingStep.Welcome))
    }

    @Test fun navigationSkipsGuides() {
        assertEquals(OnboardingStep.Checklist, OnboardingRules.next(spec, OnboardingStep.Welcome))
        assertEquals(OnboardingStep.Finish, OnboardingRules.next(spec, OnboardingStep.Checklist))
        assertEquals(OnboardingStep.Checklist, OnboardingRules.next(spec, OnboardingStep.AccessibilityGuide(a11y)))
        assertNull(OnboardingRules.next(spec, OnboardingStep.Finish))
        assertNull(OnboardingRules.back(spec, OnboardingStep.Welcome))
        assertEquals(OnboardingStep.Checklist, OnboardingRules.back(spec, OnboardingStep.Finish))
        assertEquals(OnboardingStep.AccessibilityGuide(a11y), OnboardingRules.guideFor(a11y))
        assertNull(OnboardingRules.guideFor(mic))
    }

    @Test fun stepIdsRoundTrip() {
        OnboardingRules.steps(spec).forEach { assertEquals(it, OnboardingRules.stepOf(spec, it.id)) }
        assertEquals(OnboardingStep.Welcome, OnboardingRules.stepOf(spec, "nope"))
        assertEquals("3 of 4", OnboardingRules.progressLabel(spec, OnboardingStep.AccessibilityGuide(a11y)))
    }

    @Test fun checklistExcludesBatteryAndOrdersRows() {
        val rows = OnboardingRules.rows(spec, grants())
        assertEquals(listOf(mic, cam, a11y, notif), rows.map { it.request })
        assertEquals(listOf(true, false, false, false), rows.map { it.active })
        // optional camera does not block the rows below it
        val after = OnboardingRules.rows(spec, grants(mic))
        assertEquals(listOf(true, true, true, false), after.map { it.active })
        val unordered = OnboardingRules.rows(spec.copy(ordered = false), grants())
        assertTrue(unordered.all { it.active })
    }

    @Test fun continueAndFinishRules() {
        assertFalse(OnboardingRules.canContinue(spec, grants(mic, a11y)))
        assertTrue(OnboardingRules.canContinue(spec, grants(mic, a11y, notif)))
        // battery is optional by default
        assertTrue(OnboardingRules.canFinish(spec, grants(mic, a11y, notif)))
        val strict = spec.copy(requests = spec.requests.map { if (it == battery) battery.copy(required = true) else it })
        assertFalse(OnboardingRules.canFinish(strict, strict.requests.filter { it.kind != PermissionKind.BATTERY }.associate { OnboardingRules.key(it) to true }))
        assertEquals(listOf(mic, a11y, notif), OnboardingRules.missing(spec, grants()))
    }

    @Test fun missingKeysFailClosed() {
        assertFalse(OnboardingRules.canContinue(spec, emptyMap()))
        assertEquals("accessibility:$svc", OnboardingRules.key(a11y))
        assertEquals("microphone", OnboardingRules.key(mic))
    }

    @Test(expected = IllegalArgumentException::class) fun accessibilityNeedsClass() {
        PermissionRequest(PermissionKind.ACCESSIBILITY, "x")
    }

    @Test(expected = IllegalArgumentException::class) fun duplicatesRejected() {
        OnboardingSpec("d", "D", listOf(mic, mic))
    }

    @Test fun storeCompletionRules() {
        val kv = MemoryKeyValueStore()
        val store = OnboardingStore(kv)
        assertFalse(store.isDone(spec))
        store.markDone(spec)
        assertTrue(store.isDone(spec))
        assertEquals("1", kv.get("axf.onboarding.notes.done"))
        // a new requirement (version 2) asks again
        assertFalse(store.isDone(spec.copy(version = 2)))
        // per app
        assertFalse(store.isDone(spec.copy(appId = "other")))
        kv.put("axf.onboarding.notes.done", "garbage")
        assertFalse(store.isDone(spec))
        store.markDone(spec); store.reset("notes")
        assertFalse(store.isDone(spec))
        assertTrue(OnboardingStore.isDone(3, 2))
        assertFalse(OnboardingStore.isDone(null, 1))
    }

    @Test fun serviceTracksDone() {
        val service = OnboardingService(spec, OnboardingStore(MemoryKeyValueStore()))
        assertFalse(service.done.value)
        service.markDone(); assertTrue(service.isDone())
        service.reset(); assertFalse(service.done.value)
    }

    @Test fun recoveryRules() {
        val all = grants(*spec.requests.toTypedArray())
        assertEquals(RecoveryState.Ok, RecoveryState.evaluate(spec, onboardingDone = false, grants = emptyMap()))
        assertEquals(RecoveryState.Ok, RecoveryState.evaluate(spec, true, all))
        // unknown heartbeat is not "stopped"
        assertEquals(RecoveryState.Ok, RecoveryState.evaluate(spec, true, all, mapOf(svc to null)))
        assertEquals(RecoveryState.Ok, RecoveryState.evaluate(spec, true, all, mapOf(svc to true)))

        val stopped = RecoveryState.evaluate(spec, true, all, mapOf(svc to false)) as RecoveryState.NeedsAttention
        assertEquals(listOf(RecoveryIssue(a11y, RecoveryReason.SERVICE_STOPPED)), stopped.issues)
        assertTrue(stopped.blocking); assertTrue(stopped.stopped)

        // optional revoked → warning only; required issues sorted first
        val mixed = RecoveryState.evaluate(spec, true, all - OnboardingRules.key(cam) - OnboardingRules.key(mic)) as RecoveryState.NeedsAttention
        assertEquals(listOf(mic, cam), mixed.issues.map { it.request })
        assertTrue(mixed.blocking)
        val soft = RecoveryState.evaluate(spec, true, all - OnboardingRules.key(battery)) as RecoveryState.NeedsAttention
        assertFalse(soft.blocking); assertFalse(soft.stopped)
        // revoked wins over a heartbeat
        val off = RecoveryState.evaluate(spec, true, all - OnboardingRules.key(a11y), mapOf(svc to false)) as RecoveryState.NeedsAttention
        assertEquals(RecoveryReason.REVOKED, off.issues.single().reason)
    }

    @Test fun heartbeat() {
        ServiceHeartbeat.forget(svc)
        assertNull(ServiceHeartbeat.isAlive(svc))
        ServiceHeartbeat.up(svc); assertEquals(true, ServiceHeartbeat.isAlive(svc))
        ServiceHeartbeat.down(svc); assertEquals(false, ServiceHeartbeat.isAlive(svc))
        ServiceHeartbeat.forget(svc)
    }

    @Test fun kindsAndVersion() {
        assertEquals(PermissionKind.OVERLAY, PermissionKind.of("overlay"))
        assertNull(PermissionKind.of("x"))
        assertEquals(HandOff.GUIDED_SETTINGS, PermissionKind.ACCESSIBILITY.handOff)
        assertEquals(1, OnboardingVersion.API_LEVEL)
        assertTrue(Regex("""\d+\.\d+\.\d+""").matches(OnboardingVersion.VERSION))
    }
}
