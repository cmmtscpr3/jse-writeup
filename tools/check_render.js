// Render check for writeup.html: no script errors, no network requests, no horizontal scroll on a
// phone, no heading-order jumps, lightbox keyboard flow, sticky table header.
// Usage: node tools/check_render.js [path/to/writeup.html] [screenshot-dir]
// Requires the globally installed Playwright (/opt/node22/lib/node_modules/playwright) and Chromium.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const file = 'file://' + path.resolve(process.argv[2] || 'writeup.html');
const outDir = process.argv[3] || null;

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  for (const vp of [{ width: 1280, height: 900 }, { width: 820, height: 1100 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: vp });
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:')) errs.push('EXTERNAL REQUEST ' + u); });
    await page.goto(file, { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' }); // smooth scroll breaks scrolled screenshots
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    const heads = await page.evaluate(() => Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(h => +h.tagName[1]));
    let jumps = 0; for (let i = 1; i < heads.length; i++) if (heads[i] > heads[i - 1] + 1) jumps++;
    const ok = errs.length === 0 && sw === vp.width && jumps === 0;
    if (!ok) failed = true;
    console.log(`${vp.width}px: scrollWidth ${sw} (want ${vp.width}), heading jumps ${jumps}, errors ${JSON.stringify(errs)} -> ${ok ? 'OK' : 'FAIL'}`);
    if (vp.width === 1280) {
      // lightbox: Enter opens, focus lands on Close, Escape closes and returns focus
      await page.evaluate(() => document.querySelector('img.shot').scrollIntoView());
      await page.focus('img.shot'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
      const onClose = await page.evaluate(() => document.activeElement.id === 'lb-close');
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      const back = await page.evaluate(() => document.activeElement.classList.contains('shot') && !document.getElementById('lb').classList.contains('on'));
      console.log(`lightbox keyboard flow: ${onClose && back ? 'OK' : 'FAIL'}`);
      // table view sticky header
      await page.click('#tl-table-btn'); await page.waitForTimeout(150);
      const sticky = await page.evaluate(() => { const t = document.getElementById('tl-table'); t.scrollTop = 400; const th = t.querySelector('thead th'); return Math.abs(th.getBoundingClientRect().top - t.getBoundingClientRect().top) < 3; });
      console.log(`timeline table sticky header: ${sticky ? 'OK' : 'FAIL'}`);
      if (!(onClose && back && sticky)) failed = true;
    }
    if (outDir) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      let n = 0;
      for (let y = 0; y < h; y += vp.height - 50) { await page.evaluate(y => window.scrollTo(0, y), y); await page.waitForTimeout(120); await page.screenshot({ path: path.join(outDir, `${vp.width}_${String(n++).padStart(2, '0')}.png`) }); }
    }
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
