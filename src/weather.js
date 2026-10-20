// 天気（v1/feed/weather/<府県予報区のコード>.json）。天気アプリが10分おきに読む。
// 予報は気象庁の発表のまま（天気の文・天気のコード・気温・降水確率）。現在の気温はアメダスの観測。
// 日の出入り・月（月相・月齢・次の満月・月の出入り・8日分）は、予報の地点のアメダスの位置でこちらが計算する。
// 府県予報区は58件あり、1回に読める数（無料プランは外への読み込みが1回50件まで）を超えるので、
// 毎時15〜18分に15件ずつ読んで D1 に置き、19分にまとめて1回で書き出す。
import SunCalc from "suncalc";
import { publish } from "./github.js";
import { clean } from "./catalog.js";

const JMA = "https://www.jma.go.jp/bosai";
const BATCH = 15;
export const BATCHES = 4; // 15 × 4 ≥ 58

const JST = 9 * 3600e3;
/** 時刻（ミリ秒）→ 日本時間の "2026-10-20" と "05:49"。 */
const jstDate = (ms) => new Date(ms + JST).toISOString().slice(0, 10);
const jstTime = (d) => (d && !isNaN(d) ? new Date(d.getTime() + JST).toISOString().slice(11, 16) : null);
/** 日本時間のその日の0時（ミリ秒）。 */
const jstMidnight = (date) => Date.parse(`${date}T00:00:00+09:00`);

// ---- 月 ----

export const MOON_NAMES = [
  ["新月", "New Moon"], ["三日月", "Waxing Crescent"], ["上弦の月", "First Quarter"], ["十三夜", "Waxing Gibbous"],
  ["満月", "Full Moon"], ["寝待月", "Waning Gibbous"], ["下弦の月", "Last Quarter"], ["有明月", "Waning Crescent"],
];
const SYNODIC = 29.530588;
const phaseAt = (ms) => SunCalc.getMoonIllumination(new Date(ms)).phase; // 0 新月 → 0.5 満月 → 1

/**
 * その日（日本時間）の月相の番号。新月・上弦・満月・下弦（0・2・4・6）はその瞬間がある日だけ、
 * ほかの日はあいだの番号（1・3・5・7。三日月・十三夜・寝待月・有明月）。
 */
export function dayPhase(date) {
  const start = jstMidnight(date);
  let prev = phaseAt(start);
  for (let h = 1; h <= 24; h++) {
    const p = phaseAt(start + h * 3600e3);
    if (prev > 0.9 && p < 0.1) return 0; // 1 → 0 に戻った＝新月（満月のあたりは少し行き戻りするので、端だけを見る）
    for (const q of [0.25, 0.5, 0.75]) if (prev < q && p >= q) return q * 8;
    prev = p;
  }
  return Math.floor(phaseAt(start + 12 * 3600e3) * 4) * 2 + 1;
}

/** その日の日本時間のうちに起きる月の出・月の入り（なければ null）。 */
function moonTimes(date, lat, lon) {
  const start = jstMidnight(date), end = start + 86400e3;
  const found = { rise: null, set: null };
  for (const day of [start - 86400e3, start, end]) { // suncalc は UTC の1日ずつ探すので、前後の日も見て日本時間の日に入るものを拾う
    const t = SunCalc.getMoonTimes(new Date(day), lat, lon, true);
    for (const k of ["rise", "set"])
      if (t[k] && t[k] >= start && t[k] < end && (!found[k] || t[k] < found[k])) found[k] = t[k];
  }
  return found;
}

/** 月相・月齢・次の満月・8日分（どこから見ても同じなので1回だけ計算する）。 */
export function moonPhases(now) {
  const today = jstDate(now);
  const noon = (date) => new Date(jstMidnight(date) + 12 * 3600e3);
  const ill = SunCalc.getMoonIllumination(noon(today));
  let nextFull = null; // 次の満月：1時間ずつ進めて、満ちていく月が半分（0.5）を越えたところ
  for (let t = now, prev = SunCalc.getMoonIllumination(new Date(t)).phase; t < now + 31 * 86400e3; t += 3600e3) {
    const p = SunCalc.getMoonIllumination(new Date(t + 3600e3)).phase;
    if (prev < 0.5 && p >= 0.5) { nextFull = jstDate(t + 3600e3); break; }
    prev = p;
  }
  const idx = dayPhase(today);
  const days = [];
  for (let i = 0; i < 8; i++) {
    const date = jstDate(now + i * 86400e3);
    const j = i ? dayPhase(date) : idx;
    days.push({ date, phase: j, name: MOON_NAMES[j][0], nameEn: MOON_NAMES[j][1] });
  }
  return {
    phase: idx, name: MOON_NAMES[idx][0], nameEn: MOON_NAMES[idx][1],
    age: Math.round(ill.phase * SYNODIC * 10) / 10, // 正午の月齢（目安）
    nextFull, days,
  };
}

/** 月相に、その場所の今日の月の出入りを足す。 */
export function buildMoon(now, lat, lon, phases = moonPhases(now)) {
  const times = moonTimes(jstDate(now), lat, lon);
  const { days, ...rest } = phases;
  return { ...rest, rise: jstTime(times.rise), set: jstTime(times.set), days };
}

export function buildSun(now, lat, lon) {
  const t = SunCalc.getTimes(new Date(jstMidnight(jstDate(now)) + 12 * 3600e3), lat, lon);
  return { rise: jstTime(t.sunrise), set: jstTime(t.sunset) };
}

// ---- 予報 ----

const num = (s) => (s === "" || s == null || isNaN(Number(s)) ? null : Number(s));
/** 天気のコード（"201" など）→ 大まかな天気（"200"。1 晴れ・2 くもり・3 雨・4 雪）。元のコードは wxCode に残す。 */
const wxMain = (code) => (/^[1-4]\d\d$/.test(code ?? "") ? code[0] + "00" : "");
const pickArea = (ts, areas) => ts.areas.find((a) => areas?.has(a.area?.code)) ?? ts.areas[0];
const stationArea = (ts, station) => (station ? ts.areas.find((a) => a.area?.code === station) : ts.areas[0]);

// 自分の予報のファイルがない府県予報区（親のファイルに入っている）と、その気温の地点
const FORECAST_FILE = { "014030": "014100", "460040": "460100" };
const STATION = { "014030": "20432", "460040": "88837" }; // 帯広・名瀬

/**
 * 府県予報区の予報（forecast/<code>.json）から日ごとの並びを作る。
 * 週間予報を基本にし、ない日・ない値（今日・明日）は短期予報で埋める。
 * 区域は areas（この府県予報区の一次細分区域のコード）の最初のもの、なければ先頭。気温は station の地点だけ（ほかの地点の値は使わない）。
 */
export function buildDays(forecast, now, areas = null, station = null) {
  const [short, week] = forecast;
  const byDate = new Map();
  const day = (iso) => {
    const d = iso.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, { date: d, wx: "", wxCode: "", max: null, min: null, pop: null });
    return byDate.get(d);
  };
  const set = (o, k, v) => { if (v !== null && v !== "" && (o[k] === null || o[k] === "")) o[k] = v; };

  const [wts, pts] = week?.timeSeries ?? [];
  const wa = wts && pickArea(wts, areas);
  wts?.timeDefines.forEach((t, i) => {
    const a = wa, d = day(t);
    set(d, "wxCode", a.weatherCodes?.[i] ?? ""); set(d, "pop", num(a.pops?.[i]));
  });
  const pa = pts && stationArea(pts, station);
  if (pa) pts.timeDefines.forEach((t, i) => {
    const a = pa, d = day(t);
    set(d, "max", num(a.tempsMax?.[i])); set(d, "min", num(a.tempsMin?.[i]));
  });

  const [sw, sp, st] = short?.timeSeries ?? [];
  sw?.timeDefines.forEach((t, i) => set(day(t), "wxCode", pickArea(sw, areas).weatherCodes?.[i] ?? ""));
  const shortPop = new Map(); // 6時間ごと → その日の最大
  sp?.timeDefines.forEach((t, i) => {
    const p = num(pickArea(sp, areas).pops?.[i]);
    if (p !== null) shortPop.set(t.slice(0, 10), Math.max(shortPop.get(t.slice(0, 10)) ?? 0, p));
  });
  for (const [d, p] of shortPop) set(day(d), "pop", p);
  const sa = st && stationArea(st, station);
  if (sa) st.timeDefines.forEach((t, i) => { // 0時の値は最低、9時の値は最高
    const v = num(sa.temps?.[i]);
    set(day(t), t.slice(11, 13) === "00" ? "min" : "max", v);
  });

  const today = jstDate(now);
  return [...byDate.values()].filter((d) => d.date >= today).sort((a, b) => (a.date > b.date ? 1 : -1)).slice(0, 7)
    .map((d) => ({ ...d, wx: wxMain(d.wxCode) }));
}

/** 1つの府県予報区のファイル。station は予報の気温の地点（アメダス）。obs は最新のアメダス（全国）。 */
export function buildArea(forecast, station, obs, obsAt, now = Date.now(), phases = moonPhases(now), areas = null) {
  const [short] = forecast;
  const sw = short?.timeSeries?.[0];
  const sa = sw && pickArea(sw, areas);
  const code = sa?.weatherCodes?.[0] ?? "";
  const temp = obs?.[station.code]?.temp;
  return {
    version: 1,
    updatedAt: short?.reportDatetime ?? "",
    current: {
      temp: temp && temp[1] === 0 ? temp[0] : null, // [値, 品質]。0 が正常
      at: obsAt,
      wx: wxMain(code), wxCode: code,
      wxText: clean(sa?.weathers?.[0], 60).replace(/　/g, " "),
    },
    days: buildDays(forecast, now, areas, station.code),
    sun: buildSun(now, station.lat, station.lon),
    moon: buildMoon(now, station.lat, station.lon, phases),
    station: { name: station.name, nameEn: station.nameEn, lat: station.lat, lon: station.lon },
  };
}

// ---- 動かす ----

async function getJson(path) {
  const res = await fetch(`${JMA}/${path}`, { headers: { "User-Agent": "ulexite-catalog (+https://github.com/thesilver0913/ulexite-catalog)" } });
  if (!res.ok) throw new Error(`JMA ${path} ${res.status}`);
  return res.json();
}

const deg = ([d, m]) => Math.round((d + m / 60) * 1e4) / 1e4;

/** 府県予報区の15件ずつの1組を読んで、D1 に置く。batch は 0〜3。 */
export async function runWeatherBatch(env, batch) {
  const area = await getJson("common/const/area.json");
  const codes = Object.keys(area.offices).sort().slice(batch * BATCH, (batch + 1) * BATCH);
  if (!codes.length) return { ok: true, batch, count: 0 };
  const [table, latest] = await Promise.all([getJson("amedas/const/amedastable.json"),
    fetch(`${JMA}/amedas/data/latest_time.txt`).then((r) => r.text())]);
  const obsAt = latest.trim();
  const stamp = new Date(Date.parse(obsAt) + JST).toISOString().replace(/[-T:]/g, "").slice(0, 12) + "00";
  const obs = await getJson(`amedas/data/map/${stamp}.json`).catch(() => null);
  const now = Date.now();
  const phases = moonPhases(now);
  let count = 0;
  const writes = [];
  for (const code of codes) {
    try {
      const forecast = await getJson(`forecast/data/forecast/${FORECAST_FILE[code] ?? code}.json`);
      const stCode = STATION[code] ?? forecast[0].timeSeries[2].areas[0].area.code;
      const t = table[stCode];
      if (!t) continue;
      const station = { code: stCode, name: t.kjName, nameEn: t.enName, lat: deg(t.lat), lon: deg(t.lon) };
      const areas = new Set(area.offices[code].children);
      writes.push(env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(`weather.${code}`, JSON.stringify(buildArea(forecast, station, obs, obsAt, now, phases, areas))));
      count++;
    } catch (e) {
      console.log(`weather ${code}: ${e.message}`); // 1件読めなくても、前回の分を残してほかを進める
    }
  }
  if (writes.length) await env.DB.batch(writes);
  return { ok: true, batch, count };
}

/** D1 に置いた全件をまとめて書き出す。 */
export async function publishWeather(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'weather.%'").all();
  if (!results.length) return { ok: true, count: 0 };
  const files = {};
  for (const r of results) files[`v1/feed/weather/${r.key.slice(8)}.json`] = r.value;
  await publish(env, files, "天気を更新");
  return { ok: true, count: results.length };
}

/** 手動で動かすとき（/run?job=weather）：全部読んで書き出す。外への読み込みが多いので、無料プランでは途中で止まることがある。 */
export async function runWeather(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  for (let b = 0; b < BATCHES; b++) await runWeatherBatch(env, b);
  return publishWeather(env);
}
