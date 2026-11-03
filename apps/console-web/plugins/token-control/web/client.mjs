/**
 * The shared control@1 client (token-control s11): one small fetch wrapper the CLI (`--remote`) and the console's
 * Token control page both use. Plain ES module (no React, no DOM), so Node 18+ and the browser load the same file.
 *
 *   const cc = controlClient({ base: 'https://console.amberxai.com', token: process.env.AXF_TOKEN });
 *   await cc.get('tokens.layout', 'navWidth');               await cc.set('tokens.theme', 'accent', '#ff8800', { reason });  (theme-ok: example values)
 *   await cc.list('amberx.items', { kind: 'todo', status: 'not-done' });
 *   await cc.add('amberx.items', { kind: 'todo', text: 'Buy milk' });
 *   const first = await cc.remove('amberx.items', id);       // { ok: false, code: 'confirmation_required', confirm }
 *   await cc.remove('amberx.items', id, { confirm: first.confirm });
 *   await cc.act('planner.builds', 'token-control', 'step', { step: 's11', done: true });
 *
 * Every method answers the control@1 envelope ({ ok: true, … } or { ok: false, code, message }); network trouble is
 * an `unexpected` failure, never a throw. In the console page pass `fetch: pluginFetch`-style credentials via `headers`.
 */
export const CONTROL_PATH = '/api/control';

export function controlClient({ base = '', token = '', fetch: f = globalThis.fetch, headers = {}, path = CONTROL_PATH } = {}) {
  const root = `${String(base).replace(/\/$/, '')}${path}`;
  const enc = (s) => String(s).split('/').map(encodeURIComponent).join('/');
  async function call(method, url, body) {
    try {
      const res = await f(url, {
        method,
        credentials: 'same-origin',
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { $axf: 'control@1', ok: false, code: res.status === 404 ? 'not_found' : res.status === 401 || res.status === 403 ? 'denied' : 'unexpected', message: `${res.status} ${text.slice(0, 200)}` }; }
    } catch (e) {
      return { $axf: 'control@1', ok: false, code: 'unexpected', message: `could not reach ${root}: ${e?.message ?? e}` };
    }
  }
  const audit = (o) => ({ ...(o?.by ? { by: o.by } : {}), ...(o?.reason ? { reason: o.reason } : {}) });
  return {
    root,
    /** Any whole control@1 command (POST /api/control). */
    send: (command) => call('POST', root, { $axf: 'control@1', ...command }),
    list: (target, select = {}) => {
      const qs = Object.entries(select).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`).join('&');
      return call('GET', `${root}/${enc(target)}${qs ? `?${qs}` : ''}`);
    },
    get: (target, path) => call('GET', `${root}/${enc(target)}/${enc(path)}`),
    set: (target, path, value, o) => call('PUT', `${root}/${enc(target)}/${enc(path)}`, { value, ...audit(o) }),
    reset: (target, path, o) => call('POST', `${root}/${enc(target)}/reset`, { ...(path ? { path } : {}), ...audit(o) }),
    add: (target, value, o) => call('POST', `${root}/${enc(target)}`, { value, ...audit(o) }),
    remove: (target, path, o) => call('DELETE', `${root}/${enc(target)}/${enc(path)}`, { ...(o?.confirm ? { confirm: o.confirm } : {}), ...audit(o) }),
    act: (target, path, action, input = {}, o) => call('POST', `${root}/${enc(target)}/${enc(path)}/act/${enc(action)}`, { input, ...audit(o) }),
    registry: () => call('GET', `${root}/meta/registry`),
    audit: (n = 50) => call('GET', `${root}/meta/audit?n=${n}`),
  };
}

/** The same command as the three transports write it (the docs' try-it panels and Copy buttons). */
export function controlForms(command, { base = 'https://console.amberxai.com' } = {}) {
  const c = command ?? {};
  const t = encodeURIComponent(c.target ?? '');
  const p = c.path ? `/${String(c.path).split('/').map(encodeURIComponent).join('/')}` : '';
  const auth = '-H "Authorization: Bearer $AXF_TOKEN"';
  const json = (o) => `'${JSON.stringify(o).replace(/'/g, "'\\''")}'`;
  const audit = { ...(c.by ? { by: c.by } : {}), ...(c.reason ? { reason: c.reason } : {}) };
  let rest;
  switch (c.op) {
    case 'list': { const qs = Object.entries(c.select ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`).join('&'); rest = `curl ${auth} "${base}${CONTROL_PATH}/${t}${qs ? `?${qs}` : ''}"`; break; }
    case 'get': rest = `curl ${auth} "${base}${CONTROL_PATH}/${t}${p}"`; break;
    case 'set': rest = `curl -X PUT ${auth} -H "content-type: application/json" "${base}${CONTROL_PATH}/${t}${p}" -d ${json({ value: c.value, ...audit })}`; break;
    case 'reset': rest = `curl -X POST ${auth} -H "content-type: application/json" "${base}${CONTROL_PATH}/${t}/reset" -d ${json({ ...(c.path ? { path: c.path } : {}), ...audit })}`; break;
    case 'add': rest = `curl -X POST ${auth} -H "content-type: application/json" "${base}${CONTROL_PATH}/${t}" -d ${json({ value: c.value, ...audit })}`; break;
    case 'remove': rest = `curl -X DELETE ${auth} -H "content-type: application/json" "${base}${CONTROL_PATH}/${t}${p}" -d ${json({ ...(c.confirm ? { confirm: c.confirm } : {}), ...audit })}`; break;
    case 'act': rest = `curl -X POST ${auth} -H "content-type: application/json" "${base}${CONTROL_PATH}/${t}${p}/act/${encodeURIComponent(c.action ?? '')}" -d ${json({ input: c.input ?? {}, ...audit })}`; break;
    default: rest = `curl -X POST ${auth} -H "content-type: application/json" "${base}${CONTROL_PATH}" -d ${json(c)}`;
  }
  const args = Object.fromEntries(Object.entries({ target: c.target, path: c.path, value: c.value, select: c.select, action: c.action, input: c.input, confirm: c.confirm, ...audit }).filter(([, v]) => v !== undefined && v !== '' && !(typeof v === 'object' && v && !Array.isArray(v) && !Object.keys(v).length && v !== c.value)));
  const sh = (s) => (/^[\w@%+=:,./#-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, "'\\''")}'`);
  const val = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const words = ['axf', 'control', c.op, c.target];
  if (c.op === 'act') words.push(c.path, c.action, ...(c.input && Object.keys(c.input).length ? [val(c.input)] : []));
  else if (c.op === 'set') words.push(c.path, val(c.value));
  else if (c.op === 'add') words.push(val(c.value));
  else if (c.path) words.push(c.path);
  for (const [k, v] of Object.entries(c.op === 'list' ? c.select ?? {} : {})) words.push('--select', `${k}=${val(v)}`);
  if (c.op === 'remove' && c.confirm) words.push('--confirm', c.confirm);
  if (c.reason) words.push('--reason', c.reason);
  return { rest, mcp: { tool: `control_${c.op}`, arguments: args }, cli: words.filter((w) => w !== undefined && w !== '').map(sh).join(' ') };
}
