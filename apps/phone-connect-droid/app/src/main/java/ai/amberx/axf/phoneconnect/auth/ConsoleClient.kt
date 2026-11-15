package ai.amberx.axf.phoneconnect.auth

import org.json.JSONObject

/** Phone Connect's console routes (/api/plugins/phone-connect/…) with the phone's hub session, through the hub's wall. */
class ConsoleClient(private val session: Session) {
    private fun url(path: String) = "${HubRules.CONSOLE}/api/plugins/phone-connect/${path.trimStart('/')}"
    private fun cookie() = session.cookie(HubRules.CONSOLE) ?: session.cookie()

    fun get(path: String): HubRules.Reply = HubRules.request("GET", url(path), cookie())
    fun post(path: String, body: JSONObject = JSONObject()): HubRules.Reply = HubRules.request("POST", url(path), cookie(), body.toString())
}
