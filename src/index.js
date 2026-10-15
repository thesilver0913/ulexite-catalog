// Ulexite の共通サーバー。各アプリのデータを作り、GitHub Pages（docs/v1/）に JSON で書き出す。
// いまは動画の一覧だけ。天気・アプリのカタログなどは、仕事（job）を足して同じ Worker に相乗りさせる。
// 手動で動かすときは POST /run?job=videos（Authorization: Bearer RUN_TOKEN）。

import { runVideos } from "./videos.js";

// cron の式 → 仕事。wrangler.toml の crons と合わせる
const SCHEDULE = {
  "0 3,15 * * *": ["videos"], // 日本時間の 12時・24時
};

const JOBS = { videos: runVideos };

export default {
  async scheduled(event, env, ctx) {
    for (const job of SCHEDULE[event.cron] ?? []) ctx.waitUntil(JOBS[job](env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/run") {
      if (!env.RUN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.RUN_TOKEN}`)
        return new Response("forbidden", { status: 403 });
      const job = JOBS[url.searchParams.get("job") ?? "videos"];
      if (!job) return new Response("unknown job", { status: 404 });
      try {
        return Response.json(await job(env));
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 }); // 秘密の値はメッセージに含めない
      }
    }
    return new Response("Ulexite server");
  },
};
