import { useEffect, useState, type ReactNode } from 'react';
import { Note, SelectField, useRuntime } from '@console/axf/react';

/*
 * Split section (Brett, Nov 13 2026: "orchestrator settings needs a collapsible section for split, with all the
 * splitting options, and one option splits it so it runs multiple parallel builds simultaneously to speed it up").
 * One collapsible block holding every option for how a request is split into steps and builds. It shows on the
 * orchestrator's Rules panel and as its own panel of Settings → Plugins → Build orchestrator; the deep link
 * build-orchestrator.split-settings opens it and flashes it.
 *
 * Every value is a pipeline-settings@1 setting (GET / POST pipeline/settings; MCP pipeline-settings /
 * pipeline-settings-set; `pipeline.mjs settings | set k=v`), saved as soon as it changes.
 *   splitProvider   how a build is cut into steps: claude | rules | off
 * Further split options (step size, model per step, phases, step format, the parallel split) are rendered by the
 * caller as children, or added to SplitBody, so the section stays the one place for them.
 */
export type SplitSettingsValues = { splitProvider: string } & Record<string, unknown>;
type Res = { ok: boolean; error?: string; settings: SplitSettingsValues };
export type SplitApi = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };

/** The element id the deep link (build-orchestrator.split-settings) opens and flashes. */
export const SPLIT_SECTION_ID = 'orch-split-settings';

export const SPLIT_PROVIDERS = [
  { value: 'claude', label: 'Claude: a one-shot call cuts it into short steps (Fable only where needed)' },
  { value: 'rules', label: 'Rules: no model, one step per line of the request (review the steps)' },
  { value: 'off', label: 'Off: steps are written by hand' },
];

/** Opens the Split section if it is on the page; returns it (for flashWhenReady). */
export function openSplitSection(): HTMLDetailsElement | null {
  const el = document.getElementById(SPLIT_SECTION_ID) as HTMLDetailsElement | null;
  if (el) el.open = true;
  return el;
}

export function SplitSettings({ api, open, children }: { api: SplitApi; open?: boolean; children?: ReactNode }) {
  const rt = useRuntime();
  const [s, setS] = useState<SplitSettingsValues | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.call<Res>('pipeline/settings')
      .then((r) => { if (!live) return; if (!r.ok) throw new Error(r.error || 'could not read the split settings'); setS(r.settings); setError(''); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [api]);
  const save = async (patch: Partial<SplitSettingsValues>, what: string) => {
    setBusy(true);
    try {
      const r = await api.post<Res>('pipeline/settings', patch);
      if (!r.ok) throw new Error(r.error || 'not saved');
      setS(r.settings); rt.toast(what, 'success');
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  return (
    <details className="pd-add oc-split" id={SPLIT_SECTION_ID} open={open} data-help="split-section">
      <summary>Split <span className="fx-muted fx-small">· how a request is cut into steps and builds</span></summary>
      {error && <Note tone="warning">{error}</Note>}
      {!s ? (!error && <p className="fx-small fx-muted">Loading the split settings…</p>) : (
        <div className="fx-stack">
          <SelectField label="How a build is split" value={s.splitProvider} options={SPLIT_PROVIDERS} disabled={busy}
            hint="Every build is split as soon as it is filed."
            onChange={(v) => void save({ splitProvider: v }, `Split: ${v}`)} />
          {children}
          <p className="fx-small fx-muted">Same settings anywhere: <span className="fx-mono">pipeline.mjs set splitProvider=rules</span>, REST / MCP <span className="fx-mono">pipeline-settings-set</span>.</p>
        </div>
      )}
    </details>
  );
}
