// node src/radio.test.mjs で確認する（Cloudflare には繋がない。D1 と KV は偽物、配信は偽の fetch）
import assert from "node:assert/strict";
import {
  validateStation, parseStreamTitle, buildFeed, readIcyTitle,
  registerStations, handleRadioRegister, isPrivateHost,
} from "./radio.js";

// ---- 局の検証 ----
assert.deepEqual(validateStation({ id: "abc-123", url: "https://example.com/radio.mp3" }), {
  ok: true, value: { key: "id:abc-123", id: "abc-123", url: "https://example.com/radio.mp3" },
});
assert.equal(validateStation({ url: "http://example.com/a" }).value.key, "url:http://example.com/a", "id が無ければ URL で照合");
assert.equal(validateStation({ url: "ftp://example.com/a" }).ok, false, "ftp は断る");
assert.equal(validateStation({ url: "" }).ok, false);
assert.equal(validateStation({ url: "not a url" }).ok, false);
assert.equal(validateStation(null).ok, false);
assert.equal(validateStation({ url: "http://localhost:8000/a" }).ok, false, "localhost");
assert.equal(validateStation({ url: "http://10.1.2.3/a" }).ok, false, "10.");
assert.equal(validateStation({ url: "http://192.168.0.10/a" }).ok, false, "192.168.");
assert.equal(validateStation({ url: "http://172.20.0.1/a" }).ok, false, "172.16-31.");
assert.equal(validateStation({ url: "http://169.254.169.254/latest" }).ok, false, "メタデータ");
assert.equal(validateStation({ url: "http://intranet/a" }).ok, false, "ドットの無い名前");
assert.equal(validateStation({ url: "http://example.com/" + "a".repeat(600) }).value.url.length, 500, "長すぎる URL は切る");
assert.equal(isPrivateHost("127.0.0.1"), true);
assert.equal(isPrivateHost("example.com"), false);
assert.equal(isPrivateHost("::1"), true);

// ---- 曲名の読み取り（ICY） ----
assert.deepEqual(parseStreamTitle("StreamTitle='Artist - Song';"), { artist: "Artist", title: "Song" });
assert.deepEqual(parseStreamTitle("StreamTitle='Only Song';"), { artist: "", title: "Only Song" });
assert.deepEqual(parseStreamTitle("StreamTitle='';"), { artist: "", title: "" });
assert.deepEqual(parseStreamTitle(""), { artist: "", title: "" });

function icyResponse(meta, metaint = 4) {
  const bytes = [...meta].map((c) => c.charCodeAt(0));
  const padded = new Uint8Array(32).fill(32); // 32バイト（長さの単位 16 の2つぶん）
  padded.set(bytes.slice(0, 32));
  const body = new Uint8Array([1, 2, 3, 4, Math.ceil(bytes.length / 16), ...padded]);
  return new Response(body, { headers: { "icy-metaint": String(metaint) } });
}
{
  const t = await readIcyTitle("https://example.com/s", async () => icyResponse("StreamTitle='DJ - Night';"));
  assert.deepEqual(t, { artist: "DJ", title: "Night" }, "ICY のメタデータを読む");
  const none = await readIcyTitle("https://example.com/s", async () => new Response(new Uint8Array([1, 2, 3, 4])));
  assert.equal(none, null, "icy-metaint が無ければ読めない");
  const short = await readIcyTitle("https://example.com/s", async () => new Response(new Uint8Array([1, 2]), { headers: { "icy-metaint": "4" } }));
  assert.equal(short, null, "音声が足りなければ読めない");
  const broken = await readIcyTitle("https://example.com/s", async () => { throw new Error("timeout"); });
  assert.equal(broken, null, "取れなければ null");
}

// ---- feed の形 ----
{
  const feed = buildFeed([
    { station_id: "a", url: "https://a.example/1", artist: "A", title: "Song A" },
    { station_id: "", url: "https://b.example/2", artist: "", title: "" }, // 曲名なしは出さない
  ], "2026-10-23T10:00:00.000Z");
  assert.deepEqual(feed, {
    version: 1, at: "2026-10-23T10:00:00.000Z",
    stations: [{ id: "a", url: "https://a.example/1", artist: "A", title: "Song A" }],
  });
}

// ---- 偽の D1 と KV ----
function fakeDB() {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const st = {
        args: [],
        bind(...a) { st.args = a; return st; },
        async run() { calls.push({ sql, args: st.args }); return { meta: { changes: 1 } }; },
        async first() { return { n: 0 }; },
        async all() { return { results: db.rows ?? [] }; },
      };
      return st;
    },
    rows: [],
  };
  return db;
}
function fakeKV() {
  const map = new Map();
  return { map, async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v) { map.set(k, v); } };
}
const env = (db = fakeDB(), kv = fakeKV()) => ({ DB: db, CONTACT_KV: kv, CONTACT_SALT: "test-salt" });

// ---- 登録 ----
{
  const db = fakeDB();
  const r = await registerStations(env(db), [
    { id: "a", url: "https://a.example/1" },
    { url: "https://intranet/x" }, // 断る
    { url: "https://b.example/2" },
  ]);
  assert.deepEqual(r, { registered: 2, skipped: 1 });
  const insert = db.calls.filter((c) => c.sql.startsWith("INSERT INTO radio_stations"));
  assert.equal(insert.length, 2);
  assert.deepEqual(insert[0].args.slice(0, 3), ["id:a", "a", "https://a.example/1"]);
}
{
  const e = env();
  const post = (body) => new Request("https://x/v1/register/radio", {
    method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.5" },
    body: JSON.stringify(body),
  });
  const ok = await handleRadioRegister(post({ stations: [{ id: "a", url: "https://a.example/1" }] }), e);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, registered: 1, skipped: 0 });
  assert.equal((await handleRadioRegister(new Request("https://x/v1/register/radio"), e)).status, 405, "GET は 405");
  assert.equal((await handleRadioRegister(post({}), e)).status, 400, "stations が無い");
  assert.equal((await handleRadioRegister(post({ stations: [] }), e)).status, 200, "空でも 200");
}
{
  // 同じ IP から 20回を超えたら 429
  const e = env();
  const post = () => new Request("https://x/v1/register/radio", {
    method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.7" },
    body: JSON.stringify({ stations: [{ url: "https://a.example/1" }] }),
  });
  for (let i = 0; i < 20; i++) assert.equal((await handleRadioRegister(post(), e)).status, 200, `${i + 1}回目`);
  assert.equal((await handleRadioRegister(post(), e)).status, 429, "21回目は 429");
}
console.log("ok");
