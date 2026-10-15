// GitHub のリポジトリにファイルを書き込む（Pages がそのまま配る）。

import { toBase64 } from "./catalog.js";

export async function commit(env, path, text) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}`, // 貼り付けで前後に空白や改行が入っても通るように
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ulexite-catalog",
  };
  const current = await fetch(`${url}?ref=${env.GITHUB_BRANCH}`, { headers });
  const sha = current.ok ? (await current.json()).sha : undefined;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message: `update ${path}`, content: toBase64(text), branch: env.GITHUB_BRANCH, sha }),
  });
  if (res.status === 401) {
    // トークンの中身は出さず、形だけ（前置きと長さ）を返して貼り間違いを見分ける
    const t = env.GITHUB_TOKEN.trim();
    throw new Error(`GitHub 401: token starts with "${t.slice(0, 4)}", length ${t.length} (fine-grained は gith で始まり90文字前後)`);
  }
  if (!res.ok) throw new Error(`GitHub ${path} ${res.status} ${(await res.text()).slice(0, 200)}`);
}
