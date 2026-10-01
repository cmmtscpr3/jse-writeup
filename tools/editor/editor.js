// Draft editor for writeup.editable.html. Runs after the article's own script.
// Model: the pristine document (captured by pre.js) + an ordered log of structural ops + a map of
// per-block innerHTML edits. The live page is only the editing surface; both exports replay the log
// onto a fresh copy of the pristine document.
(function () {
  'use strict';
  var ED = window.__ED; if (!ED || !ED.pristine) return;
  var BUILD = document.body.getAttribute('data-ed-build') || '0';
  var KEY = 'toaster-edit:' + BUILD;
  var LEAF = '[data-ed-leaf]';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var byId = function (root, id) { return root.querySelector('[data-ed="' + id + '"]'); };
  var state = { ops: [], edits: {} };
  var orig = {}, baked = { removed: [], final: [] };   // from a saved working copy, if this is one
  var on = false, saveTimer = null, discarded = false;
  var TOOLBAR_HTML = $('#ed-bar').outerHTML;    // clean copy for saved working copies
  // pre.js snapshots the page before the parser reaches the article's own script, so graft every
  // later non-editor script into the snapshot (script elements are never changed at runtime)
  (function () { var live = $$('body > script:not([data-editor])'), pr = $$('body > script:not([data-editor])', ED.pristine), pb = ED.pristine.querySelector('body'); for (var i = pr.length; i < live.length; i++) { pb.appendChild(document.createTextNode('\n')); pb.appendChild(live[i].cloneNode(true)); } pb.appendChild(document.createTextNode('\n')); })();

  // ---------- html helpers
  function cleanHTML(el) { var c = el.cloneNode(true); $$('[data-editor]', c).forEach(function (x) { x.remove(); }); return c.innerHTML; }
  function norm(h) { return (h || '').replace(/<br\s*\/?>\s*$/i, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
  function textOf(h) { var d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.replace(/\s+/g, ' ').trim(); }
  function snip(t, n) { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > (n || 90) ? t.slice(0, n || 90) + '…' : t; }
  function esc(t) { return (t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pristineHTML(id) { var p = byId(ED.pristine, id); return p ? cleanHTML(p) : null; }
  function origHTML(id) { return (id in orig) ? orig[id] : pristineHTML(id); }   // what Changes compares against
  function newId() { return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); }
  function stamp() { return new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-') + '-' + Math.floor(Math.random() * 46656).toString(36); }
  function isAdded(id) { return pristineHTML(id) === null || (id in orig && orig[id] === null); }
  function placeholderComment(el) {
    // the <!-- PLACEHOLDER --> note sits before the box, or before an ancestor of an inline placeholder
    var e = el;
    for (var lvl = 0; lvl < 3 && e; lvl++, e = e.parentElement) {
      for (var s = e.previousSibling; s; s = s.previousSibling) {
        if (s.nodeType === 3 && !/\S/.test(s.nodeValue)) continue;
        if (s.nodeType === 8 && /PLACEHOLDER/.test(s.nodeValue)) return s;
        if (s.nodeType === 1 && s.hasAttribute('data-ed') && isAdded(s.getAttribute('data-ed'))) continue;   // look past blocks inserted in front of the box
        break;
      }
    }
    return null;
  }
  function dropComment(el) { var c = placeholderComment(el); if (c) c.remove(); }

  // ---------- replaying the log onto any root (live document or a pristine copy)
  function apply(root, ops, edits) {
    ops.forEach(function (op) {
      var el = byId(root, op.id), ref;
      if (op.t === 'add') {
        ref = byId(root, op.ref); if (!ref) { console.warn('editor: anchor missing for', op); return; }
        var n = document.createElement(op.tag); if (op.cls) n.className = op.cls;
        n.setAttribute('data-ed', op.id); if (op.leaf) n.setAttribute('data-ed-leaf', '1');
        n.innerHTML = op.html || '';
        ref.insertAdjacentElement(op.pos === 'before' ? 'beforebegin' : 'afterend', n);
      } else if (op.t === 'rm') { if (el) { dropComment(el); el.remove(); } }
      else if (op.t === 'unph') { if (el) { dropComment(el); el.classList.remove('ph-inline'); if (!el.className) el.removeAttribute('class'); } }
      else if (op.t === 'reph') { if (el) el.classList.add('ph-inline'); }
    });
    Object.keys(edits).forEach(function (id) { var el = byId(root, id); if (el) el.innerHTML = edits[id]; });
  }

  // ---------- draft persistence (this browser only)
  function save() {
    if (discarded) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); setWarn(''); }
    catch (e) { setWarn('Autosave failed: the draft is too large for this browser (images count). Use “Save working copy”.'); }
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.ops && s.edits) state = s; } catch (e) { }
    var j = $('#ed-orig');
    if (j) { try { var o = JSON.parse(j.textContent); orig = o.orig || {}; (o.added || []).forEach(function (id) { orig[id] = null; }); baked.removed = o.removed || []; baked.final = o.final || []; } catch (e) { } }
  }

  // ---------- change tracking
  function isChanged(id, el) { var o = origHTML(id); if (o === null) return true; return norm(cleanHTML(el)) !== norm(o); }
  function recordEdit(leaf) {
    var id = leaf.getAttribute('data-ed'), h = cleanHTML(leaf).replace(/\u00a0/g, ' '), p = pristineHTML(id);   // browsers type trailing spaces as nbsp
    if (p !== null && norm(h) === norm(p)) delete state.edits[id]; else state.edits[id] = h;
    leaf.toggleAttribute('data-ed-changed', isChanged(id, leaf));
    scheduleSave(); updateCount();
  }
  function refreshMarks() { $$(LEAF).forEach(function (el) { el.toggleAttribute('data-ed-changed', isChanged(el.getAttribute('data-ed'), el)); }); updateCount(); }
  function sectionOf(el) {
    var sec = el.closest('section'); var k = sec && sec.querySelector('h2 .num');
    if (k) return k.textContent.trim(); if (el.closest('header')) return 'Top'; if (el.closest('footer')) return 'Footer'; return '';
  }
  function changes() {
    var out = [], addedIds = {};
    state.ops.forEach(function (o) { if (o.t === 'add') addedIds[o.id] = o; });
    $$(LEAF).forEach(function (el) {
      if (el.closest('[data-editor]')) return;
      var id = el.getAttribute('data-ed'); if (!isChanged(id, el)) return;
      var o = origHTML(id);
      out.push({ kind: o === null ? 'Added' : 'Edited', id: id, el: el, before: textOf(o), after: el.textContent, sec: sectionOf(el) });
    });
    Object.keys(addedIds).forEach(function (id) { var o = addedIds[id]; if (o.tag === 'figure') { var el = byId(document, id); if (el) out.push({ kind: 'Added image', id: id, el: el, after: '', sec: sectionOf(el), op: o }); } });
    state.ops.forEach(function (o) {
      if (o.t === 'rm') { var p = byId(ED.pristine, o.id); if (p) out.push({ kind: 'Removed', id: o.id, before: p.textContent, pristine: p, sec: sectionOf(p) }); }
      if (o.t === 'unph') { var el = byId(document, o.id); if (el) out.push({ kind: 'Marked final', id: o.id, el: el, after: el.textContent, sec: sectionOf(el) }); }
    });
    Object.keys(orig).forEach(function (id) { if (orig[id] !== null || addedIds[id]) return; var el = byId(document, id); if (el && el.tagName === 'FIGURE') out.push({ kind: 'Added image', id: id, el: el, after: '', sec: sectionOf(el) }); });
    baked.final.forEach(function (id) { var el = byId(document, id); if (el && !el.classList.contains('ph-inline') && !state.ops.some(function (o) { return o.t === 'reph' && o.id === id; })) out.push({ kind: 'Marked final', id: id, el: el, after: el.textContent, sec: sectionOf(el), baked: true }); });
    baked.removed.forEach(function (r) { if (!addedIds[r.id] && !byId(document, r.id)) out.push({ kind: 'Removed', id: r.id, before: textOf(r.html), baked: r, sec: r.sec || '' }); });
    return out;
  }
  function updateCount() {
    var n = changes().length, t = n === 0 ? 'no changes' : n + (n === 1 ? ' change' : ' changes');
    $('#ed-count').textContent = t;
    var pn = $('#ed-pill-n'); pn.hidden = n === 0; pn.textContent = n;
    document.title = (n ? '✎ ' : '') + document.title.replace(/^✎ /, '');
  }
  function setWarn(t) { $('#ed-warn').textContent = t; }
  var toastTimer;
  function toast(msg, ms) { var t = $('#ed-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 6000); }

  // ---------- revert
  function placeLike(p, el) {
    var s, live;
    for (s = p.previousElementSibling; s; s = s.previousElementSibling) if (s.hasAttribute('data-ed') && (live = byId(document, s.getAttribute('data-ed')))) { live.insertAdjacentElement('afterend', el); return true; }
    for (s = p.nextElementSibling; s; s = s.nextElementSibling) if (s.hasAttribute('data-ed') && (live = byId(document, s.getAttribute('data-ed')))) { live.insertAdjacentElement('beforebegin', el); return true; }
    for (var par = p.parentElement; par; par = par.parentElement) {
      if (par.id && (live = document.getElementById(par.id))) { live.appendChild(el); return true; }
      if (par.hasAttribute('data-ed') && (live = byId(document, par.getAttribute('data-ed')))) { live.appendChild(el); return true; }
    }
    return false;
  }
  function revert(c) {
    if (c.kind === 'Edited') { c.el.innerHTML = origHTML(c.id); recordEdit(c.el); }
    else if (c.kind === 'Added' || c.kind === 'Added image') {
      if (pristineHTML(c.id) === null) {                       // added this session: drop the op
        state.ops = state.ops.filter(function (o) { return !(o.t === 'add' && o.id === c.id); });
        $$('[data-ed]', c.el).concat([c.el]).forEach(function (x) { delete state.edits[x.getAttribute('data-ed')]; });
      } else state.ops.push({ t: 'rm', id: c.id });             // baked into this working copy: record a removal
      c.el.remove();
    }
    else if (c.kind === 'Removed' && c.pristine) {
      state.ops = state.ops.filter(function (o) { return !(o.t === 'rm' && o.id === c.id); });
      var el = c.pristine.cloneNode(true);
      if (placeLike(c.pristine, el)) { var cm = placeholderComment(c.pristine); if (cm) el.parentNode.insertBefore(cm.cloneNode(), el); enableLeaves(el); phActions(true, el); }
    }
    else if (c.kind === 'Removed' && c.baked) {
      var t = document.createElement('template'); t.innerHTML = c.baked.outer; var n = t.content.firstElementChild;
      var ref = byId(document, c.baked.ref); if (!ref) { toast('Cannot find where this block was; add it by hand instead.'); return; }
      ref.insertAdjacentElement(c.baked.pos === 'before' ? 'beforebegin' : 'afterend', n);
      state.ops.push({ t: 'add', id: c.id, ref: c.baked.ref, pos: c.baked.pos, tag: n.tagName.toLowerCase(), cls: n.className, html: n.innerHTML, leaf: n.hasAttribute('data-ed-leaf') });
      orig[c.id] = n.innerHTML; enableLeaves(n); phActions(true, n);
    }
    else if (c.kind === 'Marked final') { if (c.baked) state.ops.push({ t: 'reph', id: c.id }); else state.ops = state.ops.filter(function (o) { return !(o.t === 'unph' && o.id === c.id); }); c.el.classList.add('ph-inline'); var lf = c.el.closest(LEAF); if (lf && lf !== c.el) recordEdit(lf); }
    save(); refreshMarks(); renderChanges();
  }
  function renderChanges() {
    var panel = $('#ed-panel'); if (panel.hidden) return;
    var list = changes();
    if (!list.length) { panel.innerHTML = '<div class="ed-empty">No changes yet. Click any paragraph to start.</div>'; return; }
    panel.innerHTML = list.map(function (c, i) {
      var t = c.kind === 'Edited' ? '<s>' + esc(snip(c.before)) + '</s><span class="ar">→</span>' + esc(snip(c.after))
        : c.kind === 'Removed' ? '<s>' + esc(snip(c.before)) + '</s>'
        : c.kind === 'Added image' ? 'Figure inserted' : esc(snip(c.after));
      var jump = c.el ? '<button type="button" data-jump="' + i + '">Show</button>' : '';
      return '<div class="ed-chg"><div class="k"><b>' + esc(c.kind) + '</b> · ' + esc(c.sec) + '</div><div class="t">' + t + '</div><div class="a">' + jump + '<button type="button" data-revert="' + i + '">Revert</button></div></div>';
    }).join('');
    panel.querySelectorAll('[data-jump]').forEach(function (b) { b.onclick = function () { var c = list[+b.getAttribute('data-jump')]; var d = c.el.closest('details'); if (d) d.open = true; c.el.scrollIntoView({ block: 'center' }); c.el.classList.remove('ed-flash'); void c.el.offsetWidth; c.el.classList.add('ed-flash'); }; });
    panel.querySelectorAll('[data-revert]').forEach(function (b) { b.onclick = function () { revert(list[+b.getAttribute('data-revert')]); }; });
  }

  // ---------- edit mode
  function enableLeaves(root) { $$(LEAF, root).concat(root && root.matches && root.matches(LEAF) ? [root] : []).forEach(function (el) { if (on) { el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true'); } else { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); } }); }
  function phActions(show, root) {
    $$('.ph[data-ed]', root).forEach(function (ph) {
      var row = ph.querySelector(':scope > .ed-ph');
      if (!show) { if (row) row.remove(); return; }
      if (row) return;
      row = document.createElement('div'); row.className = 'ed-ph'; row.setAttribute('data-editor', '');
      row.innerHTML = '<button type="button" data-act="text">Replace with text</button><button type="button" data-act="img">Add image…</button><button type="button" data-act="del">Delete box</button>';
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
    $('#ed-tools').hidden = !on; $('#ed-open').hidden = on;
    if (!on) { $('#ed-panel').hidden = true; $('#ed-helpbox').hidden = true; $('#ed-changes').setAttribute('aria-expanded', 'false'); $('#ed-help').setAttribute('aria-expanded', 'false'); }
    refreshMarks();
  }
  function focusAt(el, atEnd) { el.focus(); var r = document.createRange(); r.selectNodeContents(el); r.collapse(!atEnd); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  function prevLeaf(el) { var all = $$(LEAF).filter(function (x) { return !x.closest('[data-editor]'); }); var i = all.indexOf(el); return i > 0 ? all[i - 1] : null; }
  function addBlock(tag, cls, ref, pos, html, leaf) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    var id = newId(); n.setAttribute('data-ed', id); if (leaf) n.setAttribute('data-ed-leaf', '1'); n.innerHTML = html || '';
    ref.insertAdjacentElement(pos === 'before' ? 'beforebegin' : 'afterend', n);
    state.ops.push({ t: 'add', id: id, ref: ref.getAttribute('data-ed'), pos: pos, tag: tag, cls: cls || '', html: html || '', leaf: !!leaf });
    enableLeaves(n); return n;
  }
  function removeBlock(el) {
    var id = el.getAttribute('data-ed');
    if (pristineHTML(id) === null) { state.ops = state.ops.filter(function (o) { return !(o.t === 'add' && o.id === id); }); }
    else state.ops.push({ t: 'rm', id: id });
    $$('[data-ed]', el).concat([el]).forEach(function (x) { delete state.edits[x.getAttribute('data-ed')]; });
    dropComment(el); el.remove(); save(); refreshMarks(); renderChanges();
  }
  function splitBlock(leaf) {
    var sel = window.getSelection(); if (!sel.rangeCount) return;
    var r = sel.getRangeAt(0); r.deleteContents();
    var after = document.createRange(); after.setStart(r.endContainer, r.endOffset); after.setEnd(leaf, leaf.childNodes.length);
    var frag = after.extractContents();
    var cls = (leaf.className || '').trim();
    var n = addBlock(leaf.tagName.toLowerCase(), cls, leaf, 'after', '', true);
    n.appendChild(frag);
    var br = leaf.lastChild; if (br && br.nodeName === 'BR') br.remove();
    recordEdit(leaf); recordEdit(n); focusAt(n, false); renderChanges();
  }

  // ---------- exports
  function refFor(p, root) {   // nearest neighbour of pristine element p that exists in root
    var s;
    for (s = p.previousElementSibling; s; s = s.previousElementSibling) if (s.hasAttribute('data-ed') && byId(root, s.getAttribute('data-ed'))) return { ref: s.getAttribute('data-ed'), pos: 'after' };
    for (s = p.nextElementSibling; s; s = s.nextElementSibling) if (s.hasAttribute('data-ed') && byId(root, s.getAttribute('data-ed'))) return { ref: s.getAttribute('data-ed'), pos: 'before' };
    return null;
  }
  function buildDoc(final) {
    var root = ED.pristine.cloneNode(true);
    $$('#ed-orig', root).forEach(function (x) { x.remove(); });
    apply(root, state.ops, state.edits);
    var body = root.querySelector('body');
    if (final) {
      $$('[data-editor]', root).forEach(function (x) { x.remove(); });
      $$('p[data-ed],li[data-ed]', root).forEach(function (x) { if (pristineHTML(x.getAttribute('data-ed')) === null && !x.textContent.trim() && !x.querySelector('img')) x.remove(); });
      $$('[data-ed],[data-ed-leaf],[contenteditable],[data-ed-changed],[spellcheck]', root).forEach(function (x) { ['data-ed', 'data-ed-leaf', 'contenteditable', 'spellcheck', 'data-ed-changed'].forEach(function (a) { x.removeAttribute(a); }); });
      body.removeAttribute('data-ed-build'); body.classList.remove('ed-on'); if (!body.className) body.removeAttribute('class');
    } else {
      body.setAttribute('data-ed-build', stamp());
      var j = { orig: {}, added: [], removed: [], final: [] };
      changes().forEach(function (c) {
        if (c.kind === 'Edited') j.orig[c.id] = origHTML(c.id);
        else if (c.kind === 'Added' || c.kind === 'Added image') j.added.push(c.id);
        else if (c.kind === 'Removed' && c.pristine) { var rf = refFor(c.pristine, root); if (rf) j.removed.push({ id: c.id, outer: c.pristine.outerHTML, html: c.pristine.innerHTML, ref: rf.ref, pos: rf.pos, sec: c.sec }); }
        else if (c.kind === 'Removed' && c.baked) j.removed.push(c.baked);
        else if (c.kind === 'Marked final') j.final.push(c.id);
      });
      var s = document.createElement('script'); s.type = 'application/json'; s.id = 'ed-orig'; s.setAttribute('data-editor', '');
      s.textContent = JSON.stringify(j).replace(/<\//g, '<\\/');
      var tb = document.createElement('template'); tb.innerHTML = TOOLBAR_HTML;
      body.appendChild(tb.content.firstElementChild); body.appendChild(s); body.appendChild($('#ed-main').cloneNode(true));
    }
    return { html: '<!DOCTYPE html>\n' + root.outerHTML, placeholders: root.querySelectorAll('.ph,.ph-inline').length };
  }
  function download(name, text) {
    var b = new Blob([text], { type: 'text/html' }), u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
  }
  function exportFinal() {
    var d = buildDoc(true), n = changes().length;
    if (/data-editor|contenteditable/.test(d.html.replace(/<script id="ed-main"[\s\S]*$/, ''))) { toast('Export check failed: editor markup would remain. Please report this.'); return; }
    download('writeup.html', d.html);
    toast('Exported writeup.html (' + (d.html.length / 1e6).toFixed(1) + ' MB) with ' + n + (n === 1 ? ' change' : ' changes') + '. ' + (d.placeholders ? d.placeholders + ' placeholder' + (d.placeholders === 1 ? '' : 's') + ' still open.' : 'No placeholders left.'), 9000);
  }
  function saveCopy() {
    var d = buildDoc(false);
    download('writeup.editable.html', d.html);
    toast('Saved writeup.editable.html with ' + changes().length + ' change(s) baked in. Open that file to continue, or send it to Claude. This tab keeps its own draft.', 9000);
  }

  // ---------- events
  document.addEventListener('click', function (e) {
    if (!on || !e.target.closest) return;
    if (e.target.closest('[data-editor]')) return;
    var leaf = e.target.closest(LEAF);
    if (leaf) { e.stopPropagation(); if (e.target.closest('a')) e.preventDefault(); }   // page widgets stay put while editing text
  }, true);
  document.addEventListener('input', function (e) { var leaf = e.target.closest && e.target.closest(LEAF); if (leaf && on) recordEdit(leaf); });
  document.addEventListener('paste', function (e) {
    var leaf = e.target.closest && e.target.closest(LEAF); if (!leaf || !on) return;
    e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!document.execCommand || !document.execCommand('insertText', false, t)) { var s = window.getSelection(); if (s.rangeCount) { var r = s.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(t)); r.collapse(false); } }
    recordEdit(leaf);
  });
  document.addEventListener('keydown', function (e) {
    if (!on) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCopy(); return; }
    var leaf = e.target.closest && e.target.closest(LEAF); if (!leaf) return;
    var tag = leaf.tagName.toLowerCase();
    if (e.key === 'Escape') { leaf.blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (tag === 'p' || tag === 'li') splitBlock(leaf); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && (tag === 'p' || tag === 'li') && !leaf.textContent.trim() && !leaf.querySelector('img')) {
      e.preventDefault(); var p = prevLeaf(leaf); removeBlock(leaf); if (p) focusAt(p, true);
    }
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.ed-ph button, .ed-pi'); if (!b) return;
    if (b.classList.contains('ed-pi')) {
      var sp = b.previousElementSibling; b.remove();
      state.ops.push({ t: 'unph', id: sp.getAttribute('data-ed') }); dropComment(sp);
      sp.classList.remove('ph-inline'); if (!sp.className) sp.removeAttribute('class');
      var lf = sp.closest(LEAF); if (lf && lf !== sp) recordEdit(lf);
      save(); refreshMarks(); renderChanges(); return;
    }
    var ph = b.closest('.ph'), act = b.getAttribute('data-act');
    if (act === 'text') { var p = addBlock('p', '', ph, 'before', '', true); removeBlock(ph); focusAt(p, false); }
    else if (act === 'del') removeBlock(ph);
    else if (act === 'img') { var f = $('#ed-file'); f.__ph = ph; f.value = ''; f.click(); }
  });
  $('#ed-file').addEventListener('change', function () {
    var f = this.files[0], ph = this.__ph; if (!f || !ph) return;
    if (f.size > 1.5e6 && !window.confirm('This image is ' + (f.size / 1e6).toFixed(1) + ' MB. The article embeds images in the file; a JPEG under 1 MB keeps it light. Insert anyway?')) return;
    var rd = new FileReader();
    rd.onload = function () {
      var cid = newId();
      var html = '<div class="fig"><img class="shot" src="' + rd.result + '" alt="" tabindex="0" role="button"><span class="enl" aria-hidden="true">⤢ Enlarge</span></div><figcaption data-ed="' + cid + '" data-ed-leaf="1"><b>Caption.</b> Describe the image here.</figcaption>';
      var fig = addBlock('figure', '', ph, 'before', html, false);
      save(); refreshMarks(); renderChanges(); focusAt(fig.querySelector('figcaption'), true);
      toast('Image inserted above the placeholder box. Edit the caption, then delete the box when you are done.');
    };
    rd.readAsDataURL(f);
  });
  $('#ed-open').onclick = function () { setMode(true); };
  $('#ed-done').onclick = function () { setMode(false); };
  $('#ed-changes').onclick = function () { var p = $('#ed-panel'); p.hidden = !p.hidden; $('#ed-helpbox').hidden = true; $('#ed-help').setAttribute('aria-expanded', 'false'); this.setAttribute('aria-expanded', String(!p.hidden)); renderChanges(); };
  $('#ed-help').onclick = function () { var p = $('#ed-helpbox'); p.hidden = !p.hidden; $('#ed-panel').hidden = true; $('#ed-changes').setAttribute('aria-expanded', 'false'); this.setAttribute('aria-expanded', String(!p.hidden)); };
  $('#ed-discard').onclick = function () { if (!changes().length) { toast('Nothing to discard.'); return; } if (window.confirm('Discard every unsaved edit in this browser and reload the draft?')) { discarded = true; clearTimeout(saveTimer); try { localStorage.removeItem(KEY); } catch (e) { } location.reload(); } };
  $('#ed-save').onclick = saveCopy;
  $('#ed-export').onclick = exportFinal;

  window.addEventListener('pagehide', function () { clearTimeout(saveTimer); save(); });

  // ---------- boot
  load();
  apply(document, state.ops, state.edits);
  updateCount();
})();
