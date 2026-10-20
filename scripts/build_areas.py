"""気象庁の市区町村（class20）の形を1つのファイルにまとめる（警報の塗り分けに使う）。

気象庁は一次細分区域（class10）の形を配っていないが、市区町村（class20）の形は
`common/const/geojson/class20s/<コード>.json` にある。class20 → class15 → class10 の親を
`common/const/area.json` からたどって、class20 ごとに「どの一次細分区域か」を付けて保存する。

    python scripts/build_areas.py            # data/class20s.json を作り直す（年1回くらいでよい）

出典：気象庁ホームページ（加工して作成）。気象庁の区域の区切りは変わるので、ときどき作り直す。
"""
import json
import math
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

JMA = "https://www.jma.go.jp/bosai"
OUT = "data/class20s.json"


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "ulexite-catalog (+https://github.com/thesilver0913/ulexite-catalog)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url):
    return json.loads(fetch(url))


def round_ring(ring, nd=3):
    """[lon, lat] の並びを小数 nd 桁に丸めて、平らな配列にする（大きさを抑える）。"""
    flat = []
    last = None
    for lon, lat in ring:
        p = (round(lon, nd), round(lat, nd))
        if p != last:  # 丸めで重なった点は落とす
            flat.extend(p)
            last = p
    return flat


def main():
    area = get_json(f"{JMA}/common/const/area.json")
    relm = get_json(f"{JMA}/common/const/class20relm.json")
    class15 = area["class15s"]
    codes = sorted(relm)

    def one(code):
        c15 = area["class20s"].get(code, {}).get("parent")
        c10 = class15.get(c15, {}).get("parent")
        if not c10:
            return code, None
        try:
            g = get_json(f"{JMA}/common/const/geojson/class20s/{code}.json")
        except Exception as e:  # 形のない区域（海上など）もある
            print(f"skip {code}: {e}", file=sys.stderr)
            return code, None
        geom = g["features"][0]["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        rings = [round_ring(ring) for poly in polys for ring in poly if len(ring) >= 4]
        if not rings:
            return code, None
        return code, {"c10": c10, "r": rings}

    out = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        for i, (code, v) in enumerate(ex.map(one, codes), 1):
            if v:
                out[code] = v
            if i % 200 == 0:
                print(f"{i}/{len(codes)}", file=sys.stderr)

    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    points = sum(len(v["r"][0]) for v in out.values())  # ざっくりの目安
    print(f"{len(out)} class20 → {OUT} ({len(text) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
