// node src/catalog.test.mjs で確認する
import assert from "node:assert/strict";
import { buildCatalog, buildPool, isVideoId, toBase64 } from "./catalog.js";

assert.ok(isVideoId("dQw4w9WgXcQ"));
assert.ok(!isVideoId("short"));
assert.ok(!isVideoId("dQw4w9WgXc<"));

const catalog = buildCatalog([
  { key: "a", rows: [
    { id: "aaaaaaaaaaa", title: "タイトル\n改行", channel: "ch", live: 1 },
    { id: "bad id", title: "x", channel: "x", live: 0 },
  ] },
  { key: "b", rows: [
    { id: "aaaaaaaaaaa", title: "t", channel: "c", live: 0 },
    { id: "bbbbbbbbbbb", title: "t", channel: "c", live: 0 },
  ] },
], 100);
assert.equal(catalog.version, 1);
assert.equal(catalog.genres[0].videos.length, 1, "不正なIDは外す");
assert.equal(catalog.genres[0].videos[0].title, "タイトル 改行", "制御文字は空白に");
assert.equal(catalog.genres[0].videos[0].live, true);

assert.equal(buildCatalog([{ key: "c", rows: [{ id: "ccccccccccc", title: "🔴️LIVE‍", channel: "", live: 0 }] }], 1).genres[0].videos[0].title, "🔴LIVE", "見えない記号は外す");

const pool = buildPool(catalog, 10);
assert.deepEqual(pool.ids, ["aaaaaaaaaaa", "bbbbbbbbbbb"], "重複なし・出てきた順");
assert.equal(buildPool(catalog, 1).ids.length, 1);

const text = "日本語".repeat(20000);
assert.equal(Buffer.from(toBase64(text), "base64").toString("utf8"), text);
console.log("ok");
