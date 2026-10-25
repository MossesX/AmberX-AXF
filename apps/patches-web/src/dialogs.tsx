import { useAxfState, useRuntime, type DialogMap } from './axf/react';

/** Patches' keys: they work in Patches and inside every app in its tabs (the apps hand them over, suite mode). */
const KEYS: [string, string][] = [
  ['Ctrl/Cmd + K', 'Search every app (also /)'],
  ['Alt + 1 … 9', 'Bring tab 1 … 9 up'],
  ['Esc', 'Close the search, a menu or a dialog'],
];

function Shortcuts() {
  return (
    <div className="fx-stack">
      <table className="pt-keys">
        <tbody>{KEYS.map(([k, what]) => <tr key={k}><td><kbd className="fx-kbd">{k}</kbd></td><td>{what}</td></tr>)}</tbody>
      </table>
      <p className="fx-muted" style={{ margin: 0 }}>Each app’s own shortcuts keep working in its tab.</p>
    </div>
  );
}

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

export const dialogs: DialogMap = {
  'patches.shortcuts': { title: 'Keyboard shortcuts', icon: 'keyboard', render: () => <Shortcuts /> },
  'dev-console': { title: 'Developer console', icon: 'terminal', render: () => <DevConsole /> },
};
