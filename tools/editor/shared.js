// Shared draft editor for the claude.ai copy (writeup.shared.html). Runs after the article's script.
// Same block model as editor.js (pre.js assigns data-ed ids and keeps a pristine snapshot), but the
// state lives in the page's shared database: blocks/<id> = {html, by, at} for text edits, and
// ops/<opId> = {t, id, ref, pos, tag, cls, html, leaf, by, at} as an append-only log of structural
// changes (add, rm, restore, unph, reph). Every view subscribes to both and applies what it has
// not seen; reverts write inverse entries. Exports replay the log onto the pristine snapshot.
(function () {
  'use strict';
  var ED = window.__ED; if (!ED || !ED.pristine) return;
  var LEAF = '[data-ed-leaf]';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var byId = function (root, id) { return root.querySelector('[data-ed="' + id + '"]'); };
  var state = { ops: [], edits: {} };
  var seenOps = {}, pending = 0, timers = {};
  var caps = {}, me = null, canWrite = null, on = false, focusedId = null, lastLeaf = null, readOnly = false;
  var peerColors = {};

  // graft the article's own script (parsed after the snapshot) into the pristine copy
  (function () { var live = $$('body > script:not([data-editor])'), pr = $$('body > script:not([data-editor])', ED.pristine), pb = ED.pristine.querySelector('body'); for (var i = pr.length; i < live.length; i++) { pb.appendChild(document.createTextNode('\n')); pb.appendChild(live[i].cloneNode(true)); } })();

  // ---------- html helpers
  function cleanHTML(el) { var c = el.cloneNode(true); $$('[data-editor]', c).forEach(function (x) { x.remove(); }); return c.innerHTML; }
  function norm(h) { return (h || '').replace(/<br\s*\/?>\s*$/i, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
  function textOf(h) { var d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.replace(/\s+/g, ' ').trim(); }
  function snip(t, n) { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > (n || 90) ? t.slice(0, n || 90) + '…' : t; }
  function esc(t) { return (t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pristineHTML(id) { var p = byId(ED.pristine, id); return p ? cleanHTML(p) : null; }
  function baseHTML(id) { var p = pristineHTML(id); if (p !== null) return p; var op = null; state.ops.forEach(function (o) { if (o.t === 'add' && o.id === id) op = o; }); return op ? (op.html || '') : null; }
  function newId() { return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); }
  function isAdded(id) { return pristineHTML(id) === null; }
  function placeholderComment(el) {
    var e = el;
    for (var lvl = 0; lvl < 3 && e; lvl++, e = e.parentElement) {
      for (var s = e.previousSibling; s; s = s.previousSibling) {
        if (s.nodeType === 3 && !/\S/.test(s.nodeValue)) continue;
        if (s.nodeType === 8 && /PLACEHOLDER/.test(s.nodeValue)) return s;
        if (s.nodeType === 1 && s.hasAttribute('data-ed') && isAdded(s.getAttribute('data-ed'))) continue;
        break;
      }
    }
    return null;
  }
  function dropComment(el) { var c = placeholderComment(el); if (c) c.remove(); }
  function placeLike(root, p, el) {
    var s, live;
    for (s = p.previousElementSibling; s; s = s.previousElementSibling) if (s.hasAttribute('data-ed') && (live = byId(root, s.getAttribute('data-ed')))) { live.insertAdjacentElement('afterend', el); return true; }
    for (s = p.nextElementSibling; s; s = s.nextElementSibling) if (s.hasAttribute('data-ed') && (live = byId(root, s.getAttribute('data-ed')))) { live.insertAdjacentElement('beforebegin', el); return true; }
    for (var par = p.parentElement; par; par = par.parentElement) {
      if (par.id && (live = root.querySelector('#' + CSS.escape(par.id)))) { live.appendChild(el); return true; }
      if (par.hasAttribute('data-ed') && (live = byId(root, par.getAttribute('data-ed')))) { live.appendChild(el); return true; }
    }
    return false;
  }

  // ---------- replaying the log
  function applyOp(root, op) {
    var el = byId(root, op.id), ref;
    if (op.t === 'add') {
      if (el) return;
      ref = byId(root, op.ref); if (!ref) { console.warn('editor: anchor missing', op); return; }
      var n = document.createElement(op.tag); if (op.cls) n.className = op.cls;
      n.setAttribute('data-ed', op.id); if (op.leaf) n.setAttribute('data-ed-leaf', '1');
      n.innerHTML = op.html || '';
      ref.insertAdjacentElement(op.pos === 'before' ? 'beforebegin' : 'afterend', n);
      if (root === document) { enableLeaves(n); if (state.edits[op.id]) n.innerHTML = state.edits[op.id].html; }
    } else if (op.t === 'rm') { if (el) { dropComment(el); el.remove(); } }
    else if (op.t === 'restore') { if (el) return; var p = byId(ED.pristine, op.id); if (!p) return; var c = p.cloneNode(true); if (placeLike(root, p, c)) { var cm = placeholderComment(p); if (cm) c.parentNode.insertBefore(cm.cloneNode(), c); if (root === document) { enableLeaves(c); phActions(on, c); } } }
    else if (op.t === 'unph') { if (el) { dropComment(el); el.classList.remove('ph-inline'); if (!el.className) el.removeAttribute('class'); } }
    else if (op.t === 'reph') { if (el) el.classList.add('ph-inline'); }
  }
  function applyAll(root) {
    state.ops.forEach(function (op) { applyOp(root, op); });
    Object.keys(state.edits).forEach(function (id) { var el = byId(root, id); if (el) el.innerHTML = state.edits[id].html; });
  }

  // ---------- shared store
  function setSync(t, busy) { var s = $('#ed-sync'); s.textContent = t; s.classList.toggle('busy', !!busy); }
  function writeFail(e) {
    pending--; setSync(pending ? 'saving…' : 'save failed', true);
    if (e && e.code === 'invalid_argument' && canWrite !== true) setReadOnly('You can read this draft but not change it. Ask the owner for Contributor access.');
    else if (e && e.code === 'quota_exceeded') toast('The page’s database is full; ask Claude to tidy it.');
    else toast('Could not save (' + ((e && e.code) || 'error') + '). Check your connection and try again.');
  }
  function writeDone() { pending--; setSync(pending ? 'saving…' : 'all changes saved', pending > 0); }
  function writeOp(op) {
    if (!caps.db) return;
    var ref = caps.db.collection('ops').doc(); op._id = ref.id; op.by = me; op.at = Date.now();
    seenOps[ref.id] = true; state.ops.push(op);
    var body = {}; Object.keys(op).forEach(function (k) { if (k !== '_id') body[k] = op[k]; });
    pending++; setSync('saving…', true);
    ref.set(body).then(writeDone, writeFail);
  }
  function writeEdit(id, html) {
    if (!caps.db) return;
    var base = baseHTML(id), ref = caps.db.doc('blocks/' + id);
    pending++; setSync('saving…', true);
    if (base !== null && norm(html) === norm(base)) { delete state.edits[id]; ref.delete().then(writeDone, writeFail); }
    else { state.edits[id] = { html: html, by: me, at: Date.now() }; ref.set(state.edits[id]).then(writeDone, writeFail); }
  }
  function subscribe() {
    var db = caps.db, ready = 0;
    function first() { if (++ready === 2) { setSync('all changes saved'); refreshMarks(); renderChanges(); if (readOnly) return; $('#ed-open').hidden = canWrite === false; } }
    db.collection('ops').orderBy('at').onSnapshot(function (snap) {
      var reset = false;
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'added') { var op = ch.doc.data(); if (seenOps[ch.doc.id]) return; seenOps[ch.doc.id] = true; op = Object.assign({}, op, { _id: ch.doc.id }); state.ops.push(op); applyOp(document, op); }
        else if (ch.type === 'removed') reset = true;
      });
      if (reset) toast('The draft was reset outside this page. Reload to see its current state.', 20000);
      if (ready < 2) first(); else { refreshMarks(); renderChanges(); }
    }, function (e) { setSync('live updates lost (' + e.code + '); reload', true); });
    db.collection('blocks').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        var id = ch.doc.id, el = byId(document, id);
        if (ch.type === 'removed') {
          if (state.edits[id] && state.edits[id].by === me && ch.doc.metadata.hasPendingWrites) return;
          delete state.edits[id];
          if (el && id !== focusedId) { var b = baseHTML(id); if (b !== null) el.innerHTML = b; }
        } else {
          var d = ch.doc.data(); state.edits[id] = d;
          if (!el) return;
          if (id === focusedId) { if (d.by !== me) toast('Someone else just changed the paragraph you are in. Your version replaces theirs when you leave it.', 8000); return; }
          if (norm(cleanHTML(el)) !== norm(d.html)) el.innerHTML = d.html;
        }
      });
      if (ready < 2) first(); else { refreshMarks(); renderChanges(); }
    }, function (e) { setSync('live updates lost (' + e.code + '); reload', true); });
  }

  // ---------- people
  var profileCache = {};
  function names(ids, cb) {
    ids = ids.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!caps.user || !ids.length) { cb({}); return; }
    caps.user.profiles(ids).then(function (ps) { Object.keys(ps).forEach(function (k) { profileCache[k] = ps[k]; }); cb(ps); }, function () { cb({}); });
  }
  function nameOf(id, ps) { if (id === me) return 'you'; var p = (ps && ps[id]) || profileCache[id]; return (p && p.name) || 'Someone'; }
  function avatarOf(id, ps) { var p = (ps && ps[id]) || profileCache[id]; return p ? p.avatarUrl : ''; }
  function renderPeers() {
    if (!caps.room) return;
    var peers = caps.room.peers().filter(function (p) { return !p.isMe && p.kind === 'viewer'; });
    $$('[data-ed-peer]').forEach(function (el) { el.removeAttribute('data-ed-peer'); el.style.removeProperty('--peer'); });
    var ids = peers.map(function (p) { return p.by || (p.presence && p.presence.uid) || null; });
    names(ids, function (ps) {
      var strip = $('#ed-people'); strip.innerHTML = '';
      peers.forEach(function (p, i) {
        var id = ids[i], nm = nameOf(id, ps), av = avatarOf(id, ps), col = (ps[id] && ps[id].color) || '';
        if (av) { var img = document.createElement('img'); img.src = av; img.alt = nm; img.title = nm + ' is here'; strip.appendChild(img); }
        var ed = p.presence && p.presence.editing; if (ed) { var el = byId(document, ed); if (el) { el.setAttribute('data-ed-peer', nm); if (col) el.style.setProperty('--peer', col); } }
      });
    });
  }
  function setPresence(editing) { if (caps.room) caps.room.presence({ editing: editing || null, uid: me || null }).catch(function () { }); }

  // ---------- change tracking
  function isChanged(id, el) { var b = pristineHTML(id); if (b === null) return true; return norm(cleanHTML(el)) !== norm(b); }
  function recordEdit(leaf) {
    var id = leaf.getAttribute('data-ed'), h = cleanHTML(leaf).replace(/ /g, ' ');
    leaf.toggleAttribute('data-ed-changed', isChanged(id, leaf));
    clearTimeout(timers[id]); timers[id] = setTimeout(function () { writeEdit(id, h); updateCount(); }, 700);
    updateCount();
  }
  function flushEdit(leaf) { var id = leaf.getAttribute('data-ed'); if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; writeEdit(id, cleanHTML(leaf).replace(/ /g, ' ')); } }
  function refreshMarks() { $$(LEAF).forEach(function (el) { if (!el.closest('[data-editor]')) el.toggleAttribute('data-ed-changed', isChanged(el.getAttribute('data-ed'), el)); }); updateCount(); }
  function sectionOf(el) {
    var sec = el.closest('section'); var k = sec && sec.querySelector('h2 .num');
    if (k) return k.textContent.trim(); if (el.closest('header')) return 'Top'; if (el.closest('footer')) return 'Footer'; return '';
  }
  function lastOpFor(id) { var r = null; state.ops.forEach(function (o) { if (o.id === id) r = o; }); return r; }
  function changes() {
    var out = [];
    $$(LEAF).forEach(function (el) {
      if (el.closest('[data-editor]')) return;
      var id = el.getAttribute('data-ed'); if (!isChanged(id, el)) return;
      var added = isAdded(id), e = state.edits[id], o = added ? lastOpFor(id) : null;
      out.push({ kind: added ? 'Added' : 'Edited', id: id, el: el, before: textOf(pristineHTML(id)), after: el.textContent, sec: sectionOf(el), by: e ? e.by : (o ? o.by : null), at: e ? e.at : (o ? o.at : 0) });
    });
    $$('figure[data-ed]').forEach(function (el) { var id = el.getAttribute('data-ed'); if (isAdded(id)) { var o = lastOpFor(id); out.push({ kind: 'Added image', id: id, el: el, after: '', sec: sectionOf(el), by: o && o.by, at: o ? o.at : 0 }); } });
    $$('[data-ed]', ED.pristine).forEach(function (p) {
      var id = p.getAttribute('data-ed'); if (byId(document, id)) return;
      for (var a = p.parentElement; a; a = a.parentElement) if (a.hasAttribute('data-ed') && !byId(document, a.getAttribute('data-ed'))) return;   // inside a removed box
      var o = lastOpFor(id); out.push({ kind: 'Removed', id: id, before: p.textContent, pristine: p, sec: sectionOf(p), by: o && o.by, at: o ? o.at : 0 });
    });
    $$('.ph-inline[data-ed]', ED.pristine).forEach(function (p) { var id = p.getAttribute('data-ed'), el = byId(document, id); if (el && !el.classList.contains('ph-inline')) { var o = lastOpFor(id); out.push({ kind: 'Marked final', id: id, el: el, after: el.textContent, sec: sectionOf(el), by: o && o.by, at: o ? o.at : 0 }); } });
    return out;
  }
  function updateCount() {
    var n = changes().length, t = n === 0 ? 'no changes' : n + (n === 1 ? ' change' : ' changes');
    $('#ed-count').textContent = t;
    var pn = $('#ed-pill-n'); pn.hidden = n === 0; pn.textContent = n;
  }
  function ago(t) { if (!t) return ''; var s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString(); }
  var toastTimer;
  function toast(msg, ms) { var t = $('#ed-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 6000); }

  // ---------- revert = inverse write
  function revert(c) {
    if (c.kind === 'Edited') { c.el.innerHTML = pristineHTML(c.id); clearTimeout(timers[c.id]); writeEdit(c.id, c.el.innerHTML); }
    else if (c.kind === 'Added' || c.kind === 'Added image') { dropComment(c.el); c.el.remove(); writeOp({ t: 'rm', id: c.id }); }
    else if (c.kind === 'Removed') { var op = { t: 'restore', id: c.id }; applyOp(document, op); writeOp(op); }
    else if (c.kind === 'Marked final') { c.el.classList.add('ph-inline'); writeOp({ t: 'reph', id: c.id }); }
    refreshMarks(); renderChanges();
  }
  function renderChanges() {
    var panel = $('#ed-panel'); if (panel.hidden) return;
    var list = changes();
    if (!list.length) { panel.innerHTML = '<div class="ed-empty">No changes yet. Click any paragraph to start.</div>'; return; }
    names(list.map(function (c) { return c.by; }), function (ps) {
      panel.innerHTML = list.map(function (c, i) {
        var t = c.kind === 'Edited' ? '<s>' + esc(snip(c.before)) + '</s><span class="ar">→</span>' + esc(snip(c.after))
          : c.kind === 'Removed' ? '<s>' + esc(snip(c.before)) + '</s>'
          : c.kind === 'Added image' ? 'Figure inserted' : esc(snip(c.after));
        var av = avatarOf(c.by, ps), who = (c.by || c.at) ? '<span class="ed-who">· ' + (av ? '<img src="' + esc(av) + '" alt="">' : '') + esc(nameOf(c.by, ps)) + (c.at ? ', ' + esc(ago(c.at)) : '') + '</span>' : '';
        var jump = c.el ? '<button type="button" data-jump="' + i + '">Show</button>' : '';
        var rev = readOnly ? '' : '<button type="button" data-revert="' + i + '">Revert</button>';
        return '<div class="ed-chg"><div class="k"><b>' + esc(c.kind) + '</b> · ' + esc(c.sec) + ' ' + who + '</div><div class="t">' + t + '</div><div class="a">' + jump + rev + '</div></div>';
      }).join('');
      panel.querySelectorAll('[data-jump]').forEach(function (b) { b.onclick = function () { var c = list[+b.getAttribute('data-jump')]; var d = c.el.closest('details'); if (d) d.open = true; c.el.scrollIntoView({ block: 'center' }); c.el.classList.remove('ed-flash'); void c.el.offsetWidth; c.el.classList.add('ed-flash'); }; });
      panel.querySelectorAll('[data-revert]').forEach(function (b) { b.onclick = function () { revert(list[+b.getAttribute('data-revert')]); }; });
    });
  }

  // ---------- edit mode
  function enableLeaves(root) { var list = $$(LEAF, root); if (root && root.matches && root.matches(LEAF)) list.push(root); list.forEach(function (el) { if (on) { el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true'); } else { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); } }); }
  function phActions(show, root) {
    $$('.ph[data-ed]', root).forEach(function (ph) {
      var row = ph.querySelector(':scope > .ed-ph');
      if (!show) { if (row) row.remove(); return; }
      if (row) return;
      row = document.createElement('div'); row.className = 'ed-ph'; row.setAttribute('data-editor', '');
      row.innerHTML = '<button type="button" data-act="text">Replace with text</button>' + (caps.assets ? '<button type="button" data-act="img">Add image…</button>' : '') + '<button type="button" data-act="del">Delete box</button>';
      ph.appendChild(row);
    });
    $$('.ph-inline[data-ed]', root).forEach(function (el) {
      var b = el.nextElementSibling && el.nextElementSibling.classList.contains('ed-pi') ? el.nextElementSibling : null;
      if (!show) { if (b) b.remove(); return; }
      if (b) return;
      b = document.createElement('button'); b.type = 'button'; b.className = 'ed-pi'; b.setAttribute('data-editor', ''); b.textContent = '✓ final'; b.title = 'Mark this text as final: keeps the words, removes the amber underline';
      el.insertAdjacentElement('afterend', b);
    });
  }
  function setMode(v) {
    on = v; document.body.classList.toggle('ed-on', on);
    enableLeaves(document); phActions(on);
    $('#ed-tools').hidden = !on; $('#ed-open').hidden = on || readOnly;
    if (!on) { $('#ed-panel').hidden = true; $('#ed-helpbox').hidden = true; $('#ed-changes').setAttribute('aria-expanded', 'false'); $('#ed-help').setAttribute('aria-expanded', 'false'); setPresence(null); }
    refreshMarks(); renderPeers();
  }
  function setReadOnly(msg) { readOnly = true; if (on) setMode(false); $('#ed-open').hidden = true; var v = document.createElement('span'); v.className = 'ed-view'; v.textContent = 'View only'; $('#ed-bar').appendChild(v); if (msg) toast(msg, 10000); }
  function focusAt(el, atEnd) { el.focus(); var r = document.createRange(); r.selectNodeContents(el); r.collapse(!atEnd); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  function prevLeaf(el) { var all = $$(LEAF).filter(function (x) { return !x.closest('[data-editor]'); }); var i = all.indexOf(el); return i > 0 ? all[i - 1] : null; }
  function addBlock(tag, cls, ref, pos, html, leaf) {
    var op = { t: 'add', id: newId(), ref: ref.getAttribute('data-ed'), pos: pos, tag: tag, cls: cls || '', html: html || '', leaf: !!leaf };
    applyOp(document, op); writeOp(op); return byId(document, op.id);
  }
  function removeBlock(el) {
    var id = el.getAttribute('data-ed');
    $$('[data-ed]', el).concat([el]).forEach(function (x) { clearTimeout(timers[x.getAttribute('data-ed')]); });
    dropComment(el); el.remove(); writeOp({ t: 'rm', id: id }); refreshMarks(); renderChanges();
  }
  function splitBlock(leaf) {
    var sel = window.getSelection(); if (!sel.rangeCount) return;
    var r = sel.getRangeAt(0); r.deleteContents();
    var after = document.createRange(); after.setStart(r.endContainer, r.endOffset); after.setEnd(leaf, leaf.childNodes.length);
    var frag = after.extractContents();
    var n = addBlock(leaf.tagName.toLowerCase(), (leaf.className || '').trim(), leaf, 'after', '', true);
    n.appendChild(frag);
    var br = leaf.lastChild; if (br && br.nodeName === 'BR') br.remove();
    recordEdit(leaf); flushEdit(leaf); if (n.textContent.trim()) { recordEdit(n); flushEdit(n); }
    focusedId = n.getAttribute('data-ed'); focusAt(n, false); renderChanges();
  }

  // ---------- export
  function buildFinal(cb) {
    var root = ED.pristine.cloneNode(true);
    applyAll(root);
    $$('[data-editor]', root).forEach(function (x) { x.remove(); });
    $$('p[data-ed],li[data-ed]', root).forEach(function (x) { if (isAdded(x.getAttribute('data-ed')) && !x.textContent.trim() && !x.querySelector('img')) x.remove(); });
    $$('[data-ed],[data-ed-leaf],[contenteditable],[data-ed-changed],[spellcheck],[data-ed-peer]', root).forEach(function (x) { ['data-ed', 'data-ed-leaf', 'contenteditable', 'spellcheck', 'data-ed-changed', 'data-ed-peer', 'style'].forEach(function (a) { if (a !== 'style' || x.hasAttribute('data-ed-peer')) x.removeAttribute(a); }); });
    var body = root.querySelector('body'); body.classList.remove('ed-on'); if (!body.className) body.removeAttribute('class');
    var placeholders = root.querySelectorAll('.ph,.ph-inline').length;
    // uploaded images: inline them so the file stays self-contained
    var imgs = $$('img[src^="/_blob/"]', root), left = imgs.length;
    function finish() {
      var headEl = $('#ed-head'), head = headEl ? headEl.textContent : '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">';
      var attrs = headEl && headEl.getAttribute('data-html-attrs') || ' lang="en"';
      var inner = Array.prototype.map.call(body.childNodes, function (n) { return n.nodeType === 1 && (n.tagName === 'TITLE' || n.hasAttribute('data-fromhead')) ? '' : (n.outerHTML !== undefined ? n.outerHTML : n.nodeValue); }).join('');
      cb({ html: '<!DOCTYPE html>\n<html' + attrs + '>\n<head>' + head + '</head>\n<body>' + inner + '</body>\n</html>\n', placeholders: placeholders });
    }
    if (!left) return finish();
    imgs.forEach(function (im) {
      fetch(im.getAttribute('src')).then(function (r) { return r.blob(); }).then(function (b) { var rd = new FileReader(); rd.onload = function () { im.setAttribute('src', rd.result); if (!--left) finish(); }; rd.onerror = function () { if (!--left) finish(); }; rd.readAsDataURL(b); }).catch(function () { if (!--left) finish(); });
    });
  }
  function exportFinal() {
    if (!caps.downloads) { toast('Downloads are not available in this view. Ask Claude to export the draft.'); return; }
    buildFinal(function (d) {
      var n = changes().length;
      caps.downloads.save({ filename: 'writeup.html', data: new Blob([d.html], { type: 'text/html' }) }).then(function () {
        toast('Exported writeup.html (' + (d.html.length / 1e6).toFixed(1) + ' MB) with ' + n + (n === 1 ? ' change' : ' changes') + '. ' + (d.placeholders ? d.placeholders + ' placeholder' + (d.placeholders === 1 ? '' : 's') + ' still open.' : 'No placeholders left.'), 9000);
      }, function (e) { if (e.code === 'declined') return; toast(e.code === 'extension_not_enabled' ? 'HTML downloads are switched off in this view. Ask Claude to export the draft.' : 'Export failed (' + e.code + ').'); });
    });
  }

  // ---------- events
  document.addEventListener('click', function (e) {
    if (!on || !e.target.closest) return;
    if (e.target.closest('[data-editor]')) return;
    var leaf = e.target.closest(LEAF);
    if (leaf) { e.stopPropagation(); if (e.target.closest('a')) e.preventDefault(); }
  }, true);
  document.addEventListener('focusin', function (e) { var leaf = e.target.closest && e.target.closest(LEAF); if (leaf && on && !leaf.closest('[data-editor]')) { focusedId = leaf.getAttribute('data-ed'); lastLeaf = leaf; setPresence(focusedId); $('#ed-comment').disabled = false; } });
  document.addEventListener('focusout', function (e) { var leaf = e.target.closest && e.target.closest(LEAF); if (leaf && on) { flushEdit(leaf); if (focusedId === leaf.getAttribute('data-ed')) focusedId = null; setPresence(null); } });
  document.addEventListener('input', function (e) { var leaf = e.target.closest && e.target.closest(LEAF); if (leaf && on) recordEdit(leaf); });
  document.addEventListener('paste', function (e) {
    var leaf = e.target.closest && e.target.closest(LEAF); if (!leaf || !on) return;
    e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!document.execCommand || !document.execCommand('insertText', false, t)) { var s = window.getSelection(); if (s.rangeCount) { var r = s.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(t)); r.collapse(false); } }
    recordEdit(leaf);
  });
  document.addEventListener('keydown', function (e) {
    if (!on) return;
    var leaf = e.target.closest && e.target.closest(LEAF); if (!leaf) return;
    var tag = leaf.tagName.toLowerCase();
    if (e.key === 'Escape') { leaf.blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (tag === 'p' || tag === 'li') splitBlock(leaf); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && (tag === 'p' || tag === 'li') && !leaf.textContent.trim() && !leaf.querySelector('img')) {
      e.preventDefault(); var p = prevLeaf(leaf); focusedId = null; removeBlock(leaf); if (p) focusAt(p, true);
    }
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.ed-ph button, .ed-pi'); if (!b) return;
    if (b.classList.contains('ed-pi')) {
      var sp = b.previousElementSibling; b.remove();
      var op = { t: 'unph', id: sp.getAttribute('data-ed') }; applyOp(document, op); writeOp(op);
      var lf = sp.closest(LEAF); if (lf && lf !== sp) { recordEdit(lf); flushEdit(lf); }
      refreshMarks(); renderChanges(); return;
    }
    var ph = b.closest('.ph'), act = b.getAttribute('data-act');
    if (act === 'text') { var p = addBlock('p', '', ph, 'before', '', true); removeBlock(ph); focusAt(p, false); }
    else if (act === 'del') removeBlock(ph);
    else if (act === 'img') { var f = $('#ed-file'); f.__ph = ph; f.value = ''; f.click(); }
  });
  $('#ed-file').addEventListener('change', function () {
    var f = this.files[0], ph = this.__ph; if (!f || !ph || !caps.assets) return;
    toast('Uploading image…', 20000);
    caps.assets.upload(f).then(function (res) {
      var cid = newId();
      var html = '<div class="fig"><img class="shot" src="' + esc(res.url) + '" alt="" tabindex="0" role="button"><span class="enl" aria-hidden="true">⤢ Enlarge</span></div><figcaption data-ed="' + cid + '" data-ed-leaf="1"><b>Caption.</b> Describe the image here.</figcaption>';
      var fig = addBlock('figure', '', ph, 'before', html, false);
      refreshMarks(); renderChanges(); focusAt(fig.querySelector('figcaption'), true);
      toast('Image inserted above the placeholder box. Edit the caption, then delete the box when you are done.');
    }, function (e) { toast(e.code === 'too_large' ? 'That image is over the 20 MB limit.' : e.code === 'unsupported_type' ? 'Use a PNG, JPEG, GIF or WebP image.' : 'Upload failed (' + e.code + ').'); });
  });
  $('#ed-open').onclick = function () { setMode(true); };
  $('#ed-done').onclick = function () { setMode(false); };
  $('#ed-changes').onclick = function () { var p = $('#ed-panel'); p.hidden = !p.hidden; $('#ed-helpbox').hidden = true; $('#ed-help').setAttribute('aria-expanded', 'false'); this.setAttribute('aria-expanded', String(!p.hidden)); renderChanges(); };
  $('#ed-help').onclick = function () { var p = $('#ed-helpbox'); p.hidden = !p.hidden; $('#ed-panel').hidden = true; $('#ed-changes').setAttribute('aria-expanded', 'false'); this.setAttribute('aria-expanded', String(!p.hidden)); };
  $('#ed-export').onclick = exportFinal;
  $('#ed-comment').onclick = function () {
    if (!caps.comments || !lastLeaf || !lastLeaf.isConnected) { toast('Click a paragraph first, then Comment.'); return; }
    caps.comments.openComposer({ element: lastLeaf }).then(function (r) { if (!r.opened) toast('Finish or close the open comment first.'); }, function (e) { if (e.code === 'unavailable') { $('#ed-comment').hidden = true; toast('Commenting is not available in this view.'); } });
  };
  window.addEventListener('pagehide', function () { Object.keys(timers).forEach(function (id) { var el = byId(document, id); if (el) flushEdit(el); }); });

  // ---------- boot: render first, light up when the capabilities answer
  setSync('connecting…', true);
  var use = function (n) { return (window.claude && window.claude.use) ? window.claude.use(n).catch(function () { return null; }) : Promise.resolve(null); };
  Promise.all([use('db'), use('user'), use('room'), use('comments'), use('downloads'), use('assets')]).then(function (r) {
    caps = { db: r[0], user: r[1], room: r[2], comments: r[3], downloads: r[4], assets: r[5] };
    if (!caps.db) { setSync('not connected'); setReadOnly(window.claude ? 'Sign in to claude.ai to edit this draft.' : null); return; }
    var after = function () {
      $('#ed-comment').hidden = !caps.comments; $('#ed-export').hidden = !caps.downloads;
      if (canWrite === false) setReadOnly('You can read this draft but not change it. Ask the owner for Contributor access.');
      subscribe();
      if (caps.room) { caps.room.onPeers(renderPeers, function () { }); }
    };
    if (caps.user) Promise.all([caps.user.id(), caps.user.can('data.write')]).then(function (u) { me = u[0]; canWrite = u[1]; after(); }, after); else after();
  });
})();
