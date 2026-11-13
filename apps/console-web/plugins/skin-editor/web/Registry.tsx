/*
 * Token registry page: every --fx-* token in the system, browsable and searchable, with element, area, state, scheme,
 * level, description, default and source. Basic / Pro / Advanced views (the level toolbar). A row opens the token in the
 * Skin editor on the current UI.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, Segmented, SelectField, useRuntime } from '@console/axf/react';
import type { RegistrySummary } from '@console/axf/core/engines/token-registry.mjs';
import { ELEMENT_LABELS, TOKEN_AREAS, TOKEN_STATES } from '@console/axf/core/engines/token-registry.mjs';
import { registry as fetchRegistry, registrySummary } from './api';
import { LEVELS, LEVEL_KEY, type RegistryToken, type TokenLevel } from './model';

const P = 'axp-registry';
export const REGISTRY_Q_KEY = 'axf.skin-editor.registry.q';

export function RegistryView() {
  const rt = useRuntime();
  const [tokens, setTokens] = useState<RegistryToken[]>([]);
  const [summary, setSummary] = useState<RegistrySummary | null>(null);
  const [q, setQ] = useState(String(rt.settings.get(REGISTRY_Q_KEY) ?? ''));
  const [level, setLevel] = useState<TokenLevel>((String(rt.settings.get(LEVEL_KEY) ?? 'advanced') as TokenLevel));
  const [area, setArea] = useState('');
  const [element, setElement] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => { registrySummary().then(setSummary, () => setSummary(null)); }, []);
  useEffect(() => {
    let live = true;
    fetchRegistry({ q, level, area, element, state }).then((r) => { if (!live) return; setTokens(r.tokens); setTotal(r.total); setError(''); }, (e: Error) => live && setError(e.message));
    rt.settings.set(REGISTRY_Q_KEY, q);
    rt.settings.set(LEVEL_KEY, level);
    return () => { live = false; };
  }, [q, level, area, element, state, rt]);

  const elements = useMemo(() => Object.keys(summary?.elements ?? {}).sort(), [summary]);
  const openIn = (t: RegistryToken) => rt.dispatch(`skin-editor.open:token:${t.id}`);

  return (
    <div className={`${P} fx-stack fx-stack--lg`}>
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Framework</p><h1>Token registry</h1></div></header>
      <div className="axp-skin__bar" role="toolbar" aria-label="Token registry">
        <Segmented label="Level" size="sm" value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l.value, label: l.label, title: l.title }))} />
        <input className="fx-input" placeholder="Find a token: words from its name, element, description…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a token" />
        <SelectField label="Area" value={area} onChange={setArea} options={[{ value: '', label: 'Every area' }, ...TOKEN_AREAS.map((a) => ({ value: a, label: a }))]} />
        <SelectField label="Element" value={element} onChange={setElement} options={[{ value: '', label: 'Every element' }, ...elements.map((e) => ({ value: e, label: ELEMENT_LABELS[e] ?? e }))]} />
        <SelectField label="State" value={state} onChange={setState} options={[{ value: '', label: 'Every state' }, ...TOKEN_STATES.map((s) => ({ value: s, label: s }))]} />
        <Button size="sm" icon="palette" onClick={() => rt.navigate('skin-editor')}>Skin editor</Button>
      </div>
      {summary && (
        <div className={`${P}__summary`}>
          <Chip tone="accent">{summary.total} tokens</Chip>
          {Object.entries(summary.levels).map(([k, n]) => <Chip key={k}>{n} {k}</Chip>)}
          {Object.entries(summary.areas).map(([k, n]) => <Chip key={k}>{n} {k}</Chip>)}
        </div>
      )}
      {error && <Note tone="danger">{error}</Note>}
      <Container title={`${tokens.length} of ${total} tokens`} icon="list">
        <table className={`axp-skin__table ${P}__table`}>
          <thead><tr><th>Token</th><th>Element</th><th>Area</th><th>State</th><th>Scheme</th><th>Level</th><th>What it does</th><th>Default</th><th>Source</th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} data-fx-row tabIndex={0} title="Open in the Skin editor" onClick={() => openIn(t)} onKeyDown={(e) => { if (e.key === 'Enter') openIn(t); }}>
                <td>{t.id}</td><td>{ELEMENT_LABELS[t.element] ?? t.element}</td><td>{t.area}</td><td>{t.state}</td><td>{t.scheme}</td><td>{t.level}</td>
                <td>{t.description}</td><td className={`${P}__default`} title={String(t.default)}>{String(t.default)}</td><td className={`${P}__default`} title={(t.sources ?? [t.source]).join('\n')}>{t.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tokens.length && !error && <p className="fx-muted">No token matches. Clear a filter or try other words.</p>}
      </Container>
    </div>
  );
}
