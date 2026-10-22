// node src/metar.test.mjs で確認する（Aviation Weather Center には繋がない）
import assert from "node:assert/strict";
import {
  AIRPORTS, dirName, parseWind, parseVisibility, visibilityText, parseWeather, parseCloud,
  ceilingOf, flightCategory, readMetar, buildMetar, markGroups,
} from "./metar.js";

// 風向の16方位
assert.deepEqual(dirName(340), { ja: "北北西", en: "NNW" });
assert.deepEqual(dirName(0), { ja: "北", en: "N" });
assert.deepEqual(dirName(359), { ja: "北", en: "N" }, "360度は北に戻る");
assert.equal(dirName(null), null);

// 風の電文
assert.deepEqual(parseWind("34008KT"), { dir: 340, kt: 8, gust: null, variable: false });
assert.deepEqual(parseWind("VRB03KT"), { dir: null, kt: 3, gust: null, variable: true });
assert.deepEqual(parseWind("34008G18KT"), { dir: 340, kt: 8, gust: 18, variable: false });
assert.equal(parseWind("NIL"), null);

// 視程（日本のメートル4桁。9999 と CAVOK は10km以上）
assert.deepEqual(parseVisibility("9999"), { m: 10000, over: true });
assert.deepEqual(parseVisibility("CAVOK"), { m: 10000, over: true });
assert.deepEqual(parseVisibility("1200"), { m: 1200, over: false });
assert.deepEqual(parseVisibility("0800"), { m: 800, over: false });
assert.equal(parseVisibility(""), null);
assert.equal(parseVisibility("1 1/2SM").m, Math.round(1.5 * 1609), "米国のマイル表記も読む");
assert.deepEqual(visibilityText({ m: 10000, over: true }), { ja: "10km以上", en: "10 km or more" });
assert.equal(visibilityText({ m: 8000 }).ja, "8km");
assert.equal(visibilityText({ m: 1200 }).ja, "1.2km");
assert.equal(visibilityText({ m: 800 }).ja, "800m");
assert.equal(visibilityText(null).ja, "—");

// 天気
assert.deepEqual(parseWeather("-RA"), { code: "-RA", ja: "弱い雨", en: "Light rain" });
assert.deepEqual(parseWeather("RA").ja, "雨");
assert.deepEqual(parseWeather("SHRA"), { code: "SHRA", ja: "にわか雨", en: "Rain showers" });
assert.deepEqual(parseWeather("TSRA").ja, "雷雨");
assert.equal(parseWeather("TSRA").en, "Thunderstorm with rain");
assert.equal(parseWeather("+SN").ja, "強い雪");
assert.equal(parseWeather("BR").ja, "もや");
assert.equal(parseWeather("NSW").ja, "現象なし");
assert.equal(parseWeather("//"), null);
assert.equal(parseWeather("XYZ"), null);

// 雲（高さは 100ft 単位）
assert.deepEqual(parseCloud("FEW030"), { cover: "FEW", base: 3000, code: "FEW030", ja: "少し 3,000ft", en: "Few 3,000 ft" });
assert.deepEqual(parseCloud("VV002"), { cover: "VV", base: 200, code: "VV002", ja: "垂直視程 200ft", en: "Vertical visibility 200 ft" });
assert.equal(parseCloud("NSC").base, null);
assert.equal(parseCloud("BKN016CB").base, 1600);
assert.equal(parseCloud("XYZ"), null);
assert.equal(ceilingOf([parseCloud("FEW010"), parseCloud("BKN008"), parseCloud("OVC015")]), 800, "天井はいちばん低い BKN・OVC");
assert.equal(ceilingOf([parseCloud("FEW010")]), null, "BKN・OVC がなければ天井なし");

// 飛行区分
assert.equal(flightCategory(800, null), "LIFR", "視程 1マイル未満");
assert.equal(flightCategory(5000, 3000), "MVFR", "視程 3マイル以上・天井 3,000ft");
assert.equal(flightCategory(5000, 800), "IFR", "天井 1,000ft 未満");
assert.equal(flightCategory(10000, 5000), "VFR");

// 電文の読み解き（設計の見本と同じ形：羽田）
const t = readMetar("METAR RJTT 201500Z 34008KT 9999 FEW030 18/09 Q1021 NOSIG");
assert.equal(t.marked, "METAR RJTT [201500Z] [34008KT] [9999] [FEW030] [18/09] [Q1021] NOSIG", "見本のように [ ] で区切る");
assert.deepEqual(t.wind, { dir: 340, kt: 8, gust: null, variable: false, nameJa: "北北西", nameEn: "NNW", calm: false });
assert.equal(t.vis.textJa, "10km以上");
assert.equal(t.clouds[0].textJa, "少し 3,000ft");
assert.equal(t.clouds[0].code, "FEW030");
assert.equal(t.wx, null);
assert.equal(t.tempC, 18);
assert.equal(t.dewpC, 9);
assert.equal(t.qnh, 1021);
assert.equal(t.qnhInHg, 30.15, "inHg（小さく併記する）");
assert.equal(t.fltCat, "VFR", "暖かく視程も天井もよいので VFR");
assert.equal(t.obsTime, "2015Z");

// 雨・霧・風向不定も読む
const rain = readMetar("METAR RJTT 201500Z 34008G18KT 360V070 1200 -SHRA BR BKN008 OVC015 18/17 Q1008");
assert.equal(rain.wind.gust, 18);
assert.equal(rain.vis.textJa, "1.2km");
assert.equal(rain.wx.textJa, "弱いにわか雨");
assert.equal(rain.fltCat, "LIFR", "天井 800ft で IFR、視程 1.2km（0.75マイル）で LIFR");
assert.equal(rain.obsTime, "2015Z");
const fog = readMetar("METAR RJAA 201500Z VRB02KT 0800 FG VV002 12/12 Q1005");
assert.equal(fog.wind.variable, true);
assert.equal(fog.wind.nameJa, "風向不定");
assert.equal(fog.vis.textJa, "800m");
assert.equal(fog.clouds[0].cover, "VV");
assert.equal(fog.wx.textJa, "霧");
assert.equal(fog.tempC, 12);
assert.equal(fog.dewpC, 12);
const cavok = readMetar("METAR RJBB 201500Z 20015KT CAVOK 25/12 Q1015");
assert.equal(cavok.vis.textJa, "10km以上");
assert.deepEqual(cavok.clouds, []);
assert.equal(cavok.fltCat, "VFR");

// 表：空港は重複なし、観測がなければ metar は null、いちばん新しい報告を使う
const icaos = AIRPORTS.map((a) => a.icao);
assert.equal(new Set(icaos).size, icaos.length, "ICAO が重ならない");
assert.ok(icaos.includes("RJTT") && icaos.includes("ROAH"), "既定の空港が入っている");
for (const a of AIRPORTS) assert.ok(a.name && a.long && a.nameEn && a.longEn, `${a.icao} の名前`);

const rows = [
  { icaoId: "RJTT", obsTime: 1792506600, rawOb: "METAR RJTT 201330Z 03005KT 9999 FEW020 22/20 Q1017", fltCat: "VFR", lat: 35.55, lon: 139.78 },
  { icaoId: "RJTT", obsTime: 1792508400, rawOb: "METAR RJTT 201500Z 34008KT 9999 FEW030 18/09 Q1021", fltCat: "VFR" },
];
const table = buildMetar(rows, [], Date.UTC(2026, 9, 20, 15, 10));
assert.equal(table.version, 1);
assert.equal(table.updated, Math.floor(Date.UTC(2026, 9, 20, 15, 10) / 1000));
assert.equal(table.source, "NOAA Aviation Weather Center");
const rjtt = table.airports.find((a) => a.icao === "RJTT");
assert.equal(rjtt.metar.raw, "METAR RJTT 201500Z 34008KT 9999 FEW030 18/09 Q1021", "いちばん新しい報告");
assert.equal(rjtt.at, "2026-10-21T00:00:00+09:00");
assert.equal(rjtt.atZ, "2026-10-20T15:00:00Z");
assert.equal(rjtt.lat, 35.55, "位置は報告から");
assert.equal(table.airports.find((a) => a.icao === "RJAA").metar, null, "報告がなければ null");
assert.ok(JSON.stringify(buildMetar(rows, [])).length < 100000, "100KB 未満");

// TAF は電文と発行時刻だけ持つ
const withTaf = buildMetar([], [{ icaoId: "RJTT", rawTAF: "TAF RJTT 201105Z 2012/2118 30006KT 9999 FEW020", issueTime: "2026-10-20T11:05:00.000Z" }]);
assert.equal(withTaf.airports[0].taf.raw, "TAF RJTT 201105Z 2012/2118 30006KT 9999 FEW020");
assert.equal(withTaf.airports[0].taf.marked, "TAF RJTT [201105Z] [2012/2118] [30006KT] [9999] [FEW020]");
// BECMG などの変わり目の言葉は [ ] で囲まない（設計の見本と同じ）
assert.equal(
  markGroups("TAF RJTT 181100Z 1812/1918 34010KT 9999 FEW030 BECMG 1900/1903 18006KT".split(" ")),
  "TAF RJTT [181100Z] [1812/1918] [34010KT] [9999] [FEW030] BECMG [1900/1903] [18006KT]",
);
assert.equal(withTaf.airports[0].taf.at, "2026-10-20T11:05:00.000Z");
console.log("ok");
