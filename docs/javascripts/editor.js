(() => {
  "use strict";
  if (window.__blogEditorInitialized) return;
  window.__blogEditorInitialized = true;
  const key = "realm-post-draft-v1";

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
    const slug = root.querySelector("#post-slug");
    const body = root.querySelector("#post-body");
    const preview = root.querySelector("#post-preview");
    const status = root.querySelector("#editor-status");
    slug.value = new Date().toLocaleDateString("sv-SE") + "-new-post";
    try {
      const draft = JSON.parse(localStorage.getItem(key));
      if (draft && [draft.title, draft.slug, draft.body].every(value => typeof value === "string")) {
        title.value = draft.title; slug.value = draft.slug; body.value = draft.body;
        status.textContent = "임시저장한 글을 복원했습니다.";
      }
    } catch { status.textContent = "브라우저의 임시저장을 사용할 수 없습니다. 파일로 내려받아 보관하세요."; }

    function render() {
      preview.replaceChildren();
      const heading = document.createElement("h1");
      heading.textContent = title.value || "글 제목";
      preview.append(heading);
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
        localStorage.setItem(key, JSON.stringify({ title: title.value, slug: slug.value, body: body.value }));
        status.textContent = "이 브라우저에 임시저장했습니다.";
      } catch { status.textContent = "임시저장에 실패했습니다. Markdown 파일을 내려받아 보관하세요."; }
    }
    root.addEventListener("input", () => { render(); save(); });
    root.querySelector("#post-save").addEventListener("click", save);
    root.querySelectorAll("[data-format]").forEach(button => button.addEventListener("click", () => {
      const formats = { heading: ["## ", ""], bold: ["**", "**"], italic: ["*", "*"], link: ["[", "](https://example.com)"], list: ["- ", ""], code: ["\n```\n", "\n```\n"] };
      const [before, after] = formats[button.dataset.format];
      const start = body.selectionStart;
      const selected = body.value.slice(start, body.selectionEnd) || "텍스트";
      body.setRangeText(before + selected + after, start, body.selectionEnd, "end");
      body.focus(); body.setSelectionRange(start + before.length, start + before.length + selected.length);
      render(); save();
    }));
    root.querySelector("#post-download").addEventListener("click", () => {
      if (!title.value.trim() || /[\r\n]/.test(title.value) || !body.value.trim() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,247}$/.test(slug.value)) {
        status.textContent = "제목과 본문, 올바른 파일 이름을 입력하세요."; return;
      }
      save();
      const content = `# ${title.value.trim()}\n\n${body.value}\n`;
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `${slug.value}.md`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "파일을 내려받았습니다. ‘GitHub에서 게시’를 열어 업로드하고 커밋하세요. 같은 파일 이름은 기존 글과 충돌할 수 있습니다.";
    });
    render();
  }
  if (typeof document$ !== "undefined") document$.subscribe(initialize);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
