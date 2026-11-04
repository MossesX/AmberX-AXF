import { useEffect, useState } from 'react';
import { Button, Note, SelectField, Slider, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER } from './keys';

/*
 * Settings → Plugins → UI Review → Review alarm (ui-review-alarm@1). Kept by the server (alarm-settings.json in the
 * data folder) because the timer runs there: an item unreviewed for the window rings Brett's phone, and when the
 * grace runs out the switch decides (auto-approve, or leave it waiting). Molly / MCP / CLI change the same document
 * (PUT alarm/settings, `review.mjs alarm set …`).
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
export interface AlarmSettings {
  enabled: boolean; openOnNew: boolean; windowMin: number; graceMin: number; unanswered: 'approve' | 'hold';
  sound: string; volume: number; vibrate: boolean; repeat: boolean;
  quietHours: boolean; quietStart: string; quietEnd: string; quietMode: 'silent' | 'hold'; timeZone: string; scope: 'all' | 'blocking';
}
const SOUNDS = [{ value: 'alarm', label: 'Alarm (the phone\'s own)' }, { value: 'siren', label: 'Siren' }, { value: 'beacon', label: 'Beacon' }, { value: 'pulse', label: 'Pulse' }, { value: 'ringtone', label: 'Ringtone' }];

export function AlarmPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<AlarmSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.call<AlarmSettings>('alarm/settings').then(setS, (e: Error) => setError(e.message)); }, []);
  const set = async (patch: Partial<AlarmSettings>) => {
    setS((x) => (x ? { ...x, ...patch } : x));
    try { setS(await api.put<AlarmSettings>('alarm/settings', patch)); rt.terminal.log('ui-review', `alarm: ${Object.entries(patch).map(([k, v]) => `${k}=${String(v)}`).join(', ')}`, 'ok'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (error) return <Note tone="warning">{error}</Note>;
  if (!s) return <Note>Loading the alarm settings…</Note>;
  return (
    <div className="fx-stack">
      <Switch label="Ring my phone when UI Review waits too long" checked={s.enabled} onChange={(v) => void set({ enabled: v })}
        hint={`Unreviewed for ${s.windowMin} min: a loud alarm on your phone (AmberX) and the banner. ${s.graceMin} min later the switch below decides. Tapping the alarm opens the item and pauses it.`} />
      <SelectField label="When the alarm isn't answered" value={s.unanswered} onChange={(v) => void set({ unanswered: v as AlarmSettings['unanswered'] })}
        options={[{ value: 'approve', label: 'Auto-approve (run it)' }, { value: 'hold', label: "Don't run it (leave it waiting)" }]}
        hint="Auto-approvals are logged on the item and in the Breakroom chat; Undo on the item re-opens it." />
      <Slider label="Review window" value={s.windowMin} min={5} max={240} step={5} unit=" min" onChange={(v) => void set({ windowMin: v })} />
      <Slider label="Grace after the alarm" value={s.graceMin} min={0} max={60} step={1} unit=" min" onChange={(v) => void set({ graceMin: v })} />
      <SelectField label="Applies to" value={s.scope} onChange={(v) => void set({ scope: v as AlarmSettings['scope'] })}
        options={[{ value: 'all', label: 'Every item' }, { value: 'blocking', label: 'Only items blocking a merge (with a PR or branch)' }]} />
      <Switch label="Open UI Review on each new item" checked={s.openOnNew} onChange={(v) => void set({ openOnNew: v })} hint="Follow Amber opens it on the console and Molly; your phone gets a notice." />
      <SelectField label="Alarm sound" value={s.sound} options={SOUNDS} onChange={(v) => void set({ sound: v })} />
      <Slider label="Alarm volume" value={s.volume} min={10} max={100} step={5} unit="%" onChange={(v) => void set({ volume: v })} />
      <Switch label="Vibrate" checked={s.vibrate} onChange={(v) => void set({ vibrate: v })} />
      <Switch label="Keep ringing until I tap it" checked={s.repeat} onChange={(v) => void set({ repeat: v })} />
      <Switch label="Quiet hours" checked={s.quietHours} onChange={(v) => void set({ quietHours: v })} />
      {s.quietHours && <>
        <div className="axp-ui-review__alarmrow">
          <TextField label="From" type="time" value={s.quietStart} onChange={(v) => void set({ quietStart: v })} />
          <TextField label="To" type="time" value={s.quietEnd} onChange={(v) => void set({ quietEnd: v })} />
        </div>
        <SelectField label="During quiet hours" value={s.quietMode} onChange={(v) => void set({ quietMode: v as AlarmSettings['quietMode'] })}
          options={[{ value: 'silent', label: 'Follow the switch without ringing' }, { value: 'hold', label: 'Hold until quiet hours end' }]} />
        <TextField label="Time zone" value={s.timeZone} onChange={(v) => setS({ ...s, timeZone: v })} hint="IANA name, e.g. America/New_York." />
        <Button size="sm" onClick={() => void set({ timeZone: s.timeZone })}>Save time zone</Button>
      </>}
      <Note>The phone's full-screen alarm through silent mode needs the AmberX update with the review alarm; until it is installed the phone gets a critical notice.</Note>
    </div>
  );
}
