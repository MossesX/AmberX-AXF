// The axf-molly side of the console-down drill (runs in a node:22 container on the axf-data network):
// seed | write | read-through-hub. Prints one JSON line per step.
const [cmd] = process.argv.slice(2);
const hub = process.env.HUB_URL || 'http://axhub-route:8080/mcp';
const out = (v) => console.log(JSON.stringify(v));
const tool = async (name, args = {}) => {
  const r = await fetch(hub, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const res = j.result; return { ok: r.ok && res && !res.isError, data: res ? JSON.parse(res.content[0].text) : j };
};
if (cmd === 'seed') {
  const { remoteStore } = await import('/axf/framework/core/data-files.mjs');
  const s = remoteStore();
  await s.put('builds/store.json', { $axf: 'builds@1', rev: 1, builds: [{ id: 'drill-existing', title: 'Existing build', status: 'running', profile: 'all', steps: [] }] }, { create: true });
  await s.put('notes/handoffs/console-down-drill.md', new TextEncoder().encode('# Drill\n\nThis note must be readable with the console down.\n'), { create: true, contentType: 'text/markdown' });
  out({ step: 'seed', ok: true });
} else if (cmd === 'write') {
  const io = await import('/axf/framework/cli/builds-store.mjs');
  const r = io.withStore((s) => { s.builds.push({ id: 'drill-from-molly', title: 'Written by axf-molly with the console down', status: 'pending', profile: 'all', steps: [] }); return s; }, { by: 'axf-molly', action: 'drill' });
  out({ step: 'builds-store write (axf-molly, cutover)', ok: true, rev: r.rev, mode: io.storeMode() });
} else if (cmd === 'read-through-hub') {
  const status = await tool('data_status');
  const notes = await tool('notes_list', { folder: 'handoffs' });
  const note = await tool('note_read', { path: 'handoffs/console-down-drill.md' });
  const builds = await tool('builds_list');
  const ids = builds.ok ? builds.data.builds.map((b) => b.id) : [];
  out({ step: 'through the axHub route', ok: status.ok && notes.ok && note.ok && builds.ok, healthOk: status.data?.health?.ok, notes: notes.data?.notes?.map((n) => n.path), noteText: note.data?.text?.slice(0, 40), builds: ids, mollyWriteLanded: ids.includes('drill-from-molly') });
}
