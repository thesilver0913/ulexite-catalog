# ulexite-catalog

VRChat ワールド向けのテレビ「Ulexite TV」の共通サーバー。Cloudflare Worker が各アプリのデータを作り、このリポジトリの `docs/v1/` に JSON で書き出す。GitHub Pages がそのまま配る（VRChat の String Loading は Cloudflare から直接読めないため）。

| 仕事（job） | 書き出す先 | 状態 |
| --- | --- | --- |
| `videos` 動画アプリの一覧（YouTube Data API） | `/v1/videos/` | 稼働 |
| `common` 共通の feed（地震・津波・警報・注意報。気象庁） | `/v1/feed/common.json` | 稼働 |
| `weather` 天気（気象庁の予報・アメダス、日の出入りと月の計算） | `/v1/feed/weather/<府県予報区>.json` | 稼働 |
| 時差の表 | `/v1/timezones.json` | 予定 |
| アプリ・ワールドのカタログ | `/v1/apps/` など | 予定 |

**ブランチ**：`main` はコードと静的なページ（`docs/`、プライバシーポリシーなど）。Pages が配るのは `pages` ブランチで、Worker が書き出すたびに `docs/` の静的なページ＋各仕事のデータを「親のないコミット1つ」に上書きする（1日2回書いても履歴が積み上がらない）。Pages の設定は `pages` ブランチの `/`。

**いつ動くか**：cron は1分おきの1つだけで、その分にやる仕事は `src/index.js` の `jobsAt` が決めて順番に動かす（別々の cron だと同じ分に並んで動き、Pages のブランチを上書きし合うため）。

| 分（UTC） | 仕事 |
| --- | --- |
| 3時・15時の0分（日本時間の12時・24時） | `videos` だけ |
| 毎分 | `common` |
| 毎時15〜18分 | `common`＋`weather` を15件ずつ読んで D1 に置く |
| 毎時19分 | `common`＋`weather` をまとめて書き出す |

無料プランの「外への読み込みは1回50件まで」に収まるように組んである。仕事を足すときは `src/` にファイルを作り、`jobsAt` と `JOBS`（手動で動かす名前）に足す。

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

**3〜4分**（2026-10-19、日本から30秒おきに測定。Pages はワールドと同じ URL をキャッシュ破りなしで読んだ）。

| 発表 | 気象庁の発表時刻 | 気象庁のファイルで読めた | Worker が書き出し | Pages で読めた | 発表から |
| --- | --- | --- | --- | --- | --- |
| 地震（22:41 ころ、震源・震度情報） | 22:44:00 | 〜22:46:10 | 22:46:25 | 22:47:08〜14 | 約3分10秒 |
| 警報・注意報 | 23:07:00 | 23:07:47 | 23:10:25 | 23:11:07〜23 | 約4分10秒 |
| （初回の書き出し） | — | — | 22:07:54 | 22:08:39〜47 | 書き出しから約50秒 |

- 内訳：気象庁がファイルを更新するまで約1〜2分、Worker が気づくまで最大1〜2分（1分おき＋気象庁のキャッシュ60秒）、Pages の公開に約45秒〜1分。ワールドは1分おきに読むので、さらに最大1分
- Pages の `Cache-Control: max-age=600` は、公開のたびに GitHub がキャッシュを捨てるので、実際には待たされなかった（公開の直後に `Age: 0` で新しい中身が返った）。日本以外の地域では測っていない
- 7分に1回までの制限に当たると、その分だけ遅れる（最悪で約10分）。震度の大きい地震が続くときに目立つなら、地震と津波だけ制限を外すか、Pages の公開を GitHub Actions に移す（回数の目安がなくなる）

### 気象庁のデータの使い方

- 気象庁ホームページのコンテンツは「公共データ利用規約（第1.0版）」で使える。出典を書く（例：「出典：気象庁ホームページ」）。加工したときは加工した旨を書き、国が作ったように見せない（例：「気象庁のデータをもとに Ulexite TV が作成」）。気象庁のロゴ・キャラクターは使わない（[気象庁ホームページについて](https://www.jma.go.jp/jma/kishou/info/coment.html)）
- 防災情報のページの JSON（`www.jma.go.jp/bosai/`）は、ホームページの表示用のデータで、仕様は公開されていない。ホームページのコンテンツとして上の規約で使えるが、URL や形式は予告なく変わりうる（2026年5月の防災気象情報の切り替えで、警報の JSON は `warning/data/warning/` から `warning/data/r8/` に移り、古い方は更新が止まった）。読めない・形が変わったときは、前回の feed を出し続ける（書き出さない）
- 負荷をかけないよう、毎分の確認は小さい HEAD だけにしている。公式の配信が要るなら、気象庁防災情報 XML（PULL 型）に移す

## 天気（weather）

府県予報区（58件）ごとに1ファイル。毎時、予報（`forecast/data/forecast/<コード>.json`）と最新のアメダス（`amedas/data/map/…`）を読み直す。書き出しは1時間に1回。

- **予報**：気象庁の発表のまま。日ごとの並び（最大7日）は週間予報を基本に、今日・明日など週間にない値は短期予報で埋める。区域はその府県予報区の最初の一次細分区域、気温は予報の地点（アメダス）のものだけ使う。`wx` は天気のコードの大まかな種類（`100` 晴れ・`200` くもり・`300` 雨・`400` 雪）、元のコードは `wxCode`、天気の文は `wxText`（気象庁の文のまま）
- **現在の気温**：予報の地点のアメダスの最新の観測（品質が正常なものだけ。観測時刻は `current.at`）
- **日の出入り・月**：予報の地点の位置で、こちらで計算する（[suncalc](https://github.com/mourner/suncalc)、BSD-2-Clause。気象庁のデータではない。数分の誤差がある）。月相の番号は 0 新月・2 上弦・4 満月・6 下弦をその瞬間がある日だけに付け、ほかの日は 1 三日月・3 十三夜・5 寝待月・7 有明月。月齢は正午の値
- **十勝地方（014030）・奄美地方（460040）**：自分の予報のファイルがないので、親のファイル（014100・460100）から自分の区域を取る。十勝の週間予報の気温は釧路のものしかないので出さない
- `station`：予報の地点の名前と緯度・経度（地図などの代表点に使える）

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
// feed/weather/130000.json
{ "version": 1, "updatedAt": "2026-10-20T17:00:00+09:00",
  "current": { "temp": 21.7, "at": "2026-10-20T21:50:00+09:00", "wx": "200", "wxCode": "200", "wxText": "くもり 所により 夜 雨" },
  "days": [ { "date": "2026-10-21", "wx": "200", "wxCode": "201", "max": 29, "min": 20, "pop": 20 } ],  // 値がないときは null
  "sun": { "rise": "05:52", "set": "17:01" },
  "moon": { "phase": 3, "name": "十三夜", "nameEn": "Waxing Gibbous", "age": 8.7, "nextFull": "2026-10-26", "rise": "13:45", "set": null,
            "days": [ { "date": "2026-10-20", "phase": 3, "name": "十三夜", "nameEn": "Waxing Gibbous" } ] },  // 8日分。月の出・入りがない日は null
  "station": { "name": "東京", "nameEn": "Tokyo", "lat": 35.6917, "lon": 139.75 } }
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
curl -X POST -H "Authorization: Bearer <RUN_TOKEN>" "https://ulexite-catalog.<アカウント>.workers.dev/run?job=weather"   # 外への読み込みが多いので有料プラン向け。無料プランでは毎時の自動に任せる
```

## テスト

```bash
npm test
```

## プライバシーポリシー

[docs/privacy.html](docs/privacy.html)（Pages では `/privacy.html`）。

## ライセンス

[MIT](LICENSE)。Ulexite TV 本体（Unity 側）は別のライセンス（VN3）。
