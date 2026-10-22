/**
 * The studio's IDE workspace, on lib-workspace: toolbar docks on all four edges, pane areas with tabs and splitters,
 * floating panes and toolbars, seven layouts, phone = one tabbed area. The studio supplies the panes and its commands.
 */
import { useEffect } from 'react';
import { useAxfState, useRuntime } from '../axf/react';
import { WorkspaceHost } from '../axf/libs/workspace';
import { setTrashHandler } from '../axf/libs/dnd';
import { describe } from './commands';
import { PANE_VIEWS } from './panes';
import { studio, useStudio } from './store';
import { ui } from './ui';
import { trashItem } from './model';

export function Workspace() {
  const rt = useRuntime();
  useAxfState();
  // toolbars repaint when the selection, undo stack or recording changes (their buttons show that state)
  useStudio((s) => s.recording); useStudio((s) => s.selection); useStudio((s) => s.undo + s.redo * 1000);
  useEffect(() => {
    // pieces and sections dropped on lib-dnd's trash can go to the project trash
    setTrashHandler((p) => {
      const kind = p.kind.endsWith(':leaf') || p.kind.endsWith(':row') || p.kind === 'piece' ? 'piece' : p.kind.endsWith(':branch') || p.kind.endsWith(':group') || p.kind === 'section' ? 'section' : null;
      if (!kind) return;
      studio().edit('Delete', (q) => trashItem(q, { kind, id: p.id }));
      rt.toast(`"${p.label}" moved to the trash.`, 'info', 'Deleted');
    });
    return () => setTrashHandler(null);
  }, [rt]);
  return <WorkspaceHost ws={ui.ws} renderPane={(id) => <PaneBody id={id} />} describe={(spec) => describe(rt, spec)} />;
}

function PaneBody({ id }: { id: string }) {
  const project = useStudio((s) => s.project);
  const View = PANE_VIEWS[id];
  if (!View) return <p className="fx-muted ws-pad">No pane "{id}".</p>;
  if (!project && id !== 'projects' && id !== 'log') return <p className="fx-muted ws-pad">Open or create a project first.</p>;
  return <View />;
}
