// 共通の feed（v1/feed/common.json）。テレビ本体が常に読む小さなデータ：地震・津波・気象の警報・注意報・お知らせ・本体の最新のバージョン。
// ワールドの Feed Loader が1分おきに読む。こちらも1分おきに気象庁の防災情報のページの JSON を確かめ、中身が変わったときだけ書き出す。
// 気象庁の発表をそのままの形で伝えるだけで、独自の判定・予測・要約はしない（気象業務法）。名前や文は気象庁のものを使う。
import { publish } from "./github.js";
import { clean } from "./catalog.js";

/** 本体（Ulexite TV）の最新のバージョン。リリースのたびに上げる。 */
export const LATEST_TV_VERSION = "0.2.0";

/**
 * この feed の中身の作り方の版。作り方を変えたら上げる。
 * 気象庁のデータが変わっていなくても、次の実行で作り直して書き出す（デプロイしただけでは書き出されない、を防ぐ）。
 */
export const COMMON_BUILD = "4";

const JMA = "https://www.jma.go.jp/bosai";
const MAX_QUAKES = 10;
const MAX_AREAS = 20;
// GitHub Pages（ブランチから公開）は1時間に10回が目安。動画の書き出しの分を残して、7分に1回まで
const MIN_PUBLISH_GAP = 7 * 60;

// ---- 地震 ----

/** 震度の表記（気象庁の "5-" → "5弱"）。 */
export const intText = (s) => String(s ?? "").replace(/^([56])-$/, "$1弱").replace(/^([56])\+$/, "$1強");
const intRank = (s) => ({ "1": 1, "2": 2, "3": 3, "4": 4, "5-": 5, "5+": 6, "6-": 7, "6+": 8, "7": 9 }[s] ?? 0);

/** 震源の "+34.4+131.5-20000/" → 緯度・経度・深さ（km）。 */
export function parseCoord(cod) {
  const m = /^([+-][\d.]+)([+-][\d.]+)(?:([+-]\d+))?\//.exec(cod ?? "");
  if (!m) return {};
  const r = { lat: Number(m[1]), lon: Number(m[2]) };
  if (m[3] !== undefined) r.depth = Math.round(Math.abs(Number(m[3])) / 1000);
  return r;
}

const QUAKE_TITLES = new Set(["震度速報", "震源に関する情報", "震源・震度情報", "遠地地震に関する情報"]);

/** 地震の一覧（quake/data/list.json）から、地震ごとに最新の発表を新しい順に。 */
export function latestQuakes(list) {
  const byEvent = new Map();
  for (const e of list) {
    if (!QUAKE_TITLES.has(e.ttl) || e.ift !== "発表") continue;
    const prev = byEvent.get(e.eid);
    if (!prev || e.rdt > prev.rdt) byEvent.set(e.eid, e);
  }
  return [...byEvent.values()].sort((a, b) => (b.at > a.at ? 1 : -1)).slice(0, MAX_QUAKES);
}

/** 1つの地震。detail は詳しい JSON（読めなければ null）。 */
export function buildQuake(e, detail) {
  const q = {
    at: e.at,
    place: clean(e.anm || e.ttl, 60),
    placeEn: clean(e.en_anm, 80),
    mag: e.mag && !isNaN(Number(e.mag)) ? Number(e.mag) : null,
    max: intText(e.maxi),
    ...parseCoord(e.cod),
    tsunamiText: clean(detail?.Body?.Comments?.ForecastComment?.Text, 120),
    areas: [],
  };
  for (const pref of detail?.Body?.Intensity?.Observation?.Pref ?? [])
    for (const a of pref.Area ?? [])
      q.areas.push({ r: intRank(a.MaxInt), int: intText(a.MaxInt), name: clean(a.Name, 40), nameEn: clean(a.enName, 60) });
  q.areas = q.areas.sort((a, b) => b.r - a.r).slice(0, MAX_AREAS)
    .map(({ int, name, nameEn }) => (nameEn ? { int, name, nameEn } : { int, name }));
  return q;
}

// ---- 津波 ----

/** 種類の文から重さ（3 大津波警報・2 津波警報・1 津波注意報・0 それ以外）。 */
function tsunamiRank(kind) {
  if (!kind || kind.includes("解除")) return 0;
  if (kind.includes("大津波警報")) return 3;
  if (kind.startsWith("津波警報")) return 2;
  if (kind.startsWith("津波注意報")) return 1;
  return 0;
}
const TSUNAMI_LEVEL = ["", "津波注意報", "津波警報", "大津波警報"];

/** 津波の一覧（tsunami/data/list.json）の最新の発表が警報・注意報を含むならそれを、ないなら null。 */
export function activeTsunami(list, now = Date.now()) {
  const recent = list.filter((e) => e.ift === "発表" && now - Date.parse(e.rdt) < 48 * 3600e3) // ponytail: 解除の発表を取りこぼしても2日で消える
    .sort((a, b) => (b.rdt > a.rdt ? 1 : -1));
  const e = recent[0];
  const rank = Math.max(0, ...(e?.kind ?? []).map((k) => tsunamiRank(k.kind)));
  return rank ? { entry: e, level: TSUNAMI_LEVEL[rank], rank } : null;
}

export function buildTsunami(active, detail) {
  if (!active) return []; // 出ていないときは空（ワールドの when では「値なし」）
  // rank は機械用の段階（1 津波注意報・2 津波警報・3 大津波警報）。表示名が変わっても壊れないように
  return { level: active.level, rank: active.rank, text: clean(detail?.Head?.Headline?.Text, 200), at: active.entry.rdt };
}

// ---- 気象の警報・注意報（2026年5月からの新しい防災気象情報。warning/data/r8/） ----

// 気象庁の警報の種類のコード → 名前（日本語・英語）・段階（気象庁の警報のページの表を写したもの）
// 英語はこちらで訳したもの（気象庁の公式の英文の転載ではない）。特別警報＝Emergency Warning・危険警報＝Danger Warning・
// 警報＝Warning・注意報＝Advisory。大雨・土砂災害・高潮にはレベルの番号が付く。
const W = (name, nameEn, lv) => ({ name, nameEn, lv });
export const WARNING_KINDS = {
  "33": W("レベル5大雨特別警報", "Level 5 Heavy Rain Emergency Warning", 5),
  "43": W("レベル4大雨危険警報", "Level 4 Heavy Rain Danger Warning", 4),
  "03": W("レベル3大雨警報", "Level 3 Heavy Rain Warning", 3),
  "10": W("レベル2大雨注意報", "Level 2 Heavy Rain Advisory", 2),
  "39": W("レベル5土砂災害特別警報", "Level 5 Landslide Emergency Warning", 5),
  "49": W("レベル4土砂災害危険警報", "Level 4 Landslide Danger Warning", 4),
  "09": W("レベル3土砂災害警報", "Level 3 Landslide Warning", 3),
  "29": W("レベル2土砂災害注意報", "Level 2 Landslide Advisory", 2),
  "38": W("レベル5高潮特別警報", "Level 5 Storm Surge Emergency Warning", 5),
  "48": W("レベル4高潮危険警報", "Level 4 Storm Surge Danger Warning", 4),
  "08": W("レベル3高潮警報", "Level 3 Storm Surge Warning", 3),
  "19": W("レベル2高潮注意報", "Level 2 Storm Surge Advisory", 2),
  "35": W("暴風特別警報", "Storm Emergency Warning", 5), "05": W("暴風警報", "Storm Warning", 3), "15": W("強風注意報", "Strong Wind Advisory", 2),
  "32": W("暴風雪特別警報", "Snowstorm Emergency Warning", 5), "02": W("暴風雪警報", "Snowstorm Warning", 3), "13": W("風雪注意報", "Wind and Snow Advisory", 2),
  "36": W("大雪特別警報", "Heavy Snow Emergency Warning", 5), "06": W("大雪警報", "Heavy Snow Warning", 3), "12": W("大雪注意報", "Heavy Snow Advisory", 2),
  "37": W("波浪特別警報", "High Waves Emergency Warning", 5), "07": W("波浪警報", "High Waves Warning", 3), "16": W("波浪注意報", "High Waves Advisory", 2),
  "14": W("雷注意報", "Thunderstorm Advisory", 2), "17": W("融雪注意報", "Snowmelt Advisory", 2), "20": W("濃霧注意報", "Dense Fog Advisory", 2),
  "21": W("乾燥注意報", "Dry Air Advisory", 2), "22": W("なだれ注意報", "Avalanche Advisory", 2), "23": W("低温注意報", "Low Temperature Advisory", 2),
  "24": W("霜注意報", "Frost Advisory", 2), "25": W("着氷注意報", "Ice Accretion Advisory", 2), "26": W("着雪注意報", "Snow Accretion Advisory", 2),
};
const LEVEL_NAME = { 5: "special", 4: "danger", 3: "warning", 2: "advisory" };

/**
 * 全国の発表（r8/map.json）を府県予報区（offices）ごとにまとめる。
 * 区域（class10）ごと・種類ごとに最新の発表の状態を見て、解除されていないものを府県予報区に集める。
 * 府県の一部の区域だけに出ているときは、その区域の名前を regions に添える（全部の区域なら付けない）。
 * area は common/const/area.json（class10 → 府県予報区・名前）。
 */
export function buildWarnings(reports, area) {
  const latest = new Map(); // "区域|種類" → { rdt, status }
  let at = "";
  for (const r of reports) {
    if (r.infoType === "取消") continue;
    if (r.reportDatetime > at) at = r.reportDatetime;
    for (const item of r.warning?.class10Items ?? [])
      for (const k of item.kinds ?? []) {
        if (!k.code) continue;
        const key = `${item.areaCode}|${k.code}`;
        const prev = latest.get(key);
        if (!prev || r.reportDatetime > prev.rdt) latest.set(key, { rdt: r.reportDatetime, status: k.status });
      }
  }
  const byOffice = new Map(); // 府県予報区 → Map(種類 → Set(区域))
  for (const [key, { status }] of latest) {
    if (status === "解除") continue;
    const [code10, kind] = key.split("|");
    const office = area.class10s?.[code10]?.parent;
    if (!office || !WARNING_KINDS[kind]) continue;
    if (!byOffice.has(office)) byOffice.set(office, new Map());
    const kinds = byOffice.get(office);
    if (!kinds.has(kind)) kinds.set(kind, new Set());
    kinds.get(kind).add(code10);
  }
  // 府県予報区の区域（一次細分区域）の数。これと比べて「府県の一部だけ」を知る
  const areasInOffice = new Map();
  for (const a of Object.values(area.class10s ?? {}))
    areasInOffice.set(a.parent, (areasInOffice.get(a.parent) ?? 0) + 1);

  const warnings = {};
  for (const office of [...byOffice.keys()].sort()) {
    warnings[office] = [...byOffice.get(office)]
      .map(([kind, codes]) => ({ w: WARNING_KINDS[kind], codes: [...codes].sort() }))
      .sort((a, b) => b.w.lv - a.w.lv)
      .map(({ w, codes }) => {
        const item = { name: w.name, nameEn: w.nameEn, level: LEVEL_NAME[w.lv] };
        const total = areasInOffice.get(office) ?? 0; // 0 は区域の表にない（分からない）とき
        // 府県の一部の区域だけのときだけ、区域の名前を添える（府県全体・分からないときは添えない）
        if (total && codes.length < total) {
          const regions = codes.map((c) => clean(area.class10s[c]?.name, 20)).filter(Boolean);
          if (regions.length) item.regions = regions; // 例：強風注意報（伊豆諸島北部・伊豆諸島南部）
        }
        return item;
      });
  }
  return { warnings: Object.keys(warnings).length ? warnings : [], warningsAt: at };
}

// ---- まとめ ----

export function buildCommon({ quakes = [], tsunami = [], warnings = [], warningsAt = "" } = {}, now = Date.now()) {
  return {
    version: 1,
    updated: Math.floor(now / 1000),
    latest: { tv: LATEST_TV_VERSION },
    quakes,     // 最近の地震（気象庁の発表済みの情報。速報ではない）
    tsunami,    // 津波の警報・注意報（出ているときだけ。ないときは []）
    warnings,   // 府県予報区のコード → 警報・注意報の並び（ないときは []）
    warningsAt, // 警報・注意報の最新の発表時刻
    notices: [], // Ulexite 公式のお知らせ（ホームのバナーの公式枠。制作者がオフにできる）
  };
}

async function getJson(path) {
  const res = await fetch(`${JMA}/${path}`, { headers: { "User-Agent": "ulexite-catalog (+https://github.com/thesilver0913/ulexite-catalog)" } });
  if (!res.ok) throw new Error(`JMA ${path} ${res.status}`);
  return res.json();
}

/** 変わったかの目安（小さいファイルと ETag だけで見る）。 */
async function sourceStamp() {
  const heads = await Promise.all(["quake/data/list.json", "tsunami/data/list.json", "warning/data/r8/map_time.json"]
    .map((p) => fetch(`${JMA}/${p}`, { method: "HEAD" }).then((r) => r.headers.get("etag") ?? r.headers.get("last-modified") ?? String(Date.now()))));
  return heads.join(" ");
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const kvGet = async (env, key) => (await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first())?.value ?? null;
const kvSet = (env, key, value) => env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));

/** 気象庁から読んで共通の feed を作る（書き出しはしない）。 */
export async function fetchCommon() {
  const [quakeList, tsunamiList, reports, area] = await Promise.all([
    getJson("quake/data/list.json"), getJson("tsunami/data/list.json"),
    getJson("warning/data/r8/map.json"), getJson("common/const/area.json"),
  ]);
  const events = latestQuakes(quakeList);
  const details = await Promise.all(events.map((e) => getJson(`quake/data/${e.json}`).catch(() => null)));
  const active = activeTsunami(tsunamiList);
  const tsunamiDetail = active ? await getJson(`tsunami/data/${active.entry.json}`).catch(() => null) : null;
  return buildCommon({
    quakes: events.map((e, i) => buildQuake(e, details[i])),
    tsunami: buildTsunami(active, tsunamiDetail),
    ...buildWarnings(reports, area),
  });
}

export async function runCommon(env, { force = false } = {}) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const stamp = await sourceStamp();
  // 気象庁のデータも、このコードの中身の作り方（COMMON_BUILD）も変わっていなければ、何もしない
  if (!force && stamp === await kvGet(env, "common.stamp") && COMMON_BUILD === await kvGet(env, "common.build"))
    return { ok: true, changed: false };

  const common = await fetchCommon();
  const { updated, ...body } = common;
  const hash = await sha256(JSON.stringify(body));
  if (!force && hash === await kvGet(env, "common.hash")) {
    await env.DB.batch([kvSet(env, "common.stamp", stamp), kvSet(env, "common.build", COMMON_BUILD)]).run();
    return { ok: true, changed: false };
  }
  const last = Number(await kvGet(env, "common.publishedAt") ?? 0);
  if (!force && updated - last < MIN_PUBLISH_GAP) return { ok: true, pending: true }; // 印を残さないので、次の回にもう一度確かめる
  await publish(env, { "v1/feed/common.json": JSON.stringify(common) }, "共通の feed を更新");
  await env.DB.batch([kvSet(env, "common.stamp", stamp), kvSet(env, "common.build", COMMON_BUILD),
    kvSet(env, "common.hash", hash), kvSet(env, "common.publishedAt", updated)]);
  return { ok: true, changed: true, updated, quakes: common.quakes.length, warningAreas: Object.keys(common.warnings).length };
}
