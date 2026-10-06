// Runs before the article's own script. Gives every text-bearing block a stable id (data-ed) and
// marks the editable ones (data-ed-leaf), then keeps a pristine copy of the document. Exports are
// built from that pristine copy plus the recorded edits, never from the live DOM, so nothing the
// page's own scripts generate (pipeline diagram, timeline, lightbox state) can leak into a file.
(function () {
  'use strict';
  var EXCL = 'nav.toc,#lb,svg,button,select,input,textarea,[data-editor],.tabs,#tl-box,#pipe,#pipe-out,#fw-out,script,style,summary,template';
  var INLINE = /^(a|b|i|em|strong|span|small|code|sup|sub|br|wbr|kbd|abbr|time|mark|s|u|q|cite|var)$/i;
  var n = 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-ed]'), function (el) { var m = /^b(\d+)$/.exec(el.getAttribute('data-ed')); if (m && +m[1] > n) n = +m[1]; });   // ids baked into the source keep their numbers
  function hasText(el) {
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\S/.test(c.nodeValue)) return true;
    return false;
  }
  function tag(el) { if (!el.hasAttribute('data-ed')) el.setAttribute('data-ed', 'b' + (++n)); }
  Array.prototype.forEach.call(document.querySelectorAll('header *,main *,footer *'), function (el) {
    if (el.closest(EXCL)) return;
    if (el.classList.contains('ph')) { tag(el); return; }                       // placeholder box: actions, not text
    if (el.classList.contains('ph-inline')) { tag(el); el.setAttribute('data-ed-leaf', '1'); return; }
    if (INLINE.test(el.tagName)) return;                                         // inline runs belong to their block
    if (!hasText(el)) return;
    tag(el); el.setAttribute('data-ed-leaf', '1');
  });
  // a block inside an editable block is edited as part of its parent
  Array.prototype.forEach.call(document.querySelectorAll('[data-ed-leaf]'), function (el) {
    for (var p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute('data-ed-leaf')) { el.removeAttribute('data-ed-leaf'); break; }
  });
  window.__ED = { pristine: document.documentElement.cloneNode(true) };
})();
