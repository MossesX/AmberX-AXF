package ai.amberx.axf.voicevault.views

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.LifecycleResumeEffect
import ai.amberx.axf.lock.PinPrompt
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfHeading
import ai.amberx.axf.ui.components.AxfLoadingState
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voicevault.vault.BrokenReason
import ai.amberx.axf.voicevault.vault.Cmd
import ai.amberx.axf.voicevault.vault.isUnlocked
import ai.amberx.axf.voicevault.vault.Stage
import ai.amberx.axf.voicevault.vault.VaultSession
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.LocalContext
import ai.amberx.axf.voicevault.background.WakeDelivery
import ai.amberx.axf.voicevault.background.WakeListener
import ai.amberx.axf.voicevault.background.WakeState
import ai.amberx.axf.voicevault.voice.VoiceControl

/** The Voice screen: banner on top when a password is ready to copy, the mic, and the current step. */
@Composable
fun HomeView() {
    val session = rememberService<VaultSession>() ?: run { AxfEmptyState("Vault unavailable", icon = "lock"); return }
    val voice = rememberService<AxfVoice>()
    val stage by session.stage.collectAsState()
    val note by session.note.collectAsState()
    LifecycleResumeEffect(session) {
        session.onScreenVisible(true)
        onPauseOrDispose { session.onScreenVisible(false) }
    }
    Column(Modifier.fillMaxSize()) {
        CopyBanner(session, stage)
        Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two), horizontalAlignment = Alignment.CenterHorizontally) {
            MicHeader(session, voice, stage)
            MicSwitch()
            NoteLine(note)
            ListeningFor(session, stage)
            StageBody(session, voice, stage)
            HowItWorks(session)
        }
    }
}

/** Banner at the top of the screen with the site name: Confirm copies its password, Cancel backs out. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CopyBanner(session: VaultSession, stage: Stage) {
    val c = Axf.colors
    val shape = RoundedCornerShape(bottomStart = Axf.shapes.lg, bottomEnd = Axf.shapes.lg)
    AnimatedVisibility(stage is Stage.Confirm || stage is Stage.Choose, enter = expandVertically(), exit = shrinkVertically()) {
        Column(Modifier.fillMaxWidth().background(c.accent, shape).padding(horizontal = Axf.space.two, vertical = Axf.space.oneHalf), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            when (stage) {
                is Stage.Confirm -> {
                    AxfText("Copy password for", color = c.accentText, style = Axf.type.labelMedium)
                    AxfText(stage.entry.site, color = c.accentText, style = Axf.type.headlineSmall, maxLines = 2)
                    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                        AxfButton("Confirm", { session.confirm() }, icon = "copy")
                        AxfButton("Cancel", { session.cancel() }, tone = ButtonTone.GHOST, icon = "x")
                    }
                }
                is Stage.Choose -> {
                    AxfText("Which site? (heard “${stage.heard}”)", color = c.accentText, style = Axf.type.labelMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                        stage.matches.forEach { e -> AxfChip(e.site, icon = "lock", onClick = { session.pick(e) }) }
                    }
                    AxfButton("Cancel", { session.cancel() }, tone = ButtonTone.GHOST, icon = "x")
                }
                else -> {}
            }
        }
    }
}

@Composable
private fun MicHeader(session: VaultSession, voice: AxfVoice?, stage: Stage) {
    val listening by session.listening.collectAsState()
    val hearing by (voice?.input?.listening ?: remember { kotlinx.coroutines.flow.MutableStateFlow(false) }).collectAsState()
    val level by (voice?.input?.level ?: remember { kotlinx.coroutines.flow.MutableStateFlow(0f) }).collectAsState()
    val c = Axf.colors
    val canListen = voice != null && (stage == Stage.Locked || stage.isUnlocked()) && stage !is Stage.Editing
    val ring = Axf.space.borderWidth * (1f + level * 6f)
    Box(
        Modifier.size(Axf.space.touchTarget * 2.4f).background(if (listening) c.accentSoft else c.surface2, CircleShape)
            .border(ring, if (hearing) c.accent else c.border, CircleShape)
            .clickable(enabled = canListen) { session.touch(); session.toggleListening() }
            .semantics { contentDescription = if (listening) "Stop listening" else "Start listening" },
        contentAlignment = Alignment.Center,
    ) { AxfIcon(if (stage.isUnlocked()) "unlock" else if (listening) "mic" else "lock", size = Axf.space.touchTarget, tint = if (listening) c.accent else c.muted) }
    AxfHeading(title(stage), level = 2)
    AxfText(subtitle(stage, listening, hearing), muted = true, style = Axf.type.bodyMedium.copy(textAlign = TextAlign.Center))
    LiveTranscript(session)
}

/** The master microphone switch (this phone only): off = Voice Vault doesn't listen at all, here or in the background. */
@Composable
private fun MicSwitch() {
    val control = rememberService<VoiceControl>() ?: return
    val off by control.micOff.collectAsState()
    val runtime = LocalAxfRuntime.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfSwitch(!off, { control.setMicOff(!it) }, Modifier.weight(1f), label = "Microphone",
            description = if (off) "Off: nothing listens, not here and not in the background." else "On: listens here, and in the background for your triggers.")
        AxfButton("Voice actions", { runtime.navigate(VoiceControl.ROUTE) }, tone = ButtonTone.GHOST, icon = "mic")
    }
}

/** What's being said, live, in plain text (Settings → Show what you say; on by default). */
@Composable
private fun LiveTranscript(session: VaultSession) {
    val heard by session.heard.collectAsState()
    if (heard.isEmpty()) return
    val shown = if (session.showSpeech) heard else "•".repeat(heard.length)
    AxfCard(Modifier.fillMaxWidth()) {
        AxfText("Hearing", muted = true, style = Axf.type.labelMedium)
        AxfText(shown, style = Axf.type.code.copy(textAlign = TextAlign.Center), modifier = Modifier.fillMaxWidth())
    }
}

private fun title(stage: Stage): String = when (stage) {
    Stage.Starting -> "Starting…"
    Stage.Setup -> "Set your unlock code"
    Stage.Locked -> "Locked"
    Stage.Verifying -> "Checking…"
    is Stage.PinEntry -> "Enter your PIN"
    Stage.Ready -> "Unlocked"
    is Stage.AskSite -> if (stage.forStore) "Which site?" else "Which site to retrieve?"
    is Stage.AskPassword -> "Password for ${stage.site}"
    is Stage.Editing -> if (stage.replacing != null) "Update ${stage.replacing.site}" else "Check and save"
    is Stage.Confirm -> "Copy password?"
    is Stage.Choose -> "Pick a site"
    is Stage.Broken -> "Vault can't be opened"
}

private fun subtitle(stage: Stage, listening: Boolean, hearing: Boolean): String {
    val mic = when { hearing -> "Listening…"; listening -> "Getting ready…"; else -> "Tap the mic to talk." }
    return when (stage) {
        Stage.Setup -> "Choose a phrase you'll say to open the vault."
        Stage.Locked -> "Say your unlock code. $mic"
        Stage.Ready -> "Say a trigger or tap below. $mic"
        is Stage.AskSite, is Stage.AskPassword, is Stage.Confirm, is Stage.Choose -> mic
        is Stage.Editing -> "Edit anything that was misheard, then tap Save."
        else -> ""
    }
}

@Composable
private fun StageBody(session: VaultSession, voice: AxfVoice?, stage: Stage) {
    val runtime = LocalAxfRuntime.current
    when (stage) {
        Stage.Starting -> AxfLoadingState("Starting…")
        Stage.Setup -> UnlockCodeEditor(session, voice, setup = true)
        Stage.Locked -> { TypedCodeFallback(session); ForgotCode(session) }
        Stage.Verifying -> AxfLoadingState("Checking…")
        is Stage.PinEntry -> PinPrompt("Enter your PIN", stage.previous, onSubmit = { session.submitPin(it) }, onCancel = { session.submitPin(null) })
        Stage.Ready -> {
            if (voice == null) AxfText("Voice isn't available; use the buttons.", muted = true)
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Store", { session.startStore() }, tone = ButtonTone.PRIMARY, icon = "plus")
                AxfButton("Retrieve", { session.startRetrieve() }, icon = "search")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Saved sites", { runtime.navigate("vault") }, tone = ButtonTone.GHOST, icon = "list")
                AxfButton("Lock", { session.lock(clearClipboard = true) }, tone = ButtonTone.GHOST, icon = "lock")
            }
        }
        is Stage.AskSite -> Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            if (stage.forStore) AxfButton("Type instead", { session.editNew() }, icon = "edit")
            AxfButton("Cancel", { session.cancel() }, tone = ButtonTone.GHOST, icon = "x")
        }
        is Stage.AskPassword -> Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Type instead", { session.editNew(stage.site) }, icon = "edit")
            AxfButton("Cancel", { session.cancel() }, tone = ButtonTone.GHOST, icon = "x")
        }
        is Stage.Editing -> EditForm(session, stage)
        is Stage.Confirm, is Stage.Choose -> AxfText("Say confirm or cancel, or use the banner above.", muted = true)
        is Stage.Broken -> BrokenVault(session, stage.reason)
    }
}

@Composable
private fun EditForm(session: VaultSession, stage: Stage.Editing) {
    var site by remember(stage) { mutableStateOf(stage.site) }
    var password by remember(stage) { mutableStateOf(stage.password) }
    var show by remember(stage) { mutableStateOf(session.showSpeech) }
    var error by remember(stage) { mutableStateOf<String?>(null) }
    AxfCard(Modifier.fillMaxWidth(), title = if (stage.replacing != null) "Update saved password" else "New password", icon = "lock") {
        AxfTextField(site, { site = it; error = null }, Modifier.fillMaxWidth(), label = "Site", leadingIcon = "link")
        AxfTextField(password, { password = it; error = null }, Modifier.fillMaxWidth(), label = "Password", leadingIcon = "lock", secret = !show, monospace = show)
        AxfSwitch(show, { show = it }, label = "Show password")
        error?.let { AxfText(it, color = Axf.colors.danger) }
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Save", { error = session.save(site, password, stage.replacing?.id) }, tone = ButtonTone.PRIMARY, icon = "save")
            AxfButton("Cancel", { session.cancel() }, tone = ButtonTone.GHOST, icon = "x")
        }
    }
}

@Composable
private fun TypedCodeFallback(session: VaultSession) {
    var open by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    if (!open) { AxfButton("Type the code instead", { open = true }, tone = ButtonTone.GHOST, icon = "keyboard"); return }
    AxfCard(Modifier.fillMaxWidth(), title = "Type your unlock code", icon = "keyboard") {
        AxfTextField(code, { code = it }, Modifier.fillMaxWidth(), label = "Unlock code", secret = true)
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Unlock", { session.unlockTyped(code); code = "" }, tone = ButtonTone.PRIMARY, icon = "unlock", enabled = code.isNotBlank())
            AxfButton("Close", { open = false; code = "" }, tone = ButtonTone.GHOST, icon = "x")
        }
    }
}

@Composable
private fun BrokenVault(session: VaultSession, reason: BrokenReason) {
    var sure by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val (title, text) = when (reason) {
        BrokenReason.VAULT_UNREADABLE -> "The vault file can't be decrypted" to "The phone's secure key was reset (for example after clearing app storage or restoring to a new phone). The saved passwords can't be recovered."
        BrokenReason.CODE_MISSING -> "The unlock code is missing" to "A vault exists but its unlock code is gone, so it can't be opened. For safety a new code can't be set for an old vault; erasing starts over."
        BrokenReason.STORAGE_ERROR -> "Secure storage couldn't be read" to "Try again. If it keeps failing, erasing starts over with an empty vault."
    }
    AxfCard(Modifier.fillMaxWidth(), title = title, icon = "alert") {
        AxfText(text, muted = true)
        if (reason == BrokenReason.STORAGE_ERROR) AxfButton("Try again", { scope.launch { session.refreshStart() } }, tone = ButtonTone.PRIMARY, icon = "refresh")
        if (!sure) AxfButton("Erase and start over", { sure = true }, tone = ButtonTone.DANGER, icon = "trash")
        else Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Yes, erase everything", { session.erase(alsoCode = true) }, tone = ButtonTone.DANGER, icon = "trash")
            AxfButton("Keep it", { sure = false }, tone = ButtonTone.GHOST, icon = "x")
        }
    }
}

/** Forgot the code (or locked out of the second step): erase everything and start over. Reveals nothing. */
@Composable
private fun ForgotCode(session: VaultSession) {
    var step by remember { mutableStateOf(0) }
    when (step) {
        0 -> AxfButton("Forgot the code?", { step = 1 }, tone = ButtonTone.GHOST, icon = "help")
        else -> AxfCard(Modifier.fillMaxWidth(), title = "Erase and start over?", icon = "alert") {
            AxfText("The vault can only be opened with your code (and second step). Erasing deletes every saved password for good.", muted = true)
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Erase everything", { session.erase(alsoCode = true); step = 0 }, tone = ButtonTone.DANGER, icon = "trash")
                AxfButton("Cancel", { step = 0 }, tone = ButtonTone.GHOST, icon = "x")
            }
        }
    }
}


/** Exactly what Voice Vault is listening for right now: each thing you can say, with every phrase that works. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ListeningFor(session: VaultSession, stage: Stage) {
    val items = session.listeningFor(stage)
    if (items.isEmpty()) return
    AxfCard(Modifier.fillMaxWidth(), title = "You can say", icon = "mic") {
        items.forEach { item ->
            Column(verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                AxfText(item.label, style = Axf.type.labelLarge)
                if (item.phrases.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                    item.phrases.forEach { AxfChip("“$it”") }
                }
                item.note?.let { AxfText(it, muted = true, style = Axf.type.bodySmall) }
            }
        }
        AxfText("Change any of these in Settings → Global trigger and commands.", muted = true, style = Axf.type.bodySmall)
    }
}

/** How it's working: the background listener, what happens when it hears the trigger, and anything Android is blocking. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HowItWorks(session: VaultSession) {
    val ctx = LocalContext.current
    val wake by WakeListener.state.collectAsState()
    val runtime = LocalAxfRuntime.current
    val phrases = session.wakePhrases()
    AxfCard(Modifier.fillMaxWidth(), title = "In the background", icon = "bell") {
        val (line, tone) = when (val w = wake) {
            is WakeState.Listening -> "Listening for your global trigger${if (w.phrases.size > phrases.size) " and voice notes" else ""}." to null
            WakeState.TakingNote -> "Taking a voice note." to null
            WakeState.PausedInApp -> "Paused while the app is open. Close it or turn off the screen and it listens for your global trigger." to null
            is WakeState.Heard -> "Heard your trigger and opened the app." to null
            is WakeState.Quiet -> "Quiet hours: not listening until ${w.until}." to null
            is WakeState.Off -> w.why to Axf.colors.warning
        }
        AxfText(line, color = tone ?: androidx.compose.ui.graphics.Color.Unspecified)
        if (phrases.isNotEmpty()) {
            AxfText("Global trigger", style = Axf.type.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) { phrases.forEach { AxfChip("“$it”", icon = "mic") } }
        }
        AxfText("In the background it only listens for these words. Nothing else it hears is kept or acted on, and it never goes online.", muted = true, style = Axf.type.bodySmall)
        when (WakeListener.delivery(ctx)) {
            WakeDelivery.POPS_OPEN -> AxfText("When it hears one, Voice Vault pops open at the unlock step.", muted = true, style = Axf.type.bodySmall)
            WakeDelivery.FULL_SCREEN -> {
                AxfText("When it hears one, it opens full screen if the phone is locked, otherwise it shows an alert. Allow it to pop open over other apps:", muted = true, style = Axf.type.bodySmall)
                AxfButton("Let it pop open", { WakeListener.openPopupSettings(ctx) }, icon = "external")
            }
            WakeDelivery.TAP_ALERT -> {
                AxfText("Right now Android only lets it show an alert you tap. Allow either of these so it opens by itself:", muted = true, style = Axf.type.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                    AxfButton("Let it pop open", { WakeListener.openPopupSettings(ctx) }, icon = "external")
                    AxfButton("Full-screen alerts", { WakeListener.openFullScreenSettings(ctx) }, icon = "bell")
                }
            }
            WakeDelivery.BLOCKED -> {
                AxfText("Notifications are off, so a heard trigger can't reach you. Allow notifications, or let it pop open:", color = Axf.colors.warning, style = Axf.type.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                    AxfButton("Allow notifications", { WakeListener.openNotificationSettings(ctx) }, icon = "bell")
                    AxfButton("Let it pop open", { WakeListener.openPopupSettings(ctx) }, icon = "external")
                }
            }
        }
        AxfButton("Background settings", { runtime.dispatch("settings.open:voicevault") }, tone = ButtonTone.GHOST, icon = "settings")
    }
}
