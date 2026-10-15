# ulexite-catalog

VRChat 向けメディアプレイヤー「Ulexite Player」の共通サーバー。Cloudflare Worker が各アプリのデータを作り、このリポジトリの `docs/v1/` に JSON で書き出す。GitHub Pages がそのまま配る（VRChat の String Loading は Cloudflare から直接読めないため）。

| 仕事（job） | 書き出す先 | 状態 |
| --- | --- | --- |
| `videos` 動画アプリの一覧（YouTube Data API） | `/v1/videos/` | 稼働 |
| 天気（気象庁の予報） | `/v1/weather/` | 予定 |
| 時差の表 | `/v1/timezones.json` | 予定 |
| アプリ・ワールドのカタログ | `/v1/apps/` など | 予定 |

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

## JSON の形式（version 1）

```jsonc
// videos/catalog.json
{ "version": 1, "updated": 1760500000, "genres": [
  { "key": "popular_jp", "videos": [ { "id": "11文字のID", "title": "…", "channel": "…", "live": false } ] }
] }
// videos/pool.json
{ "version": 1, "updated": 1760500000, "ids": [ "11文字のID" ] }
```

後方互換を守る：項目は増やしても消さない。読む側は知らない項目を無視する。形式を変えるときは `version` を上げて別のパス（`/v2/`）に出す。

## 設置の手順

1. このリポジトリを GitHub に公開で作り、Settings → Pages で「Deploy from a branch」→ `main` の `/docs` を選ぶ
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

5. 初回は手動で動かす（以後は1日2回自動）

```bash
curl -X POST -H "Authorization: Bearer <RUN_TOKEN>" "https://ulexite-catalog.<アカウント>.workers.dev/run?job=videos"
```

## テスト

```bash
npm test
```

## プライバシーポリシー

[docs/privacy.html](docs/privacy.html)（Pages では `/privacy.html`）。
