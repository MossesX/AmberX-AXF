/**
 * The live view: a picture of the VPS browser's active tab (CDP screencast frames on a canvas) that forwards taps,
 * clicks, drags, wheel / touch scrolling and keys back to it, with the address bar, tabs, device and zoom around it.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Button, IconButton, Note, Segmented, TextField, useRuntime } from '@console/axf/react';
import { get, keyName, liveUrl, post, type BrowserState, type Device, type Download } from './api';

type Conn = 'connecting' | 'live' | 'down';
type Zoom = 'fit' | '50' | '75' | '100' | '150';
interface Frame { w: number; h: number }
interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void }

const TAP_SLOP = 8; // CSS px of movement before a touch becomes a scroll
const MOVE_EVERY = 50; // ms between forwarded hover moves

export function LiveView({ workspace, device: startDevice, homeUrl }: { workspace: string; device: Device; homeUrl: string }) {
  const rt = useRuntime();
  const canvas = useRef<HTMLCanvasElement>(null);
  const sock = useRef<WebSocket | null>(null);
  const frame = useRef<Frame>({ w: 0, h: 0 });
  const pending = useRef(new Map<string, Pending>());
  const seq = useRef(0);
  const [conn, setConn] = useState<Conn>('connecting');
  const [err, setErr] = useState('');
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [device, setDevice] = useState<Device>(startDevice);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [kbd, setKbd] = useState(false);
  const [typed, setTyped] = useState('');
  const [downloads, setDownloads] = useState<Download[] | null>(null);
  const [retry, setRetry] = useState(0);

  // ---- socket --------------------------------------------------------------------------------------------------------
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const img = new Image();
    let drawing = false;
    let next: string | null = null;
    const draw = (data: string) => {
      if (drawing) { next = data; return; }
      drawing = true;
      img.onload = () => {
        const c = canvas.current;
        if (c) {
          if (c.width !== img.naturalWidth || c.height !== img.naturalHeight) { c.width = img.naturalWidth; c.height = img.naturalHeight; }
          c.getContext('2d')?.drawImage(img, 0, 0);
        }
        drawing = false;
        if (next) { const n = next; next = null; draw(n); }
      };
      img.onerror = () => { drawing = false; };
      img.src = `data:image/jpeg;base64,${data}`;
    };
    (async () => {
      setConn('connecting');
      try {
        ws = new WebSocket(await liveUrl(workspace, startDevice));
      } catch (e) {
        if (!closed) { setConn('down'); setErr((e as Error).message); }
        return;
      }
      sock.current = ws;
      ws.onopen = () => { if (!closed) { setConn('live'); setErr(''); } };
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as Record<string, any>;
        switch (m.t) {
          case 'frame': frame.current = { w: m.w, h: m.h }; draw(m.data); break;
          case 'hello': break;
          case 'state': setState(m as unknown as BrowserState); setDevice(m.device); break;
          case 'result': pending.current.get(m.id)?.resolve(m.result); pending.current.delete(m.id); break;
          case 'error':
            if (m.id && pending.current.has(m.id)) { pending.current.get(m.id)!.reject(new Error(m.error)); pending.current.delete(m.id); }
            else if (m.error) { setErr(m.error); setConn('down'); }
            break;
          case 'blocked': rt.toast(`${m.url}: ${m.reason}`, 'warning', 'Blocked'); break;
          case 'dialog': rt.toast(m.message || m.kind, 'info', `Page ${m.kind}`); break;
          case 'download': rt.toast(m.error ? `${m.name}: ${m.error}` : `${m.name} saved on the VPS`, m.error ? 'danger' : 'success', 'Download'); break;
          case 'closed': setConn('down'); setErr('The browser was closed.'); break;
          default: break;
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setConn('down');
        for (const p of pending.current.values()) p.reject(new Error('live view disconnected'));
        pending.current.clear();
        timer = setTimeout(() => setRetry((n) => n + 1), 3000);
      };
    })();
    return () => { closed = true; clearTimeout(timer); ws?.close(); sock.current = null; };
  }, [workspace, startDevice, retry, rt]);

  useEffect(() => { if (!editing && state) setAddress(state.url === 'about:blank' ? '' : state.url); }, [state, editing]);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = sock.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  /** A command over the socket, answered by id. */
  const cmd = useCallback(<T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => new Promise((resolve, reject) => {
    const id = `c${++seq.current}`;
    pending.current.set(id, { resolve: resolve as (v: unknown) => void, reject });
    const ws = sock.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { pending.current.delete(id); reject(new Error('live view not connected')); return; }
    ws.send(JSON.stringify({ t: 'cmd', cmd: name, args, id }));
  }), []);

  const fail = (e: unknown) => rt.toast((e as Error).message, 'danger', 'Browser');

  // ---- input -----------------------------------------------------------------------------------------------------------
  const point = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const f = frame.current;
    const w = f.w || c.width, h = f.h || c.height;
    return { x: Math.round(((e.clientX - r.left) / r.width) * w), y: Math.round(((e.clientY - r.top) / r.height) * h) };
  };
  const drag = useRef<{ id: number; x: number; y: number; lx: number; ly: number; touch: boolean; scrolling: boolean } | null>(null);
  const lastMove = useRef(0);
  const button = (b: number) => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left');

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    canvas.current?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const touch = e.pointerType !== 'mouse';
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, touch, scrolling: false };
    if (!touch) send({ t: 'mouse', action: 'down', ...point(e), button: button(e.button), clicks: e.detail || 1 });
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d && d.touch) {
      if (!d.scrolling && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) d.scrolling = true;
      if (d.scrolling) {
        const r = canvas.current!.getBoundingClientRect();
        const k = (frame.current.w || r.width) / r.width;
        send({ t: 'wheel', ...point(e), dx: Math.round((d.lx - e.clientX) * k), dy: Math.round((d.ly - e.clientY) * k) });
        d.lx = e.clientX; d.ly = e.clientY;
      }
      return;
    }
    const now = performance.now();
    if (now - lastMove.current < MOVE_EVERY) return;
    lastMove.current = now;
    send({ t: 'mouse', action: 'move', ...point(e) });
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.touch) { if (!d.scrolling) send({ t: 'mouse', action: 'click', ...point(e) }); return; }
    send({ t: 'mouse', action: 'up', ...point(e), button: button(e.button), clicks: e.detail || 1 });
  };
  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => send({ t: 'wheel', ...point(e), dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) });
  const onKey = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === 'Unidentified' || e.key === 'Process') return;
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) send({ t: 'text', text: e.key });
    else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) send({ t: 'key', key: keyName(e) });
  };
  const onPaste = (e: React.ClipboardEvent<HTMLCanvasElement>) => { const text = e.clipboardData.getData('text'); if (text) { e.preventDefault(); send({ t: 'text', text }); } };

  // ---- toolbar actions -------------------------------------------------------------------------------------------------
  const go = (e?: FormEvent) => {
    e?.preventDefault();
    setEditing(false);
    const url = address.trim() || homeUrl;
    void cmd('navigate', { url }).catch(fail);
    canvas.current?.focus();
  };
  const changeDevice = (d: Device) => { setDevice(d); void cmd('device', { preset: d }).catch(fail); };
  const sendTyped = (e?: FormEvent) => { e?.preventDefault(); if (typed) { send({ t: 'text', text: typed }); setTyped(''); } };
  const shot = async () => {
    try {
      const r = await post<{ type: string; data: string }>('screenshot', { workspace, tab: state?.active });
      const blob = await (await fetch(`data:image/${r.type};base64,${r.data}`)).blob();
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (e) { fail(e); }
  };
  const loadDownloads = async () => {
    if (downloads) { setDownloads(null); return; }
    try { setDownloads((await get<{ items: Download[] }>(`downloads?workspace=${encodeURIComponent(workspace)}`)).items); } catch (e) { fail(e); }
  };
  const saveDownload = async (name: string) => {
    try {
      const { pluginFetch } = await import('@console/plugins');
      const r = await pluginFetch('auto-browser', `download?workspace=${encodeURIComponent(workspace)}&name=${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(`download failed (${r.status})`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
    } catch (e) { fail(e); }
  };

  const tabs = state?.tabs ?? [];
  return (
    <div className="axp-auto-browser__live" data-device={device}>
      <form className="axp-auto-browser__bar" onSubmit={go}>
        <IconButton icon="arrow-left" label="Back" data-help="back" disabled={conn !== 'live'} onClick={() => void cmd('back').catch(fail)} />
        <IconButton icon="arrow-right" label="Forward" data-help="forward" disabled={conn !== 'live'} onClick={() => void cmd('forward').catch(fail)} />
        <IconButton icon="refresh" label="Reload" data-help="reload" disabled={conn !== 'live'} onClick={() => void cmd('reload').catch(fail)} />
        <div className="axp-auto-browser__address" data-help="address" onFocus={() => setEditing(true)} onBlur={() => setEditing(false)}>
          <TextField label="Address" value={address} onChange={setAddress} placeholder={homeUrl} mono />
        </div>
        <Button type="submit" tone="primary" size="sm" icon="arrow-right" disabled={conn !== 'live'}>Go</Button>
      </form>

      <div className="axp-auto-browser__tabs" role="tablist" aria-label="Tabs">
        {tabs.map((t) => (
          <span key={t.id} className="axp-auto-browser__tab" role="tab" aria-selected={t.active}>
            <Button size="sm" tone={t.active ? 'primary' : 'quiet'} className="axp-auto-browser__tabtitle" title={t.url} onClick={() => void cmd('activate', { tab: t.id }).catch(fail)}>{t.title || t.url || 'New tab'}</Button>
            <IconButton icon="x" label={`Close ${t.title || 'tab'}`} onClick={() => void cmd('closeTab', { tab: t.id }).catch(fail)} />
          </span>
        ))}
        <IconButton icon="plus" label="New tab" data-help="new-tab" disabled={conn !== 'live'} onClick={() => void cmd('newTab', { url: homeUrl }).catch(fail)} />
      </div>

      <div className="axp-auto-browser__tools">
        <span data-help="device"><Segmented size="sm" label="Device size" value={device} onChange={changeDevice} options={[
          { value: 'desktop', label: 'Desktop', icon: 'monitor' }, { value: 'tablet', label: 'Tablet', icon: 'layout' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]} /></span>
        <span data-help="zoom"><Segmented size="sm" label="Zoom" value={zoom} onChange={setZoom} options={[
          { value: 'fit', label: 'Fit' }, { value: '50', label: '50%' }, { value: '75', label: '75%' }, { value: '100', label: '100%' }, { value: '150', label: '150%' }]} /></span>
        <Button size="sm" tone={kbd ? 'primary' : 'neutral'} icon="keyboard" data-help="keyboard" onClick={() => setKbd((k) => !k)}>Keyboard</Button>
        <Button size="sm" icon="eye" data-help="screenshot" disabled={conn !== 'live'} onClick={() => void shot()}>Screenshot</Button>
        <Button size="sm" icon="download" data-help="downloads" onClick={() => void loadDownloads()}>Downloads</Button>
        <span className={`fx-chip axp-auto-browser__conn is-${conn}`}>{conn === 'live' ? 'Live' : conn === 'connecting' ? 'Connecting…' : 'Offline'} · {workspace}</span>
      </div>

      {kbd && (
        <form className="axp-auto-browser__kbd" onSubmit={sendTyped}>
          <TextField label="Type into the page" value={typed} onChange={setTyped} placeholder="Tap a field on the page first" />
          <Button type="submit" size="sm" tone="primary">Send</Button>
          <Button size="sm" onClick={() => send({ t: 'key', key: 'Enter' })}>Enter</Button>
          <Button size="sm" onClick={() => send({ t: 'key', key: 'Backspace' })}>⌫</Button>
          <Button size="sm" onClick={() => send({ t: 'key', key: 'Tab' })}>Tab</Button>
        </form>
      )}

      {downloads && (
        <div className="axp-auto-browser__downloads">
          {downloads.length === 0 ? <p className="fx-muted">Nothing downloaded in this workspace yet.</p> : downloads.map((d) => (
            <Button key={d.name} size="sm" icon="download" onClick={() => void saveDownload(d.name)}>{d.name} · {Math.max(1, Math.round(d.size / 1024))} KB</Button>
          ))}
        </div>
      )}

      {conn === 'down' && (
        <Note tone="warning">
          {err || 'The live view is disconnected.'} Trying again… If the browser host isn't running, Settings → Plugins → Automated Browser shows how to start it.
        </Note>
      )}

      <div className={`axp-auto-browser__screen is-zoom-${zoom}`}>
        <canvas ref={canvas} className="axp-auto-browser__canvas" tabIndex={0} aria-label="Live view of the VPS browser"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
          onWheel={onWheel} onKeyDown={onKey} onPaste={onPaste} onContextMenu={(e) => e.preventDefault()} />
      </div>
    </div>
  );
}
