(() => {
  "use strict";
  if (window.__blogEditorInitialized) return;
  window.__blogEditorInitialized = true;
  // Start the simplified editor empty; keep the old draft untouched in storage.
  const key = "realm-post-draft-v2";

  // Build preview nodes with textContent: draft HTML is never executed.
  function inline(parent, text) {
    const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^\s)]+)\))/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(offset, match.index)));
      const node = document.createElement(match[2] ? "code" : match[3] ? "strong" : match[4] ? "em" : "a");
      node.textContent = match[2] || match[3] || match[4] || match[5];
      if (match[6]) {
        try {
          const url = new URL(match[6], window.location.href);
          if (["https:", "http:"].includes(url.protocol)) {
            node.href = url.href;
            node.target = "_blank";
            node.rel = "noopener noreferrer";
          }
        } catch { /* Leave invalid links as inert text. */ }
      }
      parent.append(node);
      offset = match.index + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(offset)));
  }

  function initialize() {
    const root = document.getElementById("blog-editor");
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = "true";
    const title = root.querySelector("#post-title");
    const body = root.querySelector("#post-body");
    const preview = root.querySelector("#post-preview");
    const status = root.querySelector("#editor-status");
    let slug = null;
    try {
      const draft = JSON.parse(localStorage.getItem(key));
      if (draft && [draft.title, draft.body].every(value => typeof value === "string")) {
        title.value = draft.title; body.value = draft.body;
        if (typeof draft.slug === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,247}$/.test(draft.slug)) slug = draft.slug;
        status.textContent = "임시저장한 글을 복원했습니다.";
      }
    } catch { status.textContent = "브라우저의 임시저장을 사용할 수 없습니다."; }

    function render() {
      preview.replaceChildren();
      if (title.value) {
        const heading = document.createElement("h1");
        heading.textContent = title.value;
        preview.append(heading);
      }
      let code = null;
      let list = null;
      for (const line of body.value.split("\n")) {
        if (line.startsWith("```")) {
          if (code) code = null;
          else {
            const pre = document.createElement("pre"); code = document.createElement("code");
            pre.append(code); preview.append(pre);
          }
          list = null;
          continue;
        }
        if (code) { code.textContent += line + "\n"; continue; }
        const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
        if (item) {
          const tag = /^\s*\d/.test(line) ? "ol" : "ul";
          if (!list || list.localName !== tag) { list = document.createElement(tag); preview.append(list); }
          const li = document.createElement("li"); inline(li, item[1]); list.append(li); continue;
        }
        list = null;
        if (!line.trim()) continue;
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        const node = document.createElement(h ? `h${h[1].length}` : "p");
        inline(node, h ? h[2] : line); preview.append(node);
      }
    }
    function save() {
      try {
        localStorage.setItem(key, JSON.stringify({ title: title.value, slug, body: body.value }));
        status.textContent = "이 브라우저에 임시저장했습니다.";
      } catch { status.textContent = "임시저장에 실패했습니다. 브라우저 저장 공간을 확인하세요."; }
    }
    root.addEventListener("input", () => { render(); save(); });
    root.querySelector("#post-save").addEventListener("click", save);
    root.querySelector("#post-publish").addEventListener("click", () => {
      if (!title.value.trim() || /[\r\n]/.test(title.value) || !body.value.trim()) {
        status.textContent = "TITLE과 CONTENT를 입력하세요."; return;
      }
      slug ??= `${new Date().toISOString().slice(0, 10)}-${window.crypto.randomUUID()}`;
      save();
      const content = `# ${title.value.trim()}\n\n${body.value}\n`;
      const publishUrl = new URL("https://github.com/G1rmmr/G1rmmr.github.io/new/main");
      publishUrl.searchParams.set("filename", `docs/posts/${slug}.md`);
      publishUrl.searchParams.set("value", content);
      if (publishUrl.href.length <= 6000) {
        window.open(publishUrl.href, "_blank", "noopener,noreferrer");
        status.textContent = "GitHub에서 내용을 확인하고 커밋하면 게시됩니다. 새 창이 열리지 않았다면 팝업 허용 후 다시 눌러주세요.";
        return;
      }
      // Long posts exceed practical URL limits; preserve the entire text in a file.
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `${slug}.md`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.open("https://github.com/G1rmmr/G1rmmr.github.io/upload/main/docs/posts", "_blank", "noopener,noreferrer");
      status.textContent = "긴 글은 파일로 준비했습니다. 열린 GitHub 창에 내려받은 파일을 업로드하고 커밋하면 게시됩니다.";
    });
    render();
  }
  if (typeof document$ !== "undefined") document$.subscribe(initialize);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
