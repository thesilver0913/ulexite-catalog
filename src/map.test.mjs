// node src/map.test.mjs で確認する（気象庁には繋がない）
import assert from "node:assert/strict";
import { amedasPoints, quakePoints, buildWeatherMap, AMEDAS_GRID, MAX_QUAKE_POINTS } from "./map.js";
import { jobsAt } from "./index.js";

// アメダス：品質が正常な気温だけ、格子に1つ、緯度・経度は3桁まで、観測所のコード順で決まる
const table = {
  "11001": { lat: [45, 31.2], lon: [141, 56.1] },   // 宗谷岬（45.52, 141.935）
  "11002": { lat: [45, 30.0], lon: [141, 57.0] },   // 同じ格子の隣
  "13101": { lat: [35, 41.5], lon: [139, 45.0] },   // 東京（35.6917, 139.75）
  "13102": { lat: [35, 41.2], lon: [139, 44.2] },   // 同じ格子
  "40001": { lat: [33, 36.0], lon: [130, 25.0] },   // 気温の品質が不良
  "40002": { lat: [33, 36.0], lon: [130, 25.0] },   // 気温なし
};
const obs = {
  "11001": { temp: [9.8, 0] },
  "11002": { temp: [9.5, 0] }, // 11001 と同じ格子なので出ない
  "13101": { temp: [18.4, 0] },
  "13102": { temp: [18.6, 0] },
  "40001": { temp: [21.5, 1] }, // 品質 1 は使わない
  "40002": {},
};
assert.deepEqual(amedasPoints(table, obs), [
  { lat: 45.52, lon: 141.935, t: 9.8 },
  { lat: 35.692, lon: 139.75, t: 18.4 },
]);
assert.equal(AMEDAS_GRID, 0.5);

// 震度の観測点：震度の大きい順、位置のない観測点は出さない、気象庁の表記（5弱）、上限まで
const detail = {
  Body: { Intensity: { Observation: { Pref: [{
    Area: [{
      City: [
        { IntensityStation: [
          { Name: "a", Int: "3", latlon: { lat: 35.69, lon: 139.69 } },
          { Name: "b", Int: "5-", latlon: { lat: 35.65, lon: 140.05 } },
          { Name: "c", Int: "4", latlon: { lat: 36.08, lon: 140.11 } },
          { Name: "d", Int: "1" }, // 位置なし
        ] },
        { IntensityStation: [{ Name: "e", Int: "3", latlon: { lat: 35.7, lon: 139.7 } }] },
      ],
    }],
  }] } } },
};
assert.deepEqual(quakePoints(detail), [
  { lat: 35.65, lon: 140.05, int: "5弱" },
  { lat: 36.08, lon: 140.11, int: "4" },
  { lat: 35.69, lon: 139.69, int: "3" },
  { lat: 35.7, lon: 139.7, int: "3" },
]);
// 上限まで（震度の観測点が多くても、地図に並べられる数で切る）
const station = (i) => ({ Int: "2", latlon: { lat: 30 + i / 1000, lon: 130 } });
const many = {
  Body: { Intensity: { Observation: { Pref: [{ Area: [{ City: [
    { IntensityStation: Array.from({ length: MAX_QUAKE_POINTS + 50 }, (_, i) => station(i)) },
  ] }] }] } } },
};
assert.equal(quakePoints(many).length, MAX_QUAKE_POINTS);
assert.deepEqual(quakePoints(null), []);

// 地図の feed：地震がないときは空、あるときは震源と観測点
const empty = buildWeatherMap({ amedasAt: "2026-10-20T22:50:00+09:00", amedas: [{ lat: 35.692, lon: 139.75, t: 18.4 }] }, 1760000000000);
assert.equal(empty.version, 1);
assert.equal(empty.updated, 1760000000);
assert.equal(empty.rainAt, null, "雨雲の画像はまだ作っていない");
assert.equal(empty.amedasAt, "2026-10-20T22:50:00+09:00");
assert.deepEqual(empty.quakePoints, []);
assert.equal(empty.quakeEpi, null);

const withQuake = buildWeatherMap({
  amedas: [], quake: {
    entry: { at: "2026-10-19T10:00:00+09:00", anm: "千葉県北西部", maxi: "5-", cod: "+35.7+140.1-40000/" },
    detail,
  },
}, 1760000000000);
assert.deepEqual(withQuake.quakeEpi, { lat: 35.7, lon: 140.1, max: "5弱", place: "千葉県北西部", at: "2026-10-19T10:00:00+09:00" });
assert.equal(withQuake.quakePoints.length, 4);

// 動かす分：天気の地図は20分おき（毎時 5・25・45分）に足す。ほかの仕事の分は変えない
const at = (m) => jobsAt(new Date(Date.UTC(2026, 9, 20, 12, m)));
for (const m of [5, 25, 45]) assert.equal(at(m).length, 2, `${m}分は common＋map`);
for (const m of [1, 4, 6, 20, 30]) assert.equal(at(m).length, 1, `${m}分は common だけ`);
for (const m of [15, 16, 17, 18, 19]) assert.equal(at(m).length, 2, `${m}分は common＋天気`);
assert.equal(at(0).length, 1);
assert.equal(jobsAt(new Date(Date.UTC(2026, 9, 20, 3, 0))).length, 1, "12時（日本時間）は動画だけ");
console.log("ok");
