#!/usr/bin/env node
/**
 * GitHub token broker (github-app@1): the one place AXF tools get a GitHub token from (library: ./github-app.mjs).
 *
 *   node framework/cli/github-token.mjs installation [--json] [--force]  the app's installation token (cached, refreshed at 50 min)
 *   node framework/cli/github-token.mjs user [--json] [--force]          the user access token (refreshed, refresh token rolled)
 *   node framework/cli/github-token.mjs token [--json]                   installation token, else the old GITHUB_TOKEN
 *   node framework/cli/github-token.mjs credential get                   git credential helper (same order)
 *   node framework/cli/github-token.mjs keep --json                      console keeper: installation token + user refresh in one call
 *   node framework/cli/github-token.mjs status [--live] [--json]         health (never a secret)
 *   node framework/cli/github-token.mjs repo create <name> [--public] [--description "…"]   new repo with the user token
 *   node framework/cli/github-token.mjs manifest --origin <url> [--name "…"] [--org <org>]   console: start the manifest flow
 *   node framework/cli/github-token.mjs convert | find-installation | authorize-url | exchange | forget [--all]
 *     (convert / exchange read {code, state, origin} as JSON on stdin, so codes never show in `ps`)
 *
 * Tokens go to stdout only, for the caller; errors go to stderr without any secret; exit 1 on failure.
 * The folder is AXF_GITHUB_APP_DIR, else <AXF_ROOT>/.axf-console/github-app, else /opt/axf/.axf-console/github-app.
 */
import * as app from './github-app.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined; };
const json = flag('json');
const dir = app.appDir();

async function stdinJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) { chunks.push(c); if (chunks.reduce((n, x) => n + x.length, 0) > 64 * 1024) break; }
  const t = Buffer.concat(chunks).toString('utf8').trim();
  return t ? JSON.parse(t) : {};
}
const out = (v) => process.stdout.write(typeof v === 'string' ? `${v}\n` : `${JSON.stringify(v)}\n`);

async function main() {
  const [cmd, sub, arg] = argv.filter((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.match(/^--(origin|name|org|description)$/));
  switch (cmd) {
    case 'installation': {
      const t = await app.installationToken(dir, { force: flag('force') });
      return out(json ? { token: t.token, expiresAt: t.expiresAt, cached: t.cached } : t.token);
    }
    case 'user': {
      const t = await app.userToken(dir, { force: flag('force') });
      return out(json ? { token: t.token, login: t.login, accessExpiresAt: t.accessExpiresAt, refreshExpiresAt: t.refreshExpiresAt, cached: t.cached } : t.token);
    }
    case 'token': {
      const t = await app.bestToken(dir);
      if (!t.token) throw new Error('no GitHub token: set up the GitHub App (Settings → Plugins → GitHub) or GITHUB_TOKEN');
      return out(json ? t : t.token);
    }
    case 'credential': {
      // git credential helper protocol: only `get` answers; store/erase are ignored (tokens are minted, not stored by git)
      if (sub !== 'get') return;
      await stdinJsonSafe();
      const t = await app.bestToken(dir);
      if (t.token) process.stdout.write(`username=x-access-token\npassword=${t.token}\n`);
      return;
    }
    case 'keep': {
      const r = { installation: null, user: null, legacy: !!app.legacyToken(dir) };
      if (app.configured(dir)) {
        try { const t = await app.installationToken(dir); r.installation = { ok: true, token: t.token, expiresAt: t.expiresAt }; } catch (e) { r.installation = { ok: false, why: app.redact(e.message) }; }
        if (app.hasUser(dir)) try { const u = await app.userToken(dir); r.user = { ok: true, login: u.login, accessExpiresAt: u.accessExpiresAt, refreshExpiresAt: u.refreshExpiresAt }; } catch (e) { r.user = { ok: false, why: app.redact(e.message) }; }
      }
      return out(r);
    }
    case 'status': {
      const s = await app.status(dir, { live: flag('live') });
      if (json) return out(s);
      const line = (k, v) => console.log(`${k.padEnd(14)} ${v}`);
      line('folder', s.dir);
      line('app', s.app ? `${s.app.name} (${s.app.slug}, id ${s.app.appId})` : 'not set up');
      for (const [k, v] of Object.entries(s.checks)) line(k, v.ok ? 'ok' : `✗ ${v.why ?? v.state ?? (v.problems ?? []).join('; ')}`);
      line('old token', s.legacy.set ? 'set (fallback)' : 'not set');
      return;
    }
    case 'repo': {
      if (sub !== 'create' || !arg) throw new Error('usage: github-token.mjs repo create <name> [--public] [--description "…"]');
      const r = await app.createRepo(dir, { name: arg, private: !flag('public'), description: opt('description') ?? '' });
      return out(json ? r : `${r.created ? 'created' : 'exists'}: ${r.fullName} (${r.private ? 'private' : 'public'}) ${r.htmlUrl}`);
    }
    case 'manifest': return out(app.startManifest(dir, { origin: opt('origin'), name: opt('name'), org: opt('org') }));
    case 'convert': { const b = await stdinJson(); return out(await app.convertManifest(dir, b)); }
    case 'find-installation': return out({ installation: await app.findInstallation(dir, { wanted: opt('id') ?? null }), app: app.publicMeta(app.readMeta(dir)) });
    case 'authorize-url': return out(app.authorizeUrl(dir, { origin: opt('origin') }));
    case 'exchange': { const b = await stdinJson(); return out(await app.exchangeUserCode(dir, b)); }
    case 'forget': app.forget(dir, { all: flag('all') }); return out({ ok: true });
    default:
      throw new Error('usage: github-token.mjs installation|user|token|credential get|keep|status|repo create <name>|manifest|convert|find-installation|authorize-url|exchange|forget');
  }
}
async function stdinJsonSafe() { try { if (!process.stdin.isTTY) for await (const _ of process.stdin) { /* drain git's request */ } } catch { /* none */ } }

main().catch((e) => {
  const msg = app.redact(e?.message ?? String(e));
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: msg, status: e?.status ?? 0 })}\n`);
  else process.stderr.write(`github-token: ${msg}\n`);
  process.exit(1);
});
