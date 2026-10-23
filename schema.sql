-- 動画の情報（毎回取り直す。25日より古いものは消す）
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  live INTEGER NOT NULL DEFAULT 0,
  refreshed INTEGER NOT NULL
);

-- ジャンルごとの順位と、最後に一覧に出てきた時刻
CREATE TABLE IF NOT EXISTS ranks (
  genre TEXT NOT NULL,
  id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  PRIMARY KEY (genre, id)
);

-- 小さな状態（共通の feed の前回の中身の印など）。仕事が自分でも作る
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 不具合の報告フォーム（POST /v1/contact）で送られたもの。1年で消す（Cron で古い行を削除）
-- 連絡先は受け取らない。IP は保存しない（レート用のハッシュは KV に24時間だけ）
CREATE TABLE IF NOT EXISTS contact_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,              -- bug・request・other
  version TEXT NOT NULL,           -- Ulexite TV のバージョン
  env TEXT NOT NULL,               -- pc,quest,vr,desktop のカンマ区切り
  world TEXT NOT NULL DEFAULT '',  -- ワールド名（任意）
  body TEXT NOT NULL,              -- 起きたこと
  error TEXT NOT NULL DEFAULT '',  -- エラーの内容（任意）
  status TEXT NOT NULL DEFAULT 'new'
);
