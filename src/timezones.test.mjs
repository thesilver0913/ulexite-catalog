// node src/timezones.test.mjs で確認する（ネットワークには繋がない。Intl のタイムゾーンを使う）
import assert from "node:assert/strict";
import { CITIES, offsetMinutes, weekdayOnOrAfter, isDst, deriveRule, findTransitions, zoneTable, buildTimezones } from "./timezones.js";

// 時差（分）
assert.equal(offsetMinutes("Asia/Tokyo", Date.UTC(2026, 0, 15)), 540);
assert.equal(offsetMinutes("Asia/Kolkata", Date.UTC(2026, 0, 15)), 330);
assert.equal(offsetMinutes("Europe/London", Date.UTC(2026, 0, 15)), 0, "冬は標準時");
assert.equal(offsetMinutes("Europe/London", Date.UTC(2026, 6, 15)), 60, "夏は夏時間");

// 「day 日以降で最初の weekday」（0=日曜）
assert.equal(new Date(weekdayOnOrAfter(2026, 3, 25, 0)).toISOString(), "2026-03-29T00:00:00.000Z", "3月25日以降で最初の日曜＝3月最後の日曜");
assert.equal(new Date(weekdayOnOrAfter(2026, 3, 8, 0)).toISOString(), "2026-03-08T00:00:00.000Z", "3月8日以降で最初の日曜＝第2日曜");
assert.equal(new Date(weekdayOnOrAfter(2026, 11, 2, 0)).toISOString(), "2026-11-08T00:00:00.000Z", "11月2日以降で最初の日曜");

// 決まりの形（いまの気象庁ではなく IANA のデータから。2026年の見込み）
const london = zoneTable("Europe/London", Date.UTC(2026, 6, 1));
assert.equal(london.offset, 0);
assert.deepEqual(london.dst.start, { month: 3, day: 25, weekday: 0, minute: 60 }, "3月最後の日曜 1:00（標準時）");
assert.deepEqual(london.dst.end, { month: 10, day: 25, weekday: 0, minute: 60 });
const ny = zoneTable("America/New_York", Date.UTC(2026, 6, 1));
assert.equal(ny.offset, -300);
assert.deepEqual(ny.dst.start, { month: 3, day: 8, weekday: 0, minute: 120 }, "3月の第2日曜 2:00");
assert.deepEqual(ny.dst.end, { month: 11, day: 1, weekday: 0, minute: 60 }, "11月の第1日曜 2:00（夏時間）＝1:00（標準時）");
const sydney = zoneTable("Australia/Sydney", Date.UTC(2026, 6, 1));
assert.equal(sydney.offset, 600);
assert.deepEqual(sydney.dst.start, { month: 10, day: 1, weekday: 0, minute: 120 });
assert.deepEqual(sydney.dst.end, { month: 4, day: 1, weekday: 0, minute: 120 });
assert.deepEqual(zoneTable("Asia/Tokyo", Date.UTC(2026, 6, 1)), { offset: 540 }, "夏時間のない地域は offset だけ");

// ブリティッシュコロンビアは 2026-03-09 から永久 -07（tzdata 2026b）。時差そのものは 2026-11-01 から
// 変わらない（夏時間のまま -420 → 標準時 -420）ので、切り替わりは見えず、決まりにはならない。
// 10/21 の時点で「これから先の切り替わりなし」＝いまの時差 -420 が標準時。
assert.deepEqual(zoneTable("America/Vancouver", Date.UTC(2026, 9, 21)), { offset: -420 }, "夏時間をやめた地域は、いまの時差だけ");
assert.equal(offsetMinutes("America/Vancouver", Date.UTC(2027, 0, 15)), -420, "2027年1月も -420（-480 ではない）");
assert.equal(offsetMinutes("America/Vancouver", Date.UTC(2030, 0, 15)), -420, "2030年も -420");
assert.equal(isDst(null, -420, Date.UTC(2027, 0, 15)), false, "決まりがなければ夏時間ではない");

// 決まりから出した夏時間が、実際の時差と1年ぶん合うか（3日おきに見る）
for (const tz of ["Europe/London", "America/New_York", "Australia/Sydney", "America/Santiago", "Africa/Cairo"]) {
  const t = zoneTable(tz, Date.UTC(2026, 6, 1));
  assert.ok(t.dst, `${tz} は決まりになる`);
  for (let u = Date.UTC(2026, 0, 1); u < Date.UTC(2028, 0, 1); u += 3 * 86400e3)
    assert.equal(isDst(t.dst, t.offset, u) ? t.offset + t.dst.save : t.offset, offsetMinutes(tz, u), `${tz} ${new Date(u).toISOString()}`);
}

// 決まりは、期間中を10日おきに確かめている（切り替わりの取りこぼしで、実データと違う決まりを出さない）
const nyRule = zoneTable("America/New_York", Date.UTC(2026, 6, 1)).dst;
for (let u = Date.UTC(2027, 0, 1); u < Date.UTC(2031, 0, 1); u += 7 * 86400e3)
  assert.equal(isDst(nyRule, -300, u) ? -240 : -300, offsetMinutes("America/New_York", u), `NY ${new Date(u).toISOString()}`);

// 決まりで表せない並びは null（毎年ちがう）
assert.equal(deriveRule("Asia/Tokyo", [], 540), null);
assert.equal(deriveRule("Asia/Tokyo", findTransitions("Asia/Tokyo", Date.UTC(2025, 0, 1), Date.UTC(2027, 0, 1)), 540), null);

// 表：都市は重複なし、タイムゾーンはまとめる、どの都市も zones にある
const table = buildTimezones(Date.UTC(2026, 6, 1));
const keys = new Set(CITIES.map((c) => c.key));
assert.equal(keys.size, CITIES.length, "key が重ならない");
assert.ok(Object.keys(table.zones).length < CITIES.length, "同じタイムゾーンの都市は1つにまとめる");
for (const c of table.cities) assert.ok(table.zones[c.zone], `${c.key} の ${c.zone} が zones にある`);
for (const c of table.cities) {
  assert.ok(c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180, `${c.key} の緯度経度`);
  assert.ok(c.name && c.nameEn && c.key, `${c.key} の名前`);
}
assert.equal(table.version, 1);
assert.equal(table.updated, Math.floor(Date.UTC(2026, 6, 1) / 1000));
assert.ok(JSON.stringify(table).length < 20000, "20KB 未満");
assert.equal(table.zones["America/New_York"].dst.save, 60);
console.log("ok");
