// 共通の feed（v1/feed/common.json）。テレビ本体が常に読む小さなデータ：地震・津波・気象の警報・注意報・お知らせ・本体の最新の版。
// ワールドの App Services が1分おきに読む。今は形だけで、地震などの欄は取ってくる仕事を作ったときに埋める（空の一覧でも形は変えない）。
import { publish } from "./github.js";

/** 本体（Ulexite TV）の最新の版。リリースのたびに上げる。 */
export const LATEST_TV_VERSION = "0.2.0";

export function buildCommon(now = Date.now()) {
  return {
    version: 1,
    updated: Math.floor(now / 1000),
    latest: { tv: LATEST_TV_VERSION },
    quakes: [],   // 地震情報（気象庁の発表済みの情報。速報ではない）
    tsunami: [],  // 津波の警報・注意報（気象庁の発表のまま）
    warnings: [], // 気象の警報・注意報（気象庁の発表のまま）
    notices: [],  // Ulexite 公式のお知らせ（ホームのバナーの公式枠。制作者がオフにできる）
  };
}

export async function runCommon(env) {
  const common = buildCommon();
  await publish(env, { "v1/feed/common.json": JSON.stringify(common) }, "共通の feed を更新");
  return { ok: true, updated: common.updated };
}
