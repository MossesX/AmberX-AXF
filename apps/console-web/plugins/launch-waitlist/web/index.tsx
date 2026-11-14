import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/** The folder name under plugins/: server routes at /api/plugins/launch-waitlist/ (they proxy the AmberX site). */
const FOLDER = 'launch-waitlist';

interface Entry { code: string; email: string; position: number; referrals: number; joinedAt: string; status: string; link: string }
interface Stats { waiting: number; invited: number; today: number; referred: number; boost: number }
interface Theme { id: string; name: string; scheme?: string }
interface Settings {
  hook: string; sub: string; videoUrl: string; colorTheme: string; styleTheme: string; waitlistOpen: boolean; referralBoost: number;
  pricing: { price: number; trialDays: number; checkoutUrl: string; stripePriceId: string };
}

const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const r = await pluginFetch(FOLDER, path, init);
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail ?? `request failed (${r.status})`);
  return (path === 'export' ? r.text() : r.json()) as Promise<T>;
};

async function downloadCsv() {
  const csv = await call<string>('export');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `amberx-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function LaunchWaitlistView() {
  const rt = useRuntime();
  const [site, setSite] = useState('');
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [themes, setThemes] = useState<{ color: Theme[]; style: Theme[] }>({ color: [], style: [] });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    try {
      const [st, list, s, cfg] = await Promise.all([
        call<{ site: string }>('status'),
        call<{ entries: Entry[] }>(`entries?q=${encodeURIComponent(q)}`),
        call<Stats>('stats'),
        call<{ settings: Settings; themes: { color: Theme[]; style: Theme[] } }>('settings'),
      ]);
      setSite(st.site); setEntries(list.entries); setStats(s); setSettings(cfg.settings); setThemes(cfg.themes); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    rt.actions.register('launch-waitlist.refresh', () => void load(), { label: 'Refresh the launch waitlist' });
    rt.actions.register('launch-waitlist.export', () => void downloadCsv(), { label: 'Export the launch waitlist as CSV' });
  }, [rt, load]);

  const act = async (path: string, init: RequestInit) => { try { await call(path, init); await load(); } catch (e) { setError((e as Error).message); } };
  const save = async () => {
    if (!settings) return;
    try {
      const { hook, sub, videoUrl, colorTheme, styleTheme, waitlistOpen, referralBoost, pricing } = settings;
      await call('settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hook, sub, videoUrl, colorTheme, styleTheme, waitlistOpen, referralBoost, pricing }) });
      setSaved(`Saved ${new Date().toLocaleTimeString()}`);
    } catch (e) { setError((e as Error).message); }
  };
  const put = (patch: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...patch } : s));
  const putPrice = (patch: Partial<Settings['pricing']>) => setSettings((s) => (s ? { ...s, pricing: { ...s.pricing, ...patch } } : s));

  return (
    <div className="fx-stack fx-stack--lg" data-help="view:launch-waitlist">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Launch</p><h1>AmberX waitlist</h1><p className="fx-muted">{site || 'site not reached yet'}</p></div>
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Waitlist actions">
          <Button icon="refresh" onClick={() => void load()} data-help="refresh">Refresh</Button>
          <Button icon="download" tone="primary" onClick={() => void downloadCsv().catch((e: Error) => setError(e.message))} data-help="export">Export CSV</Button>
          {site && <a className="fx-btn fx-btn--neutral" href={site} target="_blank" rel="noopener" data-help="open-site">Open site</a>}
        </div>
      </header>
      {error && <p className="fx-field__error" role="alert">{error}</p>}
      {stats && (
        <div className="fx-row fx-row--wrap" aria-live="polite">
          <Chip>Waiting: {stats.waiting}</Chip><Chip>Invited: {stats.invited}</Chip><Chip>Joined today: {stats.today}</Chip>
          <Chip>Via referral: {stats.referred}</Chip><Chip>Places per referral: {stats.boost}</Chip>
        </div>
      )}
      <Container title="The line" icon="list">
        <TextField label="Search" value={q} onChange={setQ} placeholder="Email or code" />
        <div className="fx-tablewrap">
          <table className="fx-table">
            <thead><tr><th>#</th><th>Email</th><th>Referrals</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.code}>
                  <td>{e.position || '–'}</td><td>{e.email}</td><td>{e.referrals}</td><td>{e.joinedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td><Chip>{e.status}</Chip></td>
                  <td className="fx-row fx-row--tight">
                    {e.status === 'waiting'
                      ? <Button size="sm" tone="primary" onClick={() => void act(`entries/${e.code}/invite`, { method: 'POST' })} data-help="invite">Invite</Button>
                      : <Button size="sm" onClick={() => void act(`entries/${e.code}/requeue`, { method: 'POST' })} data-help="requeue">Back in line</Button>}
                    <Button size="sm" tone="danger" confirm={`Remove ${e.email} from the waitlist? Their referrer loses the credit.`} onClick={() => void act(`entries/${e.code}`, { method: 'DELETE' })} data-help="remove">Remove</Button>
                  </td>
                </tr>
              ))}
              {!entries.length && <tr><td colSpan={6} className="fx-muted">Nobody yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Container>
      {settings && (
        <Container title="Landing page" icon="rocket">
          <div className="fx-stack" data-help="site-settings">
            <TextField label="Hook" value={settings.hook} onChange={(v) => put({ hook: v })} />
            <TextField label="Sub-line" value={settings.sub} rows={2} onChange={(v) => put({ sub: v })} />
            <TextField label="Demo video URL" value={settings.videoUrl} onChange={(v) => put({ videoUrl: v })} hint="YouTube, Vimeo or an .mp4 link; empty shows the coming-soon slot" />
            <SelectField label="Colour theme" value={settings.colorTheme} options={themes.color.map((t) => ({ value: t.id, label: `${t.name} (${t.scheme})` }))} onChange={(v) => put({ colorTheme: v })} />
            <SelectField label="Style theme" value={settings.styleTheme} options={themes.style.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => put({ styleTheme: v })} />
            <TextField label="Price per month" type="number" value={String(settings.pricing.price)} onChange={(v) => putPrice({ price: Number(v) })} />
            <TextField label="Free trial days" type="number" value={String(settings.pricing.trialDays)} onChange={(v) => putPrice({ trialDays: Number(v) })} />
            <TextField label="Stripe price id" value={settings.pricing.stripePriceId} onChange={(v) => putPrice({ stripePriceId: v })} />
            <TextField label="Checkout URL" value={settings.pricing.checkoutUrl} onChange={(v) => putPrice({ checkoutUrl: v })} hint="Empty: the pricing button joins the waitlist" />
            <TextField label="Places per referral" type="number" value={String(settings.referralBoost)} onChange={(v) => put({ referralBoost: Number(v) })} />
            <Switch label="Waitlist open" checked={settings.waitlistOpen} onChange={(v) => put({ waitlistOpen: v })} />
            <div className="fx-row" role="toolbar" aria-label="Landing page settings">
              <Button tone="primary" icon="save" onClick={() => void save()} data-help="save">Save</Button>
              <span className="fx-muted" aria-live="polite">{saved}</span>
            </div>
          </div>
        </Container>
      )}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.launch-waitlist', // must equal plugin.json "id"
  label: 'Launch waitlist',
  version: '0.1.0',
  appMenu,
  views: { 'launch-waitlist': { title: 'Launch waitlist', icon: 'rocket', render: () => <LaunchWaitlistView /> } },
  nav: { label: 'Plugins', items: [{ id: 'launch-waitlist', label: 'Launch waitlist', icon: 'rocket', view: 'launch-waitlist' }] },
  settingsTabs: [{ id: 'launch-waitlist', label: 'Launch waitlist', icon: 'rocket', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'launch-waitlist.lifecycle', tab: 'launch-waitlist', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
