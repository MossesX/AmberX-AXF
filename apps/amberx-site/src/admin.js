/* AmberX waitlist admin: talks to /api/admin/* with the admin token. No styling here: site.css + --fx-* tokens. */
(() => {
  const KEY = 'amberx-admin-token';
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let token = '';
  try { token = sessionStorage.getItem(KEY) ?? ''; } catch { /* ignore */ }

  const fail = (m) => { const e = $('[data-admin-error]'); e.textContent = m; e.hidden = !m; };
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { ...opts, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    if (r.status === 401) { open(false); throw new Error('wrong admin token'); }
    if (path.endsWith('.csv')) { if (!r.ok) throw new Error(`export failed (${r.status})`); return r.blob(); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? `request failed (${r.status})`);
    return d;
  };

  function open(on) {
    $('[data-admin-form="login"]').hidden = on;
    $('[data-admin-body]').hidden = !on;
  }

  async function loadList() {
    const q = $('[data-admin-q]').value;
    const [list, stats] = await Promise.all([api(`/api/admin/waitlist?q=${encodeURIComponent(q)}`), api('/api/admin/waitlist/stats')]);
    $('[data-admin-stats]').innerHTML = [
      ['Waiting', stats.waiting], ['Invited', stats.invited], ['Joined today', stats.today], ['Via referral', stats.referred], ['Places per referral', stats.boost],
    ].map(([k, v]) => `<span class="fx-chip">${esc(k)}: <strong>${esc(v)}</strong></span>`).join('');
    $('[data-admin-rows]').innerHTML = list.entries.map((e) => `<tr>
      <td>${e.position || '–'}</td><td>${esc(e.email)}</td><td>${e.referrals}</td>
      <td>${esc(e.joinedAt.slice(0, 16).replace('T', ' '))}</td><td><span class="fx-chip${e.status === 'invited' ? ' fx-chip--success' : ''}">${esc(e.status)}</span></td>
      <td><code>${esc(e.code)}</code></td>
      <td class="site-row">${e.status === 'waiting'
        ? `<button class="fx-btn fx-btn--sm fx-btn--primary" type="button" data-admin-action="invite" data-code="${esc(e.code)}">Invite</button>`
        : `<button class="fx-btn fx-btn--sm fx-btn--neutral" type="button" data-admin-action="uninvite" data-code="${esc(e.code)}">Back in line</button>`}
        <button class="fx-btn fx-btn--sm fx-btn--danger" type="button" data-admin-action="remove" data-code="${esc(e.code)}">Remove</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="site-muted">Nobody yet.</td></tr>';
  }

  async function loadSettings() {
    const { settings: s, themes } = await api('/api/admin/settings');
    const f = $('[data-admin-form="settings"]');
    f.colorTheme.innerHTML = themes.color.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.scheme)})</option>`).join('');
    f.styleTheme.innerHTML = themes.style.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    for (const el of f.elements) {
      if (!el.name) continue;
      const [a, b] = el.name.split('.');
      const v = b ? s[a]?.[b] : s[a];
      if (v !== undefined) el.value = String(v);
    }
  }

  async function saveSettings(f) {
    const patch = { pricing: {} };
    for (const el of f.elements) {
      if (!el.name) continue;
      const [a, b] = el.name.split('.');
      let v = el.value;
      if (el.type === 'number') v = Number(v);
      if (a === 'waitlistOpen') v = v === 'true';
      if (b) patch[a][b] = v; else patch[a] = v;
    }
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) });
    $('[data-admin-saved]').textContent = `Saved ${new Date().toLocaleTimeString()}.`;
  }

  const start = () => Promise.all([loadList(), loadSettings()]).then(() => { open(true); fail(''); }).catch((e) => fail(e.message));

  $('[data-admin-form="login"]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    token = ev.target.token.value;
    try { sessionStorage.setItem(KEY, token); } catch { /* ignore */ }
    start();
  });
  $('[data-admin-form="settings"]').addEventListener('submit', (ev) => { ev.preventDefault(); saveSettings(ev.target).catch((e) => fail(e.message)); });
  let t = 0;
  $('[data-admin-q]').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadList().catch((e) => fail(e.message)), 250); });

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-admin-action]');
    if (!b) return;
    const code = b.dataset.code;
    try {
      switch (b.dataset.adminAction) {
        case 'refresh': await loadList(); break;
        case 'invite': await api(`/api/admin/waitlist/${code}`, { method: 'PATCH', body: JSON.stringify({ status: 'invited' }) }); await loadList(); break;
        case 'uninvite': await api(`/api/admin/waitlist/${code}`, { method: 'PATCH', body: JSON.stringify({ status: 'waiting' }) }); await loadList(); break;
        case 'remove': if (confirm(`Remove ${code} from the waitlist?`)) { await api(`/api/admin/waitlist/${code}`, { method: 'DELETE' }); await loadList(); } break;
        case 'export': {
          const blob = await api('/api/admin/waitlist.csv');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `amberx-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(a.href);
          break;
        }
      }
    } catch (e) { fail(e.message); }
  });

  if (token) start();
})();
