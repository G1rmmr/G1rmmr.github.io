/* Record post visits without adding or changing any visible page elements. */
(() => {
  "use strict";

  if (window.__blogPageviewsInitialized) return;

  const endpointValue = document.querySelector('meta[name="blog-pageviews-endpoint"]')?.content;
  const originValue = document.querySelector('meta[name="blog-pageviews-origin"]')?.content;
  if (!endpointValue || !originValue) return;

  let endpoint;
  let siteOrigin;
  try {
    endpoint = new URL(endpointValue);
    siteOrigin = new URL(originValue).origin;
  } catch {
    return;
  }

  // Preview builds and local development must never add production visits.
  if (
    window.location.origin !== siteOrigin ||
    window.location.protocol !== "https:" ||
    endpoint.protocol !== "https:" ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    endpoint.pathname !== "/views"
  ) return;

  window.__blogPageviewsInitialized = true;
  let lastPath = null;

  function postPath() {
    // Both directory URLs and direct index.html URLs identify the same post.
    const pathname = window.location.pathname.replace(/\/index\.html$/, "/");
    const match = pathname.match(/^\/posts\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/);
    if (!match) return null;
    const result = `/posts/${match[1]}/`;
    return result.length <= 256 ? result : null;
  }

  function newVisitId() {
    if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
    if (typeof window.crypto?.getRandomValues !== "function") return null;
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function recordVisit() {
    if (document.visibilityState === "hidden") return;
    const path = postPath();
    if (path === lastPath) return;
    lastPath = path;
    if (!path) return;

    const visitId = newVisitId();
    if (!visitId) return;
    const body = JSON.stringify({ path, visit_id: visitId });

    async function send(attempt = 0) {
      try {
        const response = await window.fetch(endpoint.href, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          keepalive: true,
        });
        if (response.status < 500 || attempt !== 0) return;
      } catch {
        if (attempt !== 0) return;
      }
      // Reuse the visit ID so a lost response cannot cause a second increment.
      window.setTimeout(() => { void send(1); }, 1500);
    }

    void send();
  }

  // Instant navigation emits only after a page becomes current, not on prefetch.
  if (typeof document$ !== "undefined") {
    document$.subscribe(recordVisit);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", recordVisit, { once: true });
  } else {
    recordVisit();
  }
  document.addEventListener("visibilitychange", recordVisit);
})();
