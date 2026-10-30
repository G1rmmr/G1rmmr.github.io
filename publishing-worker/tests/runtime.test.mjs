import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(new URL("../../analytics-worker/package.json", import.meta.url));
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const ORIGIN = "https://g1rmmr-blog-publisher.blckhnd-std.workers.dev";

test("workerd completes OAuth exchange, encryption, D1 session and authenticated editor", async () => {
  const requests = [];
  let redirectUpstream = false;
  let imageStored = false;
  const postPath = "docs/posts/runtime-test.md";
  let postContent = "# Runtime title\r\n\r\n원본 본문\r\n";
  let postSha = "b".repeat(40);
  let postWrites = 0;
  const png = new Uint8Array([137,80,78,71,13,10,26,10]);
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "publisher-test",
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/worker.mjs", import.meta.url)),
    // Latest date supported by the workerd binary pinned in package-lock.json.
    compatibilityDate: "2026-10-26",
    bindings: { PUBLISHER_ORIGIN: ORIGIN, GITHUB_OWNER_ID: "52289794", GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "test-secret", TOKEN_ENCRYPTION_KEY: btoa("k".repeat(32)) },
    d1Databases: ["DB"],
    serviceBindings: { ASSETS: () => new Response('<article><a href="../">HOME</a><div id="blog-editor">EDITOR</div></article>', { headers: { "Content-Type": "text/html" } }) },
    outboundService: async req => {
      const url = new URL(req.url);
      requests.push(url.pathname);
      if (url.hostname === "github.com" && url.pathname === "/login/oauth/access_token") {
        if (redirectUpstream) return new Response(null, { status: 302, headers: { Location: "https://untrusted.example/" } });
        assert.equal(req.method, "POST");
        const body = await req.json();
        assert.equal(body.client_secret, "test-secret");
        assert.equal(body.code, "test-code");
        assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
        return Response.json({ access_token: "test-user-token", expires_in: 28800 });
      }
      assert.equal(url.hostname, "api.github.com");
      assert.equal(req.headers.get("Authorization"), "Bearer test-user-token");
      if (url.pathname === "/repos/G1rmmr/G1rmmr.github.io/contents/docs/posts") return Response.json(postContent === null ? [] : [{ type: "file", path: postPath, name: "runtime-test.md", sha: postSha }]);
      if (url.pathname === `/repos/G1rmmr/G1rmmr.github.io/contents/${postPath}`) {
        if (req.method === "PUT" || req.method === "DELETE") {
          const change = await req.json(); postWrites++;
          assert.equal(change.sha, postSha); assert.equal(change.branch, "main");
          postContent = req.method === "DELETE" ? null : Buffer.from(change.content, "base64").toString();
          postSha = "c".repeat(40);
          return Response.json({ commit: { sha: "d".repeat(40) }, content: postContent === null ? null : { sha: postSha } });
        }
        return postContent === null ? Response.json({}, { status: 404 }) : Response.json({ type: "file", encoding: "base64", size: Buffer.byteLength(postContent), content: Buffer.from(postContent).toString("base64"), sha: postSha });
      }
      if (url.pathname === "/repos/G1rmmr/G1rmmr.github.io/commits") return Response.json([]);
      if (/\/contents\/docs\/img\/uploads\/[a-f0-9]{64}\.png$/.test(url.pathname)) {
        if (req.method === "PUT") { imageStored = true; return Response.json({ commit: { sha: "a".repeat(40) } }, { status: 201 }); }
        if (req.headers.get("Accept") === "application/vnd.github.raw+json") return new Response(png);
        return Response.json({ type: "file" }, { status: imageStored ? 200 : 404 });
      }
      if (url.pathname === "/user") return Response.json({ id: 52289794 });
      if (url.pathname === "/repos/G1rmmr/G1rmmr.github.io") return Response.json({ permissions: { push: true } });
      return new Response("Unexpected upstream", { status: 500 });
    },
  }] }));
  try {
    const db = await mf.getD1Database("DB");
    const schema = readFileSync(new URL("../../analytics-worker/migrations/0002_publishing.sql", import.meta.url), "utf8");
    for (const statement of schema.replace(/^--.*$/gm, "").split(";").filter(s => s.trim())) await db.prepare(statement).run();
    const management = readFileSync(new URL("../../analytics-worker/migrations/0004_post_management.sql", import.meta.url), "utf8");
    for (const statement of management.split(";").filter(s => s.trim())) await db.prepare(statement).run();
    const start = await mf.dispatchFetch(ORIGIN + "/auth/login", { redirect: "manual" });
    assert.equal(start.status, 302);
    const location = new URL(start.headers.get("Location"));
    const state = location.searchParams.get("state");
    const callback = await mf.dispatchFetch(`${ORIGIN}/auth/callback?state=${state}&code=test-code`, { redirect: "manual", headers: { Cookie: `__Host-blog_oauth=${state}` } });
    assert.equal(callback.status, 302, await callback.clone().text());
    assert.equal(callback.headers.get("Location"), ORIGIN + "/write/");
    assert.deepEqual(requests, ["/login/oauth/access_token", "/user", "/repos/G1rmmr/G1rmmr.github.io"]);
    const cookie = callback.headers.getSetCookie().find(v => v.startsWith("__Host-blog_session=")).split(";")[0];
    const session = await mf.dispatchFetch(ORIGIN + "/api/session", { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    const userSession = await session.json();
    assert.equal(userSession.login, "G1rmmr");
    const page = await mf.dispatchFetch(ORIGIN + "/write/", { redirect: "manual", headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("Cache-Control"), "no-store");
    const html = await page.text();
    assert.match(html, /EDITOR/);
    assert.match(html, /href="https:\/\/g1rmmr.github.io\/"/);
    const row = await db.prepare("SELECT token_ciphertext FROM publisher_sessions").first();
    assert.ok(!row.token_ciphertext.includes("test-user-token"));
    const uploaded = await mf.dispatchFetch(ORIGIN + "/api/images", { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "X-CSRF-Token": userSession.csrf, "Content-Type": "image/png" }, body: png });
    assert.equal(uploaded.status, 200);
    const image = await uploaded.json();
    assert.match(image.path, /^\/img\/uploads\/[a-f0-9]{64}\.png$/);
    const preview = await mf.dispatchFetch(ORIGIN + image.preview, { headers: { Cookie: cookie } });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("Content-Type"), "image/png");
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), png);
    const list = await mf.dispatchFetch(ORIGIN + "/api/posts", { headers: { Cookie: cookie } });
    assert.equal((await list.json()).posts[0].title, "Runtime title");
    const loaded = await mf.dispatchFetch(`${ORIGIN}/api/post?path=${postPath}`, { headers: { Cookie: cookie } });
    const original = await loaded.json();
    assert.equal(original.body, "원본 본문\r\n");
    const mutationHeaders = { Cookie: cookie, Origin: ORIGIN, "X-CSRF-Token": userSession.csrf, "Content-Type": "application/json" };
    const updateBody = JSON.stringify({ request_id: crypto.randomUUID(), path: postPath, sha: original.sha, title: "수정 제목", body: "수정 본문\n" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const updated = await mf.dispatchFetch(ORIGIN + "/api/post", { method: "PUT", headers: mutationHeaders, body: updateBody });
      assert.equal(updated.status, 200); assert.equal((await updated.json()).blob_sha, postSha);
    }
    assert.equal(postWrites, 1);
    assert.equal(postContent, "# 수정 제목\r\n\r\n수정 본문\r\n");
    const deleteBody = JSON.stringify({ request_id: crypto.randomUUID(), path: postPath, sha: postSha });
    for (let attempt = 0; attempt < 2; attempt++) {
      const deleted = await mf.dispatchFetch(ORIGIN + "/api/post", { method: "DELETE", headers: mutationHeaders, body: deleteBody });
      assert.equal(deleted.status, 200); assert.equal((await deleted.json()).deleted, true);
    }
    assert.equal(postWrites, 2);
    const afterDelete = await mf.dispatchFetch(ORIGIN + "/api/posts", { headers: { Cookie: cookie } });
    assert.deepEqual((await afterDelete.json()).posts, []);
    redirectUpstream = true;
    const retry = await mf.dispatchFetch(ORIGIN + "/auth/login", { redirect: "manual" });
    const retryState = new URL(retry.headers.get("Location")).searchParams.get("state");
    const before = requests.length;
    const refused = await mf.dispatchFetch(`${ORIGIN}/auth/callback?state=${retryState}&code=test-code`, { redirect: "manual", headers: { Cookie: `__Host-blog_oauth=${retryState}` } });
    assert.equal(refused.status, 502);
    assert.equal(requests.length, before + 1, "credentials must not follow an upstream redirect");
  } finally { await mf.dispose(); }
});
