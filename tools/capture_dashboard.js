// Re-capture the article's screenshots and the forecast history from the two reference pages.
// Usage:
//   node tools/capture_dashboard.js shots     # writes assets/*.jpg (final cycle, 2x device scale)
//   node tools/capture_dashboard.js history   # writes assets/hist_raw.json (BN seats per cycle; slow, ~10 min)
// Then: python3 tools/embed_assets.py --hist
// Notes: the replay loads each dashboard version into an iframe via srcdoc; Prediction mode renders
// only after clicking the "Prediction" .mode-btn; the BN seat count is #ms-bn-val (later versions)
// or #c-bn (early versions). Element boxes must be read inside the frame and offset by the frame's
// own bounding box before page.screenshot({clip}).
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const A = path.join(ROOT, 'assets');
const REPLAY = 'file://' + path.join(ROOT, 'JSE_dashboard_replay.html');
const EXPLAINER = 'file://' + path.join(ROOT, 'how-the-prediction-is-made.html');
const mode = process.argv[2] || 'shots';
const jpg = { type: 'jpeg', quality: 82 };

async function openReplay(browser, dsf) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dsf });
  await page.goto(REPLAY, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(5000);
  return page;
}
const frameOf = page => page.frames().find(f => f !== page.mainFrame());

async function shots(browser) {
  // explainer: the first "recent calls" card (extractor)
  const ex = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
  await ex.goto(EXPLAINER, { waitUntil: 'load', timeout: 120000 }); await ex.waitForTimeout(2500);
  await ex.locator('.card').nth(0).screenshot({ path: path.join(A, 'explainer_extractor.jpg'), type: 'jpeg', quality: 80 });
  await ex.close();

  const page = await openReplay(browser, 2);
  await page.evaluate(() => window.__replayGoto(73)); await page.waitForTimeout(6000);
  const fr = frameOf(page);
  const fb = await page.locator('#frame').boundingBox();
  // clip an element inside the frame, scrolled so its top is visible, to at most maxH css px
  const clip = async (sel, name, maxH = 9999, sub) => {
    await fr.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'start' }), sel);
    await page.waitForTimeout(500);
    const b = await fr.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
    const top = Math.max(b.y, 0);
    let c = { x: fb.x + b.x, y: fb.y + top, width: b.w, height: Math.min(b.h - (top - b.y), fb.height - top, maxH) };
    if (sub) c = { x: c.x + (sub.x || 0), y: c.y + (sub.y || 0), width: sub.w || c.width, height: sub.h || c.height };
    await page.screenshot({ path: path.join(A, name + '.jpg'), ...jpg, clip }); console.log('ok', name);
  };
  // Monitoring "Election at a glance" (#feed-glance children: 2 baseline banner, 3 legend, 4 poll charts,
  // 8 sentiment panels, 11 campaign, 14 leader heatmap, 17 foreign+royal grid)
  const polls = await fr.evaluate(() => { const k = document.getElementById('feed-glance').children; k[1].scrollIntoView({ block: 'start' }); const a = k[1].getBoundingClientRect(), b = k[3].getBoundingClientRect(); return { x: a.x, y: a.y, w: a.width, h: b.bottom - a.y }; });
  await page.waitForTimeout(400);
  const p2 = await fr.evaluate(() => { const k = document.getElementById('feed-glance').children; const a = k[1].getBoundingClientRect(), b = k[3].getBoundingClientRect(); return { x: a.x, y: a.y, w: a.width, h: b.bottom - a.y }; });
  await page.screenshot({ path: path.join(A, 'mon_polls.jpg'), ...jpg, clip: { x: fb.x + p2.x, y: fb.y + Math.max(p2.y, 0), width: p2.w * 0.67, height: Math.min(p2.h, fb.height - Math.max(p2.y, 0)) } });
  await fr.evaluate(() => { const all = Array.from(document.querySelectorAll('#feed-glance > :nth-child(8) *')); const pick = (re, id) => { const c = all.filter(e => re.test(e.innerText || '') && e.getBoundingClientRect().height < 400 && e.getBoundingClientRect().height > 150); c[c.length - 1].id = id; }; pick(/^Comments in Malay/, 'cap-ms'); pick(/^Comments in Chinese/, 'cap-zh'); });
  await clip('#cap-ms', 'mon_sentiment_ms');
  await clip('#cap-zh', 'mon_sentiment_zh');
  await clip('#feed-glance > :nth-child(11) > .ca-grid > :nth-child(1)', 'mon_campaign_digital');
  await clip('#feed-glance > :nth-child(11) > .ca-grid > :nth-child(2)', 'mon_campaign_events');
  await clip('#feed-glance > :nth-child(14)', 'mon_leaders');
  await clip('#feed-glance > :nth-child(17) > :nth-child(2)', 'mon_royal', 560);
  await fr.evaluate(() => { document.getElementById('feed-glance').scrollTop = 0; }); await page.waitForTimeout(400);
  await page.locator('#frame').screenshot({ path: path.join(A, 'dash_monitoring.jpg'), ...jpg });
  // Prediction mode
  await fr.evaluate(() => { Array.from(document.querySelectorAll('.mode-btn')).find(b => /Prediction/.test(b.innerText)).click(); });
  await page.waitForTimeout(2500);
  await fr.evaluate(() => { const x = document.querySelector('.cb-dismiss'); x && x.click(); }); await page.waitForTimeout(400);
  await page.locator('#frame').screenshot({ path: path.join(A, 'dash_prediction.jpg'), ...jpg });
  await clip('#tab-ai .reasoning-panel', 'pred_ai', 600);
  await fr.evaluate(() => document.querySelector('.tab[data-tab="predict"]').click()); await page.waitForTimeout(1500);
  const t = await fr.evaluate(() => { const tb = document.getElementById('tbl-body').closest('table'); tb.scrollIntoView({ block: 'start' }); const b = tb.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.waitForTimeout(400);
  const top = Math.max(t.y, 0);
  await page.screenshot({ path: path.join(A, 'dash_seats.jpg'), ...jpg, clip: { x: fb.x + t.x, y: fb.y + top, width: Math.min(t.w, fb.width - t.x), height: Math.min(t.h, fb.height - top, 560) } });
  console.log('ok dash_seats');
  await page.close();
}

async function history(browser) {
  const page = await openReplay(browser, 1);
  const cycles = await page.evaluate(() => DATA.cycles.map(c => ({ id: c.id, ts: c.ts, sgt: c.sgt })));
  const out = [];
  for (let i = 0; i < cycles.length; i++) {
    await page.evaluate(i => window.__replayGoto(i), i);
    await page.waitForTimeout(2500);
    let d = { error: 'timeout' };
    for (let tries = 0; tries < 10; tries++) {
      const fr = frameOf(page); if (!fr) { await page.waitForTimeout(500); continue; }
      try {
        const ready = await fr.evaluate(() => window.__REPLAY__ === true && /johor-prn16-cycle-\d+-\d+/.test(document.body.innerText));
        if (!ready) { await page.waitForTimeout(500); continue; }
        await fr.evaluate(() => { const b = Array.from(document.querySelectorAll('.mode-btn')).find(b => /Prediction/.test(b.innerText)); if (b && !b.classList.contains('active')) b.click(); });
        await page.waitForTimeout(800);
        d = await fr.evaluate(() => { const t = id => { const x = document.getElementById(id); return x ? x.innerText.trim() : null; }; const raw = t('ms-bn-val') || t('c-bn'); const bn = raw ? (raw.match(/\d+/) || [])[0] : null; return { bn: bn ? +bn : null, inplay: (document.body.innerText.match(/(\d+)\s*of 56 seats in play/) || [])[1] || null }; });
        if (d.bn != null) break;
      } catch (e) { d = { error: e.message.slice(0, 100) }; }
      await page.waitForTimeout(500);
    }
    out.push({ i, ...cycles[i], ...d });
    console.log(i, JSON.stringify(out[i]));
    fs.writeFileSync(path.join(A, 'hist_raw.json'), JSON.stringify(out, null, 0));
  }
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  if (mode === 'history') await history(browser); else await shots(browser);
  await browser.close();
})();
