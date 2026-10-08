// End-to-end test of writeup.shared.html against a mock of the claude.ai runtime (window.claude):
// in-memory db with snapshots, user, room presence, downloads, assets, comments. Wraps the page in the
// same skeleton the Artifact tool adds. Exits 1 on any failure.
// Usage: node tools/test_shared.js [scratch-dir]   (run python3 tools/make_shared.py first)
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..'), S = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'sh-test-'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const skeleton = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px)}body{margin:0;font:14px system-ui;background:#faf9f6}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
const wrapped = path.join(S, 'shared_wrapped.html');
fs.writeFileSync(wrapped, skeleton + fs.readFileSync(path.join(ROOT, 'writeup.shared.html'), 'utf8') + '</body></html>');
const MOCK = `(() => {
  const LS='mockdb'; let store; try{store=JSON.parse(localStorage.getItem(LS)||'{}')}catch(e){store={}}
  const RO = (()=>{try{return localStorage.getItem('mockReadOnly')==='1'}catch(e){return false}})();
  const listeners={}; const persist=()=>{try{localStorage.setItem(LS,JSON.stringify(store))}catch(e){}};
  const meta={fromCache:false,hasPendingWrites:false};
  const snapDoc=(col,id)=>{const d=store[col]&&store[col][id]; return {id,exists:!!d,data:()=>d,metadata:meta}};
  const all=col=>Object.keys(store[col]||{}).map(id=>snapDoc(col,id));
  const notify=(col,changes)=>{(listeners[col]||[]).forEach(fn=>{const docs=all(col); fn({docs,size:docs.length,empty:!docs.length,docChanges:()=>changes,metadata:meta})})};
  let n=0;
  function docRef(col,id){ id=id||('d'+(++n)+Date.now().toString(36)); return { id, path:col+'/'+id,
    get:async()=>snapDoc(col,id),
    set:async(data)=>{ if(RO){const e=new Error('ro');e.code='invalid_argument';throw e} store[col]=store[col]||{}; const existed=!!store[col][id]; store[col][id]=JSON.parse(JSON.stringify(data)); persist(); notify(col,[{type:existed?'modified':'added',doc:snapDoc(col,id),oldIndex:-1,newIndex:0}]) },
    update:async(data)=>{ Object.assign(store[col][id],data); persist(); notify(col,[{type:'modified',doc:snapDoc(col,id),oldIndex:0,newIndex:0}]) },
    delete:async()=>{ if(store[col]&&store[col][id]){ const last=snapDoc(col,id); delete store[col][id]; persist(); notify(col,[{type:'removed',doc:last,oldIndex:0,newIndex:-1}]) } },
    onSnapshot:(fn)=>{ setTimeout(()=>fn(snapDoc(col,id)),0); return ()=>{} },
    collection:(p)=>colRef(col+'/'+id+'/'+p) } }
  function colRef(col){ const q={ path:col, doc:(id)=>docRef(col,id), add:async(d)=>{const r=docRef(col); await r.set(d); return r}, where:()=>q, orderBy:()=>q, limit:()=>q,
    get:async()=>{const docs=all(col); return {docs,size:docs.length,empty:!docs.length,docChanges:()=>docs.map(d=>({type:'added',doc:d,oldIndex:-1,newIndex:0})),metadata:meta}},
    onSnapshot:(fn)=>{ (listeners[col]=listeners[col]||[]).push(fn); setTimeout(()=>{const docs=all(col); fn({docs,size:docs.length,empty:!docs.length,docChanges:()=>docs.map(d=>({type:'added',doc:d,oldIndex:-1,newIndex:0})),metadata:meta})},0); return ()=>{} } }; return q }
  const db={doc:(p)=>{const i=p.lastIndexOf('/'); return docRef(p.slice(0,i),p.slice(i+1))}, collection:colRef};
  const ME='u_me', AV='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const prof=id=>({id,name:id===ME?'Me':id==='u_alex'?'Alex Tan':'',avatarUrl:AV,color:id===ME?'#2456b8':'#c8213a',email:null,isMe:id===ME,guest:false});
  const user={ id:async()=>ME, can:async()=>!RO, isOwner:async()=>!RO, canEdit:async()=>!RO, me:async()=>prof(ME), profiles:async(ids)=>{const o={};[].concat(ids).forEach(id=>o[id]=prof(id));return o} };
  let peers=[], peerFns=[]; const myPeer={peer:'p1',by:ME,isMe:true,sameTab:true,kind:'viewer',guest:false,presence:{},updatedAt:Date.now()};
  const room={ presence:async(patch)=>{ Object.assign(myPeer.presence,patch); window.__mock.myPresence=Object.assign({},myPeer.presence) }, peers:()=>[myPeer].concat(peers), onPeers:(fn)=>{ peerFns.push(fn); setTimeout(()=>fn({peers:room.peers(),joined:room.peers(),left:[],updated:[]}),0); return ()=>{} }, emit:async()=>{}, on:()=>()=>{}, connected:()=>true, onConnection:()=>()=>{} };
  const downloads={ save:async(req)=>{ const text=typeof req.data==='string'?req.data:await req.data.text(); window.__mock.saved={filename:req.filename,text}; return {status:'saved'} } };
  const assets= RO ? null : { upload:async(blob)=>{ const url=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob)}); return {id:'a'.repeat(32),url,sizeBytes:blob.size,contentType:blob.type} }, list:async()=>({assets:[],usage:{}}), delete:async()=>({deleted:true}) };
  const comments={ openComposer:async(t)=>{ window.__mock.composer=(t.element&&t.element.getAttribute('data-ed'))||'range'; return {opened:true} }, anchorFor:async()=>({path:'',x:0,y:0}) };
  window.__mock={ store, remoteSet:(col,id,data)=>docRef(col,id).set(data), remoteDelete:(col,id)=>docRef(col,id).delete(), addPeer:(by,editing)=>{ peers=[{peer:'p2',by,isMe:false,sameTab:false,kind:'viewer',guest:false,presence:{editing},updatedAt:Date.now()}]; peerFns.forEach(fn=>fn({peers:room.peers(),joined:peers,left:[],updated:[]})) } };
  window.claude={ use:(name)=>new Promise(r=>setTimeout(()=>r({db,user,room,downloads,assets,comments}[name]||null),30)) };
})();`;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) errs.push('EXTERNAL ' + r.url()); });
  await page.goto('file://' + wrapped, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'load' });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  await page.waitForSelector('#ed-open:not([hidden])', { timeout: 5000 });
  ok(true, 'edit pill appears once the runtime answers');
  ok((await page.textContent('#ed-sync')) === 'all changes saved', 'sync status after first snapshots: ' + await page.textContent('#ed-sync'));
  // 0. no-edit export: full standalone document
  await page.click('#ed-open'); await page.click('#ed-export'); await page.waitForTimeout(400);
  let saved = await page.evaluate(() => window.__mock.saved);
  fs.writeFileSync(path.join(S, 'shared_export_noedit.html'), saved.text);
  ok(saved.filename === 'writeup.html' && saved.text.startsWith('<!DOCTYPE html>\n<html lang="en">\n<head>') && /name="description"/.test(saved.text) && !/data-fromhead|data-editor|contenteditable|Project Toaster draft/.test(saved.text), 'no-edit export is a clean standalone document');
  // 1. edit a paragraph -> blocks doc with my id
  await page.click('p.standfirst'); await page.keyboard.press('Control+End'); await page.keyboard.type(' EDIT1');
  await page.waitForTimeout(1000);
  const sfId = await page.getAttribute('p.standfirst', 'data-ed');
  let st = await page.evaluate(() => window.__mock.store);
  ok(st.blocks && st.blocks[sfId] && st.blocks[sfId].by === 'u_me' && / EDIT1/.test(st.blocks[sfId].html), 'edit written to blocks/' + sfId + ' with author');
  // 2. split -> add op
  await page.keyboard.press('Enter'); await page.keyboard.type('New paragraph here.'); await page.waitForTimeout(1000);
  st = await page.evaluate(() => window.__mock.store);
  const addOps = Object.values(st.ops || {}).filter(o => o.t === 'add');
  ok(addOps.length === 1 && addOps[0].ref === sfId && addOps[0].pos === 'after' && addOps[0].by === 'u_me', 'Enter wrote an add op anchored after the standfirst');
  ok(st.blocks[addOps[0].id] && st.blocks[addOps[0].id].html === 'New paragraph here.', 'new paragraph text written to its own block doc');
  // 3. placeholders: title replace, byline final, image on Toast box
  await page.evaluate(() => document.querySelector('.ph .ed-ph [data-act="text"]').click()); await page.keyboard.type('My real title note'); await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('.ed-pi').click());
  const png = path.join(S, 'test_img.png'); await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 300, height: 120 } });
  const toastPh = await page.evaluate(() => Array.from(document.querySelectorAll('.ph')).find(p => /Toast screenshots/.test(p.textContent)).getAttribute('data-ed'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(id => document.querySelector('[data-ed="' + id + '"] [data-act="img"]').click(), toastPh)]);
  await chooser.setFiles(png); await page.waitForTimeout(800);
  ok(await page.evaluate(id => { const f = document.querySelector('[data-ed="' + id + '"]').previousElementSibling; return f.tagName === 'FIGURE' && f.querySelector('img.shot').src.startsWith('data:image/png'); }, toastPh), 'uploaded image inserted as a figure');
  await page.evaluate(id => document.querySelector('[data-ed="' + id + '"] [data-act="del"]').click(), toastPh); await page.waitForTimeout(300);
  st = await page.evaluate(() => window.__mock.store);
  const kinds = Object.values(st.ops).map(o => o.t).sort().join(',');
  ok(kinds === 'add,add,add,rm,rm,unph', 'op log so far: ' + kinds);
  // 4. remote edit on an unfocused block updates the page and is attributed
  const other = await page.evaluate(() => Array.from(document.querySelectorAll('section#s2 p[data-ed-leaf]'))[0].getAttribute('data-ed'));
  await page.evaluate(id => window.__mock.remoteSet('blocks', id, { html: 'Remote text from Alex.', by: 'u_alex', at: Date.now() }), other); await page.waitForTimeout(200);
  ok((await page.textContent('[data-ed="' + other + '"]')) === 'Remote text from Alex.', 'remote edit applied live');
  await page.click('#ed-changes'); await page.waitForTimeout(300);
  const panelText = await page.textContent('#ed-panel');
  ok(/Alex Tan/.test(panelText) && /you/.test(panelText), 'changes panel names both editors');
  // 5. remote edit on the block I am typing in does not clobber it
  await page.evaluate(() => document.querySelector('p.standfirst').scrollIntoView()); await page.click('p.standfirst'); await page.keyboard.press('Control+End'); await page.keyboard.type(' MORE');
  await page.evaluate(id => window.__mock.remoteSet('blocks', id, { html: 'Clobbered.', by: 'u_alex', at: Date.now() }), sfId); await page.waitForTimeout(200);
  ok(/MORE/.test(await page.textContent('p.standfirst')) && /Someone else just changed/.test(await page.textContent('#ed-toast')), 'focused block kept, warning shown');
  await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  st = await page.evaluate(() => window.__mock.store);
  ok(/MORE/.test(st.blocks[sfId].html) && st.blocks[sfId].by === 'u_me', 'my version written back on blur (last writer wins)');
  // 6. presence
  await page.evaluate(id => window.__mock.addPeer('u_alex', id), other); await page.waitForTimeout(300);
  ok((await page.getAttribute('[data-ed="' + other + '"]', 'data-ed-peer')) === 'Alex Tan', 'peer name tag on the block Alex is editing');
  ok(await page.evaluate(() => window.__mock.myPresence && window.__mock.myPresence.editing === null), 'my presence cleared after leaving a block');
  // 7. comment on last block
  await page.click('p.standfirst'); await page.click('#ed-comment'); await page.waitForTimeout(100);
  ok((await page.evaluate(() => window.__mock.composer)) === sfId, 'Comment opens the composer on the last clicked block');
  // 8. export final
  await page.click('#ed-export'); await page.waitForTimeout(500);
  saved = await page.evaluate(() => window.__mock.saved); const fin = saved.text;
  fs.writeFileSync(path.join(S, 'shared_export_final.html'), fin);
  ok(!/data-editor|contenteditable|data-ed[-="]|data-fromhead/.test(fin), 'final has no editor markup');
  ok(/EDIT1 MORE/.test(fin) && /New paragraph here\./.test(fin) && /My real title note/.test(fin) && /Remote text from Alex\./.test(fin), 'final carries everyone’s edits');
  ok(!/PLACEHOLDER: title|PLACEHOLDER: byline|PLACEHOLDER: Daily Toast/.test(fin) && /PLACEHOLDER: main questions/.test(fin), 'resolved placeholder comments dropped, others kept');
  ok((fin.match(/<img class="shot"/g) || []).length === 13, 'final has 13 images');
  // 8b. offline copy: a standalone writeup.editable.html carrying the shared state, with the local editor
  await page.click('#ed-offline'); await page.waitForTimeout(600);
  const off = await page.evaluate(() => window.__mock.saved);
  const offPath = path.join(S, 'shared_offline.html'); fs.writeFileSync(offPath, off.text);
  ok(off.filename === 'writeup.editable.html' && off.text.startsWith('<!DOCTYPE html>') && /id="ed-pre"/.test(off.text) && /id="ed-main"/.test(off.text) && !/ed-local-|id="ed-head"/.test(off.text), 'offline copy is a standalone editable document');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });   // no mock runtime: plain file
  const po = await ctx2.newPage(); const errsO = []; po.on('pageerror', e => errsO.push(e.message)); po.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) errsO.push('EXTERNAL ' + r.url()); });
  await po.goto('file://' + offPath, { waitUntil: 'load' }); await po.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  ok(await po.isVisible('#ed-open') && await po.evaluate(() => /EDIT1 MORE/.test(document.querySelector('p.standfirst').textContent) && document.querySelector('p.standfirst').nextElementSibling.textContent === 'New paragraph here.' && /Remote text from Alex\./.test(document.body.textContent)), 'offline copy opens with the local editor and carries everyone’s edits');
  await po.click('#ed-open'); await po.click('p.standfirst'); await po.keyboard.press('Control+End'); await po.keyboard.type(' OFFLINE'); await po.waitForTimeout(300);
  const [dlo] = await Promise.all([po.waitForEvent('download'), po.click('#ed-export')]);
  const finO = fs.readFileSync(await dlo.path(), 'utf8');
  ok(dlo.suggestedFilename() === 'writeup.html' && /EDIT1 MORE OFFLINE/.test(finO) && !/data-editor|contenteditable|data-ed[-="]/.test(finO) && (finO.match(/<img class="shot"/g) || []).length === 13, 'offline copy edits and exports a clean final with no connection');
  ok(errsO.length === 0, 'offline copy: no page errors or external requests ' + JSON.stringify(errsO.slice(0, 3)));
  await ctx2.close();
  // 9. revert the remote edit -> doc deleted, text restored
  await page.click('#ed-changes'); await page.click('#ed-changes'); await page.waitForTimeout(300);
  const ridx = await page.evaluate(() => Array.from(document.querySelectorAll('#ed-panel .ed-chg')).findIndex(c => /Remote text from Alex/.test(c.textContent)));
  await page.click(`#ed-panel [data-revert="${ridx}"]`); await page.waitForTimeout(300);
  st = await page.evaluate(() => window.__mock.store);
  ok(!st.blocks[other] && !/Remote text/.test(await page.textContent('[data-ed="' + other + '"]')), 'revert deleted the block doc and restored the text');
  // revert the title replacement (an added block) and bring the box back
  const aidx = await page.evaluate(() => Array.from(document.querySelectorAll('#ed-panel .ed-chg')).findIndex(c => /My real title note/.test(c.textContent)));
  await page.click(`#ed-panel [data-revert="${aidx}"]`); await page.waitForTimeout(300);
  const rmidx = await page.evaluate(() => Array.from(document.querySelectorAll('#ed-panel .ed-chg')).findIndex(c => /Removed/.test(c.textContent) && /working title/.test(c.textContent)));
  await page.click(`#ed-panel [data-revert="${rmidx}"]`); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!document.querySelector('header .ph') && !Array.from(document.querySelectorAll('header p')).some(p => /My real title note/.test(p.textContent))), 'restore op brought the title box back and the added paragraph is gone');
  const count = await page.textContent('#ed-count');
  // 10. reload: state rebuilt from the store
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#ed-open:not([hidden])', { timeout: 5000 }); await page.waitForTimeout(300);
  ok(await page.evaluate(() => /EDIT1 MORE/.test(document.querySelector('p.standfirst').textContent) && document.querySelector('p.standfirst').nextElementSibling.textContent === 'New paragraph here.' && !!document.querySelector('header .ph') && !document.querySelector('header .ph-inline')), 'state rebuilt from the store after reload');
  await page.click('#ed-open');
  ok((await page.textContent('#ed-count')) === count, 'same change count after reload: ' + count);
  // 11. an op removed outside the page -> reset notice
  const anyOp = Object.keys(st.ops)[0];
  await page.evaluate(id => window.__mock.remoteDelete('ops', id), anyOp); await page.waitForTimeout(200);
  ok(/reset outside this page/.test(await page.textContent('#ed-toast')), 'reset notice when the log is changed elsewhere');
  // 12. read-only viewer
  await page.evaluate(() => localStorage.setItem('mockReadOnly', '1')); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(600);
  ok(await page.evaluate(() => document.querySelector('#ed-open').hidden && !!document.querySelector('.ed-view') && /EDIT1/.test(document.querySelector('p.standfirst').textContent)), 'read-only viewer sees the shared draft without the edit pill');
  await page.evaluate(() => localStorage.removeItem('mockReadOnly'));
  // 13. phone width
  await page.reload({ waitUntil: 'load' }); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForSelector('#ed-open:not([hidden])'); await page.click('#ed-open'); await page.waitForTimeout(200);
  ok((await page.evaluate(() => document.documentElement.scrollWidth)) === 390, 'no horizontal scroll at 390px');
  await page.setViewportSize({ width: 1280, height: 900 }); await page.evaluate(id => window.__mock.addPeer('u_alex', id), other);
  await page.evaluate(id => document.querySelector('[data-ed="' + id + '"]').scrollIntoView({ block: 'center' }), other); await page.click('#ed-changes'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(S, 'shared_1280.png') });
  ok(errs.length === 0, 'no page errors or external requests ' + JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
})();
