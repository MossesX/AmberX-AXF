import { useAxfState, useRuntime, type DialogMap } from './axf/react';

function DevConsole() {
  const rt = useRuntime();
  const s = useAxfState();
  const snapshot = {
    app: rt.manifest.app,
    role: s.role,
    permissions: [...rt.permissions()],
    view: s.view,
    swaps: s.swaps,
    active: s.active,
    actions: rt.actions.list().map((a) => a.id),
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>
        Live runtime state. The same object is exposed as <code>window.AXF</code> — try <code>AXF.swap('color-theme', 'next')</code> in devtools.
      </p>
      <pre className="fx-code">{JSON.stringify(snapshot, null, 2)}</pre>
    </div>
  );
}

/** The developer console stays: it shows live runtime state, handy while testing a plugin. */
export const dialogs: DialogMap = {
  'dev-console': { title: 'Developer console', icon: 'terminal', render: () => <DevConsole /> },
};
