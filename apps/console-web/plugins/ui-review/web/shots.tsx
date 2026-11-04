import { useEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { EmptyState } from '@console/emptyState';
import type { Shot as ShotT } from './review-core.mjs';
import { FOLDER, KEYS } from './keys';

const SHOT_TIMEOUT_MS = 20000;

/** One fetch with a timeout: a picture never waits forever behind other requests. 404 = the file is gone. */
async function fetchShot(src: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), SHOT_TIMEOUT_MS);
  try {
    const r = await pluginFetch(FOLDER, `shot?path=${encodeURIComponent(src)}`, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status === 404 ? 'missing' : `HTTP ${r.status}`);
    return URL.createObjectURL(await r.blob());
  } catch (e) {
    throw new Error(ctl.signal.aborted ? 'timeout' : (e as Error).message);
  } finally { clearTimeout(t); }
}

/** A screenshot through the console token (an <img src> can't send it): fetched once (one retry unless it's gone), kept
 *  as a blob URL. A failure is reported to the server so the systems check shows it. */
const blobs = new Map<string, Promise<string>>();
function shotUrl(src: string): Promise<string> {
  let p = blobs.get(src);
  if (!p) {
    p = fetchShot(src).catch((e: Error) => (e.message === 'missing' ? Promise.reject(e) : fetchShot(src)));
    blobs.set(src, p);
    p.catch((e: Error) => {
      blobs.delete(src);
      void pluginFetch(FOLDER, 'shot-failed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src, reason: e.message }) }).catch(() => undefined);
    });
  }
  return p;
}

/**
 * One picture. While it loads: a placeholder. If it can't load: "Shot missing" (never a blank); with `actions`, also
 * Retry and Re-capture (hands the screen to the screenshots agent), shown only where it isn't inside a button.
 */
export function Shot({ src, alt, className, actions = false }: { src: string; alt: string; className?: string; actions?: boolean }) {
  const rt = useRuntime();
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; setUrl(''); setFailed(''); shotUrl(src).then((u) => live && setUrl(u), (e: Error) => live && setFailed(e.message || 'failed')); return () => { live = false; }; }, [src, n]);
  const recapture = async () => {
    setBusy(true);
    try {
      const r = await pluginFetch(FOLDER, 'recapture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; detail?: string };
      rt.toast(j.message ?? j.detail ?? (r.ok ? 'Re-capture started' : `HTTP ${r.status}`), j.ok ? 'success' : 'warning', 'UI Review');
    } catch (e) { rt.toast((e as Error).message, 'danger', 'UI Review'); } finally { setBusy(false); }
  };
  if (failed) {
    const label = failed === 'missing' ? 'Shot missing' : "Shot didn't load";
    return (
      <span className={`axp-ui-review__noimg is-failed ${className ?? ''}`} role="img" aria-label={`${label}: ${alt}`} title={`${label} (${failed})`}>
        <Icon name="alert" size={14} />
        <span className="axp-ui-review__noimg-text">{label}</span>
        {actions && (
          <span className="axp-ui-review__noimg-acts">
            {failed !== 'missing' && <Button size="sm" icon="refresh" onClick={() => setN(n + 1)}>Retry</Button>}
            <Button size="sm" icon="monitor" disabled={busy} onClick={() => void recapture()}>Re-capture</Button>
          </span>
        )}
      </span>
    );
  }
  return url ? <img src={url} alt={alt} className={className} draggable={false} loading="lazy" /> : <span className={`axp-ui-review__noimg ${className ?? ''}`} aria-busy="true" />;
}

const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: unknown) => { try { return rt.settings.get(k) ?? d; } catch { return d; } };

/**
 * The screenshot browser: screens list (a collapsible thumbnail strip on a phone) + the preview with previous / next
 * pinned above it (they never scroll away), swipe left / right and arrow keys. `index` / `onIndex` let Compare drive it.
 */
export function ShotBrowser({ shots, title, index, onIndex, list = true }: { shots: ShotT[]; title: string; index?: number; onIndex?: (i: number) => void; list?: boolean }) {
  const rt = useRuntime();
  const [own, setOwn] = useState(0);
  const n = shots.length;
  const i = Math.min(index ?? own, Math.max(0, n - 1));
  const setI = (v: number) => (onIndex ? onIndex(v) : setOwn(v));
  const [thumbs, setThumbs] = useState<boolean>(() => list && setting(rt, KEYS.thumbs, true) !== false);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const go = (d: number) => setI((i + d + n) % n);
  useEffect(() => { stage.current?.scrollTo({ top: 0 }); }, [i]);
  const f = shots[i];
  if (!f) return <EmptyState icon="eye" compact>No screenshots for this one.</EmptyState>;
  const setThumbsSaved = (v: boolean) => { setThumbs(v); try { rt.settings.set(KEYS.thumbs, v); } catch { /* not saved */ } };
  return (
    <div className={`axp-ui-review__browser ${list ? '' : 'is-bare'}`} tabIndex={-1} onKeyDown={(e) => { if (e.key === 'ArrowRight') { go(1); e.preventDefault(); } if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); } }}>
      {list && (
        <div className={`axp-ui-review__files ${thumbs ? '' : 'is-collapsed'}`} role="listbox" aria-label="Screens">
          {shots.map((s, k) => (
            <button type="button" data-fx-row key={`${s.src}-${k}`} role="option" aria-selected={k === i} className={`axp-ui-review__file ${k === i ? 'is-on' : ''}`} onClick={() => setI(k)}>
              <Shot src={s.src} alt="" className="axp-ui-review__thumb" />
              <span className="axp-ui-review__fname">{s.name}<span className="fx-muted"> · {s.device === 'phone' ? 'Phone' : 'Desktop'}</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="axp-ui-review__pane">
        <div className="axp-ui-review__pbar">
          <IconButton icon="chevron-left" label="Previous screen" onClick={() => go(-1)} />
          <IconButton icon="chevron-right" label="Next screen" onClick={() => go(1)} />
          <span className="axp-ui-review__ptitle">{f.name}</span>
          <span className="fx-small fx-muted axp-ui-review__pcount">{i + 1} / {n}</span>
          {list && <IconButton icon={thumbs ? 'chevron-up' : 'chevron-down'} label={thumbs ? 'Hide the screens list' : 'Show the screens list'} aria-expanded={thumbs} onClick={() => setThumbsSaved(!thumbs)} />}
        </div>
        <div ref={stage} className={`axp-ui-review__stage is-${f.device}`}
          onTouchStart={(e) => { const t = e.touches[0]; if (t) touch.current = { x: t.clientX, y: t.clientY }; }}
          onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (!s) return; const t = e.changedTouches[0]; if (!t) return; const dx = t.clientX - s.x; const dy = t.clientY - s.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1); }}>
          <Shot src={f.src} alt={`${title} · ${f.name}`} className="axp-ui-review__img" actions />
        </div>
      </div>
    </div>
  );
}
