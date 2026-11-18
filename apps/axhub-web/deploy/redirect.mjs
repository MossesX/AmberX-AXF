#!/usr/bin/env node
/**
 * The retired AXHub web app's redirect page (build move-everything-axhub-web-console, s28). axhub.amberxai.com still
 * sends its old HTML pages to `#/<route>` on this app's address; this page maps that route to the console's Hub screen
 * through the hub-console@1 route table and sends the browser there as a console deep link:
 *
 *   #/approvals?status=pending          → https://console.amberxai.com/?axf-open=hub.open:approvals
 *   #/approvals/<id>                    → https://console.amberxai.com/?axf-open=hub.open:approvals:<id>
 *   #/handoff/<run>                     → …?axf-open=hub.open:handoff:<run>
 *   #/jobs (deferred, no screen yet)    → …?axf-open=view:hub  (the Hub page, which says what is deferred)
 *
 *   node apps/axhub-web/deploy/redirect.mjs [--out deploy/redirect.html] [--console https://console.amberxai.com]
 * Writes a self-contained page (the route table's replaces, aliases and row patterns inlined; no framework code), served
 * by the container for every path (deploy/nginx.conf). The console URL can be changed at serve time with the `?console=`
 * query parameter only to an https origin.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const out = resolve(HERE, '..', flag('--out', 'deploy/redirect.html'));
const consoleUrl = flag('--console', 'https://console.amberxai.com').replace(/\/$/, '');
const table = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/hub-console.json'), 'utf8'));

/** What the page needs of the table: per screen its replaced routes (path segments, `<…>` = a row), its row pattern, the home. */
export function redirectMap(t) {
  const screens = [...t.screens].sort((a, b) => a.order - b.order).map((s) => ({
    id: s.id,
    routes: (s.replaces ?? []).map((r) => r.replace(/^#\//, '').split('?')[0].split('/').filter(Boolean)),
    rowPattern: s.rows?.idPattern ?? null,
  }));
  return { home: t.home ?? screens[0]?.id ?? 'approvals', screens, deferred: (t.deferred ?? []).map((d) => d.id) };
}

export function page(map, base) {
  const json = JSON.stringify(map).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>AXHub moved into the console</title>
<style>html{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:36rem;padding:2rem;text-align:center}a{color:inherit}</style>
</head><body><main>
<h1>AXHub is in the console now</h1>
<p>Every hub page lives in the Dev Console's Hub screens. Taking you there…</p>
<p><a id="go" href="${base}/?axf-open=view:hub">Open the console</a></p>
</main>
<script>
(function(){
  var MAP=${json};
  var DEFAULT_BASE=${JSON.stringify(base)};
  var q=new URLSearchParams(location.search);
  var base=DEFAULT_BASE;
  var c=q.get('console');
  if(c){try{var u=new URL(c);if(u.protocol==='https:')base=u.origin;}catch(e){}}
  var raw=(location.hash||'').replace(/^#/,'').replace(/^\\/+/,'');
  var path=raw.split('?')[0];
  var segs=path.split('/').filter(Boolean);
  var target='view:hub';
  if(!segs.length){target='hub.open:'+MAP.home;}
  else{
    var best=null,bestLit=-1;
    MAP.screens.forEach(function(s){s.routes.forEach(function(r){
      if(r.length!==segs.length)return;
      var lit=0,row=null,ok=true;
      for(var i=0;i<segs.length;i++){
        if(/^<.*>$/.test(r[i])){ if(!s.rowPattern||new RegExp(s.rowPattern).test(segs[i]))row=segs[i]; }
        else if(r[i]===segs[i])lit++; else {ok=false;break;}
      }
      if(ok&&lit>bestLit){bestLit=lit;best={id:s.id,row:row};}
    });});
    if(best)target='hub.open:'+best.id+(best.row?':'+best.row:'');
    else if(MAP.deferred.indexOf(segs[0])>=0)target='view:hub';
  }
  var href=base+'/?axf-open='+encodeURIComponent(target);
  document.getElementById('go').href=href;
  location.replace(href);
})();
</script></body></html>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(out, page(redirectMap(table), consoleUrl));
  console.log(`wrote ${out}`);
}
