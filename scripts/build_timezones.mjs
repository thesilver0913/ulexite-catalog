// 時差の表（v1/timezones.json）を作る。GitHub Actions が1日1回動かし、pages ブランチに置く。
//
//     node scripts/build_timezones.mjs --out dist
//
// 中身は src/timezones.js が IANA のタイムゾーンデータ（Intl）から計算する（テストは src/timezones.test.mjs）。
// Worker ではなく Actions で作るのは、計算に 0.7 秒ほどかかり、Worker の無料プランは CPU が 10ms/回のため。
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { buildTimezones } from "../src/timezones.js";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "dist";
mkdirSync(out, { recursive: true });

const file = `${out}/timezones.json`;
const table = buildTimezones();
const text = JSON.stringify(table);

// 中身（updated 以外）が変わっていなければ書かない（毎日のビルドを Pages に出さないため）
try {
  const old = JSON.parse(readFileSync(file, "utf8"));
  const { updated: _a, ...oldBody } = old;
  const { updated: _b, ...newBody } = table;
  if (JSON.stringify(oldBody) === JSON.stringify(newBody)) {
    console.log("変わっていません");
    process.exit(0);
  }
} catch {
  // 前のファイルがない（初回）ときは書く
}

writeFileSync(file, text + "\n", "utf8");
console.log(`${file}: ${Object.keys(table.zones).length} zones, ${table.cities.length} cities, ${text.length} bytes`);
