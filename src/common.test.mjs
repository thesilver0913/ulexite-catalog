// node src/common.test.mjs で確認する（気象庁には繋がない）
import assert from "node:assert/strict";
import { intText, parseCoord, latestQuakes, buildQuake, activeTsunami, buildTsunami, buildWarnings, buildCommon } from "./common.js";

assert.equal(intText("5-"), "5弱");
assert.equal(intText("6+"), "6強");
assert.equal(intText("3"), "3");
assert.deepEqual(parseCoord("+34.4+131.5-20000/"), { lat: 34.4, lon: 131.5, depth: 20 });
assert.deepEqual(parseCoord("-33.0-072.0/"), { lat: -33, lon: -72 });
assert.deepEqual(parseCoord(""), {});

// 同じ地震の発表は最新の1つだけ、新しい順
const quakes = latestQuakes([
  { ttl: "震度速報", ift: "発表", eid: "A", rdt: "2026-10-19T10:01:00+09:00", at: "2026-10-19T10:00:00+09:00", anm: "", maxi: "5-" },
  { ttl: "震源・震度情報", ift: "発表", eid: "A", rdt: "2026-10-19T10:04:00+09:00", at: "2026-10-19T10:00:00+09:00", anm: "千葉県北西部", mag: "4.8", maxi: "5-", cod: "+35.7+140.1-40000/" },
  { ttl: "震源・震度情報", ift: "発表", eid: "B", rdt: "2026-10-18T09:00:00+09:00", at: "2026-10-18T08:58:00+09:00", anm: "茨城県南部", mag: "2.8", maxi: "1" },
  { ttl: "南海トラフ地震関連解説情報", ift: "発表", eid: "C", rdt: "2026-10-19T11:00:00+09:00", at: "2026-10-19T11:00:00+09:00" },
]);
assert.deepEqual(quakes.map((q) => q.eid), ["A", "B"]);
const q = buildQuake(quakes[0], { Body: {
  Comments: { ForecastComment: { Text: "この地震による津波の心配はありません。" } },
  Intensity: { Observation: { Pref: [{ Area: [{ Name: "東京都２３区", MaxInt: "3" }, { Name: "千葉県北西部", MaxInt: "5-" }] }] } },
} });
assert.equal(q.place, "千葉県北西部");
assert.equal(q.mag, 4.8);
assert.equal(q.max, "5弱");
assert.equal(q.depth, 40);
assert.deepEqual(q.areas, [{ int: "5弱", name: "千葉県北西部" }, { int: "3", name: "東京都２３区" }], "震度の大きい順");
assert.equal(buildQuake({ ttl: "震度速報", at: "x", mag: "" }, null).mag, null, "M不明");

// 津波：最新の発表に警報・注意報があるときだけ
const now = Date.parse("2026-10-19T12:00:00+09:00");
const t = activeTsunami([
  { ift: "発表", rdt: "2026-10-19T10:00:00+09:00", json: "a.json", kind: [{ kind: "津波予報（若干の海面変動）" }, { kind: "津波注意報" }] },
  { ift: "発表", rdt: "2026-10-19T09:00:00+09:00", json: "b.json", kind: [{ kind: "津波警報" }] },
], now);
assert.equal(t.level, "津波注意報");
assert.equal(t.rank, 1);
assert.deepEqual(buildTsunami(t, { Head: { Headline: { Text: "津波注意報を発表しました。" } } }),
  { level: "津波注意報", rank: 1, text: "津波注意報を発表しました。", at: "2026-10-19T10:00:00+09:00" });
assert.equal(buildTsunami({ entry: { rdt: "x" }, level: "大津波警報", rank: 3 }).rank, 3, "段階は機械用の番号でも持つ");
assert.equal(activeTsunami([{ ift: "発表", rdt: "2026-10-19T10:00:00+09:00", kind: [{ kind: "津波注意報解除" }] }], now), null);
assert.equal(activeTsunami([{ ift: "発表", rdt: "2026-10-10T10:00:00+09:00", kind: [{ kind: "津波警報" }] }], now), null, "古い発表は見ない");
assert.deepEqual(buildTsunami(null), []);

// 警報・注意報：区域ごと・種類ごとに最新の状態、府県予報区にまとめて重い順。
// 府県の一部の区域だけのときは、その区域の名前を regions に添える（府県全体のときは付けない）
const area = { class10s: {
  "130010": { parent: "130000", name: "東京地方" },
  "130020": { parent: "130000", name: "伊豆諸島北部" },
  "130030": { parent: "130000", name: "伊豆諸島南部" },
  "130040": { parent: "130000", name: "小笠原諸島" },
  "011000": { parent: "011000", name: "上川地方" },
  "460010": { parent: "460040", name: "奄美地方" },
  "530010": { parent: "530000", name: "大阪府" },
  "530020": { parent: "530000", name: "大阪府２" },
} };
const w = buildWarnings([
  { reportDatetime: "2026-10-19T09:00:00+09:00", warning: { class10Items: [
    { areaCode: "130010", kinds: [{ code: "14", status: "発表" }, { code: "10", status: "発表" }] },
    { areaCode: "130020", kinds: [{ code: "15", status: "発表" }] },
    { areaCode: "130030", kinds: [{ code: "15", status: "発表" }] },
    { areaCode: "011000", kinds: [{ code: "15", status: "発表" }] },
  ] } },
  { reportDatetime: "2026-10-19T10:00:00+09:00", warning: { class10Items: [
    { areaCode: "130030", kinds: [{ code: "43", status: "発表" }] },
    { areaCode: "011000", kinds: [{ code: "15", status: "解除" }] },
    { areaCode: "130010", kinds: [{ status: "発表警報・注意報はなし" }] },
  ] } },
], area);
assert.deepEqual(w.warnings, { "130000": [
  { name: "レベル4大雨危険警報", level: "danger", regions: ["伊豆諸島南部"] },
  { name: "雷注意報", level: "advisory", regions: ["東京地方"] },
  { name: "レベル2大雨注意報", level: "advisory", regions: ["東京地方"] },
  { name: "強風注意報", level: "advisory", regions: ["伊豆諸島北部", "伊豆諸島南部"] },
] });
assert.equal(w.warningsAt, "2026-10-19T10:00:00+09:00");
assert.deepEqual(buildWarnings([], area).warnings, [], "ないときは空");

// 府県の区域すべてに出ているときは regions を付けない（区域が1つだけの府県も同じ）
const report = (items) => [{ reportDatetime: "2026-10-19T10:00:00+09:00", warning: { class10Items: items } }];
assert.deepEqual(buildWarnings(report([{ areaCode: "460010", kinds: [{ code: "15", status: "発表" }] }]), area).warnings,
  { "460040": [{ name: "強風注意報", level: "advisory" }] }, "区域が1つだけの府県");
assert.deepEqual(buildWarnings(report([
  { areaCode: "530010", kinds: [{ code: "14", status: "発表" }] },
  { areaCode: "530020", kinds: [{ code: "14", status: "発表" }] },
]), area).warnings, { "530000": [{ name: "雷注意報", level: "advisory" }] }, "すべての区域に出ているとき");
assert.deepEqual(buildWarnings(report([{ areaCode: "130040", kinds: [{ code: "14", status: "発表" }] }]), area).warnings,
  { "130000": [{ name: "雷注意報", level: "advisory", regions: ["小笠原諸島"] }] }, "一部の区域だけのとき");
// 区域の表にない府県（分からないとき）は regions を付けない
assert.deepEqual(buildWarnings(report([{ areaCode: "999999", kinds: [{ code: "14", status: "発表" }] }]),
  { class10s: { "999999": { parent: "990000" } } }).warnings,
  { "990000": [{ name: "雷注意報", level: "advisory" }] }, "区域の名前が分からないとき");

const c = buildCommon({}, 1760000000000);
assert.equal(c.version, 1);
assert.equal(c.updated, 1760000000);
assert.deepEqual([c.quakes, c.tsunami, c.warnings, c.notices], [[], [], [], []]);
console.log("ok");
