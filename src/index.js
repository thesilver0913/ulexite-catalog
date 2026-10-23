// Ulexite の共通サーバー。各アプリのデータを作り、GitHub Pages（docs/v1/）に JSON で書き出す。
// 動画の一覧（videos）・共通の feed（common）・天気（weather）・天気の地図（map）・航空気象（metar）。
// アプリのカタログなどは、仕事（job）を足して同じ Worker に相乗りさせる。
// 手動で動かすときは POST /run?job=videos（Authorization: Bearer RUN_TOKEN）。&force を付けると、変わっていなくても書き出す。
// 不具合の報告フォームの受け口は POST /v1/contact（src/contact.js。サイトから送る）。

import { runVideos } from "./videos.js";
import { runCommon } from "./common.js";
import { runWeather, runWeatherBatch, publishWeather, BATCHES } from "./weather.js";
import { runMap } from "./map.js";
import { runMetar } from "./metar.js";
import { handleContact, cleanupReports } from "./contact.js";

// cron は1分おきの1つだけ（wrangler.toml）。その分にやる仕事をここで決め、順番に動かす。
// 別々の cron にすると同じ分に並んで動き、Pages のブランチを上書きし合って片方の書き出しが消えるため。
// 外への読み込みは1回50件まで（無料プラン）なので、重い仕事の分は組み合わせを絞る。
// 時差の表（timezones）は計算が重いので Worker では作らず、GitHub Actions が作る。
export function jobsAt(date) {
  const h = date.getUTCHours(), m = date.getUTCMinutes();
  if (m === 0 && (h === 3 || h === 15)) return [(env) => runVideos(env)]; // 日本時間の 12時・24時。共通の feed は次の分に回す
  const jobs = [(env) => runCommon(env)]; // 1分おきに確かめ、変わったときだけ書き出す
  if (m >= 15 && m < 15 + BATCHES) jobs.push((env) => runWeatherBatch(env, m - 15)); // 毎時15〜18分に天気を15件ずつ読む
  if (m === 15 + BATCHES) jobs.push((env) => publishWeather(env));                 // 19分にまとめて書き出す
  if (m % 20 === 5) jobs.push((env) => runMap(env));                                // 天気の地図（20分おき。変わったときだけ書き出す）
  if (m % 10 === 7) jobs.push((env) => runMetar(env));                              // 航空気象（10分おき。変わったときだけ書き出す）
  if (h === 4 && m === 30) jobs.push((env) => cleanupReports(env));                 // 不具合の報告の古い行（1年より前）を消す
  return jobs;
}

const JOBS = { videos: runVideos, common: runCommon, weather: runWeather, map: runMap, metar: runMetar };

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      for (const job of jobsAt(new Date(event.scheduledTime)))
        try { await job(env); } catch (e) { console.log(e.message); } // 1つ失敗してもほかは動かす
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    // 不具合の報告フォーム（POST と、ブラウザの事前確認の OPTIONS）
    if (url.pathname === "/v1/contact") return handleContact(request, env);
    if (request.method === "POST" && url.pathname === "/run") {
      if (!env.RUN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.RUN_TOKEN}`)
        return new Response("forbidden", { status: 403 });
      const job = JOBS[url.searchParams.get("job") ?? "videos"];
      if (!job) return new Response("unknown job", { status: 404 });
      try {
        return Response.json(await job(env, { force: url.searchParams.has("force") }));
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 }); // 秘密の値はメッセージに含めない
      }
    }
    return new Response("Ulexite server");
  },
};
