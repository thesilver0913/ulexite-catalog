"""天気の地図に重ねる透明の画像を作る（雨雲のコマ送り・警報の塗り分け）。

    python scripts/map_images.py --out dist      # dist/ に rain-frames.png・rain.json・warn.png
    python scripts/map_images.py --check         # 下地の陸に重ねた確認用の画像も作る

決まった範囲（設計書 5.2.2。本体の日本地図の下地と同じ）：
Web メルカトル、緯度 23.5〜46.0・経度 120.86〜148.6、2048×2048。

雨雲は気象庁の降水ナウキャスト（`jmatile/data/nowc/…/surf/hrpns/<z>/<x>/<y>.png`）。タイルは
Web メルカトルなので、この範囲にそのまま貼って縮めるだけでよい。過去1時間ぶんの5分おき12コマを
4×3（2048×1536。1コマ 512×512）にまとめる（ワールドは画像を1枚だけ読んで順に切り替える）。

警報・注意報は `warning/data/r8/map.json`（区域ごと・種類ごとの最新の状態）を読み、一次細分区域
（class10）ごとのいちばん重い段階の色で、その区域の市区町村（class20）の形を塗る。形は
`scripts/build_areas.py` が作る `data/class20s.json`（気象庁の GeoJSON をまとめたもの）。

気象庁のデータをそのまま伝えるだけで、独自の判定はしない。出典：気象庁ホームページ（加工して作成）。
"""
import argparse
import datetime
import io
import json
import math
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw

JMA = "https://www.jma.go.jp/bosai"
UA = {"User-Agent": "ulexite-catalog (+https://github.com/thesilver0913/ulexite-catalog)"}

# 本体の日本地図の下地と同じ範囲（設計書 5.2.2）
WEST, EAST, SOUTH, NORTH = 120.86, 148.6, 23.5, 46.0
SIZE = 2048
COLS, ROWS = 4, 3
FRAMES = COLS * ROWS          # 12コマ（5分おき＝過去55分〜現在）
CELL = 512
RAIN_ZOOM = 7                 # この範囲で 1px ≒ 1.2km（雨雲の1kmメッシュに合う）

# 段階の色（テーマの意味の名前と同じ値。docs/spec.md「防災情報」）
LEVEL_COLOR = {5: (11, 11, 12), 4: (122, 63, 194), 3: (216, 56, 58), 2: (242, 194, 48)}
LEVEL_NAME = {5: "special", 4: "danger", 3: "warning", 2: "advisory"}


def my(lat):
    """メルカトルの縦（ラジアン）。"""
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


YTOP, YBOT = my(NORTH), my(SOUTH)


def to_xy(lon, lat):
    """緯度・経度 → 2048×2048 の中の画素。"""
    return ((lon - WEST) / (EAST - WEST) * SIZE, (YTOP - my(lat)) / (YTOP - YBOT) * SIZE)


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url):
    return json.loads(fetch(url))


def jst(stamp):
    """"20261020143000"（UTC）→ "2026-10-20T23:30:00+09:00"。"""
    t = datetime.datetime.strptime(stamp, "%Y%m%d%H%M%S") + datetime.timedelta(hours=9)
    return t.strftime("%Y-%m-%dT%H:%M:00+09:00")


# ---- 雨雲 ----

def nowcast_times():
    """降水ナウキャストのコマ（古い順）。"""
    times = get_json(f"{JMA}/jmatile/data/nowc/targetTimes_N1.json")
    return sorted({(t["basetime"], t["validtime"]) for t in times})


def tile_span(zoom):
    lon2x = lambda lon: (lon + 180) / 360 * 2 ** zoom
    lat2y = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** zoom
    x0, x1 = math.floor(lon2x(WEST)), math.ceil(lon2x(EAST)) - 1
    y0, y1 = math.floor(lat2y(NORTH)), math.ceil(lat2y(SOUTH)) - 1
    return x0, x1, y0, y1


def rain_frame(basetime, validtime, zoom=RAIN_ZOOM):
    """1コマを 2048×2048 の透明画像にする。"""
    x0, x1, y0, y1 = tile_span(zoom)
    canvas = Image.new("RGBA", ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256), (0, 0, 0, 0))

    def one(xy):
        x, y = xy
        url = f"{JMA}/jmatile/data/nowc/{basetime}/none/{validtime}/surf/hrpns/{zoom}/{x}/{y}.png"
        try:
            return xy, Image.open(io.BytesIO(fetch(url))).convert("RGBA")
        except Exception:
            return xy, None  # タイルがない（海上・範囲外）ときは透明のまま

    with ThreadPoolExecutor(max_workers=12) as ex:
        for (x, y), tile in ex.map(one, [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]):
            if tile is not None:
                canvas.alpha_composite(tile, ((x - x0) * 256, (y - y0) * 256))

    lon2x = lambda lon: (lon + 180) / 360 * 2 ** zoom
    lat2y = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** zoom
    box = (int(round((lon2x(WEST) - x0) * 256)), int(round((lat2y(NORTH) - y0) * 256)),
           int(round((lon2x(EAST) - x0) * 256)), int(round((lat2y(SOUTH) - y0) * 256)))
    return canvas.crop(box).resize((CELL, CELL), Image.LANCZOS)


def rain_sprite(frames):
    """12コマを 4×3 に並べる（左上がいちばん古い）。"""
    sprite = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    for i, (b, v) in enumerate(frames):
        sprite.alpha_composite(rain_frame(b, v), ((i % COLS) * CELL, (i // COLS) * CELL))
    return sprite


# ---- 警報・注意報 ----

def warning_levels():
    """種類のコード → 段階（src/common.js の WARNING_KINDS をそのまま使う。表を2つ持たない）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    src = open(os.path.join(here, "..", "src", "common.js"), encoding="utf-8").read()
    table = dict(re.findall(r'"(\d\d)":\s*W\("[^"]+",\s*(\d)\)', src))
    if len(table) < 20:
        raise SystemExit("src/common.js の WARNING_KINDS を読めませんでした")
    return {code: int(lv) for code, lv in table.items()}


def active_warnings():
    """一次細分区域（class10）ごとの、いちばん重い段階。"""
    reports = get_json(f"{JMA}/warning/data/r8/map.json")
    latest = {}
    at = ""
    for r in reports:
        if r.get("infoType") == "取消":
            continue
        at = max(at, r.get("reportDatetime") or "")
        for item in (r.get("warning") or {}).get("class10Items") or []:
            for k in item.get("kinds") or []:
                code = k.get("code")
                if not code:
                    continue
                key = (item.get("areaCode"), code)
                if key not in latest or (r.get("reportDatetime") or "") >= latest[key][0]:
                    latest[key] = (r.get("reportDatetime") or "", k.get("status"))
    level_of = warning_levels()
    levels = {}
    for (area, code), (_, status) in latest.items():
        if status == "解除":
            continue
        lv = level_of.get(code)
        if not lv:
            continue
        levels[area] = max(levels.get(area, 0), lv)
    return levels, at


def warn_image(levels, areas_path="data/class20s.json", scale=2):
    """区域の段階に合わせて市区町村の形を塗る（透明の 2048×2048）。"""
    areas = json.loads(open(areas_path, encoding="utf-8").read())
    img = Image.new("RGBA", (SIZE * scale, SIZE * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for code, a in areas.items():
        lv = levels.get(a["c10"])
        if not lv:
            continue
        color = LEVEL_COLOR[lv]
        # level5（特別警報）の地はほぼ黒なので、暗い下地に沈む。仕様どおり明るい線で囲む
        outline = (227, 227, 230, 255) if lv == 5 else None
        for ring in a["r"]:
            xy = []
            for i in range(0, len(ring) - 1, 2):
                x, y = to_xy(ring[i], ring[i + 1])
                xy.append((x * scale, y * scale))
            if len(xy) >= 3:
                draw.polygon(xy, fill=color + (170,), outline=outline, width=3 if outline else 1)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


# ---- 確認用（下地の陸に重ねる）----

def land_base():
    here = os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(here, "..", "..", "Packages", "vrc.ulexite.app.clock", "Textures", "world_land.png")
    mask = Image.open(p).convert("L")
    base = Image.new("RGB", (SIZE, SIZE), (16, 24, 33))
    out = base.load()
    m = mask.load()
    for oy in range(0, SIZE, 1):
        lat = math.degrees(2 * math.atan(math.exp(YTOP - (oy + 0.5) / SIZE * (YTOP - YBOT))) - math.pi / 2)
        sy = min(1023, max(0, int((90 - lat) / 180 * 1024)))
        for ox in range(SIZE):
            lon = WEST + (ox + 0.5) / SIZE * (EAST - WEST)
            if m[int((lon + 180) / 360 * 2048) % 2048, sy] > 8:
                out[ox, oy] = (52, 74, 63)
    return base.convert("RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dist")
    ap.add_argument("--check", action="store_true", help="下地の陸に重ねた確認用の画像も作る")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    times = nowcast_times()
    frames = times[-FRAMES:]
    print("rain frames:", len(frames), frames[0], "→", frames[-1])
    sprite = rain_sprite(frames)
    sprite.save(os.path.join(args.out, "rain-frames.png"))
    with open(os.path.join(args.out, "rain.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"version": 1, "at": jst(frames[0][1]), "to": jst(frames[-1][1]), "frames": len(frames), "step": 5},
                  f, ensure_ascii=False)
        f.write("\n")

    levels, at = active_warnings()
    print("warnings:", len(levels), "areas, at", at)
    warn = warn_image(levels)
    warn.save(os.path.join(args.out, "warn.png"))

    if args.check:
        base = land_base()
        for name, layer in (("check-rain", sprite.crop((0, 0, CELL, CELL))), ("check-warn", warn)):
            img = base.copy()
            img.alpha_composite(layer.resize((SIZE, SIZE), Image.LANCZOS))
            img.convert("RGB").save(os.path.join(args.out, name + ".png"))
    print("done")


if __name__ == "__main__":
    main()
