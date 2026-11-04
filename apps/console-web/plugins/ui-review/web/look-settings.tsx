import { useEffect, useState } from 'react';
import { Note, Switch, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER } from './keys';

/*
 * Settings → Plugins → UI Review → Predicted looks. Kept by the server (the data folder's settings.json), because the
 * headless launcher on the VPS reads it too (framework/cli/ui-predict.mjs gate): with it on, a build that changes UI
 * waits until Brett approves its predicted look.
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
interface LookSettings { waitForLook: boolean }

export function LookApprovalPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<LookSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.call<LookSettings>('settings').then(setS, (e: Error) => setError(e.message)); }, []);
  const set = async (waitForLook: boolean) => {
    setS((x) => ({ ...(x ?? { waitForLook }), waitForLook }));
    try { setS(await api.put<LookSettings>('settings', { waitForLook })); rt.terminal.log('ui-review', `wait for look approval: ${waitForLook ? 'on' : 'off'}`, 'ok'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (error) return <Note tone="warning">{error}</Note>;
  return (
    <div className="fx-stack">
      <Switch label="Wait for my look approval before UI builds start" checked={!!s?.waitForLook} disabled={!s} onChange={(v) => void set(v)}
        hint="Every build that changes UI gets predicted pictures in UI Review when it is launched. When this is on, it waits there until you approve the look; Reject holds it." />
    </div>
  );
}
