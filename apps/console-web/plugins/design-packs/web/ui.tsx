import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, IconButton, Segmented, useRuntime } from '@console/axf/react';
import { pluginApi, pluginFetch } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { FOLDER, KEYS } from './keys';
import './design-packs.css';

/*
 * Design packs: every candidate design package as one filterable grid (newest round first). A row opens a large
 * screenshot browser — screens on the left (a collapsible thumbnail strip on a phone), the preview on the right with
 * previous / next pinned above it (they never scroll away) and swipe left / right. Up to 3 picks, saved on the server.
 */

type Shot = { name: string; src: string; device: 'phone' | 'desktop' };
type Pack = { id: string; num: number; name: string; round: number; added: string; desc: string; scheme: 'light' | 'dark'; swatches: string[]; font: number; radius: number; files: Shot[] };
const api = pluginApi(FOLDER, 'Design packs', { unavailable: 'The design packs plugin is switched off or its server part is not running.' });
const MAX_PICKS = 3;
const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: unknown) => { try { return rt.settings.get(k) ?? d; } catch { return d; } };

/** A screenshot through the console token (an <img src> can't send it): fetched once, kept as a blob URL. */
const blobs = new Map<string, Promise<string>>();
function shotUrl(src: string): Promise<string> {
  let p = blobs.get(src);
  if (!p) { p = pluginFetch(FOLDER, `shot?path=${encodeURIComponent(src)}`).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return URL.createObjectURL(await r.blob()); }); blobs.set(src, p); p.catch(() => blobs.delete(src)); }
  return p;
}
function Shot({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; setUrl(''); setFailed(false); shotUrl(src).then((u) => live && setUrl(u), () => live && setFailed(true)); return () => { live = false; }; }, [src]);
  if (failed) return <span className={`axp-design-packs__noimg ${className ?? ''}`}><Icon name="alert" size={14} /></span>;
  return url ? <img src={url} alt={alt} className={className} draggable={false} /> : <span className={`axp-design-packs__noimg ${className ?? ''}`} aria-busy="true" />;
}

export function DesignPacksPage() {
  const rt = useRuntime();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [scheme, setScheme] = useState<'all' | 'light' | 'dark'>('all');
  const [round, setRound] = useState('all');
  const [only, setOnly] = useState<'all' | 'picked'>('all');
  const [open, setOpen] = useState<string[]>([]);

  const load = async () => {
    try {
      const [ix, pk] = await Promise.all([api.call<{ packs: Pack[] }>('index'), api.call<{ picked: string[] }>('picks')]);
      const list = [...(ix.packs ?? [])].sort((a, b) => b.round - a.round || a.num - b.num);
      setPacks(list); setPicked(Array.isArray(pk.picked) ? pk.picked : []); setError('');
      setOpen((o) => (o.length || !list[0] ? o : [list[0].id]));
    } catch (e) { setError((e as Error).message); setPacks((p) => p ?? []); }
  };
  useEffect(() => { void load(); }, []);

  const togglePick = async (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    if (next.length > MAX_PICKS) { rt.toast(`You can pick ${MAX_PICKS}. Untick one first.`, 'warning'); return; }
    setPicked(next);
    try { await api.put('picks', { picked: next }); rt.terminal.log('design-packs', `picks: ${next.join(', ') || 'none'}`, 'ok'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };

  const rounds = useMemo(() => [...new Set((packs ?? []).map((p) => p.round))].sort((a, b) => b - a), [packs]);
  if (!packs) return <LoadingSkeleton rows={5} label="Loading the design packs" />;
  const newest = rounds[0] ?? 0;
  const ql = q.trim().toLowerCase();
  const rows = packs.filter((p) => (scheme === 'all' || p.scheme === scheme) && (round === 'all' || String(p.round) === round) && (only === 'all' || picked.includes(p.id)) && (!ql || `${p.name} ${p.desc} ${p.scheme}`.toLowerCase().includes(ql)));
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  return (
    <div className="fx-stack axp-design-packs">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Look refactor · {packs.length} packs · {rounds.length} rounds</p>
          <h1>Design packs</h1>
          <p className="fx-muted">Pick {MAX_PICKS} to rebuild every default style asset from. Each new round lands at the top.</p>
        </div>
        <div className="axp-design-packs__picks" aria-label={`${picked.length} of ${MAX_PICKS} picked`}>
          <span className="fx-small fx-muted">{picked.length} of {MAX_PICKS} picked</span>
          <span className="axp-design-packs__dots">{Array.from({ length: MAX_PICKS }, (_, i) => <i key={i} className={i < picked.length ? 'is-on' : ''} />)}</span>
          <IconButton icon="refresh" label="Reload" onClick={() => void load()} />
        </div>
      </header>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <div className="axp-design-packs__bar" role="toolbar" aria-label="Filter packs">
        <input className="fx-input axp-design-packs__search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter: name, colour, mood…" aria-label="Filter packs" />
        <Segmented size="sm" label="Scheme" value={scheme} onChange={setScheme} options={[{ value: 'all', label: 'All' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Segmented size="sm" label="Round" value={round} onChange={setRound} options={[{ value: 'all', label: 'All rounds' }, ...rounds.map((r) => ({ value: String(r), label: `Round ${r}` }))]} />
        <Segmented size="sm" label="Show" value={only} onChange={setOnly} options={[{ value: 'all', label: 'Every pack' }, { value: 'picked', label: 'Picked' }]} />
        <span className="fx-small fx-muted axp-design-packs__count">{rows.length} of {packs.length}</span>
      </div>
      {rows.length === 0 ? <EmptyState icon="palette">{packs.length ? 'No packs match.' : 'No design packs yet.'}</EmptyState> : (
        <div className="axp-design-packs__grid" role="list">
          {rows.map((p) => {
            const isOpen = open.includes(p.id); const on = picked.includes(p.id);
            return (
              <div key={p.id} role="listitem" className={`axp-design-packs__pack ${isOpen ? 'is-open' : ''}`}>
                <div className="axp-design-packs__row">
                  <button type="button" data-fx-row className="axp-design-packs__hit" aria-expanded={isOpen} onClick={() => toggle(p.id)}>
                    <Icon name="chevron-down" size={14} className={isOpen ? '' : 'fx-rot--90'} />
                    <span className="axp-design-packs__num fx-small fx-muted">{p.round}.{p.num}</span>
                    <b className="axp-design-packs__name">{p.name}</b>
                    {p.round === newest && rounds.length > 1 && <span className="fx-chip axp-design-packs__new">New</span>}
                    <span className="axp-design-packs__sw" aria-hidden="true">{p.swatches.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                    <span className="axp-design-packs__desc fx-small fx-muted">{p.desc}</span>
                    <span className="axp-design-packs__meta fx-small fx-muted">{p.scheme === 'dark' ? 'Dark' : 'Light'} · {p.font}px · {p.radius}px</span>
                  </button>
                  <Button size="sm" tone={on ? 'primary' : 'neutral'} icon={on ? 'check' : 'plus'} onClick={() => void togglePick(p.id)} aria-pressed={on}>{on ? 'Picked' : 'Pick'}</Button>
                </div>
                {isOpen && <Browser pack={p} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The screenshot browser: list (or thumbnail strip) + preview with pinned previous / next and swipe. */
function Browser({ pack }: { pack: Pack }) {
  const rt = useRuntime();
  const [i, setI] = useState(0);
  const [thumbs, setThumbs] = useState<boolean>(() => setting(rt, KEYS.thumbs, true) !== false);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = pack.files.length;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  useEffect(() => { stage.current?.scrollTo({ top: 0 }); }, [i]);
  const f = pack.files[i] ?? pack.files[0];
  if (!f) return <EmptyState icon="palette" compact>No screenshots in this pack.</EmptyState>;
  const setThumbsSaved = (v: boolean) => { setThumbs(v); try { rt.settings.set(KEYS.thumbs, v); } catch { /* not saved */ } };
  return (
    <div className="axp-design-packs__browser" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'ArrowRight') { go(1); e.preventDefault(); } if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); } }}>
      <div className={`axp-design-packs__files ${thumbs ? '' : 'is-collapsed'}`} role="listbox" aria-label="Screens">
        {pack.files.map((s, k) => (
          <button type="button" data-fx-row key={s.src} role="option" aria-selected={k === i} className={`axp-design-packs__file ${k === i ? 'is-on' : ''}`} onClick={() => setI(k)}>
            <Shot src={s.src} alt="" className="axp-design-packs__thumb" />
            <span className="axp-design-packs__fname">{s.name}</span>
          </button>
        ))}
      </div>
      <div className="axp-design-packs__pane">
        <div className="axp-design-packs__pbar">
          <IconButton icon="chevron-left" label="Previous screen" onClick={() => go(-1)} />
          <IconButton icon="chevron-right" label="Next screen" onClick={() => go(1)} />
          <span className="axp-design-packs__ptitle">{f.name}</span>
          <span className="fx-small fx-muted axp-design-packs__pcount">{i + 1} / {n}</span>
          <IconButton icon={thumbs ? 'chevron-up' : 'chevron-down'} label={thumbs ? 'Hide the screens list' : 'Show the screens list'} aria-expanded={thumbs} onClick={() => setThumbsSaved(!thumbs)} />
        </div>
        <div ref={stage} className={`axp-design-packs__stage is-${f.device}`}
          onTouchStart={(e) => { const t = e.touches[0]; if (t) touch.current = { x: t.clientX, y: t.clientY }; }}
          onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (!s) return; const t = e.changedTouches[0]; if (!t) return; const dx = t.clientX - s.x; const dy = t.clientY - s.y; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1); }}>
          <Shot src={f.src} alt={`${pack.name} · ${f.name}`} className="axp-design-packs__img" />
        </div>
      </div>
    </div>
  );
}
