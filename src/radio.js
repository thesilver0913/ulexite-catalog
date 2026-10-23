// インターネットラジオの曲名（feed/radio.json）。
// 局は制作者が「テレビを作り直す」ときに焼き込み、エディタ（本体 D）が POST /v1/register/radio で登録する。
// 30日来なかった局は外す。曲名は ICY メタデータ（Icy-MetaData: 1）から読む。取れない局は feed に出さない
// （アプリは「曲名を取得できない局です」と出す）。仕様は docs/spec.md の「インターネットラジオ」。

import { publish } from "./github.js";

const MAX_STATIONS = 2000;     // 登録できる局の数（全体）
const MAX_PER_REQUEST = 200;   // 1回の登録で受ける数
const PER_POLL = 30;           // 1回の実行で曲名を読む局（無料プランの「1回50件まで」に収める）
const MAX_FEED = 300;          // feed に出す局の数（大きくなりすぎないように）
const TIMEOUT_MS = 6000;
const MAX_URL = 500;
const MAX_ID = 120;
const KEEP_DAYS = 30;
const RATE_LIMIT = 20;         // 同じ IP から1時間に20回まで
const RATE_WINDOW = 3600;

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const kvGet = async (env, key) => (await env.DB.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first())?.value ?? null;
const kvSet = (env, key, value) => env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value));

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 内部向けの宛先か（登録された URL をこちらから取りに行くので、家の中やメタデータの宛先は断る）。 */
export function isPrivateHost(hostname) {
  const h = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true; // IPv6 のユニークローカル
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // 名前だけ（ドットが無い）の宛先は受けない（社内のホスト名を狙わせない）
  if (!h.includes(".") && !h.startsWith("[")) return true;
  return false;
}

/** 局の1件を確かめる。{ ok, value: { key, id, url } } か { ok: false, error }。 */
export function validateStation(s) {
  if (!s || typeof s !== "object") return { ok: false, error: "局の形が正しくありません" };
  const url = text(s.url, MAX_URL);
  if (!url) return { ok: false, error: "URL がありません" };
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: "URL が読めません" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "http(s) の URL だけです" };
  if (isPrivateHost(u.hostname)) return { ok: false, error: "その宛先は登録できません" };
  const id = text(s.id, MAX_ID);
  return { ok: true, value: { key: id ? `id:${id}` : `url:${url}`, id, url } };
}

async function ensureTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS radio_stations (" +
    "key TEXT PRIMARY KEY, station_id TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, " +
    "artist TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', " +
    "fetched_at TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL)",
  ).run();
}

/** 登録する（同じ局は last_seen を新しくするだけ）。 */
export async function registerStations(env, stations, now = Date.now()) {
  await ensureTable(env);
  const at = new Date(now).toISOString();
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM radio_stations").first();
  let registered = 0, skipped = 0;
  for (const s of stations.slice(0, MAX_PER_REQUEST)) {
    const v = validateStation(s);
    if (!v.ok) { skipped++; continue; }
    if ((count?.n ?? 0) + registered >= MAX_STATIONS) break; // いっぱい
    await env.DB.prepare(
      "INSERT INTO radio_stations (key, station_id, url, last_seen) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET last_seen = excluded.last_seen, url = excluded.url, station_id = excluded.station_id",
    ).bind(v.value.key, v.value.id, v.value.url, at).run();
    registered++;
  }
  return { registered, skipped };
}

/** StreamTitle='アーティスト - 曲名'; → { artist, title }。 */
export function parseStreamTitle(meta) {
  const m = /StreamTitle='([^']*)'/.exec(String(meta ?? ""));
  if (!m) return { artist: "", title: "" };
  const value = m[1].trim();
  if (!value) return { artist: "", title: "" };
  const i = value.indexOf(" - ");
  if (i > 0) return { artist: value.slice(0, i).trim(), title: value.slice(i + 3).trim() };
  return { artist: "", title: value };
}

const concat = (chunks) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
};
const latin1 = (bytes) => [...bytes].map((b) => String.fromCharCode(b)).join("");

/** 配信の先頭から ICY メタデータを1つ読む（音声は捨てる）。読めなければ null。diag に何が起きたかを残す。 */
export async function readIcyTitle(url, fetchImpl = fetch, diag = null) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { "Icy-MetaData": "1", "User-Agent": "ulexite-catalog/1.0 (+https://thesilver0913.github.io/ulexite-catalog/)" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (diag) diag.error = e.message;
    console.log(`radio: fetch failed ${url}: ${e.message}`);
    return null;
  }
  if (!res || !res.ok || !res.body) {
    if (diag) diag.status = res?.status ?? 0;
    console.log(`radio: no stream ${url}: ${res?.status}`);
    return null;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let len = 0;
  const readMore = async (upTo) => {
    const { value, done } = await reader.read();
    if (done) return false;
    chunks.push(value); len += value.length;
    return len < upTo;
  };
  try {
    const metaint = Number(res.headers.get("icy-metaint") ?? 0);
    if (diag) { diag.status = res.status; diag.metaint = metaint; }
    if (metaint > 0 && metaint <= 1 << 20) {
      // 音声 metaint バイト + 長さ1バイト まで読み、長さのぶんだけメタデータを読む
      const need = metaint + 1;
      while (len < need) if (!(await readMore(need + 16 * 255 + 16))) break;
      let bytes = concat(chunks);
      if (diag) { diag.bytes = bytes.length; diag.metaLenByte = bytes[metaint] ?? -1; }
      if (bytes.length < need) return null;
      const metaLen = bytes[metaint] * 16;
      if (metaLen) {
        const want = need + metaLen; // メタデータの本体（StreamTitle など）まで読む
        while (len < want) if (!(await readMore(want + 16))) break;
        bytes = concat(chunks);
        if (diag) diag.bytes = bytes.length;
        if (bytes.length >= want) return parseStreamTitle(latin1(bytes.subarray(need, want)));
      }
      // 区切りの位置がずれている・中身が別物のことがあるので、届いた範囲から StreamTitle を探す
      const s = latin1(bytes);
      const i = s.indexOf("StreamTitle='");
      if (diag) diag.foundAt = i;
      if (i >= 0) {
        const end = s.indexOf("';", i + 13);
        if (end > 0) { if (diag) diag.block = s.slice(i, end + 2); return parseStreamTitle(s.slice(i, end + 2)); }
      }
      return { artist: "", title: "" };
    }

    // icy-metaint が無い（Cloudflare が落とすことがある）ときは、音声の並びから
    // StreamTitle='…' を探す（見つからなければ読めない局として扱う）
    console.log(`radio: no icy-metaint ${url} (${res.status})`);
    const scanMax = 200_000;
    while (len < scanMax) {
      const s = latin1(concat(chunks));
      const i = s.indexOf("StreamTitle='");
      if (i >= 0) {
        const end = s.indexOf("';", i + 13);
        if (end > 0) { if (diag) { diag.bytes = len; diag.found = true; } return parseStreamTitle(s.slice(i, end + 2)); }
      }
      if (!(await readMore(scanMax))) break;
    }
    return null;
  } catch (e) {
    if (diag) diag.error = e.message;
    console.log(`radio: read failed ${url}: ${e.message}`);
    return null;
  } finally { try { await reader.cancel(); } catch {} }
}

/** feed の形。曲名が取れている局だけ出す。 */
export function buildFeed(rows, at = new Date().toISOString()) {
  const stations = (rows ?? [])
    .filter((r) => r && r.title)
    .map((r) => ({ id: r.station_id || "", url: r.url, artist: r.artist || "", title: r.title }))
    .slice(0, MAX_FEED);
  return { version: 1, at, stations };
}

async function limit(env, ip) {
  if (!env?.CONTACT_KV || !ip) return false;
  const salt = env.CONTACT_SALT || env.GITHUB_TOKEN || "ulexite";
  const key = "radio:" + (await sha256(`${salt}|${ip}`)).slice(0, 32);
  const n = Number(await env.CONTACT_KV.get(key) ?? 0);
  if (n >= RATE_LIMIT) return true;
  await env.CONTACT_KV.put(key, String(n + 1), { expirationTtl: RATE_WINDOW });
  return false;
}

/** POST /v1/register/radio（エディタから。ブラウザ用の CORS は付けない）。 */
export async function handleRadioRegister(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "POST で送ってください" }, 405);
  if (await limit(env, request.headers.get("CF-Connecting-IP"))) {
    return json({ ok: false, error: "登録が続いています。時間をおいてください" }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "JSON が読めません" }, 400); }
  const stations = Array.isArray(body?.stations) ? body.stations : null;
  if (!stations) return json({ ok: false, error: "stations（局の並び）がありません" }, 400);
  if (!stations.length) return json({ ok: true, registered: 0, skipped: 0 });
  try {
    const r = await registerStations(env, stations);
    return json({ ok: true, ...r });
  } catch (e) {
    console.log("radio register failed: " + e.message);
    return json({ ok: false, error: "保存できませんでした" }, 500);
  }
}

/** 曲名を読む（5分おき）。登録から30日たった局は消す。 */
export async function runRadioPoll(env, now = Date.now()) {
  await ensureTable(env);
  const cutoff = new Date(now - KEEP_DAYS * 86400e3).toISOString();
  await env.DB.prepare("DELETE FROM radio_stations WHERE last_seen < ?").bind(cutoff).run();
  const rows = (await env.DB.prepare(
    "SELECT key, url FROM radio_stations ORDER BY fetched_at ASC, last_seen DESC LIMIT ?",
  ).bind(PER_POLL).all()).results ?? [];
  let read = 0;
  const diag = []; // 何が起きたかを残す（曲名が取れない局の切り分け用。D1 の kv に置く）
  for (const row of rows) {
    const d = { url: row.url };
    diag.push(d);
    const t = await readIcyTitle(row.url, fetch, d);
    const at = new Date().toISOString();
    if (t) {
      await env.DB.prepare("UPDATE radio_stations SET artist = ?, title = ?, fetched_at = ? WHERE key = ?")
        .bind(t.artist, t.title, at, row.key).run();
      if (t.title) d.ok = true;
      read++;
    } else {
      await env.DB.prepare("UPDATE radio_stations SET fetched_at = ? WHERE key = ?").bind(at, row.key).run();
    }
  }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await kvSet(env, "radio.diag", JSON.stringify({ at: new Date(now).toISOString(), stations: diag })).run();
  return { ok: true, polled: rows.length, read };
}

/** feed/radio.json を書き出す（15分おき。変わったときだけ）。 */
export async function runRadioPublish(env, { force = false, now = Date.now() } = {}) {
  await ensureTable(env);
  const rows = (await env.DB.prepare(
    "SELECT station_id, url, artist, title FROM radio_stations WHERE title != '' ORDER BY last_seen DESC LIMIT ?",
  ).bind(MAX_FEED).all()).results ?? [];
  const feed = buildFeed(rows, new Date(now).toISOString());
  const hash = await sha256(JSON.stringify({ ...feed, at: "" }));
  if (!force && hash === await kvGet(env, "radio.hash")) return { ok: true, changed: false };
  await publish(env, { "v1/feed/radio.json": JSON.stringify(feed) }, "ラジオの曲名を更新");
  await kvSet(env, "radio.hash", hash).run();
  return { ok: true, changed: true, stations: feed.stations.length };
}
