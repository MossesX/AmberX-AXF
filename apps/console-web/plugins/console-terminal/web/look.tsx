/*
 * Settings → Plugins → Terminal (Oct 28 2026): Appearance, Tabs & behaviour, and Claude Code profiles. Every change
 * saves at once (text after a short pause) and every open terminal follows it live. Each setting carries its level
 * (data-axf-level: simple / basic / developer / administrator) for the settings level toolbar (orchestrator build
 * windows-terminal s9–s11). Framework controls only, so the app's style applies.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Icon, SelectField, Slider, Switch, TextField } from '@console/axf/react';
import { SCHEMES, getSettings, onSettings, saveSettings, type ClaudeProfile, type Settings } from './api';
import { blankProfile } from './profiles';

export type Level = 'simple' | 'basic' | 'developer' | 'administrator';
/** Every terminal setting's level (what the level toolbar shows at Simple, Basic, Developer; Administrator = all). */
export const LEVELS: Record<string, Level> = {
  scheme: 'simple', fontSize: 'simple', windowsLook: 'simple', toolbar: 'simple', startup: 'simple',
  fontFamily: 'basic', cursorStyle: 'basic', mica: 'basic', newTab: 'basic', tabWidth: 'basic', closeConfirm: 'basic', copyOnSelect: 'basic', pasteWarn: 'basic',
  'profile.name': 'basic', 'profile.model': 'basic', 'profile.connection': 'basic', 'profile.color': 'basic',
  lineHeight: 'developer', scrollback: 'developer', padding: 'developer', bell: 'developer', cursorBlink: 'developer', mouseDefault: 'developer', moshDefault: 'developer',
  'profile.permissionMode': 'developer', 'profile.flags': 'developer', 'profile.cwd': 'developer', 'profile.prompt': 'developer', 'profile.icon': 'developer',
};

function useLive() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { void getSettings(true).then(setS, (e: Error) => setMsg(e.message)); return onSettings(setS); }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (patch: Partial<Settings>, wait = 0) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setMsg('Saving…'); void saveSettings(patch).then(() => setMsg('✓ Saved'), (e: Error) => setMsg(`✗ ${e.message}`)); }, wait);
  };
  return { s, msg, save };
}
const L = ({ k, children }: { k: string; children: ReactNode }) => <div className="axp-terminal__set" data-axf-level={LEVELS[k] ?? 'administrator'} data-axf-setting={`terminal.${k}`}>{children}</div>;

export function AppearancePanel() {
  const { s, msg, save } = useLive();
  if (!s) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  const schemes = [{ value: 'app', label: 'Follow the app theme' }, ...Object.entries(SCHEMES).map(([value, v]) => ({ value, label: v.name ?? value }))];
  return (
    <div className="fx-stack axp-terminal-settings">
      <div className="axp-terminal__cols">
        <L k="scheme"><SelectField label="Colour scheme" value={s.scheme} options={schemes} onChange={(v) => save({ scheme: v })} /></L>
        <L k="fontFamily"><TextField label="Font" value={s.fontFamily} placeholder="Cascadia Mono, Consolas" onChange={(v) => save({ fontFamily: v }, 600)} hint="Empty = Cascadia Mono, then Consolas, then the theme’s monospace font" /></L>
        <L k="cursorStyle"><SelectField label="Cursor" value={s.cursorStyle} options={[{ value: 'bar', label: 'Bar ( ┃ )' }, { value: 'block', label: 'Block ( █ )' }, { value: 'underline', label: 'Underline ( ▁ )' }]} onChange={(v) => save({ cursorStyle: v as Settings['cursorStyle'] })} /></L>
      </div>
      <L k="fontSize"><Slider label="Text size" value={s.fontSize} min={9} max={28} unit="pt" onChange={(v) => save({ fontSize: v }, 300)} /></L>
      <L k="lineHeight"><Slider label="Line height" value={Math.round(s.lineHeight * 100)} min={100} max={200} step={5} unit="%" onChange={(v) => save({ lineHeight: v / 100 }, 300)} /></L>
      <L k="padding"><Slider label="Padding" value={s.padding} min={0} max={4} onChange={(v) => save({ padding: v }, 300)} /></L>
      <L k="windowsLook"><Switch label="Windows look" hint="Windows Terminal tabs and shapes. Off = the app’s own tab bar." checked={s.windowsLook} onChange={(v) => save({ windowsLook: v })} /></L>
      <L k="mica"><Switch label="Mica background" hint="The window behind shows through the tab strip, blurred" checked={s.mica} onChange={(v) => save({ mica: v })} /></L>
      <L k="toolbar"><Switch label="Command toolbar" hint="Claude Code, the tab’s connection, find, text size, modes, copy / paste" checked={s.toolbar} onChange={(v) => save({ toolbar: v })} /></L>
      <L k="cursorBlink"><Switch label="Blinking cursor" checked={s.cursorBlink} onChange={(v) => save({ cursorBlink: v })} /></L>
      <span className="fx-small">{msg}</span>
    </div>
  );
}

export function BehaviourPanel() {
  const { s, msg, save } = useLive();
  if (!s) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  return (
    <div className="fx-stack axp-terminal-settings">
      <div className="axp-terminal__cols">
        <L k="startup"><SelectField label="New terminal opens" value={s.startup} options={[{ value: 'claude', label: 'Claude Code (default profile)' }, { value: 'console', label: 'A console shell' }, { value: 'picker', label: 'The connection picker' }]} onChange={(v) => save({ startup: v as Settings['startup'] })} /></L>
        <L k="newTab"><SelectField label="The + button" value={s.newTab} options={[{ value: 'picker', label: 'Asks for a connection' }, { value: 'same', label: 'Opens one like the current tab' }]} onChange={(v) => save({ newTab: v as Settings['newTab'] })} /></L>
        <L k="tabWidth"><SelectField label="Tab width" value={s.tabWidth} options={[{ value: 'equal', label: 'Equal' }, { value: 'compact', label: 'Compact' }, { value: 'title', label: 'Fit the title' }]} onChange={(v) => save({ tabWidth: v as Settings['tabWidth'] })} /></L>
        <L k="bell"><SelectField label="Bell" value={s.bell} options={[{ value: 'visual', label: 'Flash' }, { value: 'sound', label: 'Sound' }, { value: 'none', label: 'Off' }]} onChange={(v) => save({ bell: v as Settings['bell'] })} /></L>
      </div>
      <L k="scrollback"><Slider label="Scrollback (lines)" value={s.scrollback} min={500} max={100000} step={500} onChange={(v) => save({ scrollback: v }, 400)} /></L>
      <L k="closeConfirm"><Switch label="Ask before closing a running tab" checked={s.closeConfirm} onChange={(v) => save({ closeConfirm: v })} /></L>
      <L k="copyOnSelect"><Switch label="Copy on select" checked={s.copyOnSelect} onChange={(v) => save({ copyOnSelect: v })} /></L>
      <L k="pasteWarn"><Switch label="Ask before pasting several lines" checked={s.pasteWarn} onChange={(v) => save({ pasteWarn: v })} /></L>
      <L k="mouseDefault"><Switch label="New tabs start in mouse mode" checked={s.mouseDefault} onChange={(v) => save({ mouseDefault: v })} /></L>
      <L k="moshDefault"><Switch label="New tabs start in Mosh mode" checked={s.moshDefault} onChange={(v) => save({ moshDefault: v })} /></L>
      <p className="fx-small fx-muted">Keys: Ctrl+Shift+T new tab · Ctrl+Shift+W close · Ctrl+Shift+D duplicate · Ctrl+Tab / Ctrl+Shift+Tab next / previous · Ctrl+Alt+1…9 jump · Ctrl+= / Ctrl+- text size · Ctrl+Shift+F find · Ctrl+Shift+C / V copy, paste.</p>
      <span className="fx-small">{msg}</span>
    </div>
  );
}

const MODES = [{ value: 'default', label: 'Ask each time (default)' }, { value: 'acceptEdits', label: 'Accept edits' }, { value: 'plan', label: 'Plan only' }, { value: 'bypassPermissions', label: 'Bypass permissions' }];
const COLORS = [{ value: '', label: 'None' }, { value: 'accent', label: 'Accent' }, { value: 'success', label: 'Green' }, { value: 'warning', label: 'Amber' }, { value: 'danger', label: 'Red' }, { value: 'info', label: 'Blue' }];

export function ProfilesPanel() {
  const { s, msg, save } = useLive();
  const [open, setOpen] = useState<string | null>(null);
  if (!s) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  const list = s.claudeProfiles;
  const set = (id: string, p: Partial<ClaudeProfile>, wait = 0) => save({ claudeProfiles: list.map((x) => (x.id === id ? { ...x, ...p } : x)) }, wait);
  const add = () => { let n = list.length + 1; while (list.some((x) => x.id === `profile-${n}`)) n++; const p = blankProfile(n); save({ claudeProfiles: [...list, p] }); setOpen(p.id); };
  const conns = [{ value: 'console', label: 'Console container' }, { value: 'vps', label: 'VPS host (root)' }, { value: 'axhub', label: 'axHub' }];
  return (
    <div className="fx-stack axp-terminal-settings">
      <p className="fx-small fx-muted">A profile says how a Claude Code tab starts. Pick one in the connection picker or the ∨ menu; the default one opens with New terminal.</p>
      {list.map((p) => (
        <div key={p.id} className="axp-terminal__profile">
          <div className="fx-row">
            <button type="button" className="fx-iconbtn" aria-expanded={open === p.id} title={open === p.id ? 'Collapse' : 'Edit'} onClick={() => setOpen(open === p.id ? null : p.id)}><Icon name={open === p.id ? 'chevron-down' : 'chevron-right'} size={14} /></button>
            <Icon name={p.icon || 'sparkles'} size={16} />
            <strong className="fx-grow">{p.name}</strong>
            <span className="fx-small fx-muted">{p.model || 'default model'} · {p.connection.replace('container:', '')}</span>
            {s.defaultClaudeProfile === p.id ? <span className="fx-chip">Default</span> : <Button tone="ghost" onClick={() => save({ defaultClaudeProfile: p.id })}>Make default</Button>}
            <Button tone="ghost" icon="trash" disabled={list.length < 2} onClick={() => save({ claudeProfiles: list.filter((x) => x.id !== p.id) })}>Remove</Button>
          </div>
          {open === p.id && (
            <div className="axp-terminal__cols">
              <L k="profile.name"><TextField label="Name" value={p.name} onChange={(v) => set(p.id, { name: v }, 600)} /></L>
              <L k="profile.model"><TextField label="Model" value={p.model} placeholder="Claude Code’s default" onChange={(v) => set(p.id, { model: v.trim() }, 600)} hint="e.g. claude-opus-5-5, claude-fable-5-1, sonnet" /></L>
              <L k="profile.connection"><SelectField label="Opens on" value={p.connection} options={[...conns, ...(p.connection.startsWith('container:') ? [{ value: p.connection, label: p.connection.slice(10) }] : [])]} onChange={(v) => set(p.id, { connection: v })} /></L>
              <L k="profile.permissionMode"><SelectField label="Permissions" value={p.permissionMode} options={MODES} onChange={(v) => set(p.id, { permissionMode: v })} /></L>
              <L k="profile.color"><SelectField label="Tab colour" value={p.color} options={COLORS} onChange={(v) => set(p.id, { color: v })} /></L>
              <L k="profile.icon"><TextField label="Icon" value={p.icon} onChange={(v) => set(p.id, { icon: v.trim() }, 600)} hint="A framework icon name" /></L>
              <L k="profile.cwd"><TextField label="Folder" value={p.cwd} placeholder="/axf" mono onChange={(v) => set(p.id, { cwd: v.trim() }, 800)} /></L>
              <L k="profile.flags"><TextField label="Extra flags (one per line)" rows={3} mono value={p.flags.join('\n')} onChange={(v) => set(p.id, { flags: v.split('\n').map((x) => x.trim()).filter(Boolean) }, 800)} hint="e.g. --verbose, --add-dir=/projects" /></L>
              <L k="profile.prompt"><TextField label="First prompt" rows={3} value={p.prompt} onChange={(v) => set(p.id, { prompt: v }, 800)} hint="Sent when the tab starts (optional)" /></L>
            </div>
          )}
        </div>
      ))}
      <div className="fx-row"><Button icon="plus" onClick={add}>Add a profile</Button><span className="fx-small">{msg}</span></div>
    </div>
  );
}
