package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.ContextMenu
import ai.amberx.axf.kernel.asset.MenuItem

/** Context-menu engine — picks the item list for a target and substitutes `{payload}` in actions/labels. */
public object ContextMenuEngine {
    public const val DEFAULT_TARGET: String = "default"

    public fun itemsFor(menu: ContextMenu, target: String, payload: String?, gate: (String?) -> Gate): List<MenuItem> {
        val raw = menu.targets[target] ?: menu.targets[DEFAULT_TARGET] ?: emptyList()
        val substituted = if (payload == null) raw else raw.map { it.substitute(payload) }
        return UacEngine.filterMenu(substituted, gate)
    }

    private fun MenuItem.substitute(payload: String): MenuItem = copy(
        action = action?.replace("{payload}", payload), label = label?.replace("{payload}", payload),
        items = items.map { it.substitute(payload) },
    )
}
