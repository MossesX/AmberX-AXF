/**
 * Per-token editors: colour (a palette of the theme's colour tokens + a picker list), size (a slider in the token's
 * unit), font and every other choice (segmented or a select), on/off (a switch) and text. Each one previews live through
 * the applier on every change and writes through the overrides store (debounced by the dialog). Values are always the
 * token's own vocabulary (theme colour names, scale steps), so an edited element still follows a theme swap.
 */
import { Button, Segmented, SelectField, Slider, Switch, TextField } from '@console/axf/react';
import type { TokenRow, TokenValue } from './api';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
export const swatchVar = (name: string) => (name === 'transparent' || name === 'theme' ? 'transparent' : `var(--fx-${kebab(name)})`);
export const shown = (v: TokenValue) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
const label = (v: string) => (v === 'theme' ? 'Theme (axHub)' : v);

export function TokenEditor({ row, value, onChange, disabled }: { row: TokenRow; value: TokenValue; onChange: (v: TokenValue) => void; disabled?: boolean }) {
  const name = `${row.label}`;
  if (row.kind === 'color' && row.options?.length) {
    const cur = String(value ?? 'theme');
    return (
      <div className="axp-inline-edit__editor axp-inline-edit__editor--color">
        <div className="axp-inline-edit__palette" role="group" aria-label={`${name} palette`}>
          {row.options.filter((o) => o !== 'theme').map((o) => (
            <Button key={o} size="sm" tone={cur === o ? 'primary' : 'quiet'} title={o} aria-label={`${name}: ${o}`} aria-pressed={cur === o} disabled={disabled} onClick={() => onChange(o)}>
              <span className="axp-inline-edit__swatch" style={{ background: swatchVar(o) }} />
            </Button>
          ))}
        </div>
        <SelectField label={name} value={cur} options={row.options.map((o) => ({ value: o, label: label(o) }))} onChange={onChange} disabled={disabled} />
      </div>
    );
  }
  if (row.kind === 'scale') {
    const n = typeof value === 'number' ? value : Number(value ?? row.default ?? 100);
    return <div className="axp-inline-edit__editor"><Slider label={name} value={Number.isFinite(n) ? n : 100} min={row.min ?? 0} max={row.max ?? 200} step={row.step ?? 5} unit={row.unit ?? ''} onChange={(v) => onChange(v)} /></div>;
  }
  if (row.kind === 'toggle') {
    return <div className="axp-inline-edit__editor"><Switch label={name} checked={value === true} disabled={disabled} onChange={(v) => onChange(v)} /></div>;
  }
  if (row.options?.length) {
    const cur = String(value ?? row.default ?? '');
    if (row.options.length <= 5) {
      return <div className="axp-inline-edit__editor axp-inline-edit__editor--seg"><span className="axp-inline-edit__label">{name}</span><Segmented label={name} value={cur} size="sm" disabled={disabled} options={row.options.map((o) => ({ value: o, label: label(o) }))} onChange={(v) => onChange(v)} /></div>;
    }
    return <div className="axp-inline-edit__editor"><SelectField label={name} value={cur} options={row.options.map((o) => ({ value: o, label: label(o) }))} onChange={onChange} disabled={disabled} /></div>;
  }
  return <div className="axp-inline-edit__editor"><TextField label={name} value={value === null ? '' : String(value)} disabled={disabled} onChange={(v) => onChange(v)} mono /></div>;
}
