import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker, { encryptToken, hash, validPost } from "../publishing-worker/src/worker.mjs";

const ORIGIN = "https://g1rmmr-blog-publisher.blckhnd-std.workers.dev";
const ID = "52289794";
const REQUEST = "4b71a562-9091-469d-a89d-8fb160bb9b1d";
const COMMIT = "a".repeat(40);
const TOKEN = "test-user-token";
function environment() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../analytics-worker/migrations/0001_views.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../analytics-worker/migrations/0002_publishing.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../analytics-worker/migrations/0004_post_management.sql", import.meta.url), "utf8"));
  return { PUBLISHER_ORIGIN: ORIGIN, GITHUB_OWNER_ID: ID, GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "test-secret", TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)), ASSETS: { fetch: async () => new Response("PRIVATE EDITOR") }, db,
    DB: { prepare: sql => { const stmt = db.prepare(sql.replace(/\?\d+/g, "?")); let values = []; return { bind(...args) { values = args; return this; }, async run() { return stmt.run(...values); }, async first() { return stmt.get(...values) ?? null; }, async all() { return { results: stmt.all(...values) }; } }; }, batch: statements => Promise.all(statements.map(s => s.run())) } };
}
async function authenticated(env, userId = ID) {
  const cookie = "s".repeat(43); const csrf = "csrf-test";
  env.db.prepare("INSERT INTO publisher_sessions VALUES (?, ?, ?, ?, ?)").run(await hash(cookie), userId, await encryptToken(TOKEN, env), csrf, Math.floor(Date.now()/1000)+3600);
  return { Cookie: `__Host-blog_session=${cookie}`, Origin: ORIGIN, "X-CSRF-Token": csrf, "Content-Type": "application/json" };
}
const call = (env, path, options = {}) => worker.fetch(new Request(ORIGIN + path, options), env);
const response = (data, status = 200) => Response.json(data, { status });
async function upstream(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    // Workers accepts only manual/follow, unlike Node's broader Fetch API.
    assert.equal(options.redirect, "manual");
    return handler(url, options);
  };
  try { await fn(); } finally { globalThis.fetch = original; }
}

test("fails closed before configuration and protects every editor URL", async () => {
  const env = environment(); delete env.GITHUB_CLIENT_SECRET;
  assert.equal((await call(env, "/write/")).status, 503);
  env.GITHUB_CLIENT_SECRET = "secret";
  for (const path of ["/write", "/write/", "/write/index.html"]) {
    const r = await call(env, path); assert.equal(r.status, 302); assert.equal(r.headers.get("Location"), ORIGIN + "/auth/login");
  }
  assert.equal((await call(env, "/api/session")).status, 401);
  assert.equal((await call(env, "/api/posts", { method: "POST" })).status, 401);
  assert.equal(env.db.prepare("SELECT count(*) n FROM post_views").get().n, 0);
});
test("owner ID and expiry are checked even with a valid encrypted session", async () => {
  const env = environment(); const headers = await authenticated(env, "999");
  assert.equal((await call(env, "/api/session", { headers })).status, 401);
  env.db.prepare("UPDATE publisher_sessions SET user_id = ?, expires_at = 0").run(ID);
  assert.equal((await call(env, "/api/session", { headers })).status, 401);
});
test("OAuth uses PKCE and one-time cookie-bound state; tokens stay encrypted", async () => {
  const env = environment(); const start = await call(env, "/auth/login");
  const target = new URL(start.headers.get("Location")); const state = target.searchParams.get("state");
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.match(start.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await call(env, `/auth/callback?state=${state}&code=test`)).status, 400);
  const pending = env.db.prepare("SELECT * FROM publisher_oauth").get();
  assert.equal(await hash(pending.verifier), target.searchParams.get("code_challenge"));
  await upstream(async (url, options) => {
    if (url.includes("access_token")) { assert.equal(JSON.parse(options.body).code_verifier, pending.verifier); return response({ access_token: TOKEN, expires_in: 28800 }); }
    if (url.endsWith("/user")) return response({ id: Number(ID) });
    return response({ permissions: { push: true } });
  }, async () => {
    const headers = { Cookie: `__Host-blog_oauth=${state}` };
    const r = await call(env, `/auth/callback?state=${state}&code=test`, { headers });
    assert.equal(r.status, 302);
    const cookies = r.headers.getSetCookie();
    assert.ok(cookies.some(x => x.startsWith("__Host-blog_session=")));
    assert.ok(!cookies.join().includes(TOKEN));
    assert.ok(!env.db.prepare("SELECT token_ciphertext FROM publisher_sessions").get().token_ciphertext.includes(TOKEN));
    assert.equal((await call(env, `/auth/callback?state=${state}&code=test`, { headers })).status, 400);
  });
});
test("OAuth rejects another GitHub account without creating a session", async () => {
  const env = environment(); const start = await call(env, "/auth/login"); const state = new URL(start.headers.get("Location")).searchParams.get("state");
  await upstream(async url => response(url.includes("access_token") ? { access_token: TOKEN } : { id: 999 }), async () => {
    assert.equal((await call(env, `/auth/callback?state=${state}&code=test`, { headers: { Cookie: `__Host-blog_oauth=${state}` } })).status, 403);
    assert.equal(env.db.prepare("SELECT count(*) n FROM publisher_sessions").get().n, 0);
  });
});
test("CSRF, untrusted origins and extra path or branch fields cannot publish", async () => {
  const env = environment(); const headers = await authenticated(env);
  const body = JSON.stringify({ request_id: REQUEST, title: "제목", body: "본문" });
  for (const changed of [{ Origin: "https://attacker.example" }, { "X-CSRF-Token": "wrong" }]) {
    assert.equal((await call(env, "/api/posts", { method: "POST", headers: { ...headers, ...changed }, body })).status, 403);
  }
  assert.equal((await call(env, "/api/posts", { method: "POST", headers, body: JSON.stringify({ request_id: REQUEST, title: "t", body: "b", branch: "other", path: "../x" }) })).status, 400);
  assert.equal(validPost({ request_id: "../../x", title: "t", body: "b" }), false);
  assert.equal(validPost({ request_id: REQUEST, title: "t\nscript", body: "b" }), false);
  assert.equal(env.db.prepare("SELECT count(*) n FROM publisher_posts").get().n, 0);
});
test("publishes Unicode to fixed repository/main and deduplicates retries", async () => {
  const env = environment(); const headers = await authenticated(env); let writes = 0;
  await upstream(async (url, options) => {
    assert.ok(url.startsWith("https://api.github.com/repos/G1rmmr/G1rmmr.github.io/contents/docs/posts/"));
    if (options.method === "PUT") {
      writes++; const body = JSON.parse(options.body);
      assert.equal(body.branch, "main"); assert.equal(body.sha, undefined);
      assert.equal(Buffer.from(body.content, "base64").toString(), "# 제목\n\n긴 본문 한글\n");
      return response({ commit: { sha: COMMIT } }, 201);
    }
    return response({}, 404);
  }, async () => {
    const body = JSON.stringify({ request_id: REQUEST, title: "제목", body: "긴 본문 한글" });
    for (let i = 0; i < 2; i++) {
      const r = await call(env, "/api/posts", { method: "POST", headers, body });
      assert.equal(r.status, 200); assert.equal((await r.json()).sha, COMMIT);
    }
    assert.equal(writes, 1);
    assert.equal((await call(env, "/api/posts", { method: "POST", headers, body: JSON.stringify({ request_id: REQUEST, title: "수정", body: "다름" }) })).status, 409);
  });
});
test("recovers a lost PUT response without duplication or overwriting", async () => {
  const env = environment(); const headers = await authenticated(env); let written = false; let writes = 0;
  await upstream(async (url, options) => {
    if (options.method === "PUT") { writes++; written = true; throw new Error("response lost"); }
    if (url.includes("/commits?")) return response([{ sha: COMMIT }]);
    return written ? response({ type: "file", encoding: "base64", content: Buffer.from("# 제목\n\n본문\n").toString("base64") }) : response({}, 404);
  }, async () => {
    const body = JSON.stringify({ request_id: REQUEST, title: "제목", body: "본문" });
    assert.equal((await call(env, "/api/posts", { method: "POST", headers, body })).status, 503);
    const retry = await call(env, "/api/posts", { method: "POST", headers, body });
    assert.equal(retry.status, 200); assert.equal((await retry.json()).sha, COMMIT); assert.equal(writes, 1);
  });
});
test("deployment status distinguishes pending, running, failure and success", async () => {
  const env = environment(); const headers = await authenticated(env);
  for (const [run, expected] of [[null, "pending"], [{ status: "in_progress" }, "running"], [{ status: "completed", conclusion: "failure" }, "failure"], [{ status: "completed", conclusion: "success" }, "success"]]) {
    await upstream(async () => response({ workflow_runs: run ? [{ id: 1, head_sha: COMMIT, ...run }] : [] }), async () => {
      const r = await call(env, `/api/deployment?sha=${COMMIT}`, { headers }); assert.equal((await r.json()).status, expected);
    });
  }
});

test("malformed and oversized requests cannot reserve files", async () => {
  const env = environment(); const headers = await authenticated(env);
  assert.equal((await call(env, "/api/posts", { method: "POST", headers, body: "not json" })).status, 400);
  assert.equal((await call(env, "/api/posts", { method: "POST", headers, body: "x".repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal(env.db.prepare("SELECT count(*) n FROM publisher_posts").get().n, 0);
});

test("expired OAuth state, tampered sessions and logout fail safely", async () => {
  const env = environment();
  const start = await call(env, "/auth/login");
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  env.db.prepare("UPDATE publisher_oauth SET expires_at = 0").run();
  assert.equal((await call(env, `/auth/callback?state=${state}&code=test`, { headers: { Cookie: `__Host-blog_oauth=${state}` } })).status, 400);
  const headers = await authenticated(env);
  const loggedOut = await call(env, "/auth/logout", { method: "POST", headers, body: "{}" });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal((await call(env, "/api/session", { headers })).status, 401);
  await authenticated(env);
  env.db.prepare("UPDATE publisher_sessions SET token_ciphertext = 'corrupt'").run();
  assert.equal((await call(env, "/api/session", { headers })).status, 503);
});

test("image uploads require authentication, CSRF and a supported binary signature", async () => {
  const env = environment(); const headers = await authenticated(env);
  const body = new Uint8Array([137,80,78,71,13,10,26,10]);
  assert.equal((await call(env, "/api/images", { method: "POST", headers: { "Content-Type": "image/png" }, body })).status, 401);
  assert.equal((await call(env, "/api/images", { method: "POST", headers: { ...headers, "Content-Type": "image/png", "X-CSRF-Token": "wrong" }, body })).status, 403);
  assert.equal((await call(env, "/api/images", { method: "POST", headers: { ...headers, "Content-Type": "image/png" }, body: "<svg/>" })).status, 415);
  assert.equal((await call(env, "/api/images", { method: "POST", headers: { ...headers, "Content-Type": "image/png" }, body: new Uint8Array(5 * 1024 * 1024 + 1) })).status, 413);
});

test("identical images reuse a content-addressed path without duplicate commits", async () => {
  const env = environment(); const headers = { ...await authenticated(env), "Content-Type": "image/png" };
  const body = new Uint8Array([137,80,78,71,13,10,26,10]);
  let writes = 0; let stored = false;
  await upstream(async (url, options) => {
    assert.match(url, /\/contents\/docs\/img\/uploads\/[0-9a-f]{64}\.png/);
    if (options.method === "PUT") { writes++; stored = true; assert.equal(JSON.parse(options.body).branch, "main"); return response({ commit: { sha: COMMIT } }, 201); }
    return stored ? response({ type: "file" }) : response({}, 404);
  }, async () => {
    const one = await call(env, "/api/images", { method: "POST", headers, body });
    const two = await call(env, "/api/images", { method: "POST", headers, body });
    assert.equal(one.status, 200); assert.equal(two.status, 200);
    assert.deepEqual(await one.json(), await two.json()); assert.equal(writes, 1);
  });
});

const PATH = "docs/posts/2025-12-8.md";
const OLD = "b".repeat(40);
const NEW = "c".repeat(40);
const fileResponse = (content, sha = OLD) => response({ type: "file", encoding: "base64", content: Buffer.from(content).toString("base64"), size: Buffer.byteLength(content), sha });

test("lists all legacy and new posts by title, excluding generated index", async () => {
  const env = environment(); const headers = await authenticated(env);
  await upstream(async url => url.endsWith("/contents/docs/posts?ref=main")
    ? response([{ path: PATH, name: "2025-12-8.md", type: "file", sha: OLD }, { path: "docs/posts/index.md", name: "index.md", type: "file", sha: OLD }])
    : fileResponse("# 실제 제목\n\n본문\n"), async () => {
    const list = await call(env, "/api/posts", { headers });
    assert.deepEqual((await list.json()).posts, [{ path: PATH, sha: OLD, title: "실제 제목" }]);
    const loaded = await call(env, `/api/post?path=${PATH}`, { headers });
    assert.deepEqual(await loaded.json(), { path: PATH, sha: OLD, title: "실제 제목", body: "본문\n" });
  });
});

test("updates preserve metadata, newline format and path, and safely reject stale versions", async () => {
  const env = environment(); const headers = await authenticated(env);
  let content = "---\r\ndate: 2025-12-08\r\n---\r\n\r\n# 제목\r\n\r\n본문\r\n";
  let sha = OLD; let writes = 0;
  await upstream(async (url, options) => {
    if (url.includes("/commits?")) return response([]);
    if (options.method === "PUT") {
      const data = JSON.parse(options.body); writes++;
      assert.equal(data.branch, "main"); assert.equal(data.sha, OLD);
      content = Buffer.from(data.content, "base64").toString(); sha = NEW;
      assert.equal(content, "---\r\ndate: 2025-12-08\r\n---\r\n\r\n# 수정 제목\r\n\r\n수정 본문\r\n");
      return response({ commit: { sha: COMMIT }, content: { sha: NEW } });
    }
    return fileResponse(content, sha);
  }, async () => {
    const body = JSON.stringify({ request_id: REQUEST, path: PATH, sha: OLD, title: "수정 제목", body: "수정 본문\n" });
    for (let i = 0; i < 2; i++) {
      const result = await call(env, "/api/post", { method: "PUT", headers, body });
      assert.equal(result.status, 200); assert.equal((await result.json()).blob_sha, NEW);
    }
    assert.equal(writes, 1);
    const conflict = await call(env, "/api/post", { method: "PUT", headers, body: JSON.stringify({ request_id: crypto.randomUUID(), path: PATH, sha: OLD, title: "다른 수정", body: "본문" }) });
    assert.equal(conflict.status, 409); assert.equal(writes, 1);
  });
});

test("deletion requires the exact loaded version and is retry-safe", async () => {
  const env = environment(); const headers = await authenticated(env); let deletes = 0;
  await upstream(async (url, options) => {
    if (url.includes("/commits?")) return response([]);
    if (options.method === "DELETE") { deletes++; const body = JSON.parse(options.body); assert.equal(body.sha, OLD); assert.equal(body.branch, "main"); return response({ commit: { sha: COMMIT }, content: null }); }
    return fileResponse("# 제목\n\n본문\n");
  }, async () => {
    const body = JSON.stringify({ request_id: REQUEST, path: PATH, sha: OLD });
    for (let i = 0; i < 2; i++) {
      const result = await call(env, "/api/post", { method: "DELETE", headers, body });
      assert.equal(result.status, 200); const data = await result.json(); assert.equal(data.deleted, true); assert.equal(data.url, "https://g1rmmr.github.io/posts/");
    }
    assert.equal(deletes, 1);
    const stale = await call(env, "/api/post", { method: "DELETE", headers, body: JSON.stringify({ request_id: crypto.randomUUID(), path: PATH, sha: NEW }) });
    assert.equal(stale.status, 409); assert.equal(deletes, 1);
  });
});

test("lost mutation responses recover their own commit without overwriting or deleting twice", async () => {
  for (const method of ["PUT", "DELETE"]) {
    const env = environment(); const headers = await authenticated(env); let changed = false; let mutations = 0;
    await upstream(async (url, options) => {
      if (url.includes("/commits?")) return response([{ sha: COMMIT, commit: { message: `action [write:${REQUEST}]` } }]);
      if (options.method === method) { mutations++; changed = true; throw new Error("response lost"); }
      if (changed && method === "DELETE") return response({}, 404);
      return fileResponse(changed ? "# 수정\n\n본문\n" : "# 원본\n\n본문\n", changed ? NEW : OLD);
    }, async () => {
      const body = JSON.stringify({ request_id: REQUEST, path: PATH, sha: OLD, ...(method === "PUT" ? { title: "수정", body: "본문\n" } : {}) });
      assert.equal((await call(env, "/api/post", { method, headers, body })).status, 503);
      const retry = await call(env, "/api/post", { method, headers, body });
      assert.equal(retry.status, 200); assert.equal((await retry.json()).sha, COMMIT); assert.equal(mutations, 1);
    });
  }
});

test("post management rejects unauthenticated users, CSRF and paths outside posts", async () => {
  const env = environment(); const headers = await authenticated(env);
  assert.equal((await call(env, "/api/posts")).status, 401);
  assert.equal((await call(env, `/api/post?path=${PATH}`)).status, 401);
  for (const method of ["PUT", "DELETE"]) {
    const body = JSON.stringify({ request_id: REQUEST, path: PATH, sha: OLD });
    assert.equal((await call(env, "/api/post", { method, body, headers: { ...headers, "X-CSRF-Token": "wrong" } })).status, 403);
    for (const path of ["docs/posts/index.md", "../secrets", "zensical.toml", "docs/posts/a/other.md", "docs/posts/a%2Fb.md"]) {
      const result = await call(env, "/api/post", { method, headers, body: JSON.stringify({ request_id: REQUEST, path, sha: OLD }) });
      assert.equal(result.status, 400);
    }
  }
});
