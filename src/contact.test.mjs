// node src/contact.test.mjs で確認する（Cloudflare には繋がない。D1 と KV は偽物）
import assert from "node:assert/strict";
import { validateContact, corsHeaders, tooMany, saveReport, cleanupReports, handleContact } from "./contact.js";

const SITE = "https://thesilver0913.github.io";

// ---- 検証 ----
const good = { kind: "bug", version: "0.3.0", env: ["pc", "vr"], world: "チルワールド", body: "テレビが映りません。", error: "", website: "", consent: true };
assert.deepEqual(validateContact(good), {
  ok: true,
  value: { kind: "bug", version: "0.3.0", env: ["pc", "vr"], world: "チルワールド", body: "テレビが映りません。", error: "" },
});
assert.equal(validateContact({ ...good, kind: "spam" }).ok, false, "種類");
assert.equal(validateContact({ ...good, version: "  " }).ok, false, "バージョンは必須");
assert.equal(validateContact({ ...good, env: [] }).ok, false, "環境は1つ以上");
assert.equal(validateContact({ ...good, env: ["switch", "pc"] }).value.env.join(","), "pc", "知らない環境は落とす");
assert.equal(validateContact({ ...good, env: ["pc", "pc", "vr"] }).value.env.join(","), "pc,vr", "重複は消す");
assert.equal(validateContact({ ...good, body: "短い" }).ok, false, "10字未満");
assert.equal(validateContact({ ...good, body: "あ".repeat(10) }).ok, true, "10字ちょうどは通す");
assert.equal(validateContact({ ...good, consent: "true" }).ok, false, "同意は true だけ");
assert.equal(validateContact(null).ok, false);
assert.equal(validateContact({ ...good, version: "v".repeat(100) }).value.version.length, 40, "長すぎる版は切る");
assert.equal(validateContact({ ...good, body: "あ".repeat(6000) }).value.body.length, 5000, "本文は5000字で切る");
assert.equal(validateContact({ ...good, world: null }).value.world, "", "null は空");

// ---- CORS ----
assert.equal(corsHeaders(SITE)["Access-Control-Allow-Origin"], SITE);
assert.equal(corsHeaders("http://localhost:8000")["Access-Control-Allow-Origin"], "http://localhost:8000");
assert.equal(corsHeaders("https://evil.example")["Access-Control-Allow-Origin"], undefined, "ほかのオリジンは許可しない");
assert.equal(corsHeaders(SITE)["Access-Control-Allow-Methods"], "POST, OPTIONS");

// ---- 偽の D1 と KV ----
function fakeDB() {
  const rows = [];
  let fail = false;
  const db = {
    rows,
    fail: (v) => { fail = v; },
    prepare(sql) {
      const st = { args: [], bind(...a) { st.args = a; return st; },
        async run() {
          if (fail) throw new Error("db down");
          if (/^CREATE TABLE/i.test(sql)) return { meta: {} };
          if (/^INSERT INTO contact_reports/i.test(sql)) { rows.push(st.args); return { meta: { changes: 1 } }; }
          if (/^DELETE FROM contact_reports/i.test(sql)) {
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) if (rows[i][0] < st.args[0]) rows.splice(i, 1);
            return { meta: { changes: before - rows.length } };
          }
          return { meta: {} };
        },
        async first() { return null; },
      };
      return st;
    },
  };
  return db;
}
function fakeKV() {
  const map = new Map();
  return { map, async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v) { map.set(k, v); } };
}
const env = (db = fakeDB(), kv = fakeKV()) => ({ DB: db, CONTACT_KV: kv, CONTACT_SALT: "test-salt" });

const post = (body, headers = {}) => new Request("https://ulexite-catalog.example/v1/contact", {
  method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

// ---- 受け口 ----
{
  const e = env();
  const pre = await handleContact(new Request("https://x/v1/contact", { method: "OPTIONS", headers: { Origin: SITE } }), e);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.equal((await handleContact(new Request("https://x/v1/contact"), e)).status, 405, "GET は 405");
  assert.equal((await handleContact(post("{broken"), e)).status, 400, "壊れた JSON は 400");

  const honeypot = await handleContact(post({ ...good, website: "https://spam.example" }), e);
  assert.equal(honeypot.status, 200);
  assert.equal((await honeypot.json()).ok, true, "honeypot は送れたことにする");
  assert.equal(e.DB.rows.length, 0, "honeypot は保存しない");

  const ok = await handleContact(post(good), e);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  assert.equal(e.DB.rows.length, 1);
  assert.equal(e.DB.rows[0][1], "bug", "kind");
  assert.equal(e.DB.rows[0][3], "pc,vr", "env はカンマ区切り");
  assert.match(e.DB.rows[0][0], /^\d{4}-\d{2}-\d{2}T/, "created_at は ISO");

  const bad = await handleContact(post({ ...good, consent: false }), e);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /同意/);
}
{
  const e = env();
  for (let i = 0; i < 5; i++) assert.equal((await handleContact(post(good), e)).status, 200, `${i + 1}件目`);
  const sixth = await handleContact(post(good), e);
  assert.equal(sixth.status, 429, "1時間に5件を超えたら 429");
  const other = await handleContact(post(good, { "CF-Connecting-IP": "198.51.100.1" }), e);
  assert.equal(other.status, 200, "別の IP は通る");
  assert.equal(e.DB.rows.length, 6);
}
{
  const e = env();
  e.DB.fail(true);
  const res = await handleContact(post(good), e);
  assert.equal(res.status, 500, "保存できなければ 500");
}
{
  // KV が無くても保存は続ける（レートだけ見ない）
  const e = { DB: fakeDB() };
  assert.equal(await tooMany(e, "203.0.113.9"), false);
  assert.equal((await handleContact(post(good), e)).status, 200);
}

// ---- 保存と掃除 ----
{
  const e = env();
  const now = Date.parse("2026-10-23T00:00:00Z");
  await saveReport(e, validateContact(good).value, now);
  await saveReport(e, validateContact(good).value, now - 400 * 86400e3); // 1年より前
  assert.equal(e.DB.rows.length, 2);
  const res = await cleanupReports(e, now);
  assert.equal(res.deleted, 1, "1年より前だけ消す");
  assert.equal(e.DB.rows.length, 1);
}
console.log("ok");
