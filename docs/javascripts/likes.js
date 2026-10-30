(() => {
  "use strict";
  if (window.__blogLikesInitialized) return;
  let endpoint, origin;
  try {
    endpoint = new URL(document.querySelector('meta[name="blog-pageviews-endpoint"]').content);
    origin = new URL(document.querySelector('meta[name="blog-pageviews-origin"]').content).origin;
  } catch { return; }
  if (window.location.origin !== origin || endpoint.protocol !== "https:" || endpoint.pathname !== "/views" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return;
  endpoint = new URL("/likes", endpoint);
  window.__blogLikesInitialized = true;
  const ids = new Map();

  function initialize() {
    const button = document.querySelector("[data-post-like]");
    if (!button || button.dataset.initialized) return;
    const path = window.location.pathname.replace(/\/index\.html$/, "/").replace(/\/?$/, "/");
    if (!/^\/posts\/[A-Za-z0-9][A-Za-z0-9_-]*\/$/.test(path) || path.length > 256) return;
    button.dataset.initialized = "true";
    const count = button.querySelector("[data-like-count]");
    const status = document.querySelector("[data-like-status]");
    const key = `realm-like:${path}`;
    let id = ids.get(path);
    try { id ||= localStorage.getItem(key); } catch { /* In-memory fallback. */ }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id || "")) id = window.crypto.randomUUID();
    ids.set(path, id);
    try { localStorage.setItem(key, id); } catch { /* The current page can still react. */ }
    let liked = false;
    function display(data) {
      if (data.path !== path || !Number.isSafeInteger(data.likes) || data.likes < 0 || typeof data.liked !== "boolean") throw new Error("Invalid reaction response");
      liked = data.liked;
      count.textContent = data.likes.toLocaleString("ko-KR");
      button.setAttribute("aria-pressed", String(liked));
      button.classList.toggle("is-liked", liked);
      button.disabled = false;
      status.textContent = "";
    }
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const response = await window.fetch(endpoint.href, { method: "POST", credentials: "omit", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, like_id: id, liked: !liked }) });
        if (!response.ok) throw new Error();
        display(await response.json());
      } catch {
        status.textContent = "라이크를 저장하지 못했습니다. 다시 눌러주세요.";
        button.disabled = false;
      }
    });
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ path, like_id: id });
    window.fetch(url.href, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      display(await response.json());
    }).catch(() => { status.textContent = "라이크를 불러오지 못했습니다. 페이지를 새로고침하세요."; });
  }
  if (typeof document$ !== "undefined") document$.subscribe(initialize);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
