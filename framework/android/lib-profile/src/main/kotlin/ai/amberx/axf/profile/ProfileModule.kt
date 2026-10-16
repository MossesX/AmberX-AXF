package ai.amberx.axf.profile

import ai.amberx.axf.kernel.asset.parseJsonObjectOf
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SessionProvider
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonPrimitive

/* User profile interface — PLACEHOLDER MODULE: contracts + a local store; sync/avatar capture/public profile are declared capabilities. */

public data class UserProfile(val displayName: String = "", val bio: String = "", val avatar: String? = null, val contact: String = "", val privacy: String = "private", val fields: Map<String, String> = emptyMap()) {
    public fun toJson(): String = kotlinx.serialization.json.buildJsonObject { put("displayName", JsonPrimitive(displayName)); put("bio", JsonPrimitive(bio)); avatar?.let { put("avatar", JsonPrimitive(it)) }; put("contact", JsonPrimitive(contact)); put("privacy", JsonPrimitive(privacy)); put("fields", kotlinx.serialization.json.JsonObject(fields.mapValues { JsonPrimitive(it.value) })) }.toString()
    public companion object {
        public fun fromJson(text: String?): UserProfile = text?.let { parseJsonObjectOf(it) }?.let { o -> UserProfile(ai.amberx.axf.kernel.asset.strOrNull(o, "displayName") ?: "", ai.amberx.axf.kernel.asset.strOrNull(o, "bio") ?: "", ai.amberx.axf.kernel.asset.strOrNull(o, "avatar"), ai.amberx.axf.kernel.asset.strOrNull(o, "contact") ?: "", ai.amberx.axf.kernel.asset.strOrNull(o, "privacy") ?: "private", ai.amberx.axf.kernel.asset.strMap(o, "fields")) } ?: UserProfile()
    }
}

/** Profile operations. Local get/set work today; the rest return NotImplemented. */
public interface ProfileService {
    public val profile: StateFlow<UserProfile>
    public suspend fun update(p: UserProfile): AxfResult<Unit>
    public suspend fun sync(): AxfResult<Unit>
    public suspend fun captureAvatar(): AxfResult<String>
    public suspend fun publicLink(): AxfResult<String>
}

public class LocalProfileService(private val kv: KeyValueStore?, private val session: SessionProvider?) : ProfileService {
    private fun key() = "axf.profile." + (session?.current?.principal?.id ?: "anonymous")
    private val flow = MutableStateFlow(UserProfile.fromJson(kv?.get(key())))
    override val profile: StateFlow<UserProfile> get() = flow
    override suspend fun update(p: UserProfile): AxfResult<Unit> { flow.value = p; kv?.put(key(), p.toJson()); return AxfResult.ok(Unit) }
    override suspend fun sync(): AxfResult<Unit> = AxfResult.err(AxfFailure.NotImplemented("axf.profile.sync"))
    override suspend fun captureAvatar(): AxfResult<String> = AxfResult.err(AxfFailure.NotImplemented("axf.profile.avatar"))
    override suspend fun publicLink(): AxfResult<String> = AxfResult.err(AxfFailure.NotImplemented("axf.profile.public"))
}

public class ProfileModule : PlaceholderModule(ID, "Profile", listOf(Capability("axf.profile", "User profile interface"), Capability("axf.profile.sync"), Capability("axf.profile.avatar"), Capability("axf.profile.public"), Capability("axf.profile.activity"))) {
    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        ctx.services.register(ProfileService::class, LocalProfileService(ctx.service(KeyValueStore::class), ctx.service(SessionProvider::class)), "axf.profile")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("profile", "Profile", icon = "user", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("account.profile", ActionMeta("Profile", module = id)) { _, _ -> runtime?.navigate("profile") })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("profile", "Profile", "user", id, order = 110, settings = listOf(
            SettingSpec("axf.profile.open", "Edit profile", SettingKind.LINK, target = "profile", icon = "user"),
            SettingSpec("axf.profile.privacy", "Profile visibility", SettingKind.CHOICE, default = JsonPrimitive("private"), options = listOf("private" to "Private", "contacts" to "Contacts", "public" to "Public")),
        ))))
    }
    public companion object { public const val ID: String = "ai.amberx.axf.profile" }
}
