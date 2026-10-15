/** Miniature live previews of any asset — used by asset cards in the studio. */
import type * as React from 'react';
import { compileLayout, type Asset, type AssetEnvelope, type AssetType } from '../../core';
import { Icon } from '../components/Icon';

const box = (style: React.CSSProperties = {}): React.CSSProperties => ({
  background: 'var(--fx-surface3)',
  borderRadius: 3,
  ...style,
});

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="fx-pv-screen">{children}</div>;
}

export function AssetPreview({ asset }: { asset: AssetEnvelope }) {
  const a = asset as Asset<AssetType>;
  switch (a.type) {
    case 'color-theme': {
      const t = (a as Asset<'color-theme'>).data.tokens;
      return (
        <div className="fx-pv-screen" style={{ background: t.bg, borderColor: t.border }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
            <div style={{ height: 6, width: '60%', background: t.text, borderRadius: 3, opacity: 0.85 }} />
            <div style={{ height: 5, width: '85%', background: t.muted, borderRadius: 3, opacity: 0.6 }} />
            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
              <span style={{ background: t.accent, color: t.accentText, fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4 }}>Aa</span>
              {[t.success, t.warning, t.danger, t.info].map((c) => (
                <span key={c} style={{ width: 14, borderRadius: 3, background: c }} />
              ))}
            </div>
          </div>
        </div>
      );
    }
    case 'style-theme': {
      const s = (a as Asset<'style-theme'>).data;
      return (
        <Screen>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: s.fontDisplay, fontWeight: s.headingWeight, fontSize: 30, letterSpacing: `${s.tracking}em`, lineHeight: 1, color: 'var(--fx-text)' }}>Aa</span>
            <div style={{ display: 'grid', gap: 4, flex: 1 }}>
              <div style={{ height: 14, border: '1.5px solid var(--fx-accent)', borderRadius: s.radius.md, boxShadow: s.shadow.sm }} />
              <div style={{ fontFamily: s.fontMono, fontSize: 9, color: 'var(--fx-muted)' }}>
                r{s.radius.md} · {s.density}
              </div>
            </div>
          </div>
        </Screen>
      );
    }
    case 'layout': {
      const l = (a as Asset<'layout'>).data;
      const c = compileLayout({ ...l, navWidth: l.navWidth > 120 ? 30 : 14, inspectorWidth: 34 });
      const fill: Record<string, React.CSSProperties> = {
        menubar: box({ height: 6 }),
        toolbar: box({ height: 8, opacity: 0.7 }),
        nav: box({ background: 'var(--fx-accent)', opacity: 0.55, minHeight: l.nav === 'top' ? 7 : undefined }),
        main: box({ background: 'var(--fx-surface)', border: '1px dashed var(--fx-border)' }),
        inspector: box({ opacity: 0.6 }),
        status: box({ height: 4, opacity: 0.6 }),
      };
      return (
        <div
          className="fx-pv-screen"
          style={{ display: 'grid', gap: 3, gridTemplateAreas: c.areas, gridTemplateColumns: c.columns, gridTemplateRows: c.rows.replace('minmax(0, 1fr)', '1fr'), padding: 6 }}
        >
          {c.regions.map((r) => (
            <div key={r} style={{ gridArea: r, ...fill[r] }} />
          ))}
        </div>
      );
    }
    case 'button': {
      const b = (a as Asset<'button'>).data;
      const radius = b.shape === 'pill' ? 999 : b.shape === 'square' ? 2 : 7;
      const fills: Record<string, React.CSSProperties> = {
        solid: { background: 'var(--fx-accent)', color: 'var(--fx-accent-text)' },
        soft: { background: 'var(--fx-accent-soft)', color: 'var(--fx-accent)' },
        outline: { background: 'transparent', color: 'var(--fx-accent)', boxShadow: 'inset 0 0 0 1.5px var(--fx-accent)' },
        gradient: { background: 'linear-gradient(135deg, var(--fx-accent), var(--fx-info))', color: 'var(--fx-accent-text)' },
      };
      const pad = { sm: '4px 10px', md: '7px 14px', lg: '9px 18px' }[b.size];
      return (
        <Screen>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            <span style={{ ...fills[b.fill], borderRadius: radius, padding: pad, fontWeight: b.weight, fontSize: 11, textTransform: b.uppercase ? 'uppercase' : 'none', letterSpacing: b.uppercase ? '0.06em' : 0, boxShadow: b.elevation ? 'var(--fx-shadow-sm)' : fills[b.fill]?.boxShadow }}>
              Button
            </span>
            <span style={{ borderRadius: radius, padding: pad, fontSize: 11, background: 'var(--fx-surface3)', color: 'var(--fx-text)' }}>Alt</span>
          </div>
        </Screen>
      );
    }
    case 'slider': {
      const s = (a as Asset<'slider'>).data;
      const r = s.thumb === 'circle' ? '50%' : s.thumb === 'bar' ? 2 : 3;
      const w = s.thumb === 'bar' ? Math.max(5, s.thumbSize / 3) : s.thumbSize;
      const fill = s.fill === 'gradient' ? 'linear-gradient(90deg, var(--fx-info), var(--fx-accent))' : s.fill === 'solid' ? 'var(--fx-accent)' : 'transparent';
      return (
        <Screen>
          <div style={{ position: 'relative', height: Math.max(s.thumbSize, 14), display: 'flex', alignItems: 'center' }}>
            <div style={{ height: s.track, width: '100%', background: 'var(--fx-surface3)', borderRadius: 99 }}>
              <div style={{ height: '100%', width: '62%', background: fill, borderRadius: 99 }} />
            </div>
            <div style={{ position: 'absolute', left: `calc(62% - ${w / 2}px)`, width: w, height: s.thumbSize, borderRadius: r, background: 'var(--fx-surface)', border: '2px solid var(--fx-accent)' }} />
          </div>
          {s.ticks && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>{Array.from({ length: 6 }, (_, i) => <span key={i} style={{ width: 1, height: 4, background: 'var(--fx-muted)' }} />)}</div>}
        </Screen>
      );
    }
    case 'container': {
      const c = (a as Asset<'container'>).data;
      const bg = c.variant === 'glass' ? 'color-mix(in srgb, var(--fx-surface) 60%, transparent)' : c.variant === 'outline' ? 'transparent' : c.variant === 'panel' ? 'var(--fx-surface2)' : 'var(--fx-surface)';
      return (
        <Screen>
          <div style={{ background: bg, border: c.variant === 'card' && c.elevation > 1 ? 'none' : '1px solid var(--fx-border)', borderRadius: 6, boxShadow: c.elevation ? `var(--fx-shadow-${['sm', 'sm', 'md', 'lg'][c.elevation]})` : 'none', overflow: 'hidden' }}>
            <div style={{ height: 10, borderBottom: c.header === 'divided' ? '1px solid var(--fx-border)' : 'none', borderLeft: c.header === 'accent' ? '3px solid var(--fx-accent)' : 'none', margin: c.header === 'accent' ? '6px 0 0 0' : 0, padding: '0 6px', display: 'flex', alignItems: 'center' }}>
              <span style={{ height: 4, width: 30, background: 'var(--fx-text)', opacity: 0.7, borderRadius: 2 }} />
            </div>
            <div style={{ padding: { sm: 4, md: 7, lg: 10 }[c.padding] }}>
              <div style={{ height: 4, width: '80%', background: 'var(--fx-muted)', opacity: 0.5, borderRadius: 2 }} />
            </div>
          </div>
        </Screen>
      );
    }
    case 'dialog': {
      const d = (a as Asset<'dialog'>).data;
      const panel: React.CSSProperties =
        d.variant === 'drawer'
          ? { position: 'absolute', right: 0, top: 0, bottom: 0, width: '45%' }
          : d.variant === 'sheet'
            ? { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', borderRadius: '8px 8px 0 0' }
            : { position: 'absolute', left: '22%', right: '22%', top: '18%', bottom: '18%', borderRadius: 6 };
      return (
        <div className="fx-pv-screen" style={{ position: 'relative', overflow: 'hidden', minHeight: 64 }}>
          <div style={{ position: 'absolute', inset: 0, background: d.backdrop === 'none' ? 'transparent' : 'rgba(0,0,0,.35)', backdropFilter: d.backdrop === 'blur' ? 'blur(2px)' : undefined }} />
          <div style={{ ...panel, background: 'var(--fx-surface)', border: '1px solid var(--fx-border)', overflow: 'hidden' }}>
            <div style={{ height: d.header === 'filled' ? 10 : 6, background: d.header === 'filled' ? 'var(--fx-accent)' : 'transparent', borderTop: d.header === 'accent-bar' ? '3px solid var(--fx-accent)' : 'none' }} />
          </div>
        </div>
      );
    }
    case 'popup': {
      const p = (a as Asset<'popup'>).data;
      const pos: React.CSSProperties = {
        'top-right': { top: 6, right: 6 },
        'bottom-right': { bottom: 6, right: 6 },
        'bottom-center': { bottom: 6, left: '50%', transform: 'translateX(-50%)' },
        'top-center': { top: 6, left: '50%', transform: 'translateX(-50%)' },
      }[p.position];
      const look: React.CSSProperties =
        p.variant === 'solid' ? { background: 'var(--fx-text)' } : p.variant === 'outline' ? { background: 'var(--fx-surface)', border: '1.5px solid var(--fx-accent)' } : { background: 'var(--fx-surface)', borderLeft: '3px solid var(--fx-accent)' };
      return (
        <div className="fx-pv-screen" style={{ position: 'relative', minHeight: 64 }}>
          <div style={{ position: 'absolute', width: 54, height: 14, borderRadius: 4, ...look, ...pos }} />
        </div>
      );
    }
    case 'app-menu': {
      const m = (a as Asset<'app-menu'>).data;
      return (
        <Screen>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--fx-text)' }}>
            {m.menus.map((x) => (
              <span key={x.id}>{x.label}</span>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fx-muted)', marginTop: 6 }}>
            {m.menus.reduce((n, x) => n + x.items.filter((i) => !i.separator).length, 0)} commands
          </div>
        </Screen>
      );
    }
    case 'toolbar': {
      const t = (a as Asset<'toolbar'>).data;
      return (
        <Screen>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: t.align === 'center' ? 'center' : t.align === 'spread' ? 'space-between' : 'flex-start', color: 'var(--fx-text)' }}>
            {t.groups.map((g) => (
              <span key={g.id} style={{ display: 'flex', gap: 4, padding: '0 4px', borderRight: '1px solid var(--fx-border)' }}>
                {g.items.slice(0, 3).map((i) => (t.variant === 'labels' ? <span key={i.id} style={{ fontSize: 9 }}>{i.label}</span> : <Icon key={i.id} name={i.icon} size={12} />))}
              </span>
            ))}
          </div>
        </Screen>
      );
    }
    case 'nav-menu': {
      const n = (a as Asset<'nav-menu'>).data;
      const items = n.sections.flatMap((s) => s.items).slice(0, 4);
      return (
        <Screen>
          <div style={{ display: 'grid', gap: 3, gridTemplateColumns: n.style === 'rail' ? 'repeat(4, 22px)' : '1fr' }}>
            {items.map((i, idx) => (
              <span key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, padding: '2px 5px', borderRadius: n.style === 'pills' ? 99 : 3, background: idx === 0 ? 'var(--fx-accent-soft)' : 'transparent', color: idx === 0 ? 'var(--fx-accent)' : 'var(--fx-text)' }}>
                <Icon name={i.icon} size={11} />
                {n.style !== 'rail' && i.label}
              </span>
            ))}
          </div>
        </Screen>
      );
    }
    case 'context-menu': {
      const c = (a as Asset<'context-menu'>).data;
      const items = (c.targets.default ?? []).filter((i) => !i.separator).slice(0, 3);
      return (
        <Screen>
          <div style={{ width: '75%', margin: '0 auto', padding: 4, borderRadius: 6, background: c.variant === 'glass' ? 'color-mix(in srgb, var(--fx-surface) 55%, transparent)' : 'var(--fx-surface)', border: '1px solid var(--fx-border)', boxShadow: 'var(--fx-shadow-md)' }}>
            {items.map((i) => (
              <div key={i.id} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 9, padding: c.variant === 'roomy' ? '4px 4px' : '2px 4px', color: 'var(--fx-text)' }}>
                {c.showIcons && <Icon name={i.icon} size={10} />}
                {i.label}
              </div>
            ))}
          </div>
        </Screen>
      );
    }
    case 'uac-policy': {
      const u = (a as Asset<'uac-policy'>).data;
      return (
        <Screen>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {u.roles.map((r) => (
              <span key={r.id} className="fx-chip" style={r.id === u.defaultRole ? { background: 'var(--fx-accent-soft)', color: 'var(--fx-accent)' } : undefined}>
                {r.label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fx-muted)', marginTop: 6 }}>
            {Object.keys(u.permissions).length} permissions · gating: {u.gating}
          </div>
        </Screen>
      );
    }
    default:
      return null;
  }
}
