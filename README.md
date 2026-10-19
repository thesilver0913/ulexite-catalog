# ulexite-catalog

VRChat ワールド向けのテレビ「Ulexite TV」の共通サーバー。Cloudflare Worker が各アプリのデータを作り、このリポジトリの `docs/v1/` に JSON で書き出す。GitHub Pages がそのまま配る（VRChat の String Loading は Cloudflare から直接読めないため）。

| 仕事（job） | 書き出す先 | 状態 |
| --- | --- | --- |
| `videos` 動画アプリの一覧（YouTube Data API） | `/v1/videos/` | 稼働 |
| `common` 共通の feed（地震・津波・警報・注意報。気象庁） | `/v1/feed/common.json` | 稼働 |
| 天気（気象庁の予報） | `/v1/weather/` | 予定 |
| 時差の表 | `/v1/timezones.json` | 予定 |
| アプリ・ワールドのカタログ | `/v1/apps/` など | 予定 |

**ブランチ**：`main` はコードと静的なページ（`docs/`、プライバシーポリシーなど）。Pages が配るのは `pages` ブランチで、Worker が書き出すたびに `docs/` の静的なページ＋各仕事のデータを「親のないコミット1つ」に上書きする（1日2回書いても履歴が積み上がらない）。Pages の設定は `pages` ブランチの `/`。

仕事を足すときは `src/` にファイルを作り、`src/index.js` の `JOBS` と `SCHEDULE`、`wrangler.toml` の `crons` に足す。

## 動画の一覧（videos）

```
YouTube Data API ← Cloudflare Worker（Cron、1日2回）→ D1
                         │ GitHub の API でコミット
                         ▼
GitHub Pages
  ├ /v1/videos/pool.json    … 動画IDの一覧。Unity のエディタ拡張がアップロード時に読み、URL をワールドに焼き込む
  └ /v1/videos/catalog.json … ジャンルごとの並びとタイトル。ワールドが String Loading で読む
```

- タイトルなどの API のデータは毎回取り直す（30日より古くしない）。消えた・非公開の動画は外す
- 一覧から外れた動画も60日までは候補に残す（古いワールドでも行が空になりにくいように）
- クォータの目安：人気（chart）4ジャンル＋検索4ジャンル×1日2回 ≒ 1日820ユニット（無料枠は1日10,000）

## 共通の feed（common）

テレビ本体が1分おきに読む小さなファイル。Worker も1分おきに気象庁の防災情報のページの JSON を確かめ、**中身が変わったときだけ**書き出す。

- 確かめ方：毎分、`quake/data/list.json`・`tsunami/data/list.json`・`warning/data/r8/map_time.json` の ETag だけを見る（HEAD）。変わっていれば全部読み直して feed を作り、前回の中身（`updated` を除く）のハッシュと比べる。前回の印は D1 の `kv` 表
- 書き出しは **7分に1回まで**（GitHub Pages のブランチからの公開は1時間に10回が目安。動画の分を残す）。待たせた変更は次の回に書き出す
- 地震：地震ごとに最新の発表を新しい順に10件。震度は気象庁の表記（`5弱` など）、地域は震度の大きい順に20件まで。詳しい JSON から津波の文（`tsunamiText`）と地域ごとの震度
- 津波：最新の発表に大津波警報・津波警報・津波注意報があるときだけ `{ level, text, at }`、ないときは `[]`
- 警報・注意報：2026年5月からの新しい防災気象情報（`warning/data/r8/map.json`）。区域（一次細分区域）ごと・種類ごとに最新の状態を見て、解除されていないものを府県予報区のコードにまとめる。名前は気象庁の表記（`レベル4大雨危険警報` など）。指定河川洪水予報（氾濫）は入れていない
- 気象庁の発表をそのままの形で伝えるだけで、独自の判定・予測・要約はしない（気象業務法）

### 発表からワールドで読めるまで

（測定中：本番に出したあとで、気象庁の発表時刻・書き出した時刻・Pages で読めた時刻を比べて書く）

### 気象庁のデータの使い方

- 気象庁ホームページのコンテンツは「公共データ利用規約（第1.0版）」で使える。出典を書く（例：「出典：気象庁ホームページ」）。加工したときは加工した旨を書き、国が作ったように見せない（例：「気象庁のデータをもとに Ulexite TV が作成」）。気象庁のロゴ・キャラクターは使わない（[気象庁ホームページについて](https://www.jma.go.jp/jma/kishou/info/coment.html)）
- 防災情報のページの JSON（`www.jma.go.jp/bosai/`）は、ホームページの表示用のデータで、仕様は公開されていない。ホームページのコンテンツとして上の規約で使えるが、URL や形式は予告なく変わりうる（2026年5月の防災気象情報の切り替えで、警報の JSON は `warning/data/warning/` から `warning/data/r8/` に移り、古い方は更新が止まった）。読めない・形が変わったときは、前回の feed を出し続ける（書き出さない）
- 負荷をかけないよう、毎分の確認は小さい HEAD だけにしている。公式の配信が要るなら、気象庁防災情報 XML（PULL 型）に移す

## JSON の形式（version 1）

```jsonc
// videos/catalog.json
{ "version": 1, "updated": 1760500000, "genres": [
  { "key": "popular_jp", "videos": [ { "id": "11文字のID", "title": "…", "channel": "…", "live": false } ] }
] }
// videos/pool.json
{ "version": 1, "updated": 1760500000, "ids": [ "11文字のID" ] }
// feed/common.json
{ "version": 1, "updated": 1760500000, "latest": { "tv": "0.2.0" },
  "quakes": [ { "at": "2026-10-19T15:54:00+09:00", "place": "山口県北部", "placeEn": "Northern Yamaguchi Prefecture",
                "mag": 3.1, "max": "1", "lat": 34.4, "lon": 131.5, "depth": 20,
                "tsunamiText": "この地震による津波の心配はありません。", "areas": [ { "int": "1", "name": "山口県北部" } ] } ],
  "tsunami": [],   // 出ているときは { "level": "津波注意報", "text": "…", "at": "…" }
  "warnings": { "130000": [ { "name": "雷注意報", "level": "advisory" } ] },  // level：special（5）・danger（4）・warning（3）・advisory（2）。ないときは []
  "warningsAt": "2026-10-19T21:40:00+09:00", "notices": [] }
```

後方互換を守る：項目は増やしても消さない。読む側は知らない項目を無視する。形式を変えるときは `version` を上げて別のパス（`/v2/`）に出す。

## 設置の手順

1. このリポジトリを GitHub に公開で作る（Pages の設定は、初回の書き出しで `pages` ブランチができてから「Deploy from a branch」→ `pages` の `/` を選ぶ）
2. GitHub の Settings → Developer settings → Fine-grained tokens で、このリポジトリだけ・Contents の Read and write だけのトークンを作る
3. Google Cloud の認証情報で、API キーの「API の制限」を YouTube Data API v3 だけにする
4. Cloudflare に登録し、このフォルダで次を実行する

```bash
npx wrangler login
npx wrangler d1 create ulexite-catalog        # 表示された database_id を wrangler.toml に貼る
npx wrangler d1 execute ulexite-catalog --remote --file=schema.sql
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put RUN_TOKEN             # 手動で動かすときの合言葉
npx wrangler deploy
```

5. 初回は手動で動かす（以後は自動。動画は1日2回、共通の feed は1分おき）

```bash
curl -X POST -H "Authorization: Bearer <RUN_TOKEN>" "https://ulexite-catalog.<アカウント>.workers.dev/run?job=videos"
curl -X POST -H "Authorization: Bearer <RUN_TOKEN>" "https://ulexite-catalog.<アカウント>.workers.dev/run?job=common&force"
```

## テスト

```bash
npm test
```

## プライバシーポリシー

[docs/privacy.html](docs/privacy.html)（Pages では `/privacy.html`）。

## ライセンス

[MIT](LICENSE)。Ulexite TV 本体（Unity 側）は別のライセンス（VN3）。
