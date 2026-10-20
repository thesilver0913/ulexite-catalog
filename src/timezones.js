// 時差の表（v1/timezones.json）。時計アプリの世界時計が読む。
// 都市ごとに「標準時の UTC からのずれ（分）」と「夏時間の決まり」を、Udon で計算できる形で入れる。
// 決まりは「その月の day 日以降で最初の weekday の、現地の標準時で minute 分」で書く。
// 南半球は始まりと終わりが逆になるので、終わりが始まりより前なら「終わりまで」または「始まりから」を夏時間とする。
// 決まりで表せない地域（モロッコのラマダンなど）は、代わりに切り替わる時刻の並び（transitions）を入れる。
// 出す内容は IANA のタイムゾーンデータ（Intl）から計算する。
// 計算が重い（0.7秒ほど）ので Worker ではなく GitHub Actions（scripts/build_timezones.mjs）で作り、
// pages ブランチの v1/timezones.json に置く（Worker の無料プランは CPU が 10ms/回しかない）。

/**
 * 都市の一覧。key は保存に使う名前（変えない）、zone は IANA のタイムゾーン。
 * 時計アプリは「主要都市の一覧から追加・並べ替え」をするので、名前と位置も一緒に配る。
 */
export const CITIES = [
  { key: "Tokyo", name: "東京", nameEn: "Tokyo", zone: "Asia/Tokyo", lat: 35.68, lon: 139.69 },
  { key: "Sapporo", name: "札幌", nameEn: "Sapporo", zone: "Asia/Tokyo", lat: 43.06, lon: 141.35 },
  { key: "Naha", name: "那覇", nameEn: "Naha", zone: "Asia/Tokyo", lat: 26.21, lon: 127.68 },
  { key: "Seoul", name: "ソウル", nameEn: "Seoul", zone: "Asia/Seoul", lat: 37.57, lon: 126.98 },
  { key: "Beijing", name: "北京", nameEn: "Beijing", zone: "Asia/Shanghai", lat: 39.9, lon: 116.41 },
  { key: "Shanghai", name: "上海", nameEn: "Shanghai", zone: "Asia/Shanghai", lat: 31.23, lon: 121.47 },
  { key: "HongKong", name: "香港", nameEn: "Hong Kong", zone: "Asia/Hong_Kong", lat: 22.32, lon: 114.17 },
  { key: "Taipei", name: "台北", nameEn: "Taipei", zone: "Asia/Taipei", lat: 25.03, lon: 121.57 },
  { key: "Manila", name: "マニラ", nameEn: "Manila", zone: "Asia/Manila", lat: 14.6, lon: 120.98 },
  { key: "Singapore", name: "シンガポール", nameEn: "Singapore", zone: "Asia/Singapore", lat: 1.35, lon: 103.82 },
  { key: "Bangkok", name: "バンコク", nameEn: "Bangkok", zone: "Asia/Bangkok", lat: 13.76, lon: 100.5 },
  { key: "Jakarta", name: "ジャカルタ", nameEn: "Jakarta", zone: "Asia/Jakarta", lat: -6.21, lon: 106.85 },
  { key: "Delhi", name: "デリー", nameEn: "Delhi", zone: "Asia/Kolkata", lat: 28.61, lon: 77.21 },
  { key: "Mumbai", name: "ムンバイ", nameEn: "Mumbai", zone: "Asia/Kolkata", lat: 19.08, lon: 72.88 },
  { key: "Dubai", name: "ドバイ", nameEn: "Dubai", zone: "Asia/Dubai", lat: 25.2, lon: 55.27 },
  { key: "Moscow", name: "モスクワ", nameEn: "Moscow", zone: "Europe/Moscow", lat: 55.76, lon: 37.62 },
  { key: "Istanbul", name: "イスタンブール", nameEn: "Istanbul", zone: "Europe/Istanbul", lat: 41.01, lon: 28.98 },
  { key: "Cairo", name: "カイロ", nameEn: "Cairo", zone: "Africa/Cairo", lat: 30.04, lon: 31.24 },
  { key: "Athens", name: "アテネ", nameEn: "Athens", zone: "Europe/Athens", lat: 37.98, lon: 23.73 },
  { key: "Berlin", name: "ベルリン", nameEn: "Berlin", zone: "Europe/Berlin", lat: 52.52, lon: 13.4 },
  { key: "Paris", name: "パリ", nameEn: "Paris", zone: "Europe/Paris", lat: 48.86, lon: 2.35 },
  { key: "London", name: "ロンドン", nameEn: "London", zone: "Europe/London", lat: 51.51, lon: -0.13 },
  { key: "Lisbon", name: "リスボン", nameEn: "Lisbon", zone: "Europe/Lisbon", lat: 38.72, lon: -9.14 },
  { key: "Reykjavik", name: "レイキャビク", nameEn: "Reykjavik", zone: "Atlantic/Reykjavik", lat: 64.15, lon: -21.94 },
  { key: "Lagos", name: "ラゴス", nameEn: "Lagos", zone: "Africa/Lagos", lat: 6.52, lon: 3.38 },
  { key: "Johannesburg", name: "ヨハネスブルグ", nameEn: "Johannesburg", zone: "Africa/Johannesburg", lat: -26.2, lon: 28.05 },
  { key: "SaoPaulo", name: "サンパウロ", nameEn: "São Paulo", zone: "America/Sao_Paulo", lat: -23.55, lon: -46.63 },
  { key: "Rio", name: "リオデジャネイロ", nameEn: "Rio de Janeiro", zone: "America/Sao_Paulo", lat: -22.91, lon: -43.17 },
  { key: "BuenosAires", name: "ブエノスアイレス", nameEn: "Buenos Aires", zone: "America/Argentina/Buenos_Aires", lat: -34.6, lon: -58.38 },
  { key: "Santiago", name: "サンティアゴ", nameEn: "Santiago", zone: "America/Santiago", lat: -33.45, lon: -70.67 },
  { key: "MexicoCity", name: "メキシコシティ", nameEn: "Mexico City", zone: "America/Mexico_City", lat: 19.43, lon: -99.13 },
  { key: "Chicago", name: "シカゴ", nameEn: "Chicago", zone: "America/Chicago", lat: 41.88, lon: -87.63 },
  { key: "NewYork", name: "ニューヨーク", nameEn: "New York", zone: "America/New_York", lat: 40.71, lon: -74.01 },
  { key: "Toronto", name: "トロント", nameEn: "Toronto", zone: "America/Toronto", lat: 43.65, lon: -79.38 },
  { key: "LosAngeles", name: "ロサンゼルス", nameEn: "Los Angeles", zone: "America/Los_Angeles", lat: 34.05, lon: -118.24 },
  { key: "Vancouver", name: "バンクーバー", nameEn: "Vancouver", zone: "America/Vancouver", lat: 49.28, lon: -123.12 },
  { key: "Honolulu", name: "ホノルル", nameEn: "Honolulu", zone: "Pacific/Honolulu", lat: 21.31, lon: -157.86 },
  { key: "Sydney", name: "シドニー", nameEn: "Sydney", zone: "Australia/Sydney", lat: -33.87, lon: 151.21 },
  { key: "Melbourne", name: "メルボルン", nameEn: "Melbourne", zone: "Australia/Melbourne", lat: -37.81, lon: 144.96 },
  { key: "Auckland", name: "オークランド", nameEn: "Auckland", zone: "Pacific/Auckland", lat: -36.85, lon: 174.76 },
];

const MINUTE = 60e3;
const DAY = 86400e3;
const formatters = new Map();

function formatter(tz) {
  if (!formatters.has(tz))
    formatters.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  return formatters.get(tz);
}

/** その時刻の UTC からのずれ（分）。夏時間も含む。 */
export function offsetMinutes(tz, utcMs) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((local - Math.floor(utcMs / 1000) * 1000) / MINUTE);
}

/** fromMs〜toMs の間の、時差の切り替わり（1日ずつ見て、変わった日を1分まで詰める）。 */
export function findTransitions(tz, fromMs, toMs) {
  const out = [];
  let prev = offsetMinutes(tz, fromMs);
  for (let u = fromMs + DAY; u <= toMs; u += DAY) {
    const o = offsetMinutes(tz, u);
    if (o === prev) continue;
    let lo = u - DAY, hi = u;
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / MINUTE / 2) * MINUTE;
      if (offsetMinutes(tz, mid) === prev) lo = mid;
      else hi = mid;
    }
    out.push({ at: hi, from: prev, to: o });
    prev = o;
  }
  return out;
}

/** その月の、day 日以降で最初の weekday の 0 時（現地の標準時を UTC のつもりで扱う。weekday は 0=日曜）。 */
export function weekdayOnOrAfter(year, month, day, weekday) {
  const from = Date.UTC(year, month - 1, day);
  return from + ((weekday - new Date(from).getUTCDay() + 7) % 7) * DAY;
}

/**
 * 切り替わりの時刻（現地の標準時）→「何月の、何日以降で最初の何曜日の、何分」。
 * 第n 曜日も「最後の」も、この形（day 以降で最初）で表せる。
 */
function rulePart(at, std) {
  const local = new Date(at + std * MINUTE);
  return {
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

const samePart = (a, b) => a && b && a.month === b.month && a.day === b.day && a.weekday === b.weekday && a.minute === b.minute;

/** その年の夏時間の始まり・終わり（現地の標準時のつもりのミリ秒）。 */
function ruleInstants(rule, year) {
  const at = (p) => weekdayOnOrAfter(year, p.month, p.day, p.weekday) + p.minute * MINUTE;
  return { start: at(rule.start), end: at(rule.end) };
}

/** 決まりから見て、その時刻が夏時間か。決まりがなければ false。 */
export function isDst(rule, std, utcMs) {
  if (!rule) return false;
  const localStd = utcMs + std * MINUTE;
  const { start, end } = ruleInstants(rule, new Date(localStd).getUTCFullYear());
  return end > start ? localStd >= start && localStd < end : localStd >= start || localStd < end;
}

/**
 * 切り替わりの並びから決まりを作る。決まりで表せない（毎年同じでない）ときは null。
 * 「day 以降で最初の weekday」の day は、年ごとのずれを吸収できるいちばん遅い日にする
 * （例：3月の最後の日曜＝3月25日以降で最初の日曜、9月2日以降で最初の日曜＝チリ）。
 * 作った決まりが実際の切り替わりと合うかも、その場で確かめる。
 */
export function deriveRule(tz, ts, std) {
  if (!ts.length) return null;
  const starts = ts.filter((t) => t.to > t.from);
  const ends = ts.filter((t) => t.to < t.from);
  if (!starts.length || !ends.length) return null;
  if (Math.abs(starts.length - ends.length) > 1) return null;

  const save = starts[0].to - std;
  if (save <= 0) return null;
  const tighten = (list) => {
    const parts = list.map((t) => rulePart(t.at, std));
    if (!parts.every((p) => p.month === parts[0].month && p.weekday === parts[0].weekday && p.minute === parts[0].minute))
      return null;
    const day = Math.min(...parts.map((p) => p.day)); // 年ごとの「何日以降」のうち、いちばん遅い日
    return { month: parts[0].month, day, weekday: parts[0].weekday, minute: parts[0].minute };
  };
  const start = tighten(starts), end = tighten(ends);
  if (!start || !end) return null;
  const rule = { save, start, end };

  // 実際の切り替わりと合うか（年をまたぐ南半球も、そのまま確かめられる）
  for (const t of ts) {
    const before = offsetMinutes(tz, t.at - MINUTE);
    const after = offsetMinutes(tz, t.at);
    if (before === after) return null;
    const wantBefore = isDst(rule, std, t.at - MINUTE) ? std + save : std;
    const wantAfter = isDst(rule, std, t.at) ? std + save : std;
    if (wantBefore !== before || wantAfter !== after) return null;
  }
  // 切り替わりの前後だけでなく、期間中を10日おきにも確かめる
  // （切り替わりを取りこぼしていても、決まりが実データと食い違えば決まりにしない）
  const from = ts[0].at - 30 * DAY, to = ts[ts.length - 1].at + 30 * DAY;
  for (let u = from; u < to; u += 10 * DAY)
    if ((isDst(rule, std, u) ? std + save : std) !== offsetMinutes(tz, u)) return null;
  return rule;
}

/**
 * 1つのタイムゾーンの表。**これから先**（いま〜11年後）の切り替わりを見て、決まりか、切り替わりの並びにする。
 * 夏時間をやめた（ずっと夏時間になった）地域は、切り替わりがなくなるので、いまの時差をそのまま標準時にする。
 * 例：ブリティッシュコロンビアは 2026-03-09 から永久 -07（tzdata 2026b。時差そのものは 2026-11-01 から変わらない）。
 */
export function zoneTable(tz, now = Date.now()) {
  const ts = findTransitions(tz, now, now + 11 * 365.25 * DAY);
  const current = offsetMinutes(tz, now);
  if (!ts.length) return { offset: current }; // これから先は変わらない＝いまの時差が標準時（永久に夏時間の地域もここ）
  const std = Math.min(...ts.flatMap((t) => [t.from, t.to]));
  const rule = deriveRule(tz, ts, std);
  if (rule) return { offset: std, dst: rule };
  // 決まりで表せない地域：そのまま切り替わりの時刻と時差を並べる（毎日作り直すので、先の分も入っている）
  const transitions = [[Math.floor(now / 1000), current]];
  for (const t of ts) transitions.push([t.at / 1000, t.to]);
  return { offset: std, transitions };
}

export function buildTimezones(now = Date.now()) {
  const zones = {};
  for (const city of CITIES) if (!zones[city.zone]) zones[city.zone] = zoneTable(city.zone, now);
  return {
    version: 1,
    updated: Math.floor(now / 1000),
    source: "IANA タイムゾーンデータ（Intl から計算）",
    zones,      // IANA の名前 → { offset, dst?{save,start,end}, transitions? }
    cities: CITIES, // 主要都市（key・名前・タイムゾーン・緯度経度）
  };
}

