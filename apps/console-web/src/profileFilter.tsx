/**
 * The build profile view filter every builds table shares (profile-filter@1, framework/core/engines/profile-filter.mjs;
 * Brett, Nov 3 2026: "Always just show everything in every build profile, but it just effectively filters to hide them.").
 *
 * Every builds view loads the builds of every profile and draws only what the filter shows. The filter is one console
 * setting (`builds.profileFilter`), so changing it anywhere (the Profile switcher widget, a table, another tab) re-draws
 * every table at once. The Profile switcher plugin keeps it in step with its server copy, which the CLI / MCP bulk
 * commands read. Bulk actions take `useProfileFilter().apply(rows).shown`, never the full list.
 *
 * Framework controls only (Note, Button, Chip); colours are theme tones.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Note, useRuntime } from '@console/axf/react';
import {
  applyFilter, bulkLabel, bulkSummary, filterLabel, filterNote, isAll, normalizeFilter, onlyProfile, profileTone, toggleProfile,
  type ProfileFilter, type ProfileRef,
} from '@console/axf/core/engines/profile-filter.mjs';
import { getToken } from '@console/api';

export const PROFILE_FILTER_KEY = 'builds.profileFilter';
export const PROFILE_FILTER_CHANGED = 'axf:profile-filter-changed';
export type { ProfileFilter, ProfileRef };

/* ---------------- profile names (one fetch for every table) ---------------- */

let refs: ProfileRef[] = [];
let refsAt = 0;
const refSubs = new Set<() => void>();
async function loadRefs(force = false) {
  if (!force && Date.now() - refsAt < 30_000) return;
  refsAt = Date.now();
  try {
    const t = getToken();
    const r = await fetch('/api/profiles', { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
    if (!r.ok) return;
    const j = (await r.json()) as { profiles?: ProfileRef[] };
    refs = (j.profiles ?? []).map((p) => ({ id: p.id, name: p.name, tone: p.tone, color: p.color }));
    refSubs.forEach((f) => f());
  } catch { /* names fall back to ids */ }
}
/** Profile ids + names (+ tones), shared by every table. */
export function useProfileRefs(): ProfileRef[] {
  useEffect(() => { void loadRefs(); }, []);
  return useSyncExternalStore((f) => { refSubs.add(f); return () => refSubs.delete(f); }, () => refs);
}
/** Chip tone overrides from the switcher's settings (it sets them here so tables needn't know the plugin). */
let toneOverrides: Record<string, string> = {};
export function setProfileTones(t: Record<string, string>) { toneOverrides = { ...t }; refSubs.forEach((f) => f()); }

/* ---------------- the filter ---------------- */

export function readProfileFilter(rt: AxfRuntime): ProfileFilter {
  const raw = rt.settings.get(PROFILE_FILTER_KEY);
  if (typeof raw !== 'string' || !raw) return normalizeFilter('all');
  try { return normalizeFilter(JSON.parse(raw)); } catch { return normalizeFilter(raw); }
}
/** Save the filter: every table re-draws (setting watchers), other code hears the event. */
export function writeProfileFilter(rt: AxfRuntime, raw: unknown): ProfileFilter {
  const f = normalizeFilter(raw);
  const s = JSON.stringify({ all: f.all, ids: f.ids });
  if (rt.settings.get(PROFILE_FILTER_KEY) !== s) {
    rt.settings.set(PROFILE_FILTER_KEY, s);
    globalThis.dispatchEvent?.(new CustomEvent(PROFILE_FILTER_CHANGED, { detail: f }));
  }
  return f;
}

export interface ProfileFilterApi {
  filter: ProfileFilter;
  profiles: ProfileRef[];
  all: boolean;
  label: string;
  set: (raw: unknown) => void;
  only: (id: string) => void;
  toggle: (id: string) => void;
  showAll: () => void;
  /** Split rows into the drawn ones (`shown`, what every bulk action takes) and the hidden count. */
  apply: <T>(rows: readonly T[], profilesOf?: (row: T) => string[]) => { shown: T[]; hidden: number; total: number };
  /** 'Merge 5 (filtered: Current)'. */
  bulk: (verb: string, n: number) => string;
  /** Confirm text + button for a bulk action over `rows` (visible ones only). */
  summary: <T>(verb: string, rows: readonly T[], opts?: { label?: (x: T) => string; profilesOf?: (row: T) => string[] }) => { included: T[]; hidden: number; text: string; button: string };
  tone: (id: string) => 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  name: (id: string) => string;
}

/** The shared filter, live: re-renders when it changes anywhere in this console (or another tab). */
export function useProfileFilter(): ProfileFilterApi {
  const rt = useRuntime();
  const raw = useSyncExternalStore((f) => rt.settings.onChange(PROFILE_FILTER_KEY, f), () => rt.settings.get(PROFILE_FILTER_KEY) ?? '');
  const profiles = useProfileRefs();
  void raw;
  const filter = readProfileFilter(rt);
  const known = profiles.map((p) => p.id);
  return {
    filter, profiles, all: isAll(filter), label: filterLabel(filter, profiles),
    set: (r) => { writeProfileFilter(rt, r); },
    only: (id) => { writeProfileFilter(rt, onlyProfile(id)); },
    toggle: (id) => { writeProfileFilter(rt, toggleProfile(filter, id, known)); },
    showAll: () => { writeProfileFilter(rt, 'all'); },
    apply: (rows, profilesOf) => applyFilter(rows, filter, profilesOf),
    bulk: (verb, n) => bulkLabel(verb, n, filter, profiles),
    summary: (verb, rows, opts) => bulkSummary(verb, rows, filter, profiles, opts),
    tone: (id) => profileTone(id, profiles, toneOverrides),
    name: (id) => profiles.find((p) => p.id === id)?.name || id,
  };
}

/** 'Filtered: Current · 12 hidden' with a one-tap Show all; nothing when every profile is shown. */
export function ProfileFilterNote({ hidden, extra }: { hidden: number; extra?: ReactNode }) {
  const pf = useProfileFilter();
  if (pf.all) return null;
  return (
    <Note tone="info" icon="sliders" className="axf-profile-filter-note">
      <span>{filterNote(pf.filter, hidden, pf.profiles)}</span>{extra}{' '}
      <Button size="sm" tone="ghost" icon="eye" onClick={pf.showAll}>Show all</Button>
    </Note>
  );
}

/** A build's profiles as theme-toned chips (the Profile column). */
export function ProfileChips({ ids }: { ids: readonly string[] }) {
  const pf = useProfileFilter();
  if (!ids.length) return <span className="fx-small fx-muted">–</span>;
  return <span className="fx-row fx-row--wrap axf-profile-chips">{ids.map((id) => { const t = pf.tone(id); return <Chip key={id} tone={t === 'neutral' ? undefined : t}>{pf.name(id)}</Chip>; })}</span>;
}
