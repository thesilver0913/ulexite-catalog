// 航空気象（v1/feed/metar.json）。METAR アプリが10分おきに読む。
// データは米国 NOAA の Aviation Weather Center の Data API（キー不要。エンドポイントごとに1分1回まで、
// 独自の User-Agent を名乗ること）。読み解き（風・視程・雲・天気・飛行区分）はここで済ませ、
// 端末は表示するだけにする（データで書くアプリの決まり）。米国政府の公開データ。
//
// 空港は日本の METAR のある空港から主要なものを固定で持つ。制作者が追加できるのはこの中のコードだけ
// （共通サーバーは、ワールドごとの設定を知らないため）。増やすときは AIRPORTS に足す。
import { publish } from "./github.js";
import { clean } from "./catalog.js";

const AWC = "https://aviationweather.gov/api/data";
const UA = { "User-Agent": "ulexite-catalog (+https://github.com/thesilver0913/ulexite-catalog)" };

/** 空港（ICAO コード・日本語の名前・英語の名前）。name は一覧用の短い名前、long は正式名。 */
export const AIRPORTS = [
  { icao: "RJTT", name: "東京（羽田）", long: "東京国際空港（羽田）", nameEn: "Tokyo (Haneda)", longEn: "Tokyo International (Haneda)" },
  { icao: "RJAA", name: "東京（成田）", long: "成田国際空港", nameEn: "Tokyo (Narita)", longEn: "Narita International" },
  { icao: "RJBB", name: "大阪（関西）", long: "関西国際空港", nameEn: "Osaka (Kansai)", longEn: "Kansai International" },
  { icao: "RJOO", name: "大阪（伊丹）", long: "大阪国際空港（伊丹）", nameEn: "Osaka (Itami)", longEn: "Osaka International (Itami)" },
  { icao: "RJGG", name: "名古屋（中部）", long: "中部国際空港", nameEn: "Nagoya (Chubu)", longEn: "Chubu Centrair International" },
  { icao: "RJCC", name: "札幌（新千歳）", long: "新千歳空港", nameEn: "Sapporo (New Chitose)", longEn: "New Chitose" },
  { icao: "RJFF", name: "福岡", long: "福岡空港", nameEn: "Fukuoka", longEn: "Fukuoka" },
  { icao: "ROAH", name: "沖縄（那覇）", long: "那覇空港", nameEn: "Okinawa (Naha)", longEn: "Naha" },
  { icao: "RJSS", name: "仙台", long: "仙台空港", nameEn: "Sendai", longEn: "Sendai" },
  { icao: "RJSN", name: "新潟", long: "新潟空港", nameEn: "Niigata", longEn: "Niigata" },
  { icao: "RJCH", name: "函館", long: "函館空港", nameEn: "Hakodate", longEn: "Hakodate" },
  { icao: "RJEC", name: "旭川", long: "旭川空港", nameEn: "Asahikawa", longEn: "Asahikawa" },
  { icao: "RJCM", name: "女満別", long: "女満別空港", nameEn: "Memanbetsu", longEn: "Memanbetsu" },
  { icao: "RJCB", name: "帯広", long: "とかち帯広空港", nameEn: "Obihiro", longEn: "Tokachi-Obihiro" },
  { icao: "RJCK", name: "釧路", long: "釧路空港", nameEn: "Kushiro", longEn: "Kushiro" },
  { icao: "RJCO", name: "札幌（丘珠）", long: "札幌飛行場（丘珠）", nameEn: "Sapporo (Okadama)", longEn: "Okadama" },
  { icao: "RJCW", name: "稚内", long: "稚内空港", nameEn: "Wakkanai", longEn: "Wakkanai" },
  { icao: "RJAH", name: "茨城", long: "茨城空港", nameEn: "Ibaraki", longEn: "Ibaraki" },
  { icao: "RJAF", name: "松本", long: "信州まつもと空港", nameEn: "Matsumoto", longEn: "Shinshu-Matsumoto" },
  { icao: "RJNK", name: "小松", long: "小松飛行場", nameEn: "Komatsu", longEn: "Komatsu" },
  { icao: "RJBE", name: "神戸", long: "神戸空港", nameEn: "Kobe", longEn: "Kobe" },
  { icao: "RJOS", name: "徳島", long: "徳島阿波おどり空港", nameEn: "Tokushima", longEn: "Tokushima" },
  { icao: "RJOM", name: "松山", long: "松山空港", nameEn: "Matsuyama", longEn: "Matsuyama" },
  { icao: "RJOK", name: "高知", long: "高知龍馬空港", nameEn: "Kochi", longEn: "Kochi" },
  { icao: "RJOT", name: "高松", long: "高松空港", nameEn: "Takamatsu", longEn: "Takamatsu" },
  { icao: "RJOA", name: "広島", long: "広島空港", nameEn: "Hiroshima", longEn: "Hiroshima" },
  { icao: "RJDC", name: "山口（宇部）", long: "山口宇部空港", nameEn: "Yamaguchi (Ube)", longEn: "Yamaguchi Ube" },
  { icao: "RJFT", name: "熊本", long: "阿蘇くまもと空港", nameEn: "Kumamoto", longEn: "Kumamoto" },
  { icao: "RJFK", name: "鹿児島", long: "鹿児島空港", nameEn: "Kagoshima", longEn: "Kagoshima" },
  { icao: "RJFM", name: "宮崎", long: "宮崎ブーゲンビリア空港", nameEn: "Miyazaki", longEn: "Miyazaki" },
  { icao: "RJFO", name: "大分", long: "大分空港", nameEn: "Oita", longEn: "Oita" },
  { icao: "RJFS", name: "佐賀", long: "佐賀空港", nameEn: "Saga", longEn: "Saga" },
  { icao: "RJFU", name: "長崎", long: "長崎空港", nameEn: "Nagasaki", longEn: "Nagasaki" },
  { icao: "RJFR", name: "北九州", long: "北九州空港", nameEn: "Kitakyushu", longEn: "Kitakyushu" },
  { icao: "ROIG", name: "石垣", long: "新石垣空港", nameEn: "Ishigaki", longEn: "Ishigaki" },
  { icao: "RJKA", name: "奄美", long: "奄美空港", nameEn: "Amami", longEn: "Amami" },
  { icao: "RJDT", name: "対馬", long: "対馬空港", nameEn: "Tsushima", longEn: "Tsushima" },
  { icao: "RJBD", name: "南紀白浜", long: "南紀白浜空港", nameEn: "Nanki-Shirahama", longEn: "Nanki-Shirahama" },
];

// ---- 読み解き ----

const COVER = {
  FEW: ["少し", "Few"], SCT: ["ところどころ", "Scattered"], BKN: ["大部分", "Broken"], OVC: ["全天", "Overcast"],
  SKC: ["雲なし", "Clear"], CLR: ["雲なし", "Clear"], NSC: ["雲なし", "No cloud"], NCD: ["雲なし", "No cloud"],
};
const DIR16_JA = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
const DIR16_EN = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** 風向（度）→ 北北西 などの16方位。 */
export function dirName(deg) {
  if (deg == null) return null;
  const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return { ja: DIR16_JA[i], en: DIR16_EN[i] };
}

/** 風の電文（"34008KT" "VRB03KT" "34008G18KT"）→ { dir, kt, gust, variable }。 */
export function parseWind(token) {
  const m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(token ?? "");
  if (!m) return null;
  const variable = m[1] === "VRB";
  return { dir: variable ? null : Number(m[1]), kt: Number(m[2]), gust: m[3] ? Number(m[3]) : null, variable };
}

/** 視程の電文 → メートル（"9999" と "CAVOK" は 10000 以上）。 */
export function parseVisibility(token) {
  if (!token) return null;
  if (token === "CAVOK") return { m: 10000, over: true };
  if (/^\d{4}$/.test(token)) { // 日本ではメートルの4桁（9999 は10km以上）
    const m = Number(token);
    return { m: m >= 9999 ? 10000 : m, over: m >= 9999 };
  }
  const sm = /^(\d+)?\s?(\d)\/(\d)SM$/.exec(token); // 米国のマイル表記（"1 1/2SM"。念のため）
  if (sm) {
    const v = (Number(sm[1] ?? 0) + Number(sm[2]) / Number(sm[3])) * 1609;
    return { m: Math.round(v), over: token.includes("+") };
  }
  return null;
}

/** 視程の表示（"10km以上"・"8km"・"800m"）。 */
export function visibilityText(vis) {
  if (!vis) return { ja: "—", en: "—" };
  if (vis.over || vis.m >= 10000) return { ja: "10km以上", en: "10 km or more" };
  if (vis.m >= 1000) {
    const km = Math.round(vis.m / 100) / 10;
    return { ja: `${km}km`, en: `${km} km` };
  }
  return { ja: `${vis.m}m`, en: `${vis.m} m` };
}

// 天気（現況）の種類。intensity・descriptor・現象の組み合わせで読む。
const INTENSITY = { "-": ["弱い", "Light"], "+": ["強い", "Heavy"], VC: ["付近の", "In the vicinity"] };
const DESCRIPTOR = { MI: "浅い", PR: "部分的に", BC: "帯状の", DR: "風に舞う", BL: "吹雪の", SH: "にわか", TS: "雷", FZ: "着氷性" };
const DESCRIPTOR_EN = { MI: "Shallow", PR: "Partial", BC: "Patches of", DR: "Low drifting", BL: "Blowing", SH: "Showers", TS: "Thunderstorm", FZ: "Freezing" };
const PHENOMENA = {
  DZ: ["霧雨", "Drizzle"], RA: ["雨", "Rain"], SN: ["雪", "Snow"], SG: ["霧雪", "Snow grains"], IC: ["氷晶", "Ice crystals"],
  PL: ["氷あられ", "Ice pellets"], GR: ["ひょう", "Hail"], GS: ["あられ", "Small hail"], UP: ["不明の降水", "Unknown precipitation"],
  BR: ["もや", "Mist"], FG: ["霧", "Fog"], FU: ["煙", "Smoke"], VA: ["火山灰", "Volcanic ash"], DU: ["砂じん", "Dust"],
  SA: ["砂", "Sand"], HZ: ["煙霧", "Haze"], PO: ["じん旋風", "Dust whirls"], SQ: ["スコール", "Squalls"], FC: ["漏斗雲", "Funnel cloud"],
  SS: ["砂あらし", "Sandstorm"], DS: ["砂じんあらし", "Duststorm"], NSW: ["現象なし", "No significant weather"],
};

/** 天気の電文（"-RA" "SHRA" "TSRA" "BR"）→ 日本語・英語。 */
export function parseWeather(token) {
  if (!token || token === "//") return null;
  let rest = token;
  let ja = "";
  let en = "";
  let strength = "", strengthEn = "";
  for (const [k, v] of Object.entries(INTENSITY))
    if (rest.startsWith(k)) { strength = v[0]; strengthEn = v[1]; rest = rest.slice(k.length); break; }
  let descJa = "", descEn = "";
  for (const [k, v] of Object.entries(DESCRIPTOR))
    if (rest.startsWith(k)) { descJa = v; descEn = DESCRIPTOR_EN[k]; rest = rest.slice(k.length); break; }
  const phen = PHENOMENA[rest] ?? PHENOMENA[rest.slice(0, 2)];
  if (!phen) return null;
  // 日本語：弱い＋にわか＋雨。英語：にわか雨は "Rain showers"、雷は "Thunderstorm with rain"、ほかは "Light rain"
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  ja = strength + descJa + phen[0];
  if (descJa === "にわか") en = `${strengthEn}${lower(phen[1])} showers`;
  else if (descJa === "雷") en = `${strengthEn}thunderstorm with ${lower(phen[1])}`;
  else en = `${strengthEn} ${descEn ? descEn + " " : ""}${lower(phen[1])}`.replace(/\s+/g, " ").trim();
  if (strength === "付近の") en = "In the vicinity: " + en;
  en = en.charAt(0).toUpperCase() + en.slice(1);
  return { code: token, ja, en };
}

/** 雲の電文（"FEW030" "BKN016" "OVC015CB" "VV002"）→ { cover, base, code, ja, en }。 */
export function parseCloud(token) {
  const vv = /^VV(\d{3})$/.exec(token ?? ""); // 垂直視程（雲が不明で、鉛直に見える距離）
  if (vv) {
    const base = Number(vv[1]) * 100;
    return { cover: "VV", base, code: token, ja: `垂直視程 ${base.toLocaleString("en-US")}ft`, en: `Vertical visibility ${base.toLocaleString("en-US")} ft` };
  }
  const m = /^(FEW|SCT|BKN|OVC|SKC|CLR|NSC|NCD)(\d{3})?(CB|TCU)?$/.exec(token ?? "");
  if (!m) return null;
  const cover = m[1], base = m[2] ? Number(m[2]) * 100 : null;
  const names = COVER[cover] ?? [cover, cover];
  const code = cover + (m[2] ?? "");
  const feet = base == null ? "" : `${base.toLocaleString("en-US")}ft`;
  return {
    cover, base, code,
    ja: base == null ? names[0] : `${names[0]} ${feet}`,
    en: base == null ? names[1] : `${names[1]} ${base.toLocaleString("en-US")} ft`,
  };
}

/** 雲の高さから天井（ceiling。BKN・OVC の一番低い層。垂直視程も天井とみなす）。 */
export function ceilingOf(clouds) {
  const layers = clouds.filter((c) => c.base != null && (c.cover === "BKN" || c.cover === "OVC" || c.cover === "VV"));
  return layers.length ? Math.min(...layers.map((c) => c.base)) : null;
}

/** 飛行区分（AWC が flight category をくれなかったときの計算）。 */
export function flightCategory(visM, ceilingFt) {
  const visMi = visM == null ? null : visM / 1609;
  if ((visMi != null && visMi < 1) || (ceilingFt != null && ceilingFt < 500)) return "LIFR";
  if ((visMi != null && visMi < 3) || (ceilingFt != null && ceilingFt < 1000)) return "IFR";
  if ((visMi != null && visMi <= 5) || (ceilingFt != null && ceilingFt <= 3000)) return "MVFR";
  return "VFR";
}

const PAD2 = (n) => String(n).padStart(2, "0");
const isoJst = (sec) => new Date((sec + 9 * 3600) * 1000).toISOString().replace("Z", "+09:00").replace(/\.\d+/, "");
const isoZ = (sec) => new Date(sec * 1000).toISOString().replace(/\.\d+/, "");

/**
 * 1つの空港の表示。raw は METAR の電文（"METAR RJTT 201500Z ..."）。
 * body は電文の読み解き（風・視程・雲・気温・気圧・天気・飛行区分）。
 */
export function readMetar(raw, meta = {}) {
  const tokens = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  const start = tokens[0] === "METAR" || tokens[0] === "SPECI" ? 1 : 0;
  const body = tokens.slice(start + 1); // 空港コードの後ろ
  const wind = body.map(parseWind).find(Boolean) ?? null;
  const vis = parseVisibility(body.find((t) => t === "CAVOK") ?? body.find((t) => /^\d{4}$/.test(t) || /SM$/.test(t)) ?? "");
  const clouds = body.map(parseCloud).filter(Boolean);
  const wx = body.map(parseWeather).filter(Boolean)[0] ?? null;
  const temp = /^(M?\d{2})\/(M?\d{2})?$/.exec(body.find((t) => /^(M?\d{2})\/M?\d{2}$/.test(t)) ?? "");
  const qnh = /\bQ(\d{3,4})\b/.exec(raw ?? "");
  const num = (s) => (s == null ? null : s.startsWith("M") ? -Number(s.slice(1)) : Number(s));
  const obs = /^(\d{2})(\d{2})(\d{2})Z$/.exec(body[0] ?? "");

  const dir = wind ? dirName(wind.dir) : null;
  const cloudsOut = clouds.map(({ cover, base, code, ja, en }) => ({ cover, base, code, textJa: ja, textEn: en }));
  return {
    raw: clean(raw, 300),
    parts: tokens.map((t) => clean(t, 40)),
    wind: wind ? {
      dir: wind.dir, kt: wind.kt, gust: wind.gust, variable: wind.variable,
      nameJa: wind.variable ? "風向不定" : dir?.ja ?? "", nameEn: wind.variable ? "Variable" : dir?.en ?? "",
      calm: wind.kt === 0,
    } : null,
    vis: vis ? { m: vis.m, over: !!vis.over, textJa: visibilityText(vis).ja, textEn: visibilityText(vis).en } : null,
    clouds: cloudsOut,
    wx: wx ? { code: wx.code, textJa: wx.ja, textEn: wx.en } : null,
    tempC: temp ? num(temp[1]) : null,
    dewpC: temp?.[2] ? num(temp[2]) : null,
    qnh: qnh ? Number(qnh[1]) : null,
    qnhInHg: qnh ? Math.round(Number(qnh[1]) * 0.02953 * 100) / 100 : null, // 小さく併記するため（1021 → 30.15）
    fltCat: meta.fltCat ?? flightCategory(vis?.m ?? null, ceilingOf(cloudsOut)),
    obsDay: obs ? Number(obs[1]) : null,
    obsTime: obs ? `${PAD2(Number(obs[1]))}${PAD2(Number(obs[2]))}Z` : null,
  };
}

/** 空港ごとの表示（一覧の色・詳細）。 */
export function buildEntry(airport, row, tafRow, now = Date.now()) {
  const body = row ? readMetar(row.rawOb, { fltCat: row.fltCat }) : null;
  const obsSec = row?.obsTime ? Number(row.obsTime) : null;
  return {
    icao: airport.icao,
    name: airport.name,
    long: airport.long,
    nameEn: airport.nameEn,
    longEn: airport.longEn,
    lat: row?.lat ?? null,
    lon: row?.lon ?? null,
    at: obsSec ? isoJst(obsSec) : null,
    atZ: obsSec ? isoZ(obsSec) : null,
    fltCat: body?.fltCat ?? null,
    metar: body,
    taf: tafRow ? { raw: clean(tafRow.rawTAF, 600), parts: String(tafRow.rawTAF ?? "").trim().split(/\s+/).map((t) => clean(t, 40)), at: tafRow.issueTime ?? null } : null,
  };
}

/** 同じ空港の報告が複数あるときは、いちばん新しいものだけ残す（位置はどの報告にあっても拾う）。 */
function latestBy(rows, timeKeys) {
  const out = new Map();
  for (const r of rows ?? []) {
    const t = timeKeys.reduce((best, k) => (r[k] && (!best || r[k] > best)) ? r[k] : best, "");
    const prev = out.get(r.icaoId);
    if (!prev || t > prev.t || (t === prev.t && (r.mostRecent ?? 0) > (prev.row.mostRecent ?? 0)))
      out.set(r.icaoId, { t, row: { ...r, lat: r.lat ?? prev?.row.lat ?? null, lon: r.lon ?? prev?.row.lon ?? null } });
  }
  return new Map([...out].map(([k, v]) => [k, v.row]));
}

export function buildMetar(rows = [], tafRows = [], now = Date.now()) {
  const byIcao = latestBy(rows, ["obsTime", "reportTime"]);
  const tafByIcao = latestBy(tafRows, ["issueTime", "bulletinTime"]);
  return {
    version: 1,
    updated: Math.floor(now / 1000),
    source: "NOAA Aviation Weather Center",
    notice: "実際の運航には使わないでください", // アプリにも同じ文を出す（翻訳表のほうを使う）
    airports: AIRPORTS.map((a) => buildEntry(a, byIcao.get(a.icao), tafByIcao.get(a.icao), now)),
  };
}

// ---- 動かす ----

// 空港コードを並べて1回で取る（`hours` は付けない。付けると報告が複数返り、多いときに取りこぼす）。
// METAR と TAF で1回ずつ＝「エンドポイントごとに1分1回まで」に収まる。
const ids = () => AIRPORTS.map((a) => a.icao).join(",");

async function getJson(path) {
  const res = await fetch(`${AWC}/${path}`, { headers: UA });
  if (!res.ok) throw new Error(`AWC ${path.split("?")[0]} ${res.status}`);
  return res.json();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const kvGet = async (env, key) => (await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first())?.value ?? null;
const kvSet = (env, key, value) => env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));

/** 空港ぶんをまとめて取る（METAR と TAF で2回）。 */
export async function fetchMetar(now = Date.now()) {
  const [rows, tafRows] = await Promise.all([
    getJson(`metar?ids=${ids()}&format=json`),
    getJson(`taf?ids=${ids()}&format=json`).catch(() => []), // TAF は取れなくても METAR は出す
  ]);
  return buildMetar(rows, tafRows, now);
}

export async function runMetar(env, { force = false } = {}) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const table = await fetchMetar();
  const { updated, ...body } = table;
  const hash = await sha256(JSON.stringify(body));
  if (!force && hash === await kvGet(env, "metar.hash")) return { ok: true, changed: false };
  await publish(env, { "v1/feed/metar.json": JSON.stringify(table) }, "航空気象を更新");
  await kvSet(env, "metar.hash", hash).run();
  return { ok: true, changed: true, updated, airports: table.airports.length };
}
