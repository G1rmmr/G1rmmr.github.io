import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../docs/javascripts/pageviews.js", import.meta.url), "utf8");

function browser({ endpoint = "https://counter.example.workers.dev/views", origin = "https://g1rmmr.github.io", url = "https://g1rmmr.github.io/posts/2025-12-8/", hidden = false, instant = true, readyState = "complete", replies = [], crypto = webcrypto } = {}) {
  const calls = [];
  const listeners = new Map();
  const timers = [];
  const subscribers = [];
  const window = {
    location: new URL(url),
    crypto,
    fetch: async (...args) => {
      calls.push(args);
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply ?? { status: 204 };
    },
    setTimeout: callback => { timers.push(callback); },
  };
  const document = {
    readyState,
    visibilityState: hidden ? "hidden" : "visible",
    querySelector: selector => ({ content: selector.includes("endpoint") ? endpoint : origin }),
    addEventListener: (name, callback) => { listeners.set(name, callback); },
  };
  const globals = { window, document, URL, Uint8Array };
  if (instant) {
    globals.document$ = { subscribe: callback => { subscribers.push(callback); callback(); } };
  }
  const context = vm.createContext(globals);
  const execute = () => vm.runInContext(source, context);
  execute();
  return {
    window, document, calls, timers, listeners, subscribers, execute,
    navigate: next => {
      window.location = new URL(next, window.location);
      subscribers.forEach(callback => callback());
    },
    show: () => {
      document.visibilityState = "visible";
      listeners.get("visibilitychange")?.();
    },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const bodies = b => b.calls.map(([, options]) => JSON.parse(options.body));

test("missing configuration, preview hosts and malformed endpoints never send requests", () => {
  for (const options of [
    { endpoint: "" },
    { origin: "" },
    { url: "http://localhost:8000/posts/2025-12-8/" },
    { url: "https://preview.example/posts/2025-12-8/" },
    { endpoint: "not an absolute URL" },
    { endpoint: "http://counter.example/views" },
    { endpoint: "https://user:password@counter.example/views" },
    { endpoint: "https://counter.example/views?token=value" },
    { endpoint: "https://counter.example/views#value" },
    { endpoint: "https://counter.example/other" },
  ]) {
    const b = browser(options);
    assert.equal(b.calls.length, 0);
    assert.equal(b.listeners.size, 0);
  }
});

test("records an initial post and actual navigations exactly once", () => {
  const b = browser();
  assert.equal(b.calls.length, 1);
  b.navigate("?source=link#section");
  b.subscribers[0]();
  b.execute();
  assert.equal(b.calls.length, 1);
  b.navigate("/posts/2024-12-12/");
  b.navigate("/");
  b.navigate("/posts/2025-12-8/");
  assert.deepEqual(bodies(b).map(body => body.path), ["/posts/2025-12-8/", "/posts/2024-12-12/", "/posts/2025-12-8/"]);
  assert.equal(new Set(bodies(b).map(body => body.visit_id)).size, 3);
});

test("normalizes equivalent post URLs and excludes other or invalid paths", () => {
  for (const pathname of ["/posts/new-post", "/posts/new-post/", "/posts/new-post/index.html"]) {
    const b = browser({ url: `https://g1rmmr.github.io${pathname}` });
    assert.equal(bodies(b)[0].path, "/posts/new-post/");
  }
  for (const pathname of ["/", "/404.html", "/posts/", "/posts/foo/bar/", "/posts/foo%20bar/", "/posts/.secret/", `/posts/${"a".repeat(249)}/`]) {
    assert.equal(browser({ url: `https://g1rmmr.github.io${pathname}` }).calls.length, 0);
  }
});

test("background pages wait until visible and do not count tab changes again", () => {
  const b = browser({ hidden: true });
  assert.equal(b.calls.length, 0);
  b.show();
  b.show();
  assert.equal(b.calls.length, 1);
});

test("works without instant navigation before and after DOMContentLoaded", () => {
  assert.equal(browser({ instant: false }).calls.length, 1);
  const b = browser({ instant: false, readyState: "loading" });
  assert.equal(b.calls.length, 0);
  b.listeners.get("DOMContentLoaded")();
  assert.equal(b.calls.length, 1);
});

test("retries a lost response once using the same visit ID without disrupting navigation", async () => {
  const b = browser({ replies: [new Error("offline"), new Error("still offline")] });
  await settle();
  assert.equal(b.timers.length, 1);
  b.timers.shift()();
  await settle();
  assert.equal(b.calls.length, 2);
  assert.deepEqual(bodies(b)[0], bodies(b)[1]);
  assert.equal(b.timers.length, 0);
  b.navigate("/posts/2024-12-12/");
  assert.equal(b.calls.length, 3);
});

test("retries server errors but never retries rejected input or rate limits", async () => {
  for (const status of [400, 403, 404, 413, 429]) {
    const b = browser({ replies: [{ status }] });
    await settle();
    assert.equal(b.timers.length, 0);
  }
  const b = browser({ replies: [{ status: 503 }] });
  await settle();
  b.timers.shift()();
  await settle();
  assert.equal(b.calls.length, 2);
  assert.deepEqual(bodies(b)[0], bodies(b)[1]);
});

test("sends only the post path and a valid visit ID without credentials or referrers", () => {
  const b = browser({ url: "https://g1rmmr.github.io/posts/2025-12-8/?secret=value#private" });
  const [, options] = b.calls[0];
  const body = bodies(b)[0];
  assert.deepEqual(Object.keys(body).sort(), ["path", "visit_id"]);
  assert.match(body.visit_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.keepalive, true);
  assert.equal(options.method, "POST");
});

test("uses Web Crypto for UUID fallback and remains inactive without it", () => {
  const fallback = browser({ crypto: { getRandomValues: values => webcrypto.getRandomValues(values) } });
  assert.match(bodies(fallback)[0].visit_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(browser({ crypto: {} }).calls.length, 0);
});
