#!/usr/bin/env python3
"""Bake stable block ids (data-ed="bN") into writeup.html.

Replays tools/editor/pre.js's candidate rules over the source text with a position-aware
parser and inserts the attribute into each start tag, so the ids no longer depend on document
order. After this, deleting or inserting elements in the source leaves every other block's id
unchanged, which keeps the shared draft's per-block edits attached to the right text.
Idempotent: elements that already carry data-ed keep it; new candidates get fresh ids above the
highest existing number (pre.js does the same at runtime for anything still untagged).

  python3 tools/bake_ids.py            # rewrites writeup.html in place, prints a summary
"""
import os, re, sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "writeup.html")

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
INLINE = {"a", "b", "i", "em", "strong", "span", "small", "code", "sup", "sub", "br", "wbr", "kbd", "abbr", "time", "mark", "s", "u", "q", "cite", "var"}
EXCL_TAGS = {"button", "select", "input", "textarea", "svg", "script", "style", "summary", "template"}
EXCL_IDS = {"lb", "tl-box", "pipe", "pipe-out", "fw-out"}
EXCL_CLASSES = {"tabs"}


class El:
    __slots__ = ("tag", "attrs", "pos", "parent", "has_text", "excl", "cand", "leaf", "id", "in_root")

    def __init__(self, tag, attrs, pos, parent):
        self.tag, self.attrs, self.pos, self.parent = tag, attrs, pos, parent
        self.has_text = False
        self.cand = self.leaf = False
        self.id = None
        a = dict(attrs)
        cls = set((a.get("class") or "").split())
        own_excl = (tag in EXCL_TAGS or a.get("id") in EXCL_IDS or bool(cls & EXCL_CLASSES)
                    or (tag == "nav" and "toc" in cls) or any(k == "data-editor" for k, _ in attrs))
        self.excl = own_excl or (parent.excl if parent else False)
        self.in_root = (tag in ("header", "main", "footer")) or (parent.in_root if parent else False)


class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.stack = []
        self.els = []
        self.lines = None

    def abs_pos(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        parent = self.stack[-1] if self.stack else None
        el = El(tag, attrs, self.abs_pos(), parent)
        self.els.append(el)
        if tag not in VOID:
            self.stack.append(el)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        # tolerate stray end tags: pop to the nearest matching open element
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def _text(self, data):
        if self.stack and data.strip():
            self.stack[-1].has_text = True

    handle_data = _text
    def handle_entityref(self, name): self._text("x")
    def handle_charref(self, name): self._text("x")


def main():
    src = open(SRC, encoding="utf8").read()
    p = P()
    # line start offsets for getpos() -> absolute offset
    starts = [0]
    for m in re.finditer("\n", src):
        starts.append(m.end())
    p.lines = starts
    p.feed(src); p.close()

    existing = [int(m) for m in re.findall(r'data-ed="b(\d+)"', src)]
    n = max(existing) if existing else 0
    cands = []
    for el in p.els:
        if not el.in_root or el.tag in ("header", "main", "footer") or el.excl:
            continue
        a = dict(el.attrs)
        cls = set((a.get("class") or "").split())
        if "ph" in cls:
            el.cand = True
        elif "ph-inline" in cls:
            el.cand = el.leaf = True
        elif el.tag in INLINE or not el.has_text:
            continue
        else:
            el.cand = el.leaf = True
        el.id = a.get("data-ed")
        cands.append(el)
    # second pass (leaf inside leaf) only affects data-ed-leaf, which stays runtime; ids are the same
    fresh = 0
    for el in cands:
        if not el.id:
            n += 1; el.id = "b%d" % n; fresh += 1
    # insert attributes from the end so earlier offsets stay valid
    out = src
    for el in sorted((e for e in cands if 'data-ed' not in dict(e.attrs)), key=lambda e: -e.pos):
        tag_end = out.index(">", el.pos)
        ins = ' data-ed="%s"' % el.id
        # before a self-closing slash if present
        if out[tag_end - 1] == "/":
            out = out[:tag_end - 1] + ins + out[tag_end - 1:]
        else:
            out = out[:tag_end] + ins + out[tag_end:]
    open(SRC, "w", encoding="utf8").write(out)
    print("candidates %d, already tagged %d, newly tagged %d, highest id b%d" % (len(cands), len(cands) - fresh, fresh, n))


if __name__ == "__main__":
    main()
