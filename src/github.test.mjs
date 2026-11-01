// node src/github.test.mjs で確認する（GitHub には繋がない。fetch を差し替える）
import assert from "node:assert/strict";
import { publish, beginBatch, flushBatch } from "./github.js";

const realFetch = globalThis.fetch;
const calls = [];
let failNext = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, path: u.pathname, body });
  if (failNext > 0) { failNext--; return new Response("boom", { status: 500 }); }
  const p = u.pathname;
  if (p.includes("/git/ref/heads/")) return Response.json({ object: { sha: "refsha" } });
  if (p.includes("/git/commits/refsha")) return Response.json({ tree: { sha: "treesha" } });
  if (p.endsWith("/git/trees/treesha")) return Response.json({ tree: [{ type: "blob", path: "v1/feed/common.json", sha: "abc", mode: "100644" }] });
  if (p.endsWith("/git/trees")) return Response.json({ sha: "newtree" });
  if (p.endsWith("/git/commits")) return Response.json({ sha: "newcommit" });
  return Response.json({});
};

const inserts = [];
const env = {
  PAGES_BRANCH: "pages",
  GITHUB_BRANCH: "main",
  GITHUB_REPO: "owner/repo",
  GITHUB_TOKEN: "g" + "x".repeat(39),
  DB: {
    prepare(sql) {
      return {
        bind(...a) { return this; },
        async run() { inserts.push(sql); return { meta: {} }; },
        async first() { return null; },
      };
    },
  },
};

const commits = () => calls.filter((c) => c.path.endsWith("/git/commits") && c.method === "POST");
const trees = () => calls.filter((c) => c.path.endsWith("/git/trees") && c.method === "POST");

// まとめると、2つの仕事の書き出しが1コミットになる
beginBatch(env);
await publish(env, { "v1/feed/weather/130000.json": "{}" }, "天気を更新");
await publish(env, { "v1/feed/metar.json": "{}" }, "航空気象を更新");
assert.equal(commits().length, 0, "まとめているあいだは書かない");
const flushed = await flushBatch(env);
assert.deepEqual(flushed, { ok: true, files: 2 });
assert.equal(commits().length, 1, "1コミットだけ");
const message = commits()[0].body.message;
assert.match(message, /天気を更新/, message);
assert.match(message, /航空気象を更新/, message);
const tree = trees().at(-1).body.tree.map((t) => t.path);
assert.ok(tree.includes("v1/feed/metar.json"), "まとめたファイルがツリーに入る");
assert.ok(tree.includes("v1/feed/weather/130000.json"), "まとめたファイルがツリーに入る");
assert.ok(tree.includes("v1/feed/common.json"), "前から配っているものも残る");

// まとめていないときは、その場で書く
calls.length = 0;
await publish(env, { "v1/feed/map.json": "{}" }, "地図を更新");
assert.equal(commits().length, 1);

// 何も溜まっていなければ、書きに行かない
calls.length = 0;
beginBatch(env);
assert.deepEqual(await flushBatch(env), { ok: true, empty: true });
assert.equal(calls.length, 0);

// 書き出しに失敗したら、やり直してから「変わった」の印を消す
calls.length = 0;
inserts.length = 0;
beginBatch(env);
await publish(env, { "v1/feed/radio.json": "{}" }, "ラジオを更新");
failNext = 3; // 3回とも失敗させる
await assert.rejects(() => flushBatch(env), /boom/);
assert.match(inserts.join("\n"), /DELETE FROM kv/, "印を消して、次の回に書き直せるようにする");
assert.ok(inserts.some((s) => s.includes("common.hash")));

globalThis.fetch = realFetch;
console.log("ok");
