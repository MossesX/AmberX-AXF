/**
 * Settings → Plugins → Plan Studio → Category tree (plugin-settings@1 section plan-studio.categories): the plan
 * categories as the hub holds them, read-only here; they are edited in Plan Studio itself. REST / MCP read the same
 * tree through the plugin's state route (GET /api/plugins/plan-studio/state → categories.paths).
 */
import { Button, Note, useRuntime } from '@console/axf/react';
import { useStudio, VIEW } from './api';

export function CategoryTreePanel() {
  const rt = useRuntime();
  const { state, error } = useStudio();
  const paths = state?.categories.paths ?? [];
  return (
    <div className="fx-stack">
      {error ? <Note tone="warning">{error}</Note> : null}
      {!state && !error ? <p className="fx-muted fx-small">Loading…</p> : null}
      {state && paths.length === 0 ? <p className="fx-muted fx-small">No categories yet.</p> : null}
      {paths.length > 0 ? (
        <ul className="axp-plan-studio__cattree">
          {paths.map((p) => {
            const parts = p.split(' > ');
            return <li key={p} style={{ ['--axp-depth' as string]: parts.length - 1 }}>{parts[parts.length - 1]}</li>;
          })}
        </ul>
      ) : null}
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="layout" onClick={() => rt.navigate(VIEW)}>Edit them in Plan Studio</Button>
      </div>
    </div>
  );
}
