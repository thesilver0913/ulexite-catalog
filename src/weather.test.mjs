// node src/weather.test.mjs で確認する（気象庁には繋がない）
import assert from "node:assert/strict";
import { buildDays, buildSun, buildMoon, moonPhases, dayPhase, buildArea, wxTextEn } from "./weather.js";
import { jobsAt } from "./index.js";

const now = Date.parse("2026-10-20T21:00:00+09:00");

// 天気の文の英訳（気象庁の文の語を1つずつ訳して組み立てる。実際の文で確かめる）
assert.equal(wxTextEn("くもり"), "Cloudy");
assert.equal(wxTextEn("晴れ　朝晩　くもり"), "Sunny, cloudy in the morning and evening");
assert.equal(wxTextEn("くもり　所により　夜　雨"), "Cloudy, in places rain at night");
assert.equal(wxTextEn("くもり　夕方　から　雨"), "Cloudy, rain from the evening");
assert.equal(wxTextEn("雨　時々　くもり"), "Rain, occasionally cloudy");
assert.equal(wxTextEn("雨　所により　雷を伴い　激しく　降る"), "Rain, in places, with thunder, heavily");
assert.equal(wxTextEn(""), "");

// 東京（2026-10-20）：国立天文台の暦で日の出 5:51・日の入り 17:03 前後
const sun = buildSun(now, 35.6917, 139.75);
assert.match(sun.rise, /^05:(4[89]|5[0-4])$/, sun.rise);
assert.match(sun.set, /^17:0[0-6]$/, sun.set);

// 2026年10月の満月は 26日（日本時間 13時ころ）
const phases = moonPhases(now);
assert.equal(phases.nextFull, "2026-10-26");
assert.equal(phases.days.length, 8);
assert.equal(phases.days[0].date, "2026-10-20");
assert.equal(dayPhase("2026-10-26"), 4, "満月の日だけ満月");
assert.equal(dayPhase("2026-10-25"), 3);
assert.equal(dayPhase("2026-10-27"), 5);
assert.equal(phases.days.filter((d) => d.phase === 4).length, 1);
const moon = buildMoon(now, 35.6917, 139.75, phases);
assert.ok(moon.rise === null || /^\d\d:\d\d$/.test(moon.rise));
assert.ok(moon.age > 7 && moon.age < 11, String(moon.age)); // 10/18 が上弦のころ

// 週間予報を基本に、今日・明日は短期予報で埋める
const forecast = [
  { reportDatetime: "2026-10-20T17:00:00+09:00", timeSeries: [
    { timeDefines: ["2026-10-20T17:00:00+09:00", "2026-10-21T00:00:00+09:00"],
      areas: [{ weatherCodes: ["200", "201"], weathers: ["くもり　所により　夜　雨", "くもり　時々　晴れ"] }] },
    { timeDefines: ["2026-10-20T18:00:00+09:00", "2026-10-21T00:00:00+09:00", "2026-10-21T06:00:00+09:00"],
      areas: [{ pops: ["20", "10", "30"] }] },
    { timeDefines: ["2026-10-21T00:00:00+09:00", "2026-10-21T09:00:00+09:00"], areas: [{ area: { code: "44132" }, temps: ["20", "29"] }] },
  ] },
  { timeSeries: [
    { timeDefines: ["2026-10-21T00:00:00+09:00", "2026-10-22T00:00:00+09:00"], areas: [{ weatherCodes: ["201", "302"], pops: ["", "60"] }] },
    { timeDefines: ["2026-10-21T00:00:00+09:00", "2026-10-22T00:00:00+09:00"], areas: [{ area: { code: "44132" }, tempsMin: ["", "17"], tempsMax: ["", "24"] }] },
  ] },
];
const days = buildDays(forecast, now, null, "44132");
assert.deepEqual(days.map((d) => d.date), ["2026-10-20", "2026-10-21", "2026-10-22"]);
assert.deepEqual(days[0], { date: "2026-10-20", wx: "200", wxCode: "200", max: null, min: null, pop: 20 });
assert.deepEqual(days[1], { date: "2026-10-21", wx: "200", wxCode: "201", max: 29, min: 20, pop: 30 }, "週間にない値は短期から");
assert.deepEqual(days[2], { date: "2026-10-22", wx: "300", wxCode: "302", max: 24, min: 17, pop: 60 });

const area = buildArea(forecast, { code: "44132", name: "東京", nameEn: "Tokyo", lat: 35.6917, lon: 139.75 },
  { "44132": { temp: [21.7, 0] } }, "2026-10-20T21:40:00+09:00", now, phases);
assert.equal(area.version, 1);
assert.equal(area.updatedAt, "2026-10-20T17:00:00+09:00");
assert.deepEqual(area.current, { temp: 21.7, at: "2026-10-20T21:40:00+09:00", wx: "200", wxCode: "200", wxText: "くもり 所により 夜 雨", wxTextEn: "Cloudy, in places rain at night" });
assert.equal(buildArea(forecast, { code: "1", lat: 35, lon: 139 }, { "1": { temp: [9, 5] } }, "", now, phases).current.temp, null, "品質が悪い値は出さない");

// 気温はその地点のものだけ（ほかの地点の週間の気温は使わない）
assert.equal(buildDays(forecast, now, null, "99999")[2].max, null);

// どの分に何をするか
const at = (iso) => jobsAt(new Date(iso)).length;
assert.equal(at("2026-10-20T03:00:00Z"), 1, "動画の分は動画だけ");
assert.equal(at("2026-10-20T03:01:00Z"), 1);
assert.equal(at("2026-10-20T03:15:00Z"), 2, "共通の feed＋天気の1組目");
assert.equal(at("2026-10-20T03:19:00Z"), 4, "共通の feed＋天気の書き出し＋ラジオ（読む・書き出す）");
assert.equal(at("2026-10-20T03:20:00Z"), 1);
console.log("ok");
