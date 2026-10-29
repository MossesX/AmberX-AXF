/**
 * Brand library preview pane: the picked piece on a light and a dark surface (the theme's own surface and its
 * inverse, both tokens), at every size from the §10 minimum to 96 px, animations with a replay button, and the
 * actions: Apply (a piece into the active brand) / Set as brand (a branding package), Copy id.
 */
import { useState } from 'react';
import { Button, Container, IconButton, Segmented, useAxfState, useRuntime } from '@console/axf/react';
import { applyPiece } from './apply';
import { PREVIEW_SIZES, roleLabel, type LibAsset } from './model';
import type { PreviewProps } from './BrandLibrary';
import { AnimatedArt, BrandingArt, MarkArt, PackArt, type MarkIndex } from './tiles';

type Surface = 'light' | 'dark';

function Art({ a, marks, h, play, motion }: { a: LibAsset; marks: MarkIndex; h: number; play: number; motion: boolean }) {
  if (a.type === 'logo-mark') return <MarkArt mark={a} height={h} title={a.name} />;
  if (a.type === 'animated-logo') return <AnimatedArt anim={a} marks={marks} height={h} play={play} motion={motion} />;
  if (a.type === 'icon-pack') return <PackArt pack={a} size={Math.max(16, Math.round(h * 0.5))} count={h >= 48 ? 12 : 6} />;
  return <BrandingArt brand={a} marks={marks} height={h} />;
}

function Facts({ a, marks }: { a: LibAsset; marks: MarkIndex }) {
  const d = a.data;
  const rows: [string, string][] = [['Id', a.id], ['Type', a.type]];
  if (a.facets?.brand) rows.push(['Brand', a.facets.brand]);
  if (a.type === 'logo-mark') rows.push(['Form', String(d.form ?? '')], ['Minimum', `${String(d.minSize ?? 16)} px`]);
  if (a.type === 'animated-logo') rows.push(['Mark', String(d.mark ?? '')], ['Motion', `${String(d.preset)} · ${String(d.durationMs)} ms`], ['Plays', d.loop === true ? 'always' : d.loop === 'hover' ? 'on hover' : 'once']);
  if (a.type === 'icon-pack') rows.push(['Style', String(d.style ?? '')], ['Glyphs', String(Object.keys((d.glyphs as object) ?? {}).length)], ['Grid', `${String(d.grid ?? 24)} · stroke ${String(d.stroke ?? '')}`]);
  if (a.type === 'branding') {
    const m = (d.marks as Record<string, string>) ?? {};
    rows.push(['Tagline', String((d.brand as { tagline?: string })?.tagline ?? '')], ['Lockup', m.lockup ?? '–'], ['Animated', m.animated ?? '–'], ['Icon pack', String(d.iconPack ?? '–')]);
    const dec = Object.entries((d.decorations as Record<string, string>) ?? {}).filter(([, v]) => v !== 'none').map(([k, v]) => `${k} ${v}`).join(', ');
    if (dec) rows.push(['Decorates', dec]);
    if (m.mark && !marks.has(m.mark)) rows.push(['Note', `mark ${m.mark} is not in the library`]);
  }
  return <dl className="axp-brand-library__facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === 'Id' || k === 'Mark' ? 'fx-mono' : ''}>{v}</dd></div>)}</dl>;
}

export function Preview({ asset: a, marks, config, onClose, onApplied }: PreviewProps) {
  const rt = useRuntime();
  const state = useAxfState();
  const [surface, setSurface] = useState<Surface>('light');
  const [play, setPlay] = useState(0);
  const [busy, setBusy] = useState(false);
  const active = (state.active as Record<string, string>).branding ?? '';
  const isBrand = a.type === 'branding';
  const inUse = isBrand ? active === a.id : config.applied?.asset ? JSON.stringify(config.applied.asset.data).includes(`"${a.id}"`) && active === config.applied.id : false;

  const apply = async () => {
    setBusy(true);
    try {
      const c = await applyPiece(rt, a);
      onApplied(c);
      rt.toast(isBrand ? `${a.name} is the brand now.` : `${a.name} is the brand's ${roleLabel(a)} now.`, 'success', 'Brand library');
    } catch (e) {
      rt.toast((e as Error).message || 'Could not apply it.', 'danger', 'Brand library');
    } finally { setBusy(false); }
  };
  const copy = () => void navigator.clipboard?.writeText(a.id).then(() => rt.toast(`Copied ${a.id}.`, 'success', 'Brand library'), () => rt.toast(a.id, 'info', 'Brand library id'));

  return (
    <Container className="axp-brand-library__preview" title={a.name} icon="eye" actions={<IconButton icon="x" label="Close the preview" onClick={onClose} />}>
      <div className="axp-brand-library__preview-bar">
        <Segmented size="sm" label="Surface" value={surface} onChange={setSurface} options={[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]} />
        {a.type === 'animated-logo' && <Button size="sm" icon="play" onClick={() => setPlay((n) => n + 1)} disabled={!config.motion}>Play</Button>}
      </div>
      <div className={`axp-brand-library__stage is-${surface}`}>
        <div className="axp-brand-library__stage-hero"><Art a={a} marks={marks} h={96} play={play} motion={config.motion} /></div>
        {a.type !== 'branding' && (
          <div className="axp-brand-library__sizes">
            {PREVIEW_SIZES.slice(0, -1).map((h) => (
              <figure key={h} className="axp-brand-library__size"><Art a={a} marks={marks} h={h} play={play} motion={config.motion} /><figcaption>{h}</figcaption></figure>
            ))}
          </div>
        )}
      </div>
      <Facts a={a} marks={marks} />
      <div className="fx-row fx-row--wrap axp-brand-library__actions">
        <Button tone="primary" icon={isBrand ? 'star' : 'check'} busy={busy} disabled={inUse} requires="assets.swap" onClick={() => void apply()}>
          {inUse ? 'In use' : isBrand ? 'Set as brand' : `Apply as ${roleLabel(a)}`}
        </Button>
        <Button icon="copy" onClick={copy}>Copy id</Button>
      </div>
    </Container>
  );
}
