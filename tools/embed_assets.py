#!/usr/bin/env python3
"""Embed images and timeline data into writeup.html so the file is self-contained.

Idempotent: re-run after changing anything in assets/.

  python3 tools/embed_assets.py            # embed assets/*.jpg|png + assets/hist.json
  python3 tools/embed_assets.py --hist     # (re)build assets/hist.json first, from the
                                           # replay payloads + assets/hist_raw.json

What it does
  * every <img data-asset="NAME"> in writeup.html gets src="data:image/...;base64,..."
    from assets/NAME (jpg or png)
  * <script id="hist-data" type="application/json"> gets the contents of assets/hist.json

assets/hist_raw.json is the per-cycle BN seat count read off the dashboard replay
(one row per AI cycle: i, id, ts, sgt, bn, inplay). It was produced by driving
JSE_dashboard_replay.html with Playwright; see CLAUDE.md. --hist merges it with the
six engine parameters, confidence and override count stored in the replay's payloads.
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "writeup.html")
ASSETS = os.path.join(ROOT, "assets")


def build_hist():
    raw = json.load(open(os.path.join(ASSETS, "hist_raw.json")))
    replay = open(os.path.join(ROOT, "JSE_dashboard_replay.html"), encoding="utf8").read()
    start = replay.find("const DATA = ") + len("const DATA = ")
    data, _ = json.JSONDecoder().raw_decode(replay, start)
    nom_day = data["nomDayIndex"]
    out = []
    for r in raw:
        p = data["payloads"][r["i"]]
        c = data["cycles"][r["i"]]
        out.append({
            "i": r["i"], "ts": c["ts"], "sgt": c["sgt"],
            "bn": r.get("bn"), "inplay": int(r["inplay"]) if r.get("inplay") else None,
            "contest": c["dayIndex"] >= nom_day,
            "p": p["parameters"], "conf": p.get("confidence"),
            "ov": len(p.get("seat_overrides") or {}),
        })
    json.dump(out, open(os.path.join(ASSETS, "hist.json"), "w"), separators=(",", ":"))
    print(f"hist.json: {len(out)} cycles, {sum(1 for o in out if o['bn'] is None)} without a seat count")


def embed():
    html = open(HTML, encoding="utf8").read()

    def img(m):
        name = m.group(2)
        path = os.path.join(ASSETS, name)
        if not os.path.exists(path):
            print("missing asset:", name)
            return m.group(0)
        mime = "image/png" if name.lower().endswith(".png") else "image/jpeg"
        b64 = base64.b64encode(open(path, "rb").read()).decode()
        return f'{m.group(1)}src="data:{mime};base64,{b64}"'

    # <img ... data-asset="x.jpg" ... src="..."> -> replace the src attribute that follows data-asset
    html, n = re.subn(r'(<img[^>]*data-asset="([^"]+)"[^>]*?)src="[^"]*"', img, html)
    hist_path = os.path.join(ASSETS, "hist.json")
    if os.path.exists(hist_path):
        hist = open(hist_path, encoding="utf8").read().strip()
        html, m = re.subn(r'(<script id="hist-data" type="application/json">)(.*?)(</script>)',
                          lambda mm: mm.group(1) + hist + mm.group(3), html, flags=re.S)
    else:
        m = 0
    open(HTML, "w", encoding="utf8").write(html)
    print(f"embedded {n} images, hist data {'yes' if m else 'no'}; size {os.path.getsize(HTML)/1e6:.2f} MB")


if __name__ == "__main__":
    if "--hist" in sys.argv:
        build_hist()
    embed()
