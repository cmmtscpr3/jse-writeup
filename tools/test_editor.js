// End-to-end test of writeup.editable.html: edit, split, resolve placeholders, add image, reload,
// export final, save working copy, reopen it, export again. Exits 1 on any failure.
// Usage: node tools/test_editor.js [scratch-dir]   (run python3 tools/make_editable.py first)
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..'), S = process.argv[2] || require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'ed-test-'));
const FILE = 'file://' + path.join(ROOT, 'writeup.editable.html');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) errs.push('EXTERNAL ' + r.url()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  ok(await page.isVisible('#ed-open'), 'edit pill visible to readers');
  const leaves = await page.evaluate(() => document.querySelectorAll('[data-ed-leaf]').length);
  ok(leaves > 300, 'editable blocks found: ' + leaves);
  ok(await page.evaluate(() => !document.querySelector('#fw-out [data-ed-leaf], #pipe [data-ed-leaf], .fwitem[data-ed-leaf], nav.toc [data-ed-leaf], #tl-box [data-ed-leaf]')), 'widgets are not editable');
  await page.click('#ed-open');
  ok(await page.evaluate(() => document.body.classList.contains('ed-on') && document.querySelector('p.standfirst').getAttribute('contenteditable') === 'true'), 'edit mode on');
  // 1. edit a paragraph
  await page.click('p.standfirst'); await page.keyboard.press('Control+End'); await page.keyboard.type(' EDIT1');
  ok((await page.textContent('#ed-count')) === '1 change', 'count after one edit: ' + await page.textContent('#ed-count'));
  // 2. split with Enter
  await page.keyboard.press('Enter'); await page.keyboard.type('New paragraph here.');
  ok(await page.evaluate(() => { const p = document.querySelector('p.standfirst'); return p.nextElementSibling.tagName === 'P' && p.nextElementSibling.textContent === 'New paragraph here.' && p.nextElementSibling.className === 'standfirst'; }), 'Enter created a new paragraph after the standfirst');
  // 3. resolve the title placeholder with text
  await page.evaluate(() => document.querySelector('.ph .ed-ph [data-act="text"]').click());
  await page.keyboard.type('My real title note');
  ok(await page.evaluate(() => !document.querySelector('header .ph') && document.querySelector('header p[data-ed^="n"]').textContent === 'My real title note'), 'title placeholder replaced with a paragraph');
  // 4. mark byline final
  await page.evaluate(() => document.querySelector('.ed-pi').click());
  ok(await page.evaluate(() => !document.querySelector('header .ph-inline')), 'byline marked final');
  // 5. add image to the Toast placeholder
  const png = path.join(S, 'test_img.png'); await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 300, height: 120 } });
  const toastPh = await page.evaluate(() => { const ph = Array.from(document.querySelectorAll('.ph')).find(p => /Toast screenshots/.test(p.textContent)); return ph.getAttribute('data-ed'); });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(id => document.querySelector('[data-ed="' + id + '"] [data-act="img"]').click(), toastPh)]);
  await chooser.setFiles(png); await page.waitForTimeout(600);
  ok(await page.evaluate(id => { const ph = document.querySelector('[data-ed="' + id + '"]'); const f = ph.previousElementSibling; return f.tagName === 'FIGURE' && f.querySelector('img.shot').src.startsWith('data:image/png') && f.querySelector('figcaption[data-ed-leaf]'); }, toastPh), 'figure inserted before the Toast placeholder');
  await page.evaluate(id => document.querySelector('[data-ed="' + id + '"] [data-act="del"]').click(), toastPh);
  // 6. edit a table cell and a hood paragraph
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  await page.evaluate(() => { const td = document.querySelector('#ind-table td[data-ed-leaf]:not([colspan])'); td.scrollIntoView(); });
  await page.click('#ind-table td[data-ed-leaf]:not([colspan])'); await page.keyboard.press('Control+End'); await page.keyboard.type(' CELL');
  const count1 = await page.textContent('#ed-count'); console.log('count:', count1);
  // 7. changes panel
  await page.click('#ed-changes'); await page.waitForTimeout(100);
  const kinds = await page.$$eval('#ed-panel .ed-chg .k', ks => ks.map(k => k.textContent));
  console.log('panel:', kinds.join(' | '));
  ok(kinds.length === parseInt(count1), 'panel rows equal count');
  // revert the cell edit, then redo it
  const idx = await page.evaluate(() => Array.from(document.querySelectorAll('#ed-panel .ed-chg')).findIndex(c => /CELL/.test(c.textContent)));
  await page.click(`#ed-panel [data-revert="${idx}"]`); await page.waitForTimeout(100);
  ok(!(await page.evaluate(() => /CELL/.test(document.querySelector('#ind-table').textContent))), 'revert restored the cell');
  await page.click('#ind-table td[data-ed-leaf]:not([colspan])'); await page.keyboard.press('Control+End'); await page.keyboard.type(' CELL');
  await page.click('#ed-changes');
  // 8. reload: draft persists
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(300);
  ok(await page.evaluate(() => /EDIT1/.test(document.querySelector('p.standfirst').textContent) && document.querySelector('p.standfirst').nextElementSibling.textContent === 'New paragraph here.' && !document.querySelector('header .ph') && !document.querySelector('header .ph-inline')), 'draft reapplied after reload');
  ok((await page.textContent('#ed-pill-n')) === String(parseInt(count1)), 'pill shows change count after reload: ' + await page.textContent('#ed-pill-n'));
  await page.click('#ed-open');
  // 9. export final
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ed-export')]);
  const finalPath = path.join(S, 'export_final.html'); await dl.saveAs(finalPath);
  console.log('toast:', await page.textContent('#ed-toast'));
  const fin = fs.readFileSync(finalPath, 'utf8');
  ok(dl.suggestedFilename() === 'writeup.html', 'final download name');
  ok(!/data-editor|contenteditable|data-ed[-="]|ed-on/.test(fin), 'final has no editor markup');
  ok(/EDIT1/.test(fin) && /New paragraph here\./.test(fin) && /My real title note/.test(fin) && / CELL</.test(fin), 'final carries the edits');
  ok(!/PLACEHOLDER: title|PLACEHOLDER: byline|PLACEHOLDER: Daily Toast/.test(fin) && /PLACEHOLDER: main questions/.test(fin), 'resolved placeholder comments dropped, others kept');
  ok((fin.match(/<img class="shot"/g) || []).length === 13, 'final has 13 images: ' + (fin.match(/<img class="shot"/g) || []).length);
  ok(fin.startsWith('<!DOCTYPE html>'), 'doctype present');
  // 10. save working copy, reopen it
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#ed-save')]);
  const wcPath = path.join(S, 'export_wc.html'); await dl2.saveAs(wcPath);
  ok(dl2.suggestedFilename() === 'writeup.editable.html', 'working copy download name');
  const page2 = await ctx.newPage(); const errs2 = []; page2.on('pageerror', e => errs2.push(e.message));
  await page2.goto('file://' + wcPath, { waitUntil: 'load' }); await page2.waitForTimeout(300);
  ok((await page2.textContent('#ed-pill-n')) === String(parseInt(count1)), 'working copy shows the same change count: ' + await page2.textContent('#ed-pill-n'));
  await page2.click('#ed-open'); await page2.click('#ed-changes'); await page2.waitForTimeout(100);
  const kinds2 = await page2.$$eval('#ed-panel .ed-chg .k', ks => ks.map(k => k.textContent)); console.log('panel (working copy):', kinds2.join(' | '));
  const [dl3] = await Promise.all([page2.waitForEvent('download'), page2.click('#ed-export')]);
  const fin2 = fs.readFileSync(await dl3.path(), 'utf8');
  ok(fin2 === fin, 'final exported from the working copy is identical to the first export');
  // revert in the working copy: the removed title box comes back
  const ridx = await page2.evaluate(() => Array.from(document.querySelectorAll('#ed-panel .ed-chg')).findIndex(c => /Removed/.test(c.textContent) && /working title/.test(c.textContent)));
  await page2.click(`#ed-panel [data-revert="${ridx}"]`); await page2.waitForTimeout(100);
  ok(await page2.evaluate(() => !!document.querySelector('header .ph')), 'baked removal reverted in the working copy');
  ok(errs2.length === 0, 'working copy: no page errors ' + JSON.stringify(errs2));
  // 11. discard
  page.on('dialog', d => d.accept());
  await Promise.all([page.waitForEvent('load'), page.click('#ed-discard')]); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !/EDIT1/.test(document.querySelector('p.standfirst').textContent) && document.querySelector('header .ph') !== null), 'discard restored the draft');
  // 12. phone width toolbar
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('#ed-open'); await page.waitForTimeout(200);
  ok((await page.evaluate(() => document.documentElement.scrollWidth)) === 390, 'no horizontal scroll at 390px in edit mode');
  await page.screenshot({ path: path.join(S, 'editor_390.png') });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.click('#ed-help'); await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('p.standfirst').scrollIntoView()); await page.click('p.standfirst'); await page.keyboard.type('x');
  await page.screenshot({ path: path.join(S, 'editor_1280.png') });
  ok(errs.length === 0, 'no page errors or external requests ' + JSON.stringify(errs));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
})();
