import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
const source = readFileSync(new URL("../docs/javascripts/likes.js", import.meta.url), "utf8");
const path = "/posts/example/";
const settle = () => new Promise(setImmediate);

function browser({ replies = [], origin = "https://g1rmmr.github.io", saved = null, blocked = false } = {}) {
  const calls = []; const events = {}; const count = { textContent: "—" }; const status = { textContent: "" };
  const attrs = {}; const storage = new Map(saved ? [[`realm-like:${path}`, saved]] : []);
  const button = { dataset: {}, disabled: true, querySelector: () => count, setAttribute: (key, value) => { attrs[key] = value; }, classList: { toggle() {} }, addEventListener: (key, fn) => { events[key] = fn; } };
  const document = { readyState: "complete", querySelector: selector => selector === "[data-post-like]" ? button : selector === "[data-like-status]" ? status : { content: selector.includes("endpoint") ? "https://counter.example/views" : "https://g1rmmr.github.io" } };
  const window = { location: new URL(origin + path), crypto: webcrypto, fetch: async (url, options = {}) => {
    calls.push([url, options]); const reply = replies.shift(); if (reply instanceof Error) throw reply;
    return reply || { ok: true, json: async () => ({ path, likes: options.method ? 1 : 0, liked: Boolean(options.method) }) };
  } };
  const localStorage = { getItem: key => { if (blocked) throw Error(); return storage.get(key); }, setItem: (key, value) => { if (blocked) throw Error(); storage.set(key, value); } };
  vm.runInNewContext(source, { window, document, localStorage, URL, URLSearchParams });
  return { calls, events, count, status, attrs, storage, button };
}

test("loads count and liked state with a stable per-post ID", async () => {
  const id = webcrypto.randomUUID(); const b = browser({ saved: id }); await settle();
  assert.equal(new URL(b.calls[0][0]).searchParams.get("like_id"), id);
  assert.equal(b.count.textContent, "0"); assert.equal(b.attrs["aria-pressed"], "false");
  assert.equal(b.button.disabled, false);
});
test("like and unlike are desired states rather than repeat increments", async () => {
  const b = browser({ replies: [null, null, { ok: true, json: async () => ({ path, likes: 0, liked: false }) }] }); await settle();
  await b.events.click(); assert.equal(b.count.textContent, "1");
  await b.events.click(); assert.equal(b.count.textContent, "0");
  const requests = b.calls.slice(1).map(([, options]) => JSON.parse(options.body));
  assert.deepEqual(requests.map(r => r.liked), [true, false]);
  assert.equal(requests[0].like_id, requests[1].like_id);
});
test("lost responses retry the same state without fabricating a successful count", async () => {
  const b = browser({ replies: [null, new Error("response lost")] }); await settle();
  await b.events.click(); assert.equal(b.count.textContent, "0");
  await b.events.click();
  const posts = b.calls.slice(1).map(([, options]) => JSON.parse(options.body));
  assert.deepEqual(posts[0], posts[1]);
});
test("preview hosts send nothing and unavailable storage still permits a reaction", async () => {
  assert.equal(browser({ origin: "https://preview.example" }).calls.length, 0);
  const b = browser({ blocked: true }); await settle(); await b.events.click(); assert.equal(b.count.textContent, "1");
});
