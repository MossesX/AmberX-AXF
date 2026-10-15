import { useState } from 'react';
import { Button, Slider, useFrameState, useRuntime, type DialogMap } from './frame/react';

function NewFile({ close }: { close: () => void }) {
  const rt = useRuntime();
  const [name, setName] = useState('untitled.ts');
  const [indent, setIndent] = useState(2);
  return (
    <form
      className="fx-stack"
      onSubmit={(e) => {
        e.preventDefault();
        close();
        rt.toast(`${name} created with ${indent}-space indent.`, 'success', 'File created');
      }}
    >
      <label className="fx-field">
        File name
        <input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <Slider label="Indent size" value={indent} min={1} max={8} onChange={setIndent} unit=" sp" />
      <div className="fx-row fx-row--end">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="plus" type="submit" disabled={!name.trim()}>Create</Button>
      </div>
    </form>
  );
}

function ConfirmDelete({ close }: { close: () => void }) {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Delete the selected item? This is a demo, so nothing is actually removed.</p>
      <div className="fx-row fx-row--end">
        <Button onClick={close}>Keep it</Button>
        <Button
          tone="danger"
          icon="trash"
          onClick={() => {
            close();
            rt.toast('Item deleted.', 'danger', 'Deleted');
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function DevConsole() {
  const rt = useRuntime();
  const s = useFrameState();
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
        Live runtime state. The same object is exposed as <code>window.Frame</code> — try <code>Frame.swap('color-theme', 'next')</code> in devtools.
      </p>
      <pre className="fx-code">{JSON.stringify(snapshot, null, 2)}</pre>
    </div>
  );
}

export const dialogs: DialogMap = {
  'new-file': { title: 'New file', icon: 'plus', render: (_p, close) => <NewFile close={close} /> },
  'confirm-delete': { title: 'Delete item', icon: 'trash', render: (_p, close) => <ConfirmDelete close={close} /> },
  'dev-console': { title: 'Developer console', icon: 'terminal', render: () => <DevConsole /> },
};
