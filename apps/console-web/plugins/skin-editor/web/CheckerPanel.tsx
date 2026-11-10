/*
 * The skin checker panel (skin-check@1): pick a skin, see its live score and grade and the issue list, jump to an
 * issue's token and edit it in place (the check re-runs after a short pause), fix one issue or all of them. Every read
 * and action is a REST call (api.ts); the deep link (`skin-editor.checker:<skin>:<issue>` or `?skin=&issue=`) selects
 * the skin and scrolls to the issue.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Container, IconButton, Meter, Note, SelectField, TextField, useEditorSync } from '@console/axf/react';
import { SKIN_CHECK_CATEGORIES, SKIN_CHECK_CATEGORY_LABEL, tokenKey, type SkinCheckIssue, type SkinCheckResult } from '../../../../../packages/skin-checker/src/contract.ts';
import { fixAll, fixIssues, getState, listSkins, onRequest, runCheck, setToken, takeRequest, type SkinListing } from './api';

const P = 'axp-skin-editor';
const EDIT_DELAY = 600;
const SEV_TONE = { error: 'danger', warning: 'warning', info: undefined } as const;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CheckerPanel() {
  const [skins, setSkins] = useState<SkinListing[]>([]);
  const [skin, setSkin] = useState('');
  const [result, setResult] = useState<SkinCheckResult | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const act = async (label: string, fn: () => Promise<{ result: SkinCheckResult }>, done?: (r: SkinCheckResult) => string) => {
    setBusy(label); setError('');
    try {
      const a = await fn();
      setResult(a.result);
      setMsg(done ? done(a.result) : '');
    } catch (e) { setError(errText(e)); } finally { setBusy(''); }
  };
  const loadSkins = () => listSkins().then((r) => setSkins(r.skins), (e) => setError(errText(e)));
  const open = (id: string, issue = '') => {
    setSkin(id); setSelected(issue); setCategory('');
    if (id) void act('load', () => getState(id));
  };

  useEffect(() => {
    void loadSkins();
    const w = takeRequest();
    if (w) open(w.skin, w.issue);
    return onRequest((x) => open(x.skin, x.issue));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEditorSync({ onRefresh: () => { void loadSkins(); if (skin) void act('load', () => getState(skin)); } });

  const issues = useMemo(() => (result?.issues ?? []).filter((i) => !category || i.category === category), [result, category]);
  const sel = result?.issues.find((i) => i.id === selected) ?? null;
  useEffect(() => { setDraft(sel ? String(sel.value) : ''); }, [sel?.id, sel?.value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-issue="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, result]);

  // an inline token edit re-runs the check once typing pauses
  const edit = (v: string) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    if (!sel || !v.trim()) return;
    const token = tokenKey(sel.token);
    const value = typeof sel.value === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
    timer.current = setTimeout(() => { void act('edit', () => setToken(skin, token, value), (r) => `Saved ${sel.token.path}; score ${r.score}.`); }, EDIT_DELAY);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const fixOne = (i: SkinCheckIssue) => act('fix', () => fixIssues(skin, [i.id]), (r) => `${i.fix?.label ?? 'Fixed'}; score ${r.score}.`);
  const fixEvery = () => act('fixall', () => fixAll(skin), (r) => `Fixed every issue that had a fix; score ${r.score}.`);

  const skinOptions = skins.map((s) => ({ value: s.id, label: `${s.name}${s.kind === 'design-package' ? ' (design package)' : ''}${s.last ? ` · ${s.last.score} ${s.last.grade}` : ''}` }));
  const catOptions = [{ value: '', label: `All (${result?.issues.length ?? 0})` }, ...SKIN_CHECK_CATEGORIES.map((c) => ({ value: c, label: `${SKIN_CHECK_CATEGORY_LABEL[c]} (${result?.byCategory[c].issues ?? 0})` }))];

  return (
    <div className={`fx-stack ${P}`}>
      <div className={`${P}__bar`} role="toolbar" aria-label="Skin checker">
        <SelectField className={`${P}__pick`} label="Skin" value={skin} options={skinOptions} empty="Pick a skin…" onChange={(v) => open(v)} />
        <Button icon="refresh" disabled={!skin} busy={busy === 'check'} onClick={() => act('check', () => runCheck(skin), (r) => `Checked: ${r.score}/100.`)}>Check again</Button>
        <Button tone="primary" icon="sparkles" disabled={!result?.fixable} busy={busy === 'fixall'} onClick={fixEvery}>Fix all{result?.fixable ? ` (${result.fixable})` : ''}</Button>
      </div>
      {error && <Note tone="danger">{error}</Note>}
      {msg && !error && <p className="fx-small fx-muted" role="status">{msg}</p>}
      {!skin && <Note>Pick a skin or design package. The checker flags what breaks a professional look: spacing off the token scale, too many typefaces, palette sprawl, contrast below WCAG AA, and inconsistent radius, borders and shadows.</Note>}
      {result && (
        <>
          <Container title="Score" icon="chart" className={`${P}__score`}>
            <div className={`${P}__scorerow`}>
              <span className={`${P}__num`} aria-label={`Score ${result.score} of 100`}>{result.score}</span>
              <div className={`${P}__scoremeta`}>
                <div className={`${P}__chips`}>
                  <Chip tone={result.grade === 'A' ? 'success' : result.grade === 'F' ? 'danger' : 'warning'}>Grade {result.grade}</Chip>
                  <Chip tone={result.pass ? 'success' : 'danger'}>{result.pass ? 'Passes' : 'Fails'}</Chip>
                  <span className="fx-small fx-muted">min {result.settings.minScore}{result.settings.failOnError ? ', any error fails' : ''}</span>
                </div>
                <Meter value={result.score} done={result.pass} label={`Score ${result.score}`} />
                <span className="fx-small fx-muted">{result.counts.error} errors · {result.counts.warning} warnings · {result.counts.info} info · {result.fixable} fixable</span>
              </div>
            </div>
            {result.skipped.length > 0 && <p className="fx-small fx-muted">Skipped: {result.skipped.map((s) => `${s.rule} (${s.reason})`).join('; ')}</p>}
          </Container>
          <div className={`${P}__main`}>
            <Container title="Issues" icon="list" actions={<SelectField className={`${P}__cat`} label="Category" value={category} options={catOptions} onChange={setCategory} />}>
              {issues.length === 0 ? <p className="fx-muted">{result.issues.length ? 'Nothing in this category.' : 'No issues: this skin looks professional.'}</p> : (
                <ul className={`${P}__issues`} ref={listRef}>
                  {issues.map((i) => (
                    <li key={i.id} data-issue={i.id} className={`${P}__issue${i.id === selected ? ' is-sel' : ''}`}>
                      <Chip tone={SEV_TONE[i.severity]}>{i.severity}</Chip>
                      <div className={`${P}__text`}>
                        <span>{i.message}</span>
                        <span className={`fx-small fx-muted ${P}__token`}>{tokenKey(i.token)}</span>
                      </div>
                      <div className={`${P}__rowacts`}>
                        <IconButton icon="arrow-right" label={`Jump to ${i.token.path}`} onClick={() => setSelected(i.id)} />
                        {i.fix && <Button size="sm" busy={busy === 'fix'} onClick={() => fixOne(i)} title={i.fix.label}>Fix</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Container>
            <Container title="Token" icon="edit" className={`${P}__tokenbox`}>
              {!sel ? <p className="fx-muted">Jump to an issue's token to see and edit it here; the check runs again as you type.</p> : (
                <div className="fx-stack">
                  <p className={`fx-small ${P}__token`}>{tokenKey(sel.token)}{sel.token.cssVar ? ` · ${sel.token.cssVar}` : ''}</p>
                  <TextField label={sel.token.path} value={draft} onChange={edit} mono hint={`Expected: ${sel.expected}`} />
                  {sel.against && <p className="fx-small fx-muted">Against {tokenKey(sel.against)}{sel.measured !== undefined ? ` · measured ${sel.measured}` : ''}</p>}
                  {sel.fix ? <Button tone="primary" icon="sparkles" busy={busy === 'fix'} onClick={() => fixOne(sel)}>{sel.fix.label}</Button> : <p className="fx-small fx-muted">No one-click fix: this one is a design decision.</p>}
                </div>
              )}
            </Container>
          </div>
        </>
      )}
    </div>
  );
}
