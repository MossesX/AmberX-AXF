/*
 * The skin checker's threshold settings (skin-check-settings@1), Settings → Plugins → Skin editor. The groups, fields,
 * ranges and hints come from the settings schema's one field table; every change is a REST write (PUT
 * checker/settings), the same one `axf skin settings set`, MCP and voice make.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Container, Note, SelectField, Slider, Switch } from '@console/axf/react';
import { SKIN_CHECK_RULES } from '../../../../../packages/skin-checker/src/contract.ts';
import { settingsGroups } from '../../../../../packages/skin-checker/src/settings-schema.ts';
import { getSettings, putSetting, resetSettings, type SettingsAnswer } from './api';

const P = 'axp-skin-editor';
const GROUPS = settingsGroups();
const SEVERITY = [{ value: '', label: 'Default' }, { value: 'error', label: 'Error' }, { value: 'warning', label: 'Warning' }, { value: 'info', label: 'Info' }, { value: 'off', label: 'Off' }];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CheckerSettings() {
  const [s, setS] = useState<SettingsAnswer | null>(null);
  const [error, setError] = useState('');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => { getSettings().then(setS, (e) => setError(errText(e))); }, []);
  useEffect(() => () => { for (const t of Object.values(timers.current)) clearTimeout(t); }, []);

  const write = (key: string, value: unknown, wait = 0) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { putSetting(key, value).then((a) => { setS(a); setError(''); }, (e) => setError(errText(e))); }, wait);
  };
  // sliders show the new value at once and write when the drag pauses
  const setLocal = (key: string, value: number | boolean) => setS((cur) => (cur ? { ...cur, flat: { ...cur.flat, [key]: value } } : cur));

  if (!s) return error ? <Note tone="danger">{error}</Note> : <p className="fx-muted">Loading the checker settings…</p>;
  const changed = new Set(s.changed);
  const rules = s.settings.rules as Record<string, string>;
  return (
    <div className={`fx-stack ${P}__settings`}>
      <div className={`${P}__bar`} role="toolbar" aria-label="Skin checker settings">
        <span className="fx-small fx-muted">{s.changed.length ? `${s.changed.length} changed from the defaults` : 'All defaults'}</span>
        <Button icon="undo" disabled={!s.changed.length} confirm="Put every skin checker setting back to its default?" onClick={() => resetSettings().then(setS, (e) => setError(errText(e)))}>Reset to defaults</Button>
      </div>
      {error && <Note tone="danger">{error}</Note>}
      {GROUPS.map((g) => (
        <Container key={g.id} title={g.label} icon="sliders">
          <div className={`${P}__fields`}>
            {g.fields.map((f) => f.kind === 'boolean'
              ? <Switch key={f.key} label={`${f.label}${changed.has(f.key) ? ' •' : ''}`} hint={f.hint} checked={s.flat[f.key] === true} onChange={(v) => { setLocal(f.key, v); write(f.key, v); }} />
              : (
                <div key={f.key} className={`${P}__field`}>
                  <Slider label={`${f.label}${changed.has(f.key) ? ' •' : ''}`} value={Number(s.flat[f.key])} min={f.min} max={f.max} step={f.step} unit={f.unit ?? ''} onChange={(v) => { setLocal(f.key, v); write(f.key, v, 400); }} />
                  <p className="fx-small fx-muted">{f.hint}</p>
                </div>
              ))}
            {g.rules.map((id) => {
              const meta = SKIN_CHECK_RULES.find((r) => r.id === id)!;
              return <SelectField key={id} label={`${meta.title} (${id})`} hint={`${meta.what} Default: ${meta.severity}.`} value={rules[id] ?? ''} options={SEVERITY} onChange={(v) => write(`rules.${id}`, v || meta.severity)} />;
            })}
          </div>
        </Container>
      ))}
    </div>
  );
}
