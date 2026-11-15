/**
 * Overlay settings: everything the phone shows, set here and synced live (the phone has no settings of its own; it
 * applies phone-overlay@1 on its next poll). Presets, a live phone preview, the toolbar's buttons and widgets, each
 * popup type's look and motion, the floating button, and the paired phone / Monitor / mic switches.
 * Every field is also reachable as REST `overlay` / `overlay/presets`, MCP phone_overlay(_set|_presets|_preset), CLI and voice.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Container, Note, Segmented, SelectField, Slider, Switch, TabGroup, TextField } from '@console/axf/react';
import { api, errText } from './api';
import { DevicePanel, useSettings } from './PhoneConnectSettings';

type PopupKind = 'approval' | 'alert' | 'notification';
interface Item { id: string; kind: 'button' | 'widget'; icon: string; label: string; action: string }
interface PopupStyle { position: string; enter: string; exit: string; speedMs: number; size: string; stayMs: number; sound: boolean; vibrate: boolean; opacity: number }
export interface Overlay { items: Item[]; popups: Record<PopupKind, PopupStyle>; buttonSize: number; buttonShape: 'circle' | 'rounded' | 'square'; edgeSnap: boolean; autoCollapseMs: number; toolbarOpacity: number }
interface Preset { id: string; label: string; config: Overlay }

const POSITIONS = ['top', 'bottom', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'from-button'];
const ANIMATIONS: { value: string; label: string }[] = [
  { value: 'slide-top', label: 'Slide from top' }, { value: 'burst', label: 'Burst from the middle' }, { value: 'circle', label: 'Circle reveal' },
  { value: 'fade', label: 'Fade' }, { value: 'scale', label: 'Scale' }, { value: 'bounce', label: 'Bounce' },
];
const ACTIONS: { value: string; label: string }[] = [
  { value: 'approvals', label: 'Approvals' }, { value: 'recorder', label: 'Recorder on / off' }, { value: 'notifications', label: 'Notifications' },
  { value: 'build-status', label: 'Build status' }, { value: 'open', label: 'Open a console page' },
];
const ICONS = ['check', 'mic', 'bell', 'hammer', 'monitor', 'sparkles', 'rocket', 'terminal', 'chart', 'list', 'star', 'zap', 'clock'];
const label = (s: string) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

function ItemRow({ item, index, count, onChange, onMove, onRemove }: { item: Item; index: number; count: number; onChange: (i: Item) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const isOpen = item.action.startsWith('open:');
  return (
    <li className="axp-phone-item" data-axf-target={`phone-connect.overlay.item.${item.id}`}>
      <div className="axp-phone-grid">
        <TextField label="Label" value={item.label} onChange={(v) => onChange({ ...item, label: v })} />
        <SelectField label="Icon" value={item.icon} options={ICONS.map((i) => ({ value: i, label: label(i) }))} onChange={(v) => onChange({ ...item, icon: v })} />
        <SelectField label="Does" value={isOpen ? 'open' : item.action} options={ACTIONS} onChange={(v) => onChange({ ...item, action: v === 'open' ? 'open:https://console.amberxai.com/' : v })} />
        <SelectField label="Kind" value={item.kind} options={[{ value: 'button', label: 'Button' }, { value: 'widget', label: 'Widget' }]} onChange={(v) => onChange({ ...item, kind: v as Item['kind'] })} />
        {isOpen && <TextField label="Page" value={item.action.slice(5)} onChange={(v) => onChange({ ...item, action: `open:${v}` })} hint="An https page on amberxai.com." />}
      </div>
      <div className="axp-phone-actions">
        <Button size="sm" icon="chevron-up" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up" />
        <Button size="sm" icon="chevron-down" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down" />
        <Button size="sm" icon="trash" tone="danger" disabled={count <= 1} onClick={onRemove} aria-label="Remove" />
      </div>
    </li>
  );
}

/** A phone outline with the toolbar (or the button) and one popup of the chosen type, drawn from the config. */
export function PhonePreview({ o, kind, expanded, play }: { o: Overlay; kind: PopupKind; expanded: boolean; play: number }) {
  const p = o.popups[kind];
  return (
    <div className="axp-phone-preview" role="img" aria-label="Phone preview" data-axf-target="phone-connect.overlay.preview">
      <div className="axp-phone-screen">
        <div key={`${kind}-${play}`} className={`axp-phone-pop axp-phone-pop--${p.position} axp-phone-pop--${p.size} axp-phone-in--${p.enter} axp-phone-pop--${kind}`}
          style={{ opacity: p.opacity, animationDuration: `${p.speedMs}ms` }}>
          <strong>{kind === 'approval' ? 'Deploy console?' : kind === 'alert' ? 'Main is red' : 'Fix landed'}</strong>
          <span className="axp-phone-muted">{kind === 'approval' ? 'Approve / Deny' : kind === 'alert' ? 'check-theme failed' : 'Pull request 712 merged'}</span>
        </div>
        {expanded ? (
          <div className="axp-phone-bar" style={{ opacity: o.toolbarOpacity }}>
            {o.items.map((i) => <span key={i.id} className={`axp-phone-chip axp-phone-chip--${i.kind}`}>{i.label}</span>)}
          </div>
        ) : (
          <span className={`axp-phone-bubble axp-phone-bubble--${o.buttonShape} axp-phone-bubble--s${Math.round(o.buttonSize / 8)}`} style={{ opacity: o.toolbarOpacity }} />
        )}
      </div>
    </div>
  );
}

export function OverlaySettings() {
  const { settings, save, error: setErr } = useSettings();
  const [o, setO] = useState<Overlay | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [kind, setKind] = useState<PopupKind>('approval');
  const [expanded, setExpanded] = useState(true);
  const [play, setPlay] = useState(0);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    void api.call<Overlay>('overlay').then(setO, (e) => setError(errText(e)));
    void api.call<{ presets: Preset[] }>('overlay/presets').then((r) => setPresets(r.presets), () => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);
  const patch = (body: Partial<Overlay> | { popups: Partial<Record<PopupKind, Partial<PopupStyle>>> }) =>
    api.post<Overlay>('overlay', body).then((n) => { setO(n); setError(''); setPlay((x) => x + 1); }, (e) => setError(errText(e)));
  const setItems = (items: Item[]) => void patch({ items });
  const setPopup = (k: PopupKind, v: Partial<PopupStyle>) => void patch({ popups: { [k]: v } });
  if (!o) return <Container title="Overlay" icon="layers">{error ? <Note tone="danger">{error}</Note> : <p className="axp-phone-muted">…</p>}</Container>;
  const p = o.popups[kind];
  return (
    <div className="axp-phone-overlay" data-axf-target="phone-connect.overlay">
      <div className="axp-phone-stack">
        {error && <Note tone="danger">{error}</Note>}
        <Container title="Presets" icon="sparkles">
          <div className="axp-phone-actions" data-axf-target="phone-connect.overlay.presets">
            {presets.map((x) => <Button key={x.id} size="sm" onClick={() => void api.post<Overlay>(`overlay/presets/${x.id}`, {}).then((n) => { setO(n); setPlay((v) => v + 1); }, (e) => setError(errText(e)))} data-axf-target={`phone-connect.overlay.preset.${x.id}`}>{x.label}</Button>)}
          </div>
        </Container>
        <Container title="Toolbar" icon="layout">
          <ul className="axp-phone-list" data-axf-target="phone-connect.overlay.items">
            {o.items.map((it, i) => (
              <ItemRow key={it.id} item={it} index={i} count={o.items.length}
                onChange={(n) => setItems(o.items.map((x) => (x.id === it.id ? n : x)))}
                onMove={(d) => { const a = [...o.items]; const t = a[i + d]; if (!t) return; a[i + d] = it; a[i] = t; setItems(a); }}
                onRemove={() => setItems(o.items.filter((x) => x.id !== it.id))} />
            ))}
          </ul>
          <Button icon="plus" disabled={o.items.length >= 12} onClick={() => setItems([...o.items, { id: `item-${Date.now().toString(36)}`, kind: 'button', icon: 'star', label: 'New', action: 'approvals' }])} data-axf-target="phone-connect.overlay.add-item">Add a button</Button>
        </Container>
        <Container title="Popups" icon="info">
          <TabGroup id="phone-connect.overlay.popups" label="Popup type" value={kind} onChange={setKind}
            tabs={[{ value: 'approval', label: 'Approvals', icon: 'check' }, { value: 'alert', label: 'Alerts', icon: 'alert' }, { value: 'notification', label: 'Notifications', icon: 'bell' }]} />
          <div className="axp-phone-grid" data-axf-target={`phone-connect.overlay.popup.${kind}`}>
            <SelectField label="Position" value={p.position} options={POSITIONS.map((x) => ({ value: x, label: x === 'from-button' ? 'From the button' : label(x) }))} onChange={(v) => setPopup(kind, { position: v })} />
            <SelectField label="Comes in" value={p.enter} options={ANIMATIONS} onChange={(v) => setPopup(kind, { enter: v })} />
            <SelectField label="Goes out" value={p.exit} options={ANIMATIONS} onChange={(v) => setPopup(kind, { exit: v })} />
            <SelectField label="Size" value={p.size} options={['small', 'medium', 'large'].map((x) => ({ value: x, label: label(x) }))} onChange={(v) => setPopup(kind, { size: v })} />
            <Slider label="Speed" value={p.speedMs} min={80} max={2000} step={20} unit=" ms" onChange={(v) => setPopup(kind, { speedMs: v })} />
            <Slider label="Stays" value={Math.round(p.stayMs / 1000)} min={0} max={120} unit=" s (0 = until acted on)" onChange={(v) => setPopup(kind, { stayMs: v * 1000 })} />
            <Slider label="Opacity" value={Math.round(p.opacity * 100)} min={30} max={100} unit="%" onChange={(v) => setPopup(kind, { opacity: v / 100 })} />
            <Switch label="Sound" checked={p.sound} onChange={(v) => setPopup(kind, { sound: v })} />
            <Switch label="Vibrate" checked={p.vibrate} onChange={(v) => setPopup(kind, { vibrate: v })} />
          </div>
        </Container>
        <Container title="Toolbar and button" icon="smartphone">
          <div className="axp-phone-grid" data-axf-target="phone-connect.overlay.button">
            <Slider label="Button size" value={o.buttonSize} min={40} max={80} step={4} unit=" dp" onChange={(v) => void patch({ buttonSize: v })} />
            <Segmented label="Shape" value={o.buttonShape} onChange={(v) => void patch({ buttonShape: v })}
              options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} />
            <Switch label="Snap to the edge" checked={o.edgeSnap} onChange={(v) => void patch({ edgeSnap: v })} />
            <Slider label="Collapse after" value={Math.round(o.autoCollapseMs / 1000)} min={0} max={60} unit=" s (0 = never)" onChange={(v) => void patch({ autoCollapseMs: v * 1000 })} />
            <Slider label="Toolbar opacity" value={Math.round(o.toolbarOpacity * 100)} min={30} max={100} unit="%" onChange={(v) => void patch({ toolbarOpacity: v / 100 })} />
          </div>
        </Container>
        <Container title="Phone" icon="monitor">
          <div className="axp-phone-stack" data-axf-target="phone-connect.overlay.phone">
            <Switch label="Monitor" checked={settings?.monitor ?? true} disabled={!settings} onChange={(v) => void save({ monitor: v })} hint="Approvals and alerts with the screen off." />
            <Switch label="Record my mic too" checked={settings?.recorderMic ?? false} disabled={!settings} onChange={(v) => void save({ recorderMic: v })} hint="Only your own click turns it on." />
            {setErr && <Note tone="warning">{setErr}</Note>}
          </div>
        </Container>
        <DevicePanel />
      </div>
      <aside className="axp-phone-stack axp-phone-aside">
        <PhonePreview o={o} kind={kind} expanded={expanded} play={play} />
        <div className="axp-phone-actions">
          <Button size="sm" icon="play" onClick={() => setPlay((x) => x + 1)} data-axf-target="phone-connect.overlay.replay">Play popup</Button>
          <Button size="sm" icon={expanded ? 'minimize' : 'maximize'} onClick={() => setExpanded((x) => !x)} data-axf-target="phone-connect.overlay.toggle">{expanded ? 'Collapse' : 'Expand'}</Button>
        </div>
        <span className="axp-phone-muted">The phone picks this up on its next poll (about 15 seconds).</span>
      </aside>
    </div>
  );
}
