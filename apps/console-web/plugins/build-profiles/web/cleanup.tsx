/**
 * Build profiles: the cleanup helper (Brett, Nov 3 2026: "flag archived builds that are actually complete, with a
 * one-tap fix").
 *
 * The scan and the fix are the framework's (framework/cli/profiles.mjs `cleanup`); this is their face. It reads
 * GET /api/plugins/build-profiles/cleanup and posts the same route to fix, so the page, REST, MCP and the CLI
 * (`cleanup` / `cleanup-fix`, plugin-commands@1) run the same rules. What it shows:
 *
 *   - archived builds that really finished (their PR merged, or every step is done), with the status the fix gives
 *     them; the ones the store has no proof for are listed with the reason and no button
 *   - builds tagged with a build profile that no longer exists (the fix moves them to the base profile)
 *
 * One tap on a row fixes that build; "Fix all" fixes everything fixable. Nothing is deleted by either.
 *
 *   <CleanupHelper profile? />     the full list (dialog `build-profiles-cleanup`, action `build-profiles.cleanup`)
 *   <CleanupNotice profile? />     one line for a page or a profile row: the count and a Review button; nothing when clean
 *   useCleanup(profile?)           the scan for badges and counts
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Note, useRuntime, type DialogMap } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { LoadingSkeleton } from '@console/emptyState';
import * as core from './cleanup-core.mjs';
import type { CleanupFinding, CleanupFixResult, CleanupScan } from './cleanup-core.mjs';
import './cleanup.css';

const FOLDER = 'build-profiles';
export const CLEANUP_DIALOG = 'build-profiles-cleanup';
export const CLEANUP_ACTION = 'build-profiles.cleanup';
/** Fired on window after a fix changed builds: detail = { profile, fixed: [{ id, kind, to }] }. */
export const CLEANUP_FIXED = 'axf:profile-cleanup-fixed';

/* ---------------- store (one scan per profile filter; '' = every profile) ---------------- */

interface Entry { scan: CleanupScan | null; error: string; loading: boolean; busy: string }
const EMPTY: Entry = { scan: null, error: '', loading: false, busy: '' };
const entries = new Map<string, Entry>();
const subs = new Set<() => void>();
const entry = (profile: string): Entry => entries.get(profile) ?? EMPTY;
const set = (profile: string, p: Partial<Entry>) => { entries.set(profile, { ...entry(profile), ...p }); subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

async function answer(r: Response): Promise<{ ok: boolean; body: Record<string, unknown>; error: string }> {
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.ok && body.ok !== false) return { ok: true, body, error: '' };
  const said = typeof body.detail === 'string' ? body.detail : typeof body.error === 'string' ? body.error : '';
  const error = r.status === 401 ? 'Set the console token to scan the builds.'
    : r.status === 404 ? 'The Build profiles plugin is not answering (is it enabled?).'
    : said || `The console answered ${r.status}.`;
  return { ok: false, body, error };
}

/** Run the scan (reads only) and keep the answer for every consumer of this profile filter. */
export async function scanCleanup(profile = ''): Promise<CleanupScan | null> {
  set(profile, { loading: true });
  try {
    const a = await answer(await pluginFetch(FOLDER, `cleanup${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`));
    if (!a.ok) { set(profile, { loading: false, error: a.error }); return null; }
    const scan = core.normalizeScan(a.body);
    set(profile, { loading: false, error: '', scan });
    return scan;
  } catch (e) {
    set(profile, { loading: false, error: `The console can't be reached (${(e as Error).message}).` });
    return null;
  }
}

/**
 * Fix what the scan found: every fixable finding, or only `ids`. Tells the person, rescans every filter on screen and
 * lets the other views know builds changed. Returns what was fixed (null when the request itself failed).
 */
export async function fixCleanup(rt: AxfRuntime, profile = '', ids: string[] | null = null): Promise<CleanupFixResult | null> {
  const scan = entry(profile).scan;
  if (!scan) return null;
  const body = core.fixRequest(scan, { ids, profile });
  if (!body.builds.length) { rt.toast('Nothing here can be fixed.', 'info', 'Cleanup'); return { fixed: [], refused: [], left: null }; }
  set(profile, { busy: ids?.length === 1 ? ids[0] : '*' });
  try {
    const a = await answer(await pluginFetch(FOLDER, 'cleanup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    if (!a.ok) { rt.toast(a.error, 'danger', 'Cleanup'); return null; }
    const result = core.normalizeFix(a.body, body.builds);
    const msg = core.fixMessage(result);
    rt.toast(msg.text, msg.tone, 'Cleanup');
    if (result.fixed.length) {
      for (const ev of ['axf:pending-changed', 'axf:profile-changed']) globalThis.dispatchEvent(new CustomEvent(ev, { detail: { id: profile } }));
      globalThis.dispatchEvent(new CustomEvent(CLEANUP_FIXED, { detail: { profile, fixed: result.fixed } }));
    }
    return result;
  } catch (e) {
    rt.toast(`The console can't be reached (${(e as Error).message}).`, 'danger', 'Cleanup');
    return null;
  } finally {
    set(profile, { busy: '' });
    await Promise.all([...new Set([profile, ...entries.keys()])].map((p) => scanCleanup(p)));
  }
}

/** The scan for `profile` ('' = every profile), loaded on first use. */
export function useCleanup(profile = ''): Entry {
  const e = useSyncExternalStore(subscribe, () => entry(profile));
  useEffect(() => { if (!entry(profile).scan && !entry(profile).loading) void scanCleanup(profile); }, [profile]);
  return e;
}

/* ---------------- views ---------------- */

function Row({ f, profile, busy }: { f: CleanupFinding; profile: string; busy: string }) {
  const rt = useRuntime();
  const fix = core.fixText(f);
  return (
    <li className="axp-build-profiles-cleanup__row">
      <div className="axp-build-profiles-cleanup__what">
        <span className="axp-build-profiles-cleanup__title">
          <span className="fx-mono">{f.id}</span>
          {f.fixable ? <Chip tone="success">{fix}</Chip> : <Chip tone="warning">needs a look</Chip>}
        </span>
        {f.title !== f.id && <p className="fx-small axp-build-profiles-cleanup__line">{f.title}</p>}
        <p className="fx-small fx-muted axp-build-profiles-cleanup__line">
          Flagged because {core.evidenceText(f)}{f.profiles.length ? ` · profile ${f.profiles.join(', ')}` : ''}{f.why ? ` · not fixed here: ${f.why}` : ''}
        </p>
      </div>
      {f.fixable && (
        <Button size="sm" tone="primary" icon="check" disabled={!!busy} aria-label={`Fix ${f.id}: ${fix}`} onClick={() => void fixCleanup(rt, profile, [f.id])}>
          {busy === f.id ? 'Fixing…' : 'Fix'}
        </Button>
      )}
    </li>
  );
}

/** The cleanup list: what the scan found, a Fix on every row and Fix all. `profile` limits it to one build profile. */
export function CleanupHelper({ profile = '' }: { profile?: string }) {
  const rt = useRuntime();
  const { scan, error, loading, busy } = useCleanup(profile);
  if (!scan) return <div className="axp-build-profiles-cleanup">{error ? <Note tone="warning">{error}</Note> : <LoadingSkeleton label="Scanning builds" />}</div>;
  const groups = core.groupFindings(scan.findings);
  return (
    <div className="axp-build-profiles-cleanup" aria-busy={loading || !!busy}>
      <p className="axp-build-profiles-cleanup__summary" role="status">{core.summaryText(scan)}{profile ? <span className="fx-muted"> Profile: {profile}.</span> : null}</p>
      {error && <Note tone="warning">{error}</Note>}
      <div className="axp-build-profiles-cleanup__bar">
        {scan.fixable > 0 && (
          <Button tone="primary" icon="sparkles" disabled={!!busy} onClick={() => void fixCleanup(rt, profile)}>
            {busy === '*' ? 'Fixing…' : `Fix all (${scan.fixable})`}
          </Button>
        )}
        <Button tone="ghost" icon="refresh" disabled={loading || !!busy} onClick={() => void scanCleanup(profile)}>{loading ? 'Scanning…' : 'Scan again'}</Button>
      </div>
      {groups.map((g) => (
        <section key={g.kind} className="axp-build-profiles-cleanup__group" aria-label={g.title}>
          <h4 className="axp-build-profiles-cleanup__group-head">{g.title} <span className="fx-muted">{g.rows.length}</span></h4>
          {g.hint && <p className="fx-small fx-muted axp-build-profiles-cleanup__hint">{g.hint}</p>}
          <ul className="axp-build-profiles-cleanup__list">{g.rows.map((f) => <Row key={`${f.kind}:${f.id}`} f={f} profile={profile} busy={busy} />)}</ul>
        </section>
      ))}
      {scan.total > 0 && <p className="fx-small fx-muted axp-build-profiles-cleanup__hint">A fix changes a build's status or profile and leaves a note on the build. Nothing is deleted.</p>}
    </div>
  );
}

/** One line for a page or a profile row: how much there is to clean up, with Review. Renders nothing when clean. */
export function CleanupNotice({ profile = '' }: { profile?: string }) {
  const rt = useRuntime();
  const { scan } = useCleanup(profile);
  if (!scan?.total) return null;
  return (
    <Note tone="info" className="axp-build-profiles-cleanup__notice">
      {core.summaryText(scan)}{' '}
      <Button size="sm" tone="neutral" icon="sparkles" onClick={() => rt.openDialog(CLEANUP_DIALOG, profile ? { profile } : undefined)}>Review cleanup</Button>
    </Note>
  );
}

/* ---------------- registration ---------------- */

const profileOf = (props: Record<string, unknown>): string => {
  const v = typeof props.profile === 'string' ? props.profile : typeof props.arg === 'string' ? props.arg : '';
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(v) ? v : '';
};

/** The dialog this helper adds (spread into the plugin's `dialogs`). Props: { profile? }. */
export const cleanupDialogs: DialogMap = {
  [CLEANUP_DIALOG]: { title: 'Clean up builds', icon: 'sparkles', render: (props) => <CleanupHelper profile={profileOf(props)} /> },
};

/** Register the action that opens the helper (call from the plugin's `register`). */
export function registerCleanup(rt: AxfRuntime): void {
  rt.actions.register(CLEANUP_ACTION, (args) => {
    const profile = profileOf({ arg: Array.isArray(args) ? args[0] : args });
    rt.openDialog(CLEANUP_DIALOG, profile ? { profile } : undefined);
  }, { label: 'Clean up builds' });
}
