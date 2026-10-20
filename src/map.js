// 天気の地図（v1/feed/weather-map.json）。天気アプリの地図タブが20分おきに読む。
// 点のデータだけをここに入れる（アメダスの気温・最新の地震の震度の観測点・震源）。
// 面のデータ（雨雲・警報の塗り分け・津波の沿岸）は画像（v1/feed/img/）で、こちらとは別に作る。
// 気象庁の発表をそのままの形で伝えるだけで、独自の判定・予測・要約はしない（気象業務法）。
import { publish } from "./github.js";
import { intText, parseCoord } from "./common.js";

const JMA = "https://www.jma.go.jp/bosai";

/** アメダスの点を間引く格子（度）。2048px の日本地図で値の札が重ならない、およその密度。 */
export const AMEDAS_GRID = 0.5;
/** 震度の観測点の上限（大きな地震でも地図に並べられる数）。 */
export const MAX_QUAKE_POINTS = 300;

const deg = ([d, m]) => Math.round((d + m / 60) * 1e4) / 1e4;
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
const intRank = (s) => ({ "1": 1, "2": 2, "3": 3, "4": 4, "5-": 5, "5+": 6, "6-": 7, "6+": 8, "7": 9 }[s] ?? 0);

/**
 * アメダスの気温（品質が正常なものだけ）を、格子（grid 度）に1つずつ残して間引く。
 * 同じ格子に複数あれば、観測所のコードの小さいほう（並びを決めておき、同じデータなら同じ結果にする）。
 * table は amedas/const/amedastable.json、obs は amedas/data/map/<時刻>.json。
 */
export function amedasPoints(table, obs, grid = AMEDAS_GRID) {
  const cells = new Map();
  for (const code of Object.keys(table ?? {}).sort()) {
    const t = obs?.[code]?.temp;
    if (!t || t[1] !== 0) continue; // [値, 品質]。品質 0 が正常
    const p = table[code];
    if (!p?.lat || !p?.lon) continue;
    const lat = deg(p.lat), lon = deg(p.lon);
    const cell = `${Math.floor(lat / grid)}:${Math.floor(lon / grid)}`;
    if (!cells.has(cell)) cells.set(cell, { lat: round(lat, 3), lon: round(lon, 3), t: t[0] });
  }
  return [...cells.values()];
}

/** 地震の詳しい JSON（Body.Intensity）から、震度の観測点（緯度・経度・震度）を震度の大きい順に。 */
export function quakePoints(detail, max = MAX_QUAKE_POINTS) {
  const points = [];
  for (const pref of detail?.Body?.Intensity?.Observation?.Pref ?? [])
    for (const area of pref.Area ?? [])
      for (const city of area.City ?? [])
        for (const s of city.IntensityStation ?? []) {
          if (!s.latlon) continue; // 位置のない観測点は地図に出せない
          points.push({ r: intRank(s.Int), int: intText(s.Int), lat: round(s.latlon.lat, 3), lon: round(s.latlon.lon, 3) });
        }
  return points.sort((a, b) => b.r - a.r).slice(0, max).map(({ int, lat, lon }) => ({ lat, lon, int }));
}

/** 地図の feed を組み立てる。quake は { entry, detail }（ないときは null）。 */
export function buildWeatherMap({ amedasAt = "", amedas = [], quake = null, rainAt = null } = {}, now = Date.now()) {
  const map = {
    version: 1,
    updated: Math.floor(now / 1000),
    rainAt,   // 雨雲の画像（v1/feed/img/rain-frames.png）の最初のコマの時刻。画像がまだなければ null
    amedasAt, // アメダスの観測時刻
    amedas,   // 気温の点（緯度・経度・℃）
    quakePoints: [], // 最新の地震の震度の観測点（震度の大きい順）
    quakeEpi: null,  // 震源（lat・lon・max・place・at）
  };
  if (quake) {
    const { entry, detail } = quake;
    map.quakePoints = quakePoints(detail);
    const { lat, lon } = parseCoord(entry?.cod);
    if (lat !== undefined) map.quakeEpi = { lat, lon, max: intText(entry.maxi), place: entry.anm ?? "", at: entry.at ?? "" };
  }
  return map;
}

// ---- 動かす ----

async function getJson(path) {
  const res = await fetch(`${JMA}/${path}`, { headers: { "User-Agent": "ulexite-catalog (+https://github.com/thesilver0913/ulexite-catalog)" } });
  if (!res.ok) throw new Error(`JMA ${path} ${res.status}`);
  return res.json();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const kvGet = async (env, key) => (await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first())?.value ?? null;
const kvSet = (env, key, value) => env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));

/** Pages の URL（GitHub のユーザー名とリポジトリ名から）。 */
export const pagesOrigin = (repo) => {
  const [owner, name] = String(repo ?? "").split("/");
  return owner && name ? `https://${owner}.github.io/${name}/` : "";
};

/**
 * 雨雲の画像（GitHub Actions が作る v1/feed/img/rain.json）の最初のコマの時刻。
 * 画像と時刻を食い違わせないよう、画像を作った側が書いた時刻をそのまま使う。まだなければ null。
 */
export async function rainAt(env) {
  const base = pagesOrigin(env?.GITHUB_REPO);
  if (!base) return null;
  try {
    const res = await fetch(`${base}v1/feed/img/rain.json?t=${Date.now()}`); // キャッシュを避ける
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.at === "string" ? j.at : null;
  } catch {
    return null; // 画像がまだない・読めないときは、雨雲なしとして出す
  }
}

/** 最新の地震（震源・震度情報。震源と震度の観測点がそろっているもの）。 */
async function latestQuake() {
  const list = await getJson("quake/data/list.json");
  const entry = list
    .filter((e) => e.ift === "発表" && e.ttl === "震源・震度情報" && e.cod)
    .sort((a, b) => (b.at > a.at ? 1 : -1))[0];
  if (!entry) return null;
  const detail = await getJson(`quake/data/${entry.json}`).catch(() => null);
  return detail ? { entry, detail } : null;
}

export async function fetchWeatherMap(env) {
  const [table, latest, quake, rain] = await Promise.all([
    getJson("amedas/const/amedastable.json"),
    fetch(`${JMA}/amedas/data/latest_time.txt`).then((r) => r.text()),
    latestQuake(),
    rainAt(env),
  ]);
  const amedasAt = latest.trim();
  const stamp = new Date(Date.parse(amedasAt) + 9 * 3600e3).toISOString().replace(/[-T:]/g, "").slice(0, 12) + "00";
  const obs = await getJson(`amedas/data/map/${stamp}.json`).catch(() => null);
  return buildWeatherMap({ amedasAt, amedas: obs ? amedasPoints(table, obs) : [], quake, rainAt: rain });
}

export async function runMap(env, { force = false } = {}) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const map = await fetchWeatherMap(env);
  const { updated, ...body } = map;
  const hash = await sha256(JSON.stringify(body));
  if (!force && hash === await kvGet(env, "map.hash")) return { ok: true, changed: false };
  await publish(env, { "v1/feed/weather-map.json": JSON.stringify(map) }, "天気の地図を更新");
  await kvSet(env, "map.hash", hash).run();
  return { ok: true, changed: true, updated, amedas: map.amedas.length, quakePoints: map.quakePoints.length };
}
