#!/usr/bin/env python3
"""Build writeup.editable.html: writeup.html plus an in-page text editor.

  python3 tools/make_editable.py            # writeup.html -> writeup.editable.html

The article itself is untouched. The editor lives in tools/editor/ (pre.js, editor.js,
editor.css, toolbar.html) and is inlined here, so the editable copy still works offline.
Re-run after every change to writeup.html; edits made in an older editable copy are
carried in that copy (use its "Save working copy" button), not in the draft on disk.
"""
import datetime, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "writeup.html")
OUT = os.path.join(ROOT, "writeup.editable.html")
ED = os.path.join(ROOT, "tools", "editor")

def read(name):
    return open(os.path.join(ED, name), encoding="utf8").read().strip()

html = open(SRC, encoding="utf8").read()
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")

# 1. stylesheet into <head>
assert html.count("</head>") == 1
html = html.replace("</head>", "<style data-editor>\n" + read("editor.css") + "\n</style>\n</head>", 1)

# 2. build stamp on <body>
html, n = re.subn(r"<body(\s[^>]*)?>", lambda m: "<body" + (m.group(1) or "") + f' data-ed-build="{stamp}">', html, count=1)
assert n == 1

# 3. pre-script right before the article's main script (the last <script> that is not the JSON data)
scripts = [m for m in re.finditer(r"<script(?![^>]*application/json)[^>]*>", html)]
assert scripts, "no main script found"
main = scripts[-1]
pre = '<script data-editor id="ed-pre">\n' + read("pre.js") + "\n</script>\n"
html = html[:main.start()] + pre + html[main.start():]

# 4. toolbar + editor before </body>
assert html.count("</body>") == 1
tail = read("toolbar.html") + '\n<script data-editor id="ed-main">\n' + read("editor.js") + "\n</script>\n</body>"
html = html.replace("</body>", tail, 1)

open(OUT, "w", encoding="utf8").write(html)
print(f"wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)/1e6:.2f} MB, build {stamp})")
