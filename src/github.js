// GitHub Pages に配るファイルを書き出す。
// 配る用のブランチ（PAGES_BRANCH）は、いつも「親のないコミット1つ」に上書きする。
// 1日2回書いても履歴が積み上がらず、リポジトリが太らない（古い中身は GitHub が後で片付ける）。
// ブランチの中身：main の docs/ の静的なページ（プライバシーポリシーなど）＋各仕事が書き出したデータ。
// ほかの仕事（天気など）が書いたデータは消さずに残す。

const API = "https://api.github.com";

function headers(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}`, // 貼り付けで前後に空白や改行が入っても通るように
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ulexite-catalog",
  };
}

async function gh(env, method, path, body) {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: headers(env),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    // トークンの中身は出さず、形だけ（前置きと長さ）を返して貼り間違いを見分ける
    const t = env.GITHUB_TOKEN.trim();
    throw new Error(`GitHub 401: token starts with "${t.slice(0, 4)}", length ${t.length} (fine-grained は gith で始まり90文字前後)`);
  }
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new Error(`GitHub ${method} ${path} ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** ブランチの中のファイルの一覧（パス → blob の sha と mode）。ブランチがなければ空。 */
async function listFiles(env, branch, prefix) {
  const ref = await gh(env, "GET", `/git/ref/heads/${branch}`);
  if (!ref) return new Map();
  const commit = await gh(env, "GET", `/git/commits/${ref.object.sha}`);
  const tree = await gh(env, "GET", `/git/trees/${commit.tree.sha}?recursive=1`);
  const files = new Map();
  for (const e of tree.tree)
    if (e.type === "blob" && e.path.startsWith(prefix)) files.set(e.path.slice(prefix.length), { sha: e.sha, mode: e.mode });
  return files;
}

/**
 * files（パス → 文字列）を書き出す。パスは Pages のいちばん上から（例：v1/videos/catalog.json）。
 * beginBatch のあいだは、実際には書かずに溜める（1回の実行の複数の仕事を1コミットにまとめ、
 * Pages のビルドが重なって失敗するのを減らす）。まとめたものは flushBatch で書く。
 */
export async function publish(env, files, message) {
  const batch = batches.get(env);
  if (batch) {
    for (const [path, text] of Object.entries(files)) batch.files.set(path, text);
    batch.messages.push(message);
    return;
  }
  await publishNow(env, files, message);
}

const batches = new WeakMap(); // env → { files: Map, messages: [] }

/** ここから flushBatch まで、publish は溜めるだけになる。 */
export function beginBatch(env) {
  batches.set(env, { files: new Map(), messages: [] });
}

/**
 * 溜めたものを1コミットで書く。失敗したら数回やり直し、それでもだめなら
 * 「変わった」の印（kv のハッシュ）を消して、次の回にまた書き直せるようにする。
 */
export async function flushBatch(env, fallback = "データを更新") {
  const batch = batches.get(env);
  if (!batch) return { ok: true, skipped: true };
  batches.delete(env);
  if (!batch.files.size) return { ok: true, empty: true };
  const files = Object.fromEntries(batch.files);
  const messages = [...new Set(batch.messages)].filter(Boolean);
  const message = (messages.join("／") || fallback).slice(0, 120);
  for (let attempt = 1; ; attempt++) {
    try {
      await publishNow(env, files, message);
      return { ok: true, files: batch.files.size };
    } catch (e) {
      if (attempt >= 3) {
        await resetHashes(env);
        throw e;
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** 書き出しに失敗したときに「変わった」の印を消す（次の回でまた書き直す）。 */
async function resetHashes(env) {
  try {
    await env.DB.prepare(
      "DELETE FROM kv WHERE key IN ('common.hash', 'metar.hash', 'map.hash', 'radio.hash') OR key LIKE 'weather.%'",
    ).run();
  } catch (e) {
    console.log("reset hashes failed: " + e.message);
  }
}

/** 実際に1コミット書く。 */
async function publishNow(env, files, message) {
  const branch = env.PAGES_BRANCH;
  const current = await listFiles(env, branch, "");              // 今配っているもの（ほかの仕事のデータを残す）
  const pages = await listFiles(env, env.GITHUB_BRANCH, "docs/"); // main の docs/ の静的なページ
  const entries = new Map(current);
  for (const [path, file] of pages) if (!path.startsWith("v1/")) entries.set(path, file);
  for (const [path, text] of Object.entries(files)) entries.set(path, { mode: "100644", content: text }); // 中身を直接渡すと GitHub が blob を作る（ファイルの数だけ API を呼ばない）
  const tree = await gh(env, "POST", "/git/trees", {
    tree: [...entries].map(([path, f]) => ({ path, mode: f.mode, type: "blob", ...(f.content !== undefined ? { content: f.content } : { sha: f.sha }) })),
  });
  const commit = await gh(env, "POST", "/git/commits", { message, tree: tree.sha, parents: [] });
  const ref = await gh(env, "GET", `/git/ref/heads/${branch}`);
  if (ref) await gh(env, "PATCH", `/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
  else await gh(env, "POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: commit.sha });
}
