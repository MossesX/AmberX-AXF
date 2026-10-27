package ai.amberx.axf.onboarding

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfDivider
import ai.amberx.axf.ui.components.AxfHeading
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf

/*
 * Compose half of lib-onboarding. Tokens only (Axf.colors / space / shapes / type); every word comes from the spec's
 * OnboardingWording / RecoveryWording. Ported from ActiveX's OnboardingScreens.kt (welcome → permissions → accessibility
 * hand-off → battery + done, and the "service stopped" screen), generalised to any app's declared requests.
 */

// ------------------------------------------------------------------ live state

/**
 * Live grant map for [spec]: re-checked every time the app resumes (the user comes back from system settings) and
 * whenever [refresh] changes (bump it after a runtime-permission result).
 */
@Composable
public fun rememberGrants(spec: OnboardingSpec, refresh: Int = 0): Map<GrantKey, Boolean> {
    val ctx = LocalContext.current
    val checker = remember(ctx) { PermissionChecker(ctx) }
    var grants by remember(spec) { mutableStateOf(checker.snapshot(spec)) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, spec) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) grants = checker.snapshot(spec) }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(spec, refresh) { grants = checker.snapshot(spec) }
    return grants
}

/** Live [RecoveryState] for [spec] (grants re-checked on resume + [ServiceHeartbeat]). Ok until onboarding is done. */
@Composable
public fun rememberRecoveryState(spec: OnboardingSpec, onboardingDone: Boolean, refresh: Int = 0): RecoveryState {
    val grants = rememberGrants(spec, refresh)
    val alive by ServiceHeartbeat.alive.collectAsState()
    return RecoveryState.evaluate(spec, onboardingDone, grants, alive)
}

/**
 * Acts on one request: runtime dialog (falls back to the app's details page once Android stops showing the dialog),
 * or the request's settings page. Guided requests open settings directly here; the flow shows its guide first.
 */
public class PermissionActions internal constructor(
    private val context: Context,
    private val checker: PermissionChecker,
    private val launch: (Array<String>) -> Unit,
    private val deniedOnce: MutableSet<String>,
) {
    public fun request(request: PermissionRequest) {
        val permission = checker.runtimePermission(request.kind)
        if (request.kind.handOff == HandOff.RUNTIME_DIALOG) {
            if (permission == null) return
            val activity = context.findActivity()
            val blocked = permission in deniedOnce && activity != null && !ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)
            if (blocked) runCatching { context.startActivity(checker.appDetailsIntent()) } else launch(arrayOf(permission))
        } else {
            checker.openSettings(context, request)
        }
    }
}

/** [PermissionActions] bound to this composition; [onResult] runs after every runtime-permission result. */
@Composable
public fun rememberPermissionActions(onResult: () -> Unit): PermissionActions {
    val ctx = LocalContext.current
    val checker = remember(ctx) { PermissionChecker(ctx) }
    val denied = remember { mutableSetOf<String>() }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        results.forEach { (permission, ok) -> if (!ok) denied.add(permission) }
        onResult()
    }
    return remember(ctx, launcher) { PermissionActions(ctx, checker, { launcher.launch(it) }, denied) }
}

internal fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) { if (c is Activity) return c; c = c.baseContext }
    return null
}

// ------------------------------------------------------------------ the flow

/**
 * The first-run flow for [spec]: welcome/why → checklist (each row live, re-checked on resume) → guided accessibility
 * hand-off → battery + done. "Start" marks onboarding done in [service] (default: the registered `axf.onboarding`
 * service) and calls [onDone]. [onExit] = Back on the first screen (null = Back is left to the system).
 */
@Composable
public fun OnboardingFlow(
    spec: OnboardingSpec,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    service: OnboardingService? = null,
    onExit: (() -> Unit)? = null,
) {
    val registered = rememberService<OnboardingService>()
    val target = service ?: registered?.takeIf { it.spec.appId == spec.appId }
    var stepId by rememberSaveable(spec.appId) { mutableStateOf(OnboardingStep.Welcome.id) }
    var refresh by remember { mutableStateOf(0) }
    val step = OnboardingRules.stepOf(spec, stepId)
    val grants = rememberGrants(spec, refresh)
    val actions = rememberPermissionActions { refresh++ }
    val go: (OnboardingStep) -> Unit = { stepId = it.id }
    val back: (() -> Unit)? = OnboardingRules.back(spec, step)?.let { prev -> { go(prev) } } ?: onExit
    BackHandler(enabled = back != null) { back?.invoke() }

    Column(modifier.fillMaxSize().background(Axf.colors.bg)) {
        when (step) {
            OnboardingStep.Welcome -> WelcomeStep(spec) { OnboardingRules.next(spec, step)?.let(go) }
            OnboardingStep.Checklist -> ChecklistStep(spec, step, grants, back, onRow = { r ->
                val guide = OnboardingRules.guideFor(r)
                if (guide != null) go(guide) else actions.request(r)
            }) { OnboardingRules.next(spec, step)?.let(go) }
            is OnboardingStep.AccessibilityGuide -> GuideStepScreen(spec, step, grants, back) { OnboardingRules.next(spec, step)?.let(go) }
            OnboardingStep.Finish -> FinishStep(spec, step, grants, back, onBattery = { actions.request(it) }) {
                target?.markDone()
                onDone()
            }
        }
    }
}

/**
 * Convenience wrapper: shows [OnboardingFlow] until onboarding is done, then [content] with a [RecoveryBanner] above it,
 * and [RecoveryScreen] while a required request is broken (its Back drops to the banner until the next resume).
 * Uses [service] or the registered one; with neither, "done" lives only in memory (not persisted).
 */
@Composable
public fun OnboardingGate(
    spec: OnboardingSpec,
    modifier: Modifier = Modifier,
    service: OnboardingService? = null,
    recoveryWording: RecoveryWording = RecoveryWording(),
    content: @Composable () -> Unit,
) {
    val registered = rememberService<OnboardingService>()
    val svc = service ?: registered?.takeIf { it.spec.appId == spec.appId } ?: remember(spec) { OnboardingService(spec, OnboardingStore(MemoryKeyValueStore())) }
    val done by svc.done.collectAsState()
    if (!done) { OnboardingFlow(spec, onDone = {}, modifier = modifier, service = svc); return }
    var refresh by remember { mutableStateOf(0) }
    val state = rememberRecoveryState(spec, onboardingDone = true, refresh = refresh)
    var full by remember { mutableStateOf(true) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) full = true }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    if (state is RecoveryState.NeedsAttention && state.blocking && full) {
        RecoveryScreen(spec, state, modifier, recoveryWording, onBack = { full = false }, onRefresh = { refresh++ })
        return
    }
    Column(modifier.fillMaxSize()) {
        RecoveryBanner(state, recoveryWording, onFix = { full = true })
        Box(Modifier.weight(1f).fillMaxWidth()) { content() }
    }
}

// ------------------------------------------------------------------ steps

@Composable
private fun StepFrame(header: @Composable () -> Unit, footer: @Composable ColumnScope.() -> Unit, body: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize()) {
        header()
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two), content = body)
        Column(Modifier.fillMaxWidth().padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one), horizontalAlignment = Alignment.CenterHorizontally, content = footer)
    }
}

@Composable
private fun StepHeader(spec: OnboardingSpec, step: OnboardingStep, title: String, back: (() -> Unit)?) {
    val pos = OnboardingRules.position(spec, step)
    val total = OnboardingRules.steps(spec).size
    Column(Modifier.fillMaxWidth().padding(horizontal = Axf.space.two, vertical = Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            if (back != null) AxfIconButton("arrow-left", "Back", back)
            AxfHeading(title, Modifier.weight(1f), level = 2)
            AxfText(OnboardingRules.progressLabel(spec, step), muted = true, style = Axf.type.labelMedium)
        }
        LinearProgressIndicator(
            progress = { if (total == 0) 0f else pos / total.toFloat() },
            modifier = Modifier.fillMaxWidth(),
            color = Axf.colors.accent,
            trackColor = Axf.colors.surface3,
        )
    }
}

@Composable
private fun WelcomeStep(spec: OnboardingSpec, onStart: () -> Unit) {
    val w = spec.wording
    StepFrame(header = { Spacer(Modifier.padding(top = Axf.space.four)) }, footer = {
        AxfButton(w.startLabel, onStart, Modifier.fillMaxWidth(), tone = ButtonTone.PRIMARY, icon = "arrow-right")
        AxfText(w.startHint, muted = true, style = Axf.type.bodySmall)
    }) {
        AxfPageHead(w.headline, eyebrow = spec.appName, description = w.intro)
        spec.requests.forEach { r -> WhyRow(r.kind.icon, r.label, r.why) }
    }
}

@Composable
private fun WhyRow(icon: String, title: String, detail: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.oneHalf), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(Axf.space.touchTarget).background(Axf.colors.accentSoft, Axf.shapes.mdShape), contentAlignment = Alignment.Center) {
            AxfIcon(icon, tint = Axf.colors.accent, size = Axf.space.iconSize)
        }
        Column(Modifier.weight(1f)) {
            AxfText(title, style = Axf.type.titleSmall)
            AxfText(detail, muted = true, style = Axf.type.bodySmall)
        }
    }
}

@Composable
private fun ChecklistStep(spec: OnboardingSpec, step: OnboardingStep, grants: Map<GrantKey, Boolean>, back: (() -> Unit)?, onRow: (PermissionRequest) -> Unit, onContinue: () -> Unit) {
    val w = spec.wording
    StepFrame(header = { StepHeader(spec, step, w.checklistTitle, back) }, footer = {
        AxfButton(w.continueLabel, onContinue, Modifier.fillMaxWidth(), tone = ButtonTone.PRIMARY, enabled = OnboardingRules.canContinue(spec, grants))
        if (spec.checklist.any { !it.required }) AxfText(w.skipHint, muted = true, style = Axf.type.bodySmall)
    }) {
        AxfText(w.checklistIntro, muted = true)
        OnboardingRules.rows(spec, grants).forEach { row -> ChecklistRowView(spec, row) { onRow(row.request) } }
        w.checklistNote?.let { note ->
            Row(Modifier.fillMaxWidth().background(Axf.colors.infoSoft, Axf.shapes.mdShape).padding(Axf.space.oneHalf), horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfIcon("info", tint = Axf.colors.info, size = Axf.space.iconSize)
                AxfText(note, muted = true, style = Axf.type.bodySmall)
            }
        }
    }
}

@Composable
private fun ChecklistRowView(spec: OnboardingSpec, row: ChecklistRow, onClick: () -> Unit) {
    val w = spec.wording
    val c = Axf.colors
    val shape = Axf.shapes.lgShape
    val highlight = row.active && !row.granted
    val sub = if (row.granted) w.grantedLabel else row.request.why
    Row(
        Modifier.fillMaxWidth()
            .background(c.surface, shape)
            .then(if (highlight) Modifier.border(Axf.space.borderWidth, c.accent, shape) else Modifier)
            .then(if (!row.active && !row.granted) Modifier.alpha(DISABLED_ALPHA) else Modifier)
            .padding(Axf.space.two),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Axf.space.oneHalf),
    ) {
        val (fg, bg) = when {
            row.granted -> c.success to c.successSoft
            row.active -> c.accent to c.accentSoft
            else -> c.muted to c.surface2
        }
        Box(Modifier.size(Axf.space.three).background(bg, Axf.shapes.full), contentAlignment = Alignment.Center) {
            if (row.granted) AxfIcon("check", tint = fg, size = Axf.space.two) else AxfText("${row.number}", color = fg, style = Axf.type.labelMedium)
        }
        Column(Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalAlignment = Alignment.CenterVertically) {
                AxfText(row.request.label, style = Axf.type.titleSmall)
                if (!row.request.required) AxfBadge("optional", tone = "info")
            }
            AxfText(sub, muted = true, style = Axf.type.bodySmall)
        }
        if (row.granted) AxfBadge(w.grantedLabel, tone = "success")
        else AxfButton(if (row.request.kind.handOff == HandOff.GUIDED_SETTINGS) w.enableLabel else w.allowLabel, onClick, tone = ButtonTone.PRIMARY, enabled = row.active)
    }
}

@Composable
private fun GuideStepScreen(spec: OnboardingSpec, step: OnboardingStep.AccessibilityGuide, grants: Map<GrantKey, Boolean>, back: (() -> Unit)?, onEnabled: () -> Unit) {
    val w = spec.wording
    val ctx = LocalContext.current
    val checker = remember(ctx) { PermissionChecker(ctx) }
    val on = OnboardingRules.granted(step.request, grants)
    LaunchedEffect(on) { if (on) onEnabled() }
    StepFrame(header = { StepHeader(spec, step, w.guideTitle, back) }, footer = {
        StatusLine(on, if (on) w.grantedLabel else w.enableLabel)
        AxfButton(w.openSettingsLabel, { checker.openSettings(ctx, step.request) }, Modifier.fillMaxWidth(), tone = ButtonTone.PRIMARY, icon = "external")
    }) {
        AxfText(w.guideIntro, muted = true)
        (w.guide ?: OnboardingRules.defaultGuide(spec.appName)).forEachIndexed { i, g -> NumberedLine(i + 1, g) }
    }
}

@Composable
private fun FinishStep(spec: OnboardingSpec, step: OnboardingStep, grants: Map<GrantKey, Boolean>, back: (() -> Unit)?, onBattery: (PermissionRequest) -> Unit, onStart: () -> Unit) {
    val w = spec.wording
    val missing = OnboardingRules.missing(spec, grants)
    StepFrame(header = { StepHeader(spec, step, w.finishTitle, back) }, footer = {
        if (missing.isNotEmpty()) AxfText(missing.joinToString(" · ") { it.label }, color = Axf.colors.warning, style = Axf.type.bodySmall)
        AxfButton(w.finishLabel, onStart, Modifier.fillMaxWidth(), tone = ButtonTone.PRIMARY, enabled = missing.isEmpty(), icon = "check")
    }) {
        spec.battery?.let { b ->
            val exempt = OnboardingRules.granted(b, grants)
            AxfCard(Modifier.fillMaxWidth(), title = b.label, icon = b.kind.icon) {
                AxfText(b.why, muted = true)
                AxfText(w.batteryDetail, muted = true, style = Axf.type.bodySmall)
                if (exempt) AxfBadge(w.grantedLabel, tone = "success") else AxfButton(w.allowLabel, { onBattery(b) }, tone = ButtonTone.PRIMARY)
            }
        }
        Column(Modifier.fillMaxWidth().padding(top = Axf.space.three), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            Box(Modifier.size(Axf.space.x(8)).background(Axf.colors.successSoft, Axf.shapes.full), contentAlignment = Alignment.Center) {
                AxfIcon("check", tint = Axf.colors.success, size = Axf.space.four)
            }
            AxfHeading(w.doneTitle, level = 1)
            AxfText(w.doneMessage, muted = true)
        }
    }
}

@Composable
private fun NumberedLine(n: Int, g: GuideStep) {
    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        Box(Modifier.size(Axf.space.three).background(Axf.colors.accentSoft, Axf.shapes.full), contentAlignment = Alignment.Center) {
            AxfText("$n", color = Axf.colors.accent, style = Axf.type.labelMedium)
        }
        Column(Modifier.weight(1f)) {
            AxfText(g.title, style = Axf.type.titleSmall)
            AxfText(g.detail, muted = true, style = Axf.type.bodySmall)
        }
    }
}

@Composable
private fun StatusLine(ok: Boolean, text: String) {
    Row(Modifier.fillMaxWidth().background(Axf.colors.surface, Axf.shapes.mdShape).padding(Axf.space.oneHalf), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        Box(Modifier.size(Axf.space.one).background(if (ok) Axf.colors.success else Axf.colors.danger, Axf.shapes.full))
        AxfText(text, style = Axf.type.labelLarge)
    }
}

// ------------------------------------------------------------------ recovery

/** A one-line banner while anything needs fixing (nothing when [state] is Ok). [onFix] usually opens [RecoveryScreen]. */
@Composable
public fun RecoveryBanner(state: RecoveryState, wording: RecoveryWording = RecoveryWording(), onFix: () -> Unit, modifier: Modifier = Modifier) {
    if (state !is RecoveryState.NeedsAttention) return
    val tone = if (state.blocking) "danger" else "warning"
    val c = Axf.colors
    Row(
        modifier.fillMaxWidth().background(c.toneSoft(tone)).padding(horizontal = Axf.space.two, vertical = Axf.space.one),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one),
    ) {
        AxfIcon("alert", tint = c.tone(tone), size = Axf.space.iconSize)
        AxfText(if (state.stopped) wording.bannerStopped else wording.bannerRevoked, Modifier.weight(1f), style = Axf.type.labelLarge, color = c.tone(tone))
        AxfButton(wording.fixLabel, onFix, tone = if (state.blocking) ButtonTone.PRIMARY else ButtonTone.NEUTRAL)
    }
}

/**
 * Full error/recovery screen (ported "service stopped" screen): what broke, a fix button for the first issue, the live
 * status of every request, likely causes, and the battery fix when the app asks for it. Works for [RecoveryState.Ok]
 * too (status only), so it doubles as the Settings → Setup status page.
 */
@Composable
public fun RecoveryScreen(
    spec: OnboardingSpec,
    state: RecoveryState,
    modifier: Modifier = Modifier,
    wording: RecoveryWording = RecoveryWording(),
    onBack: (() -> Unit)? = null,
    onRefresh: () -> Unit = {},
) {
    val ctx = LocalContext.current
    val checker = remember(ctx) { PermissionChecker(ctx) }
    var tick by remember { mutableStateOf(0) }
    val actions = rememberPermissionActions { tick++; onRefresh() }
    val grants = rememberGrants(spec, tick)
    val alive by ServiceHeartbeat.alive.collectAsState()
    val issues = (state as? RecoveryState.NeedsAttention)?.issues.orEmpty()
    val fix: (PermissionRequest) -> Unit = { r -> if (r.kind.handOff == HandOff.RUNTIME_DIALOG) actions.request(r) else checker.openSettings(ctx, r) }
    if (onBack != null) BackHandler { onBack() }
    Column(modifier.fillMaxSize().background(Axf.colors.bg)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Axf.space.two, vertical = Axf.space.one), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            if (onBack != null) AxfIconButton("arrow-left", "Back", onBack)
            AxfHeading(spec.appName, Modifier.weight(1f), level = 2)
            when {
                state is RecoveryState.NeedsAttention && state.stopped -> AxfBadge(wording.stoppedLabel.uppercase(), tone = "danger")
                state is RecoveryState.NeedsAttention -> AxfBadge(wording.offLabel.uppercase(), tone = if (state.blocking) "danger" else "warning")
                else -> AxfBadge(wording.onLabel.uppercase(), tone = "success")
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
            issues.firstOrNull()?.let { first ->
                val c = Axf.colors
                Column(
                    Modifier.fillMaxWidth().background(c.surface, Axf.shapes.lgShape).border(Axf.space.borderWidth, if (first.blocking) c.danger else c.warning, Axf.shapes.lgShape).padding(Axf.space.two),
                    verticalArrangement = Arrangement.spacedBy(Axf.space.one),
                ) {
                    AxfHeading(wording.screenTitle, level = 3)
                    AxfText(wording.screenMessage, muted = true)
                    AxfButton("${wording.fixLabel}: ${first.request.label}", { fix(first.request) }, Modifier.fillMaxWidth(), tone = ButtonTone.PRIMARY, icon = "external")
                }
            }
            AxfCard(Modifier.fillMaxWidth(), title = wording.statusTitle, icon = "check-circle") {
                spec.requests.forEachIndexed { i, r ->
                    if (i > 0) AxfDivider()
                    val granted = OnboardingRules.granted(r, grants)
                    val stopped = granted && r.kind == PermissionKind.ACCESSIBILITY && r.serviceClass?.let { alive[it] } == false
                    val (label, color) = when {
                        stopped -> wording.stoppedLabel to Axf.colors.danger
                        granted -> wording.onLabel to Axf.colors.success
                        r.required -> wording.offLabel to Axf.colors.danger
                        else -> wording.offLabel to Axf.colors.warning
                    }
                    StatusRow(r, label, color, showFix = !granted || stopped) { fix(r) }
                }
            }
            if (issues.isNotEmpty()) {
                AxfHeading(wording.causesTitle, level = 3)
                wording.causes.forEachIndexed { i, g -> NumberedLine(i + 1, g) }
            }
        }
        spec.battery?.takeIf { !OnboardingRules.granted(it, grants) && issues.isNotEmpty() }?.let { b ->
            Box(Modifier.fillMaxWidth().padding(Axf.space.two)) {
                AxfButton(wording.batteryFixLabel, { checker.openSettings(ctx, b) }, Modifier.fillMaxWidth(), tone = ButtonTone.NEUTRAL, icon = b.kind.icon)
            }
        }
    }
}

@Composable
private fun StatusRow(r: PermissionRequest, label: String, color: Color, showFix: Boolean, onFix: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = Axf.space.half), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfIcon(r.kind.icon, tint = Axf.colors.muted, size = Axf.space.iconSize)
        AxfText(r.label, Modifier.weight(1f))
        AxfText(label, color = color, style = Axf.type.labelLarge)
        if (showFix) AxfIconButton("external", r.label, onFix)
    }
}

/** Route `onboarding-status` (registered by [OnboardingModule]): live status of every request + "Run setup again". */
@Composable
public fun OnboardingStatusScreen(modifier: Modifier = Modifier) {
    val service = rememberService<OnboardingService>() ?: return
    val done by service.done.collectAsState()
    var refresh by remember { mutableStateOf(0) }
    val state = rememberRecoveryState(service.spec, onboardingDone = true, refresh = refresh)
    Column(modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) { RecoveryScreen(service.spec, state, onRefresh = { refresh++ }) }
        if (done) Box(Modifier.fillMaxWidth().padding(Axf.space.two)) {
            AxfButton(RUN_AGAIN, { service.reset() }, Modifier.fillMaxWidth(), tone = ButtonTone.GHOST, icon = "refresh")
        }
    }
}

internal const val RUN_AGAIN: String = "Run setup again"
private const val DISABLED_ALPHA: Float = 0.55f
