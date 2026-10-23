import { useAxfState, useRuntime, type DialogMap } from './axf/react';
import { studioDialogs } from './studio/dialogs';

function DevConsole() {
  const rt = useRuntime();
  const s = useAxfState();
  const snapshot = { app: rt.manifest.app, role: s.role, view: s.view, active: s.active, actions: rt.actions.list().map((a) => a.id) };
  return <pre className="fx-code">{JSON.stringify(snapshot, null, 2)}</pre>;
}

export const dialogs: DialogMap = {
  ...studioDialogs,
  'dev-console': { title: 'Developer console', icon: 'terminal', render: () => <DevConsole /> },
};
