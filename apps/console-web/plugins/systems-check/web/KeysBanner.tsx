import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, useBannerLaunchOpen, useRuntime, BannerIcon } from '@console/axf/react';
import { FixPanel, StatusDot, WhyLine, call, guidedOrder, isKeyIssue, issues, loadSystemCheck, useSys, type Check } from './SystemCheck';

/*
 * Live keys (Oct 30 2026, Brett: the GITHUB_TOKEN went dead and nothing told him): every key is tested against its
 * service, so a dead, expired or under-scoped key turns this banner red and says what broke, what it breaks and since
 * when, with Fix (paste a new one: tested before it's saved) and the page where a new one is made. A key expiring within a
 * week shows amber. It goes away by itself once the key works again.
 *
 * Keys banner: when the console loads and a key or password it needs is missing (or the service refuses it), a banner
 * names them. Tapping it opens the `keys-needed` dialog, which asks for exactly those keys, one form each, and tests
 * each one as it's saved. Values go to the console server only (owner-only file) and never come back to the browser.
 */

export function KeysBanner() {
  const s = useSys();
  const rt = useRuntime();
  // Launches expanded; "_" folds it to one short line (Brett, Oct 21 2026: error banners minimize, they don't close).
  const [open, setOpen] = useBannerLaunchOpen();
  const need = useMemo(() => issues(s.report).filter(isKeyIssue), [s.report]);
  if (s.unauthorized || need.length === 0) return null;
  const dead = need.filter((c) => c.status === 'error');
  const tone = dead.length ? 'is-error' : 'is-warn';
  const first = dead[0];
  const names = need.map((c) => c.title).join(', ');
  const count = dead.length
    ? (dead.length === 1 ? `${first!.title} is broken` : `${dead.length} keys are broken`)
    : need.every((c) => c.expiring) ? (need.length === 1 ? `${need[0]!.title} expires soon` : `${need.length} keys expire soon`)
    : need.length === 1 ? 'A key is needed' : `${need.length} keys are needed`;
  const make = (first ?? need[0])?.links.find((l) => /new|create|make/i.test(l.label));
  if (!open) {
    return (
      <div className={`axp-systems-check-banner ${tone} is-min`} role="alert">
        <div className="axp-systems-check-banner__row">
          <BannerIcon icon="key" working={s.loading} size={20} />
          <button type="button" data-fx-row className="axp-systems-check-banner__text" aria-expanded={false} onClick={() => setOpen(true)}>
            <span className="axp-systems-check-banner__words">{count}</span><Icon name="chevron-down" size={16} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`axp-systems-check-banner ${tone}`} role="alert">
      <div className="axp-systems-check-banner__row">
        <BannerIcon icon="key" working={s.loading} size={20} />
        <button type="button" data-fx-row className="axp-systems-check-banner__text" onClick={() => rt.openDialog('keys-needed', {})}>
          <span className="axp-systems-check-banner__words">{dead.length === 1 || (need.length === 1 && need[0]!.status === 'warn' && need[0]!.expiring) ? count : `${count}: ${names}`}</span>
        </button>
        <Button tone="primary" icon="key" onClick={() => rt.openDialog('keys-needed', {})}>{dead.length ? 'Fix' : `Add ${need.length === 1 ? 'it' : 'them'}`}</Button>
        {make && <Button icon="external" onClick={() => { const w = window.open(make.url, '_blank', 'noopener,noreferrer'); if (w) w.opener = null; }}>New key</Button>}
        <button type="button" className="fx-iconbtn" aria-label="Minimize" title="Minimize to one line" onClick={() => setOpen(false)}><Icon name="minimize" size={16} /></button>
      </div>
      {need.some((c) => c.status === 'error' || c.expiring) && (
        <ul className="axp-systems-check-banner__list">
          {need.filter((c) => c.status === 'error' || c.expiring).map((c) => (
            <li key={c.id} className="axp-systems-check-banner__li">
              <button type="button" data-fx-row className="axp-systems-check-banner__item" onClick={() => rt.openDialog('keys-needed', {})}>
                <StatusDot s={c.status} /><span className="axp-systems-check-banner__title">{c.title}</span><span className="axp-systems-check-banner__sum">{c.summary}</span>
                <span className="axp-systems-check-banner__plain fx-small">{c.summary}</span>
                <WhyLine c={c} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KeysDialog() {
  const s = useSys();
  const rt = useRuntime();
  // Remember which keys were missing when the dialog opened, so a fixed one stays on screen showing "saved".
  const [ids] = useState(() => new Set(issues(s.report).filter(isKeyIssue).map((c) => c.id)));
  const list = guidedOrder((s.report?.checks ?? []).filter((c) => ids.has(c.id)));
  const left = list.filter((c) => c.status === 'error' || c.status === 'warn').length;
  const ai = useAiState();
  if (!s.report) return <p className="fx-muted">Checking what the console needs…</p>;
  return (
    <div className="fx-stack axp-systems-check-keys">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        {left ? `Paste ${left === 1 ? 'this key' : `these ${left} keys`}. Each one is tested as soon as you save it.` : 'All set: every key works.'} Keys stay on the console server and are never shown again.
      </p>
      {list.map((c) => (
        <section key={c.id} className="fx-card axp-systems-check-keys__item">
          <h3 className="axp-systems-check-h" style={{ marginTop: 0 }}><StatusDot s={c.status} /> {c.title}</h3>
          <p className="fx-small" style={{ margin: 0 }}>{c.summary}</p>
          <WhyLine c={c} />
          {c.links.length > 0 && <p className="fx-small" style={{ margin: 0 }}>{c.links.map((l, i) => <span key={l.url}>{i ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <Icon name="external" size={12} /></a></span>)}</p>}
          {(c.status === 'error' || c.status === 'warn') && <KeyAutoFix c={c} ai={ai} />}
          <FixPanel c={c} />
        </section>
      ))}
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" onClick={() => void loadSystemCheck(true)}>Check all again</Button>
        <Button tone={left ? 'ghost' : 'primary'} onClick={() => rt.closeDialog()}>{left ? 'Later' : 'Done'}</Button>
      </div>
    </div>
  );
}

/* ---------------- Key Auto fix (Claude connected only) ---------------- */

interface AiState { ok: boolean; model: string; error: string }
interface Guide { key: string; label: string; url: string; steps: string[] }

/** Is Claude connected and working? (the systems check's AI connection test, re-run every 5 minutes on the server) */
function useAiState(): AiState | null {
  const [st, setSt] = useState<AiState | null>(null);
  useEffect(() => { let live = true; call<AiState>('ai/state').then((x) => live && setSt(x)).catch((e) => live && setSt({ ok: false, model: '', error: String((e as Error).message) })); return () => { live = false; }; }, []);
  return st;
}

/** Auto fix for a missing key: greyed out unless Claude is connected. Opens the page where the key is made (pre-filled when
 * the site allows it) and shows Claude's steps; you paste the key below and the console tests it. Keys are never fetched
 * from axHub: its vault is write-only by design. */
function KeyAutoFix({ c, ai }: { c: Check; ai: AiState | null }) {
  const keys = c.fix?.type === 'secrets' ? c.fix.fields.filter((f) => f.secret).map((f) => f.key) : [];
  const [guide, setGuide] = useState<Guide | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!keys.length) return null;
  const run = async () => {
    // Open the tab in the tap itself (phones block pop-ups opened later), then point it at the page.
    const tab = window.open('about:blank', '_blank');
    setBusy(true); setErr('');
    try {
      const g = await call<Guide>(`keys/${encodeURIComponent(keys[0] ?? "")}/guide`, { method: 'POST' });
      setGuide(g);
      if (tab && g.url) { tab.opener = null; tab.location.href = g.url; } else tab?.close();
    } catch (e) { tab?.close(); setErr((e as Error).message); } finally { setBusy(false); }
  };
  const connected = !!ai?.ok;
  return (
    <div className="fx-stack axp-systems-check-keyfix">
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="zap" disabled={!connected || busy} onClick={() => void run()}>{busy ? 'Claude is on it…' : 'Auto fix'}</Button>
        {!ai ? <span className="fx-small fx-muted">Checking Claude…</span>
          : !connected ? <span className="fx-small fx-muted"><Icon name="alert" size={12} /> Claude isn't connected{ai.error ? `: ${ai.error}` : ''}</span>
          : <span className="fx-small fx-muted">Claude ({ai.model || 'connected'}) opens the page and walks you through it</span>}
      </div>
      {err && <p className="fx-small" style={{ margin: 0 }}><Icon name="alert" size={12} /> {err}</p>}
      {guide && (
        <div className="fx-stack">
          {guide.url && <p className="fx-small" style={{ margin: 0 }}><a href={guide.url} target="_blank" rel="noopener noreferrer">Open the {guide.label} page again <Icon name="external" size={12} /></a></p>}
          {guide.steps.length > 0 && <ol className="fx-small axp-systems-check-keyfix__steps">{guide.steps.map((t, i) => <li key={i}>{t.replace(/^\s*\d+[.)]\s*/, '')}</li>)}</ol>}
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Paste it in the field below and save: it's tested right away.</p>
        </div>
      )}
    </div>
  );
}
