// 不具合の報告フォーム（POST /v1/contact）。広報の公式サイト（ulexite-site/contact/）から送る。
// 返信しない一方向（種類・バージョン・環境・ワールド・起きたこと・エラーだけ）。連絡先は受け取らない。
// IP は保存しない。スパム対策のレート用に、ソルト付きハッシュだけを KV に24時間置く（D1 には入れない）。
// 仕様は docs/sns.md の「不具合の報告フォーム」（2026-10-23）。

const SITE = "https://thesilver0913.github.io";
const LOCAL = "http://localhost:8000"; // サイトを手元で確かめるとき用

const KINDS = new Set(["bug", "request", "other"]);
const ENVS = new Set(["pc", "quest", "vr", "desktop"]);
const MAX = { kind: 20, version: 40, world: 200, body: 5000, minBody: 10, error: 10000 };

const RATE_LIMIT = 5;      // 同じ IP から1時間に5件まで
const RATE_WINDOW = 3600;  // 秒
const KEEP_DAYS = 365;     // 保存期間（1年）

/** CORS（サイトのオリジンと、手元の確認だけ許可）。 */
export function corsHeaders(origin) {
  if (origin !== SITE && origin !== LOCAL) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers });
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const count = (s) => [...s].length; // 文字数（絵文字なども1文字と数える）

/**
 * 送られてきた JSON を確かめる。外れたら { ok: false, error }。
 * env は pc/quest/vr/desktop だけを残して重複を消す。
 */
export function validateContact(data) {
  if (!data || typeof data !== "object") return { ok: false, error: "本文がありません" };
  const kind = text(data.kind, MAX.kind);
  if (!KINDS.has(kind)) return { ok: false, error: "種類（不具合・要望・その他）を選んでください" };
  const version = text(data.version, MAX.version);
  if (!version) return { ok: false, error: "Ulexite TV のバージョンを書いてください" };
  const env = Array.isArray(data.env) ? [...new Set(data.env.filter((e) => ENVS.has(e)))] : [];
  if (!env.length) return { ok: false, error: "環境（PC・Quest・VR・デスクトップ）を1つ以上選んでください" };
  const body = text(data.body, MAX.body);
  if (count(body) < MAX.minBody) return { ok: false, error: `起きたことを${MAX.minBody}字以上で書いてください` };
  const error = text(data.error, MAX.error);
  if (data.consent !== true) return { ok: false, error: "送信に同意してください" };
  return {
    ok: true,
    value: {
      kind,
      version,
      env,
      world: text(data.world, MAX.world),
      body,
      error,
    },
  };
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 同じ IP からの送信が多いか。数えたら1件ぶん足す（KV に24時間だけ。IP そのものは保存しない）。 */
export async function tooMany(env, ip) {
  if (!env?.CONTACT_KV || !ip) return false; // KV がないときはレートを見ない（保存だけ続ける）
  const salt = env.CONTACT_SALT || env.GITHUB_TOKEN || "ulexite";
  const key = "contact:" + (await sha256(`${salt}|${ip}`)).slice(0, 32);
  const n = Number(await env.CONTACT_KV.get(key) ?? 0);
  if (n >= RATE_LIMIT) return true;
  await env.CONTACT_KV.put(key, String(n + 1), { expirationTtl: RATE_WINDOW });
  return false;
}

/** 保存の表（初回に作る。schema.sql と同じ形）。 */
export async function ensureTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS contact_reports (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, kind TEXT NOT NULL, version TEXT NOT NULL, " +
    "env TEXT NOT NULL, world TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', " +
    "status TEXT NOT NULL DEFAULT 'new')",
  ).run();
}

/** 1件保存する。 */
export async function saveReport(env, r, now = Date.now()) {
  await ensureTable(env);
  await env.DB.prepare(
    "INSERT INTO contact_reports (created_at, kind, version, env, world, body, error, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')",
  ).bind(new Date(now).toISOString(), r.kind, r.version, r.env.join(","), r.world, r.body, r.error).run();
}

/** 1年より古い報告を消す（Cron で1日1回）。 */
export async function cleanupReports(env, now = Date.now()) {
  await ensureTable(env);
  const cutoff = new Date(now - KEEP_DAYS * 86400e3).toISOString();
  const res = await env.DB.prepare("DELETE FROM contact_reports WHERE created_at < ?").bind(cutoff).run();
  return { ok: true, deleted: res?.meta?.changes ?? null };
}

/** POST /v1/contact（OPTIONS も）。 */
export async function handleContact(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ ok: false, error: "POST で送ってください" }, 405, headers);

  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "JSON が読めません" }, 400, headers); }

  // honeypot（画面に出さない欄）。埋まっていたら、送れたことにして捨てる
  if (typeof data?.website === "string" && data.website.trim()) return json({ ok: true }, 200, headers);

  if (await tooMany(env, request.headers.get("CF-Connecting-IP"))) {
    return json({ ok: false, error: "送信が続いています。時間をおいて、もう一度お試しください" }, 429, headers);
  }

  const v = validateContact(data);
  if (!v.ok) return json({ ok: false, error: v.error }, 400, headers);

  try {
    await saveReport(env, v.value);
  } catch (e) {
    console.log("contact save failed: " + e.message);
    return json({ ok: false, error: "保存できませんでした" }, 500, headers);
  }
  return json({ ok: true }, 200, headers);
}
