#!/usr/bin/env python3
"""Build writeup.shared.html: the article prepared for publishing as a claude.ai page with a
shared, multi-editor text editor (tools/editor/shared.js).

  python3 tools/make_shared.py            # writeup.html -> writeup.shared.html

The output is NOT a standalone file: it has no <html>/<head>/<body> (the Artifact tool wraps it)
and its editor needs the claude.ai runtime (window.claude). Publish it with the Artifact tool and
capabilities {db, user:{scopes:[profile]}, room, comments:{composer_only}, downloads, assets}.
The original <head> is kept verbatim in a text/plain script so "Export final" can rebuild the
full standalone writeup.html.
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "writeup.html")
OUT = os.path.join(ROOT, "writeup.shared.html")
ED = os.path.join(ROOT, "tools", "editor")

def read(name):
    return open(os.path.join(ED, name), encoding="utf8").read().strip()

html = open(SRC, encoding="utf8").read()
html_attrs = re.search(r"<html([^>]*)>", html).group(1)
head = html[html.find("<head>") + 6: html.find("</head>")]
body = html[html.find("<body>") + 6: html.rfind("</body>")]
assert "</script" not in head
styles = re.findall(r"<style[^>]*>.*?</style>", head, flags=re.S)

# the article's main script is the last <script> that is not the JSON data
scripts = [m for m in re.finditer(r"<script(?![^>]*application/json)[^>]*>", body)]
assert scripts
main = scripts[-1]
pre = '<script data-editor id="ed-pre">\n' + read("pre.js") + "\n</script>\n"
body = body[:main.start()] + pre + body[main.start():]

out = []
out.append('<title>Project Toaster draft</title>')
for s in styles:
    out.append(s.replace("<style", "<style data-fromhead", 1))
out.append("<style data-editor>\n" + read("editor.css") + "\n" + read("shared.css") + "\n</style>")
out.append('<script type="text/plain" data-editor id="ed-head" data-html-attrs="%s">%s</script>' % (html_attrs.replace('"', "&quot;"), head))
out.append(body.strip("\n"))
out.append(read("toolbar_shared.html"))
out.append('<script data-editor id="ed-main">\n' + read("shared.js") + "\n</script>")
open(OUT, "w", encoding="utf8").write("\n".join(out) + "\n")
print(f"wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)/1e6:.2f} MB)")
