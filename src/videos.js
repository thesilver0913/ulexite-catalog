// 動画アプリの一覧。YouTube Data API で作り、/v1/videos/ に書き出す。

import { buildCatalog, buildPool, isVideoId } from "./catalog.js";
import { publish } from "./github.js";

// ジャンル。chart は地域別の人気動画（1回1ユニット）、search はキーワード検索（1回100ユニット）。
// 並びはワールド側のジャンルボタンの既定の並びと同じにしておく。
const GENRES = [
  { key: "popular_jp", chart: { regionCode: "JP" } },
  { key: "popular_en", chart: { regionCode: "US" } },
  { key: "music", chart: { regionCode: "JP", videoCategoryId: "10" } },
  { key: "gaming", chart: { regionCode: "JP", videoCategoryId: "20" } },
  { key: "vtuber", search: { q: "VTuber", order: "viewCount", recentDays: 14 } },
  { key: "work_bgm", search: { q: "作業用BGM", order: "relevance", videoDuration: "long" } },
  { key: "ambient", search: { q: "自然音 環境音", order: "relevance", videoDuration: "long" } },
  { key: "rain", search: { q: "雨の音", order: "relevance", videoDuration: "long" } },
];

const API = "https://www.googleapis.com/youtube/v3";
const KEEP_DAYS = 60;       // 一覧から外れた動画も、この日数までは候補に残す（古いワールドでも行が空になりにくいように）
const PER_GENRE = 100;      // ジャンルごとに配る件数
const POOL_MAX = 1000;      // 焼き込み用の一覧の上限

export async function runVideos(env) {
  const now = Math.floor(Date.now() / 1000);
  const report = { genres: {}, removed: 0 };

  // 1. ジャンルごとに今の一覧を取って順位を記録する（失敗したジャンルは前回までの記録を使う）
  for (const genre of GENRES) {
    try {
      const ids = genre.chart ? await fetchChart(env, genre.chart) : await fetchSearch(env, genre.search, now);
      const stmt = env.DB.prepare(
        "INSERT INTO ranks (genre, id, rank, seen) VALUES (?1, ?2, ?3, ?4) " +
        "ON CONFLICT (genre, id) DO UPDATE SET rank = excluded.rank, seen = excluded.seen");
      if (ids.length) await env.DB.batch(ids.map((id, i) => stmt.bind(genre.key, id, i, now)));
      report.genres[genre.key] = ids.length;
    } catch (e) {
      report.genres[genre.key] = `error: ${e.message}`;
    }
  }
  await env.DB.prepare("DELETE FROM ranks WHERE seen < ?1").bind(now - KEEP_DAYS * 86400).run();

  // 2. 候補の全動画のタイトルなどを取り直す（API のデータを30日より古くしない）。消えた・非公開の動画は外す
  const { results: idRows } = await env.DB.prepare("SELECT DISTINCT id FROM ranks").all();
  const ids = idRows.map((r) => r.id);
  const removed = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await api(env, "videos", { part: "snippet,status", id: chunk.join(","), maxResults: "50" });
    const found = new Map(data.items.map((v) => [v.id, v]));
    const upsert = env.DB.prepare(
      "INSERT INTO videos (id, title, channel, live, refreshed) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT (id) DO UPDATE SET title = excluded.title, channel = excluded.channel, live = excluded.live, refreshed = excluded.refreshed");
    const writes = [];
    for (const id of chunk) {
      const v = found.get(id);
      const live = v?.snippet.liveBroadcastContent;
      if (!v || v.status.privacyStatus !== "public" || live === "upcoming") { removed.push(id); continue; }
      writes.push(upsert.bind(id, v.snippet.title, v.snippet.channelTitle, live === "live" ? 1 : 0, now));
    }
    if (writes.length) await env.DB.batch(writes);
  }
  if (removed.length) {
    const del = env.DB.prepare("DELETE FROM ranks WHERE id = ?1");
    await env.DB.batch(removed.map((id) => del.bind(id)));
  }
  await env.DB.prepare("DELETE FROM videos WHERE id NOT IN (SELECT id FROM ranks) OR refreshed < ?1").bind(now - 25 * 86400).run();
  report.removed = removed.length;

  // 3. JSON を作って GitHub に書き出す
  const genres = [];
  for (const genre of GENRES) {
    const { results } = await env.DB.prepare(
      "SELECT r.id, v.title, v.channel, v.live FROM ranks r JOIN videos v ON v.id = r.id " +
      "WHERE r.genre = ?1 ORDER BY r.seen DESC, r.rank ASC LIMIT ?2").bind(genre.key, PER_GENRE).all();
    genres.push({ key: genre.key, rows: results });
  }
  const catalog = buildCatalog(genres, now);
  await publish(env, {
    "v1/videos/catalog.json": JSON.stringify(catalog),
    "v1/videos/pool.json": JSON.stringify(buildPool(catalog, POOL_MAX)),
  }, "update videos");
  report.updated = now;
  return report;
}

async function fetchChart(env, chart) {
  const data = await api(env, "videos", { part: "id", chart: "mostPopular", maxResults: "50", ...chart });
  return data.items.map((v) => v.id).filter(isVideoId);
}

async function fetchSearch(env, search, now) {
  const params = {
    part: "id", type: "video", maxResults: "50", q: search.q, order: search.order,
    regionCode: "JP", relevanceLanguage: "ja",
  };
  if (search.videoDuration) params.videoDuration = search.videoDuration;
  if (search.recentDays) params.publishedAfter = new Date((now - search.recentDays * 86400) * 1000).toISOString();
  const data = await api(env, "search", params);
  return data.items.map((v) => v.id?.videoId).filter(isVideoId);
}

async function api(env, method, params) {
  const url = `${API}/${method}?${new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${method} ${res.status}`); // キーを含む URL はログに出さない
  return res.json();
}

