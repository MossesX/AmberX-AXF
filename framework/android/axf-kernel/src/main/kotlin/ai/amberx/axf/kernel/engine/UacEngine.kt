package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.Gating
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.asset.UacPolicy

public enum class Gate { ALLOW, DISABLE, HIDE }

/** User account control engine — resolves a role's effective permissions (inheritance + wildcards) and how gated UI renders. */
public object UacEngine {
    public fun resolvePermissions(policy: UacPolicy, roleId: String, seen: MutableSet<String> = mutableSetOf()): Set<String> {
        val out = LinkedHashSet<String>()
        val role = policy.role(roleId) ?: return out
        if (!seen.add(roleId)) return out
        for (parent in role.inherits) out += resolvePermissions(policy, parent, seen)
        out += role.permissions
        return out
    }

    /** `*` grants everything; `ns.*` grants every permission under the namespace (any depth). */
    public fun hasPermission(granted: Set<String>, perm: String?): Boolean {
        if (perm.isNullOrEmpty()) return true
        if ("*" in granted || perm in granted) return true
        val parts = perm.split('.')
        for (i in parts.size - 1 downTo 1) if (parts.subList(0, i).joinToString(".") + ".*" in granted) return true
        return false
    }

    public fun gateFor(policy: UacPolicy, granted: Set<String>, requires: String?): Gate =
        if (hasPermission(granted, requires)) Gate.ALLOW else if (policy.gating == Gating.HIDE) Gate.HIDE else Gate.DISABLE

    /** Recursively drops hidden items (disabled ones stay; the renderer greys them) and collapses stray separators. */
    public fun filterMenu(items: List<MenuItem>, gate: (String?) -> Gate): List<MenuItem> {
        val kept = items.filter { it.separator || gate(it.requires) != Gate.HIDE }.map { if (it.items.isNotEmpty()) it.copy(items = filterMenu(it.items, gate)) else it }
        return kept.filterIndexed { i, it -> !(it.separator && (i == 0 || i == kept.size - 1 || kept[i - 1].separator)) }
    }
}
