package ai.amberx.axf.accounts

import ai.amberx.axf.kernel.contract.SessionState
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Account interface: sign in / out through the registered providers (mock today), session state, and the role panel. */
@Composable
public fun AccountScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val session = remember(kernel) { kernel?.services?.get<AccountSession>() }
    if (kernel == null || session == null) { AxfEmptyState("Accounts unavailable", message = "AccountsModule is not installed."); return }
    val s by session.session.collectAsState()
    val providers = remember(kernel) { kernel.extensions.get(ExtensionPoints.AUTH_PROVIDERS).filterIsInstance<AuthProvider>() }
    var provider by remember { mutableStateOf(providers.firstOrNull()) }
    var identifier by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Account", eyebrow = s.state.name.lowercase().replace('_', ' '), description = if (s.state == SessionState.SIGNED_IN) "Signed in as ${s.principal.displayName ?: s.principal.id} via ${s.principal.provider}" else "Sign in with a registered provider. Real providers (email, OAuth, passkeys) replace the mock without changing this screen.") }
        if (s.state == SessionState.SIGNED_IN) item { AxfCard(title = "Session", icon = "user") { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AxfListItem(s.principal.displayName ?: s.principal.id, subtitle = s.principal.email ?: s.principal.id, icon = "user", trailing = { for (r in s.principal.roles) AxfBadge(r) })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AxfButton("Sign out", { scope.launch { session.signOut() } }, icon = "power"); AxfButton("Lock", { scope.launch { session.lock() } }, icon = "lock") }
        } } }
        else item { AxfCard(title = "Sign in", icon = "lock") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (p in providers) AxfChip(p.label, selected = p == provider, onClick = { provider = p }) }
            AxfTextField(identifier, { identifier = it }, Modifier.fillMaxWidth(), label = "Email or name", placeholder = "admin@example.com gets the admin role")
            AxfTextField(secret, { secret = it }, Modifier.fillMaxWidth(), label = "Password", secret = true)
            if (error != null) AxfText(error!!, color = Axf.colors.danger)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AxfButton("Sign in", { val p = provider ?: return@AxfButton; scope.launch { session.signIn(p, Credentials(AuthMethod.PASSWORD, identifier, secret)).onErr { error = it.message } } }, tone = ButtonTone.PRIMARY, icon = "check")
                AxfButton("Continue as guest", { val p = provider ?: return@AxfButton; scope.launch { session.signIn(p, Credentials(AuthMethod.GUEST)) } })
            }
        } } }
        if (s.state == SessionState.LOCKED) item { AxfCard(title = "Locked") { AxfButton("Unlock", { session.unlock() }, tone = ButtonTone.PRIMARY, icon = "unlock") } }
        item { AxfCard(title = "Not built yet", icon = "box") { Column { for (c in listOf("OAuth (Google, GitHub)", "Passkeys", "Biometric unlock", "Session list / revoke", "Two-factor (TOTP)", "Data export + account deletion", "Multi-account switch")) AxfListItem(c, icon = "alert", subtitle = "Declared capability — returns NotImplemented") } } }
        item { AxfListItem("Roles & permissions", subtitle = "Switch role, inspect UAC gating", icon = "shield", onClick = { kernel.runtime.navigate("roles") }) }
    }
}
