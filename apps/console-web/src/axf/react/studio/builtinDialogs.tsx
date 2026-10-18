import { useRef, useState } from 'react';
import { ASSET_TYPES, ActionBus, FRAMEWORK_VERSION, type AssetType } from '../../core';
import { useRuntime, useShortcutMap } from '../AxfProvider';
import { Button, Kbd } from '../components/Controls';
import type { DialogMap } from '../components/Overlays';

function AssetJson({ type, id }: { type: AssetType; id: string }) {
  const rt = useRuntime();
  const json = rt.exportAsset(type, id);
  return (
    <div className="fx-stack">
      <pre className="fx-code">{json || 'Asset not found.'}</pre>
      <div className="fx-row fx-row--end">
        <Button icon="copy" onClick={() => rt.dispatch(`asset.copy:${type}:${id}`)}>Copy JSON</Button>
        <Button tone="primary" icon="zap" requires="assets.swap" onClick={() => rt.swap(type, id)}>Activate</Button>
      </div>
    </div>
  );
}

function Shortcuts() {
  const rt = useRuntime();
  const map = useShortcutMap();
  return (
    <table className="fx-table">
      <tbody>
        {[...map.entries()].map(([combo, action]) => (
          <tr key={combo}>
            <td>
              <Kbd>{combo.split('+').map((p) => (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1))).join('+')}</Kbd>
            </td>
            <td>{rt.actions.get(ActionBus.parse(action).id)?.meta.label ?? action}</td>
            <td className="fx-mono fx-muted">{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImportAsset({ close }: { close: () => void }) {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return setErrors(['That is not valid JSON.']);
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const errs: string[] = [];
    let ok = 0;
    for (const item of list) {
      const r = rt.importAsset(item);
      if (r.ok) ok++;
      else errs.push(...r.errors);
    }
    setErrors(errs);
    if (ok) {
      rt.toast(`${ok} asset${ok > 1 ? 's' : ''} imported and activated.`, 'success', 'Imported');
      if (!errs.length) close();
    }
  };

  const sample = () => {
    const base = JSON.parse(rt.exportAsset('color-theme', rt.getState().active['color-theme']));
    base.id = `custom-${Date.now().toString(36)}`;
    base.name = 'My Custom Theme';
    base.data.tokens.accent = '#e8467c'; // theme-ok: writes theme data
    base.data.tokens.accentSoft = 'rgba(232,70,124,.16)'; // theme-ok: writes theme data
    setText(JSON.stringify(base, null, 2));
  };

  return (
    <div className="fx-stack">
      <p className="fx-muted">
        Paste one asset (or an array of assets) in the <code>asset@1</code> format, or pick a <code>.json</code> file. It's validated against
        the shared schema, registered, and hot-swapped in.
      </p>
      <textarea className="fx-input fx-code" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "$axf": "asset@1", "type": "color-theme", … }' />
      {errors.length > 0 && (
        <ul className="fx-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) load(await f.text());
          e.target.value = '';
        }}
      />
      <div className="fx-row fx-row--end">
        <Button icon="sparkles" onClick={sample}>Sample</Button>
        <Button icon="upload" onClick={() => fileRef.current?.click()}>Choose file</Button>
        <Button tone="primary" icon="check" disabled={!text.trim()} onClick={() => load(text)}>Import</Button>
      </div>
    </div>
  );
}

function About() {
  const rt = useRuntime();
  const m = rt.manifest;
  const rows: [string, string][] = [
    ['App', `${m.app.name} (${m.app.id}) v${m.app.version}`],
    ['Framework', `AmberX AXF ${FRAMEWORK_VERSION} · template ${m.framework.template}`],
    ['Initialized', m.initializedAt ? new Date(m.initializedAt).toLocaleString() : '—'],
    ['Targets', m.targets.join(', ')],
    ['Asset slots', String(ASSET_TYPES.length)],
    ['Assets loaded', String(rt.registry.count())],
    ['Actions bound', String(rt.actions.list().length)],
  ];
  return (
    <table className="fx-table">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const builtinDialogs: DialogMap = {
  'asset-json': {
    title: 'Asset JSON',
    icon: 'code',
    render: (p) => <AssetJson type={p.type as AssetType} id={p.id as string} />,
  },
  shortcuts: { title: 'Keyboard shortcuts', icon: 'keyboard', render: () => <Shortcuts /> },
  'import-asset': { title: 'Import asset', icon: 'upload', render: (_p, close) => <ImportAsset close={close} /> },
  about: { title: 'About this app', icon: 'info', render: () => <About /> },
};
