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
