// pixel diff of two PNG folders in headless Chromium (canvas); threshold = per-channel delta treated as antialias noise
const { chromium } = require(process.env.AXF_PLAYWRIGHT || 'playwright');
const fs = require('fs'); const path = require('path');
const [before, after, outDir] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const rows = [];
  for (const f of fs.readdirSync(before).filter((x) => x.endsWith('.png')).sort()) {
    const A = 'data:image/png;base64,' + fs.readFileSync(path.join(before, f)).toString('base64');
    const B = fs.existsSync(path.join(after, f)) ? 'data:image/png;base64,' + fs.readFileSync(path.join(after, f)).toString('base64') : null;
    if (!B) { rows.push({ f, missing: true }); continue; }
    const r = await p.evaluate(async ([a, c]) => {
      const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = s; });
      const [ia, ib] = await Promise.all([load(a), load(c)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
      const cv = (i) => { const k = document.createElement('canvas'); k.width = i.width; k.height = i.height; const x = k.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
      const da = cv(ia), db = cv(ib);
      let changed = 0, aa = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        if (!d) continue;
        if (d <= 24) { aa++; continue; }
        changed++; const px = (i / 4) % ia.width, py = Math.floor(i / 4 / ia.width);
        if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py;
      }
      return { w: ia.width, h: ia.height, changed, antialias: aa, box: changed ? [x0, y0, x1, y1] : null };
    }, [A, B]);
    rows.push({ f, ...r });
  }
  await b.close();
  if (outDir) fs.writeFileSync(path.join(outDir, 'pixel-diff.json'), JSON.stringify(rows, null, 2) + '\n');
  for (const r of rows) console.log(`${r.changed ? '✗' : '✓'} ${r.f.padEnd(38)} changed ${r.changed ?? '-'} antialias ${r.antialias ?? '-'} ${r.box ? 'box ' + r.box.join(',') : ''}${r.size ? ' size ' + r.size : ''}${r.missing ? ' MISSING' : ''}`);
})();
