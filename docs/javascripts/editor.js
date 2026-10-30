(() => {
  "use strict";
  if (window.__blogEditorInitialized) return;
  window.__blogEditorInitialized = true;
  const publisher = "https://g1rmmr-blog-publisher.blckhnd-std.workers.dev";
  // Start the simplified editor empty; keep the old draft untouched in storage.
  const key = "realm-post-draft-v2";

  // Build preview nodes with textContent: draft HTML is never executed.
  function inline(parent, text) {
    const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|(!?)\[([^\]]*)\]\(([^\s)]+)\))/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(offset, match.index)));
      const image = match[5] === "!";
      const node = document.createElement(match[2] ? "code" : match[3] ? "strong" : match[4] ? "em" : image ? "img" : "a");
      if (image) { node.alt = match[6]; node.loading = "lazy"; }
      else node.textContent = match[2] || match[3] || match[4] || match[6];
      if (match[7]) {
        try {
          const url = new URL(match[7], window.location.href);
          if (["https:", "http:"].includes(url.protocol)) {
            if (image) {
              node.src = /^\/img\/uploads\/[0-9a-f]{64}\.(png|jpg|webp|gif)$/.test(url.pathname) && [publisher, "https://g1rmmr.github.io"].includes(url.origin) ? `${publisher}/media/${url.pathname.split("/").pop()}` : url.href;
            } else {
              node.href = url.href;
              node.target = "_blank";
              node.rel = "noopener noreferrer";
            }
          }
        } catch { /* Leave invalid links as inert text. */ }
      }
      parent.append(node);
      offset = match.index + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(offset)));
  }

  async function initialize() {
    const root = document.getElementById("blog-editor");
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = "true";
    if (window.location.origin !== publisher) {
      window.location.replace(`${publisher}/write/`);
      return;
    }
    const title = root.querySelector("#post-title");
    const body = root.querySelector("#post-body");
    const preview = root.querySelector("#post-preview");
    const status = root.querySelector("#editor-status");
    const publishButton = root.querySelector("#post-publish");
    const images = root.querySelector("#post-images");
    const imageStatus = root.querySelector("#image-status");
    let submission = null;
    let busy = false;
    let session;
    try {
      const response = await window.fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) { window.location.replace("/auth/login"); return; }
      if (!response.ok) throw new Error();
      session = await response.json();
      if (!session.csrf) throw new Error();
    } catch {
      root.hidden = false;
      publishButton.disabled = true;
      status.textContent = "로그인 상태를 확인하지 못했습니다. 페이지를 새로고침하세요.";
      return;
    }
    root.hidden = false;
    try {
      const draft = JSON.parse(localStorage.getItem(key));
      if (draft && [draft.title, draft.body].every(value => typeof value === "string")) {
        title.value = draft.title; body.value = draft.body;
        if (draft.submission && typeof draft.submission.id === "string" && typeof draft.submission.fingerprint === "string") submission = draft.submission;
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
    function save(quiet = false) {
      try {
        localStorage.setItem(key, JSON.stringify({ title: title.value, submission, body: body.value }));
        if (!quiet) status.textContent = "이 브라우저에 임시저장했습니다.";
      } catch { status.textContent = "임시저장에 실패했습니다. 브라우저 저장 공간을 확인하세요."; }
    }
    root.addEventListener("input", () => { render(); save(); });
    root.querySelector("#post-save").addEventListener("click", () => save());

    async function uploadImages(files) {
      if (busy || !files.length) return;
      busy = true; publishButton.disabled = true; title.disabled = true; body.disabled = true; images.disabled = true;
      let inserted = 0;
      try {
        for (const file of files) {
          if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) throw new Error("PNG, JPEG, WebP, GIF 이미지를 선택하세요.");
          if (file.size > 5 * 1024 * 1024) throw new Error("이미지는 한 장에 5 MiB 이하여야 합니다.");
          imageStatus.textContent = `이미지 업로드 중… (${inserted + 1}/${files.length})`;
          const response = await window.fetch("/api/images", { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type, "X-CSRF-Token": session.csrf }, body: file });
          if (response.status === 401) throw new Error("로그인이 만료됐습니다. 초안을 저장하고 다시 로그인하세요.");
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "이미지를 업로드하지 못했습니다.");
          if (!/^\/img\/uploads\/[0-9a-f]{64}\.(png|jpg|webp|gif)$/.test(result.path)) throw new Error("이미지 주소를 확인하지 못했습니다.");
          const alt = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[\[\]\\\r\n]/g, " ").trim() || "image";
          body.setRangeText(`\n![${alt}](${result.path})\n`, body.selectionStart, body.selectionEnd, "end");
          render(); save(true); inserted++;
        }
        imageStatus.textContent = `이미지 ${inserted}장 추가됨`;
      } catch (error) { imageStatus.textContent = error.message || "이미지 업로드에 실패했습니다."; }
      finally { busy = false; publishButton.disabled = false; title.disabled = false; body.disabled = false; images.disabled = false; images.value = ""; }
    }
    images.addEventListener("change", () => uploadImages(Array.from(images.files)));
    root.querySelector(".editor-image-add").addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); images.click(); }
    });
    body.addEventListener("paste", event => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) { event.preventDefault(); void uploadImages(files); }
    });
    body.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
    body.addEventListener("drop", event => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) { event.preventDefault(); void uploadImages(files); }
    });

    function showLink(message, href, label) {
      status.textContent = message + " ";
      const link = document.createElement("a");
      link.href = href; link.textContent = label; link.target = "_blank"; link.rel = "noopener noreferrer";
      status.append(link);
    }

    async function watchDeployment(published) {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (!root.isConnected) return;
        try {
          const response = await window.fetch(`/api/deployment?sha=${published.sha}`, { credentials: "same-origin", cache: "no-store" });
          if (response.status === 401) {
            showLink("커밋은 완료됐지만 로그인이 만료돼 배포 상태를 확인할 수 없습니다.", published.commit_url, "커밋 확인"); return;
          }
          if (!response.ok) throw new Error();
          const deployment = await response.json();
          if (deployment.status === "success") {
            showLink("배포가 완료됐습니다.", published.url, "게시물 열기"); return;
          }
          if (deployment.status === "failure") {
            showLink("커밋은 완료됐지만 블로그 배포가 실패했습니다.", deployment.workflow_url, "배포 로그 확인"); return;
          }
          showLink("main 커밋 완료 · 블로그 배포 중…", published.commit_url, "커밋 확인");
        } catch {
          showLink("커밋은 완료됐지만 배포 상태를 확인하지 못했습니다. 확인을 다시 시도합니다.", published.commit_url, "커밋 확인");
        }
        await new Promise(resolve => window.setTimeout(resolve, 5000));
      }
      showLink("커밋은 완료됐습니다. 배포 상태는 GitHub Actions에서 확인하세요.", "https://github.com/G1rmmr/G1rmmr.github.io/actions/workflows/docs.yml", "배포 확인");
    }

    publishButton.addEventListener("click", async () => {
      if (busy) return;
      if (!title.value.trim() || /[\r\n]/.test(title.value) || !body.value.trim()) {
        status.textContent = "TITLE과 CONTENT를 입력하세요."; return;
      }
      if (body.value.length > 200000) { status.textContent = "CONTENT는 200,000자 이하여야 합니다."; return; }
      const fingerprint = JSON.stringify([title.value.trim(), body.value]);
      if (!submission || submission.fingerprint !== fingerprint) submission = { id: window.crypto.randomUUID(), fingerprint };
      save(true);
      busy = true; publishButton.disabled = true; title.disabled = true; body.disabled = true;
      status.textContent = "게시물을 main에 커밋하는 중…";
      try {
        const response = await window.fetch("/api/posts", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
          body: JSON.stringify({ request_id: submission.id, title: title.value.trim(), body: body.value }),
        });
        if (response.status === 401) {
          showLink("로그인이 만료됐습니다. 초안을 저장한 뒤 다시 로그인하세요.", "/auth/login", "GitHub 로그인"); return;
        }
        const result = await response.json();
        if (!response.ok) { status.textContent = result.error || "게시하지 못했습니다. 다시 시도하세요."; return; }
        submission.published = result;
        save(true);
        await watchDeployment(result);
      } catch {
        status.textContent = "게시 결과를 확인하지 못했습니다. 같은 내용으로 다시 누르면 중복 글 없이 확인합니다.";
      } finally {
        busy = false; publishButton.disabled = false; title.disabled = false; body.disabled = false;
      }
    });
    render();
  }
  if (typeof document$ !== "undefined") document$.subscribe(initialize);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
