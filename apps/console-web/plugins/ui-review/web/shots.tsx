import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { EmptyState } from '@console/emptyState';
import type { Shot as ShotT } from './review-core.mjs';
import { FOLDER, KEYS } from './keys';

/** A screenshot through the console token (an <img src> can't send it): fetched once, kept as a blob URL. */
const blobs = new Map<string, Promise<string>>();
function shotUrl(src: string): Promise<string> {
  let p = blobs.get(src);
  if (!p) { p = pluginFetch(FOLDER, `shot?path=${encodeURIComponent(src)}`).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return URL.createObjectURL(await r.blob()); }); blobs.set(src, p); p.catch(() => blobs.delete(src)); }
  return p;
}

export function Shot({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; setUrl(''); setFailed(false); shotUrl(src).then((u) => live && setUrl(u), () => live && setFailed(true)); return () => { live = false; }; }, [src]);
  if (failed) return <span className={`axp-ui-review__noimg ${className ?? ''}`}><Icon name="alert" size={14} /></span>;
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
          <Shot src={f.src} alt={`${title} · ${f.name}`} className="axp-ui-review__img" />
        </div>
      </div>
    </div>
  );
}
