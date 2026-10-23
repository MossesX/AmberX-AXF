/**
 * User account control engine — resolves a role's effective permissions
 * (with inheritance and wildcards) and decides how gated UI is rendered.
 */
import type { Gate, MenuItem, UACPolicyData } from '../types';

export function resolvePermissions(policy: UACPolicyData, roleId: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  const role = policy.roles.find((r) => r.id === roleId);
  if (!role || seen.has(roleId)) return out;
  seen.add(roleId);
  for (const parent of role.inherits ?? []) {
    for (const p of resolvePermissions(policy, parent, seen)) out.add(p);
  }
  for (const p of role.permissions) out.add(p);
  return out;
}

export function hasPermission(granted: Set<string>, perm: string | undefined): boolean {
  if (!perm) return true;
  if (granted.has('*') || granted.has(perm)) return true;
  const parts = perm.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    if (granted.has(parts.slice(0, i).join('.') + '.*')) return true;
  }
  return false;
}

export function gateFor(policy: UACPolicyData, granted: Set<string>, requires?: string): Gate {
  if (hasPermission(granted, requires)) return 'allow';
  return policy.gating === 'hide' ? 'hide' : 'disable';
}

/** Recursively drop hidden items (disabled ones stay, the renderer greys them). */
export function filterMenu(items: MenuItem[], gate: (requires?: string) => Gate): MenuItem[] {
  return items
    .filter((i) => i.separator || gate(i.requires) !== 'hide')
    .map((i) => (i.items ? { ...i, items: filterMenu(i.items, gate) } : i))
    .filter((i, idx, arr) => !(i.separator && (idx === 0 || idx === arr.length - 1 || arr[idx - 1]?.separator)));
}
