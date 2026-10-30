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
      if (url.pathname === "/user") return Response.json({ id: 52289794 });
      if (url.pathname === "/repos/G1rmmr/G1rmmr.github.io") return Response.json({ permissions: { push: true } });
      return new Response("Unexpected upstream", { status: 500 });
    },
  }] }));
  try {
    const db = await mf.getD1Database("DB");
    const schema = readFileSync(new URL("../../analytics-worker/migrations/0002_publishing.sql", import.meta.url), "utf8");
    for (const statement of schema.replace(/^--.*$/gm, "").split(";").filter(s => s.trim())) await db.prepare(statement).run();
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
    assert.equal((await session.json()).login, "G1rmmr");
    const page = await mf.dispatchFetch(ORIGIN + "/write/", { redirect: "manual", headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("Cache-Control"), "no-store");
    const html = await page.text();
    assert.match(html, /EDITOR/);
    assert.match(html, /href="https:\/\/g1rmmr.github.io\/"/);
    const row = await db.prepare("SELECT token_ciphertext FROM publisher_sessions").first();
    assert.ok(!row.token_ciphertext.includes("test-user-token"));
    redirectUpstream = true;
    const retry = await mf.dispatchFetch(ORIGIN + "/auth/login", { redirect: "manual" });
    const retryState = new URL(retry.headers.get("Location")).searchParams.get("state");
    const before = requests.length;
    const refused = await mf.dispatchFetch(`${ORIGIN}/auth/callback?state=${retryState}&code=test-code`, { redirect: "manual", headers: { Cookie: `__Host-blog_oauth=${retryState}` } });
    assert.equal(refused.status, 502);
    assert.equal(requests.length, before + 1, "credentials must not follow an upstream redirect");
  } finally { await mf.dispose(); }
});
