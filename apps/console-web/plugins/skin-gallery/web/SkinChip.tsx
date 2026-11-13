/**
 * The banner's quick skin switcher: a chip with the skin in force on the screen in front, and a popover listing every
 * skin with one-tap Use, plus Back to skin and Undo, at the plugin's default scope (Settings → Plugins → Skins).
 * Right-click: Settings… / Change… / Move (contextItems.ts). Hidden when the bannerChip setting is off.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, useAxfState } from '@console/axf/react';
import { backAt, listSkins, readState, scopeLabel, undoLast, useSkinAt, type ScopeView, type SkinRow } from './api';
import { defaultScope, onSettings, settings } from './settings';

const useSettings = () => useSyncExternalStore(onSettings, settings, settings);

export function SkinChip() {
  const st = useAxfState();
  const conf = useSettings();
  const [skins, setSkins] = useState<SkinRow[]>([]);
  const [here, setHere] = useState<ScopeView | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState('');
  const btn = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const scope = conf.defaultScope || defaultScope();
  const shown = st.view ? `ui:${st.view}` : 'app';

  useEffect(() => { void listSkins().then(setSkins, () => undefined); }, []);
  useEffect(() => { void readState(shown).then(setHere, () => setHere(null)); }, [shown]);
  useEffect(() => {
    if (!at) return;
    const off = (e: Event) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key); };
  }, [at]);
  if (!conf.bannerChip || !skins.length) return null;

  const name = here?.inForce.id ? skins.find((s) => s.id === here.inForce.id)?.name ?? here.inForce.id : 'No skin';
  const run = async (what: string, fn: () => Promise<ScopeView>) => {
    setBusy(what);
    try { await fn(); setHere(await readState(shown)); } catch { /* the gallery shows why */ } finally { setBusy(''); }
  };
  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(280, globalThis.innerWidth - 16);
    setAt(at ? null : { top: r.bottom, left: Math.max(8, Math.min(r.right - w, globalThis.innerWidth - w - 8)) });
  };

  return (
    <span ref={btn} className="axp-skin-gallery-chip" data-fx-ctx-target="skin-gallery-chip" data-fx-ctx-payload={scope}>
      <Button size="sm" tone="ghost" icon="palette" aria-haspopup="menu" aria-expanded={!!at} title={`Skin here: ${name} (from ${here ? scopeLabel(here.inForce.from) : '…'})`} onClick={open}>{name}</Button>
      {at && createPortal(
        <div ref={pop} className="fx-popover fx-dropdown axp-skin-gallery-chip__pop" style={{ top: at.top, left: at.left }} data-fx-overlay="">
          <p className="fx-eyebrow axp-skin-gallery-chip__head">Use at {scopeLabel(scope)}</p>
          <ul className="fx-menu" role="menu" aria-label="Skins">
            {skins.map((s) => (
              <li key={s.id} className="fx-menu__li">
                <button type="button" role="menuitemradio" aria-checked={s.id === here?.inForce.id} className="fx-menu__item" disabled={!!busy} onClick={() => void run('use', () => useSkinAt(s.id, scope))}>
                  <span className="fx-menu__icon">{s.id === here?.inForce.id && <Icon name="check" size={14} />}</span><span className="fx-menu__label">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="axp-skin-gallery-chip__bar" role="toolbar" aria-label="Skin quick actions">
            <Button size="sm" tone="quiet" icon="arrow-left" busy={busy === 'back'} onClick={() => void run('back', () => backAt(scope))}>Back</Button>
            <Button size="sm" tone="quiet" icon="undo" busy={busy === 'undo'} disabled={!here?.canUndo} onClick={() => void run('undo', undoLast)}>Undo</Button>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
