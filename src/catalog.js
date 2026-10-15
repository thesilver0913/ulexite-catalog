// 外部とやり取りしない部分（テストできるように分けておく）

export const FORMAT_VERSION = 1;

/** YouTube の動画IDか（11文字の英数字と - _）。 */
export const isVideoId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);

/** タイトルなどを配る前に整える（制御文字を除き、長さを抑える）。 */
export const clean = (s, max) => String(s ?? "")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/[\ufe0e\ufe0f\u200d]/g, "") // 絵文字の見た目の指定・つなぎ（フォントにないので □ になる。外しても見た目は変わらない）
  .trim().slice(0, max);

/**
 * ワールドが読む catalog.json。
 * genres: [{ key, rows: [{ id, title, channel, live }] }]
 */
export function buildCatalog(genres, updated) {
  return {
    version: FORMAT_VERSION,
    updated,
    genres: genres.map((g) => ({
      key: g.key,
      videos: g.rows
        .filter((r) => isVideoId(r.id))
        .map((r) => ({ id: r.id, title: clean(r.title, 200), channel: clean(r.channel, 100), live: !!r.live })),
    })),
  };
}

/** エディタ拡張がアップロード時に読む pool.json（IDだけ。タイトルなどの API のデータは入れない）。 */
export function buildPool(catalog, max) {
  const ids = [];
  const seen = new Set();
  for (const g of catalog.genres)
    for (const v of g.videos)
      if (!seen.has(v.id)) { seen.add(v.id); ids.push(v.id); }
  return { version: FORMAT_VERSION, updated: catalog.updated, ids: ids.slice(0, max) };
}

/** UTF-8 の文字列を base64 に（GitHub の API に渡す）。大きな文字列でも落ちないように少しずつ変換する。 */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
