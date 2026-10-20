# ulexite-catalog

VRChat ワールド向けのテレビ「Ulexite TV」の共通サーバー。Cloudflare Worker が各アプリのデータを作り、このリポジトリの `docs/v1/` に JSON で書き出す。GitHub Pages がそのまま配る（VRChat の String Loading は Cloudflare から直接読めないため）。

| 仕事（job） | 書き出す先 | 状態 |
| --- | --- | --- |
| `videos` 動画アプリの一覧（YouTube Data API） | `/v1/videos/` | 稼働 |
| `common` 共通の feed（地震・津波・警報・注意報。気象庁） | `/v1/feed/common.json` | 稼働 |
| `weather` 天気（気象庁の予報・アメダス、日の出入りと月の計算） | `/v1/feed/weather/<府県予報区>.json` | 稼働 |
| `map` 天気の地図の点（アメダスの気温・震度の観測点・震源） | `/v1/feed/weather-map.json` | 稼働 |
| `map` 天気の地図の面（雨雲・警報の透明画像。GitHub Actions が作る） | `/v1/feed/img/` | 稼働（津波は予定） |
| `timezones` 時差と夏時間の表・主要都市（IANA のタイムゾーンデータから計算） | `/v1/timezones.json` | 稼働 |
| `metar` 航空気象（METAR・TAF の読み解き。NOAA Aviation Weather Center） | `/v1/feed/metar.json` | 稼働 |
| アプリ・ワールドのカタログ | `/v1/apps/` など | 予定 |

**ブランチ**：`main` はコードと静的なページ（`docs/`、プライバシーポリシーなど）。Pages が配るのは `pages` ブランチで、Worker が書き出すたびに `docs/` の静的なページ＋各仕事のデータを「親のないコミット1つ」に上書きする（1日2回書いても履歴が積み上がらない）。Pages の設定は `pages` ブランチの `/`。

**いつ動くか**：cron は1分おきの1つだけで、その分にやる仕事は `src/index.js` の `jobsAt` が決めて順番に動かす（別々の cron だと同じ分に並んで動き、Pages のブランチを上書きし合うため）。

| 分（UTC） | 仕事 |
| --- | --- |
| 3時・15時の0分（日本時間の12時・24時） | `videos` だけ |
| 毎分 | `common` |
| 毎時15〜18分 | `common`＋`weather` を15件ずつ読んで D1 に置く |
| 毎時19分 | `common`＋`weather` をまとめて書き出す |
| 毎時5・25・45分 | `common`＋`map`（天気の地図。中身が変わったときだけ書き出す） |
| 毎時7・17・27・37・47・57分 | `common`＋`metar`（航空気象。10分おき。変わったときだけ書き出す） |
| 毎時0・30分（GitHub Actions） | `map` の画像（雨雲のコマ送り・警報の塗り分け）を作って `pages` ブランチに置く |
| 毎日 4時10分（日本時間 13時10分。GitHub Actions） | `timezones`（時差の表）を作って `pages` ブランチに置く |

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
- **府県の一部の区域だけに出ているときは、各項目に区域の名前 `regions`**（一次細分区域の名前の並び。気象庁の表記のまま）を添える。府県の区域すべてに出ているときは付けない（付いていなければ府県全体）。ワールドでは「強風注意報（伊豆諸島北部・伊豆諸島南部）」のように添えて出す
- 気象庁の発表をそのままの形で伝えるだけで、独自の判定・予測・要約はしない（気象業務法）
- **中身の作り方を変えたとき**：気象庁のデータが変わっていないと書き出されないので、`src/common.js` の `COMMON_BUILD` を上げる（上げると、次の実行で気象庁のデータが同じでも作り直して書き出す。デプロイしただけでは反映されない）

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

## 天気の地図（map）

天気アプリの地図タブのデータ。**点**は `weather-map.json`（緯度経度と値。ワールドが文字や点を並べる）、**面**は透明の PNG（画像の読み込みは1回に1枚なので、1時間ぶんのコマを1枚にまとめる）。20分おき（毎時5・25・45分）に読み直し、中身が変わったときだけ書き出す。

- **`amedas`**：アメダスの気温（`amedas/data/map/<時刻>.json` の `temp` の品質が 0 のものだけ）。そのままでは 900件ほどあり、2048px の地図では値の札が重なるので、**緯度・経度 0.5度の格子に1つ**（同じ格子では観測所のコードの小さいほう）に間引く。いまは 265件ほど・約10KB。緯度・経度は3桁まで（約 100m）
- **`quakePoints`・`quakeEpi`**：最新の「震源・震度情報」の震度の観測点（気象庁の `latlon`。震度の大きい順に300件まで）と震源。地震の古さでは切っていない（「最新の地震」として出す。時刻は `quakeEpi.at`）
- **`rainAt`**：雨雲の画像（`feed/img/rain-frames.png`）の**最初のコマ**（いちばん古い）の時刻。画像を作る GitHub Actions が `feed/img/rain.json` に書いた時刻を、Worker がそのまま写す（画像と時刻を食い違わせない）。画像がまだなければ `null`
- **面の画像**（`feed/img/`。**GitHub Actions**（`.github/workflows/map-images.yml`、30分おき）が `scripts/map_images.py` で作って `pages` ブランチに置く）：
  - `rain-frames.png`：雨雲（気象庁の降水ナウキャスト）の**12コマを 4×3 に並べた 2048×1536**（1コマ 512×512、左上がいちばん古い、5分おきで過去55分〜現在）。ワールドは1枚だけ読んで順に切り替える
  - `warn.png`：警報・注意報の塗り分け（2048×2048 の透明）。一次細分区域ごとのいちばん重い段階の色（`level5` は地がほぼ黒なので明るい線で囲む）で、その区域の市区町村の形を塗る
  - `rain.json`：`{ "version": 1, "at": "…", "to": "…", "frames": 12, "step": 5 }`（画像のコマの時刻）
  - **範囲・図法は下地の日本地図と同じ**（設計書 5.2.2）：Web メルカトル、緯度 23.5〜46.0・経度 120.86〜148.6、2048×2048。南鳥島・沖ノ鳥島は範囲の外
  - **市区町村の形**：気象庁は一次細分区域（class10）の形を配っていないので、市区町村（class20）の公式 GeoJSON（`common/const/geojson/class20s/<コード>.json`）を `scripts/build_areas.py` で1つにまとめて `data/class20s.json` に置いてある（1805件・2.2MB。区域の区切りが変わったら作り直す）
  - **津波の沿岸（`tsunami.png`）は未着手**：津波予報区の形が公開されていない（市区町村から作るには「津波予報区→市区町村」の対応表が要る）。津波はバナー・通知・一覧で伝わるので後回し
  - **回数の注意**：画像を置くたびに Pages のビルドが1回走る。30分おき＝2回/時で、共通 feed（最大8回/時）と合わせて「1時間に10回」の目安に収める。短くするなら、画像専用のリポジトリ（別の Pages）に分ける
  - **ぶつかったとき**：Worker と Actions が同じ `pages` ブランチを書き換えるので、Actions は取ってから push を繰り返す（負けたほうは次に作り直される。雨雲は30分、feed は次の回）

## 航空気象（metar）

METAR アプリが10分おきに読む。**日本の空港 38 件**の METAR（現況）と TAF（予報）を、**読み解いた形**で入れる（端末は表示するだけ。データで書くアプリの決まり）。

- **データ**：米国 NOAA の Aviation Weather Center の Data API（キー不要）。**METAR と TAF で1回ずつ**、**空港コードを並べて1回で取る**（`format=json`。`hours` は付けない＝付けると報告が複数返り、多いときに取りこぼす）。エンドポイントごとに1分1回までの決まりに収まる。独自の User-Agent を名乗る
- **空港は固定**（`src/metar.js` の `AIRPORTS`。日本の主要 38 件。名称は日本語・英語の短い名前と正式名）。共通サーバーはワールドごとの設定を知らないので、制作者が追加できるのはこの中のコードだけ。増やすときは `AIRPORTS` に足す（ICAO コード・名前・正式名）
- **METAR の読み解き**（`readMetar`）：電文をそのまま出すための `raw` と `parts`（空港コードを [ ] で囲んで並べる用）に加えて、
  - `wind`：`dir`（度）・`kt`・`gust`・`variable`（VRB）・`nameJa`（北北西）・`nameEn`（NNW）・`calm`
  - `vis`：`m`（メートル。9999 と CAVOK は 10000）・`over`（以上）・`textJa`（10km以上・1.2km・800m）
  - `clouds`：低い順に `cover`（FEW/SCT/BKN/OVC/VV）・`base`（ft）・`code`（FEW030）・`textJa`（少し 3,000ft）
  - `wx`：天気（`code`・`textJa`（弱いにわか雨）・`textEn`）。なければ `null`
  - `tempC`・`dewpC`・`qnh`（hPa）・`qnhInHg`（小さく併記する用。1021 → 30.15）・`fltCat`（VFR/MVFR/IFR/LIFR）
- **TAF**：`raw`・`parts`・`at`（発行時刻）
- **時刻**：`at`（日本時間の ISO。例 `2026-10-21T00:00:00+09:00`）と `atZ`（UTC の ISO）。`raw` の中の `201500Z` は観測の時刻
- **飛行区分**：AWC の `fltCat` をそのまま使う。ないときは視程と天井（BKN・OVC・VV のいちばん低い層）から計算する
- 出典「NOAA Aviation Weather Center」と「実際の運航には使わないでください」をアプリに出す（`source` と `notice` も入れてある。表示はアプリの翻訳表のほうを使う）
- 大きさは約 43KB（38 件）。10分おきに読む

## 時差の表（timezones）

時計アプリの世界時計が読む。**主要都市 40 件**と、その**標準時の UTC からのずれ（分）**、**夏時間の決まり**。Udon はタイムゾーンの機能を持てない（`TimeZoneInfo` が使えない）ので、時差を自分で計算できる形で配る。

- 出す内容は **IANA のタイムゾーンデータ**（Node の `Intl` のタイムゾーン機能）から計算する。**GitHub Actions が1日1回**（`.github/workflows/timezones.yml`、日本時間 13時10分ごろ）作り直して `pages` ブランチに置く。夏時間の決まりが国で変わっても、ワールドの再アップロードなしで追随できる
- **Worker では作らない**：35 のタイムゾーン × 12年ぶんの切り替わりを探すのに 0.7 秒ほどかかり、Worker の無料プランは CPU が 10ms/回のため（`scripts/build_timezones.mjs` が Actions から呼ぶ）
- **夏時間の決まり**は「**その月の day 日以降で最初の weekday の、現地の標準時で minute 分**」で書く（`weekday` は 0=日曜）。第n 曜日も「最後の◯曜日」もこの形で表せる（例：3月最後の日曜＝`day: 25`、11月の第1日曜＝`day: 1`、チリの「9月2日以降で最初の日曜」＝`day: 2`）
  - 南半球は始まりと終わりが逆になる。**終わりが始まりより前なら、夏時間は「終わりまで」または「始まりから」**
  - `save` は夏時間で進む分（ほとんどは 60）
  - 決まりで表せない地域（モロッコのラマダンなど）は `transitions`（`[[UNIX秒, 時差], …]` の並び）で出す。いまの 40 都市はすべて決まりで表せている
- **作り方**：いまから1年前〜11年後の切り替わりを1日ずつ見つけて（1分まで詰める）、その並びが毎年同じ形なら決まりにし、**実際の切り替わりと合うかをその場で確かめる**。合わなければ `transitions` にする
- **都市**：`key`（保存に使う名前。変えない）・`name`（日本語）・`nameEn`・`zone`（IANA の名前）・`lat`・`lon`。都市を増やすときは `src/timezones.js` の `CITIES` に足す
- IANA のタイムゾーンデータはパブリックドメイン（出典の表記は要らない）。表の中の `source` にその旨を書いている

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
  "tsunami": [],   // 出ているときは { "level": "津波注意報", "rank": 1, "text": "…", "at": "…" }（rank は 1 注意報・2 警報・3 大津波警報）
  "warnings": { "130000": [ { "name": "雷注意報", "level": "advisory" },
                            { "name": "強風注意報", "level": "advisory", "regions": ["伊豆諸島北部", "伊豆諸島南部"] } ] },  // level：special（5）・danger（4）・warning（3）・advisory（2）。ないときは []。regions は府県の一部の区域だけのとき（府県全体なら無し）
  "warningsAt": "2026-10-19T21:40:00+09:00", "notices": [] }
// feed/weather/130000.json
{ "version": 1, "updatedAt": "2026-10-20T17:00:00+09:00",
  "current": { "temp": 21.7, "at": "2026-10-20T21:50:00+09:00", "wx": "200", "wxCode": "200", "wxText": "くもり 所により 夜 雨" },
  "days": [ { "date": "2026-10-21", "wx": "200", "wxCode": "201", "max": 29, "min": 20, "pop": 20 } ],  // 値がないときは null
  "sun": { "rise": "05:52", "set": "17:01" },
  "moon": { "phase": 3, "name": "十三夜", "nameEn": "Waxing Gibbous", "age": 8.7, "nextFull": "2026-10-26", "rise": "13:45", "set": null,
            "days": [ { "date": "2026-10-20", "phase": 3, "name": "十三夜", "nameEn": "Waxing Gibbous" } ] },  // 8日分。月の出・入りがない日は null
  "station": { "name": "東京", "nameEn": "Tokyo", "lat": 35.6917, "lon": 139.75 } }
// feed/weather-map.json
{ "version": 1, "updated": 1760500000,
  "rainAt": null,   // 雨雲の画像の最初のコマの時刻。まだ作っていないので null
  "amedasAt": "2026-10-20T22:50:00+09:00",
  "amedas": [ { "lat": 35.692, "lon": 139.75, "t": 18.4 } ],   // 0.5度の格子に1つ。品質が正常な気温だけ
  "quakePoints": [ { "lat": 35.65, "lon": 140.05, "int": "4" } ],  // 震度は気象庁の表記（"5弱" など）
  "quakeEpi": { "lat": 35.7, "lon": 140.1, "max": "5弱", "place": "千葉県北西部", "at": "2026-10-19T10:00:00+09:00" } }  // 地震がないときは null
// timezones.json
{ "version": 1, "updated": 1760500000, "source": "IANA タイムゾーンデータ（Intl から計算）",
  "zones": {
    "Asia/Tokyo": { "offset": 540 },   // 夏時間がない地域は offset だけ
    "Europe/London": { "offset": 0, "dst": { "save": 60,
        "start": { "month": 3, "day": 25, "weekday": 0, "minute": 60 },   // 3月25日以降で最初の日曜の 1:00（標準時）
        "end":   { "month": 10, "day": 25, "weekday": 0, "minute": 60 } } },
    "Australia/Sydney": { "offset": 600, "dst": { "save": 60,
        "start": { "month": 10, "day": 1, "weekday": 0, "minute": 120 },  // 南半球：終わり（4月）が始まりより前
        "end":   { "month": 4, "day": 1, "weekday": 0, "minute": 120 } } }
  },
  "cities": [ { "key": "Tokyo", "name": "東京", "nameEn": "Tokyo", "zone": "Asia/Tokyo", "lat": 35.68, "lon": 139.69 } ] }
// feed/metar.json
{ "version": 1, "updated": 1760500000, "source": "NOAA Aviation Weather Center", "notice": "実際の運航には使わないでください",
  "airports": [ { "icao": "RJTT", "name": "東京（羽田）", "long": "東京国際空港（羽田）", "nameEn": "Tokyo (Haneda)", "longEn": "…",
    "lat": 35.553, "lon": 139.781, "at": "2026-10-21T00:00:00+09:00", "atZ": "2026-10-20T15:00:00Z", "fltCat": "VFR",
    "metar": { "raw": "METAR RJTT 201500Z 34008KT 9999 FEW030 18/09 Q1021 NOSIG",
      "parts": ["METAR", "RJTT", "201500Z", "34008KT", "9999", "FEW030", "18/09", "Q1021", "NOSIG"],
      "wind": { "dir": 340, "kt": 8, "gust": null, "variable": false, "nameJa": "北北西", "nameEn": "NNW", "calm": false },
      "vis": { "m": 10000, "over": true, "textJa": "10km以上", "textEn": "10 km or more" },
      "clouds": [ { "cover": "FEW", "base": 3000, "code": "FEW030", "textJa": "少し 3,000ft", "textEn": "Few 3,000 ft" } ],
      "wx": null, "tempC": 18, "dewpC": 9, "qnh": 1021, "qnhInHg": 30.15, "fltCat": "VFR", "obsTime": "2015Z" },
    "taf": { "raw": "TAF RJTT 201105Z 2012/2118 30006KT 9999 FEW010 BKN020", "parts": ["TAF", "RJTT", "…"], "at": "2026-10-20T11:05:00.000Z" } } ] }
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
curl -X POST -H "Authorization: Bearer <RUN_TOKEN>" "https://ulexite-catalog.<アカウント>.workers.dev/run?job=map&force"
curl -X POST -H "Authorization: Bearer <RUN_TOKEN>" "https://ulexite-catalog.<アカウント>.workers.dev/run?job=metar&force"
```

## テスト

```bash
npm test
```

地図の画像は Python（Pillow）で作る。`--check` を付けると、下地の陸に重ねた確認用の画像も作る（`scripts/` は Actions と同じもの。手元で1回動かして見た目を確かめられる）。

```bash
python scripts/build_areas.py                     # data/class20s.json を作り直す（区域の区切りが変わったとき）
python scripts/map_images.py --out dist --check   # dist/ に rain-frames.png・rain.json・warn.png と確認用の画像
node scripts/build_timezones.mjs --out dist       # dist/ に timezones.json（時差の表）
```

## プライバシーポリシー

[docs/privacy.html](docs/privacy.html)（Pages では `/privacy.html`）。

## ライセンス

[MIT](LICENSE)。Ulexite TV 本体（Unity 側）は別のライセンス（VN3）。
