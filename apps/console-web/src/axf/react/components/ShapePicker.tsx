/*
 * Shape picker (shape@1, build banner-widget-shapes-more-than-circle). One control every place that picks a banner
 * widget shape uses: the widget's own settings, the skin editor's Shapes section, the UI Manager and Settings →
 * Appearance. It shows
 *   - a live preview of every shape asset (each drawn with its own compiled --fx-shape-widget-* tokens) and a choice
 *     grid to pick one;
 *   - Make your own: a radius slider per corner (style-theme radius steps none · sm · md · lg · pill, never a length)
 *     and an SVG path field (paste, or upload an .svg and its first path is read) with the validator's own errors;
 *     Use this shape adds it as an imported shape asset and picks it.
 * Optional `inherit` (Inherit from skin / from the app …) and `onRestore` (Restore previous edit) buttons. Framework
 * controls and theme tokens only; the rules are core/engines/shape-rules.mjs, the tokens core/engines/shape.ts.
 */
import { useState, type ChangeEvent } from 'react';
import { SHAPE_CORNERS, SHAPE_RADII, maskProblem, normalizeShape, shapeErrors } from '../../core/engines/shape-rules.mjs';
import { shapeInlineVars } from '../../core/engines/shape';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, Slider } from './Controls';
import { ChoiceGrid, Note, Section, TextField } from './Forms';

const CORNER_LABEL: Record<string, string> = { tl: 'Top left', tr: 'Top right', br: 'Bottom right', bl: 'Bottom left' };
const RADIUS_LABEL: Record<string, string> = { none: 'square', sm: 'small', md: 'medium', lg: 'large', pill: 'full' };

export interface ShapePickerProps {
  /** the shape asset id picked at this level ('' = inherit) */
  value: string;
  onPick: (id: string) => void;
  /** what this level inherits when nothing is picked (shown on the Inherit button) */
  inherit?: { label: string; onInherit: () => void };
  /** Restore previous edit; disabled when there is nothing to restore */
  onRestore?: () => void;
  canRestore?: boolean;
  /** a target id prefix for console-control (`section:<id>`, `button:<id>.…`) */
  target?: string;
  /** hide Make your own (a compact picker) */
  compact?: boolean;
}

interface ShapeAssetRow { id: string; name: string; description?: string; data: unknown }

/** One shape drawn with its own tokens (the same ones a banner chip reads). */
export function ShapePreview({ data, label }: { data: unknown; label: string }) {
  return <span className="fx-shape-preview" style={shapeInlineVars(data)} role="img" aria-label={`${label} shape`}>{label.slice(0, 2)}</span>;
}

/** The first path's `d` in an SVG document ('' when there is none). */
export function svgFirstPath(svg: string): string {
  const m = /<path\b[^>]*\sd\s*=\s*(["'])([^"']*)\1/i.exec(svg);
  return m ? m[2]!.trim() : '';
}

export function ShapePicker({ value, onPick, inherit, onRestore, canRestore = true, target = 'shape-picker', compact = false }: ShapePickerProps) {
  const rt = useRuntime();
  useAxfState();
  const shapes = rt.registry.list('shape' as never) as unknown as ShapeAssetRow[];
  const [corners, setCorners] = useState<Record<string, number>>({ tl: 3, tr: 3, br: 3, bl: 3 });
  const [mask, setMask] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const cornerData = { kind: 'corners', corners: Object.fromEntries(SHAPE_CORNERS.map((k) => [k, SHAPE_RADII[corners[k] ?? 0]])) };
  const maskWhy = mask.trim() ? maskProblem(mask) : '';
  const custom = mask.trim() ? { kind: 'mask', mask: mask.trim() } : cornerData;

  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 64_000) { setMsg({ tone: 'danger', text: 'That file is too big for a shape (64 KB at most).' }); return; }
    void f.text().then((t) => {
      const d = svgFirstPath(t);
      if (!d) setMsg({ tone: 'danger', text: 'No <path d="…"> in that SVG: draw the shape as one closed path.' });
      else { setMask(d); setMsg(null); }
    });
  };

  const create = () => {
    const errs = shapeErrors('shape', custom);
    if (errs.length) { setMsg({ tone: 'danger', text: errs.join('; ') }); return; }
    const label = name.trim() || (custom.kind === 'mask' ? 'My mask shape' : 'My corners shape');
    const id = `my-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'shape'}-${Date.now().toString(36).slice(-4)}`;
    const r = rt.importAsset({ $axf: 'asset@1', type: 'shape', id, name: label, version: '1.0.0', description: custom.kind === 'mask' ? 'A shape cut from a pasted SVG path.' : 'A shape with a radius step per corner.', author: 'You', tags: ['shape', 'custom'], data: normalizeShape(custom) }, false, 'shape-picker');
    if (!r.ok) { setMsg({ tone: 'danger', text: r.errors.join('; ') }); return; }
    setMsg({ tone: 'success', text: `${label} added.` });
    onPick(id);
  };

  return (
    <div className="fx-shape-picker" data-axf-target={`section:${target}`}>
      <div className="fx-shape-picker__previews" aria-hidden="true">
        {shapes.map((s) => <span key={s.id} className={`fx-shape-picker__sample${s.id === value ? ' is-active' : ''}`}><ShapePreview data={s.data} label={s.name} /><span className="fx-small fx-muted">{s.name}</span></span>)}
      </div>
      <ChoiceGrid label="Widget shape" selected={value ? [value] : []} onToggle={onPick}
        choices={shapes.map((s) => ({ id: s.id, title: s.name, ...(s.description ? { text: s.description } : {}) }))} />
      <div className="fx-row fx-row--wrap">
        {inherit && <Button tone="ghost" size="sm" icon="layers" disabled={!value} data-axf-target={`button:${target}.inherit`} onClick={inherit.onInherit}>{inherit.label}</Button>}
        {onRestore && <Button tone="ghost" size="sm" icon="undo" disabled={!canRestore} data-axf-target={`button:${target}.restore`} onClick={onRestore}>Restore previous edit</Button>}
      </div>
      {!compact && (
        <Section title="Make your own">
          <div className="fx-shape-picker__make">
            <ShapePreview data={custom} label={name || 'Yours'} />
            <div className="fx-stack">
              {SHAPE_CORNERS.map((k) => (
                <Slider key={k} label={`${CORNER_LABEL[k]}: ${RADIUS_LABEL[SHAPE_RADII[corners[k] ?? 0]!]}`} min={0} max={SHAPE_RADII.length - 1} step={1} value={corners[k] ?? 0}
                  onChange={(v) => { setCorners({ ...corners, [k]: v }); setMask(''); }} />
              ))}
            </div>
          </div>
          <TextField label="Or an SVG path (M … Z)" rows={3} mono value={mask} onChange={(v) => { setMask(v); setMsg(null); }} placeholder="M 50 0 L 100 50 L 50 100 L 0 50 Z" error={maskWhy ? `The path ${maskWhy}.` : undefined} hint="One closed path in a 0 0 100 100 box; it is stretched over the widget." />
          <label className="fx-shape-picker__upload">
            <span className="fx-small fx-muted">Upload an SVG</span>
            <input type="file" accept=".svg,image/svg+xml" onChange={upload} data-axf-target={`setting:${target}.upload`} />
          </label>
          <TextField label="Name" value={name} onChange={setName} placeholder="My shape" />
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
          <div className="fx-row"><Button tone="primary" size="sm" icon="plus" disabled={!!maskWhy} data-axf-target={`button:${target}.add`} onClick={create}>Use this shape</Button></div>
        </Section>
      )}
    </div>
  );
}
