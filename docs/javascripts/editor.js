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
    const postSelect = root.querySelector("#post-select");
    const loadButton = root.querySelector("#post-load");
    const deleteButton = root.querySelector("#post-delete");
    const mode = root.querySelector("#post-mode");
    const images = root.querySelector("#post-images");
    const imageStatus = root.querySelector("#image-status");
    const confirmation = root.querySelector("#post-confirm");
    function ask(message, label = "확인") {
      root.querySelector("#post-confirm-message").textContent = message;
      const accept = root.querySelector("#post-confirm-accept");
      accept.textContent = label;
      return new Promise(resolve => {
        const finish = value => { confirmation.close(); resolve(value); };
        accept.onclick = () => finish(true);
        root.querySelector("#post-confirm-cancel").onclick = () => finish(false);
        confirmation.oncancel = event => { event.preventDefault(); finish(false); };
        confirmation.showModal();
      });
    }
    let submission = null;
    let active = null;
    let deletion = null;
    let baseline = JSON.stringify(["", ""]);
    let busy = false;
    const managedPath = path => typeof path === "string" && /^docs\/posts\/[A-Za-z0-9][A-Za-z0-9_-]{0,247}\.md$/.test(path) && path !== "docs/posts/index.md";
    const fingerprint = () => JSON.stringify([title.value, body.value]);
    function controls() {
      publishButton.textContent = active ? "수정 게시" : "게시";
      deleteButton.hidden = !active;
      mode.textContent = active ? `수정 중 · ${active.path.slice(11)}` : "새 글";
      for (const element of [publishButton, loadButton, postSelect, title, body, images]) element.disabled = busy;
      deleteButton.disabled = busy || !active;
    }
    function setBusy(value) { busy = value; controls(); }
    function restore(draft) {
      if (!draft || ![draft.title, draft.body].every(value => typeof value === "string")) return;
      title.value = draft.title; body.value = draft.body;
      if (managedPath(draft.active?.path) && /^[0-9a-f]{40}$/.test(draft.active.sha || "")) active = draft.active;
      if (draft.submission && typeof draft.submission.id === "string" && typeof draft.submission.fingerprint === "string") submission = draft.submission;
      if (draft.deletion?.path === active?.path) deletion = draft.deletion;
      if (typeof draft.baseline === "string") baseline = draft.baseline;
    }
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
      const selected = localStorage.getItem(`${key}:selected`);
      const draft = JSON.parse(localStorage.getItem(managedPath(selected) ? `${key}:${selected}` : key));
      if (draft && [draft.title, draft.body].every(value => typeof value === "string")) {
        restore(draft);
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
        localStorage.setItem(active ? `${key}:${active.path}` : key, JSON.stringify({ title: title.value, submission, active, deletion, baseline, body: body.value }));
        localStorage.setItem(`${key}:selected`, active?.path || "");
        if (!quiet) status.textContent = "이 브라우저에 임시저장했습니다.";
      } catch { status.textContent = "임시저장에 실패했습니다. 브라우저 저장 공간을 확인하세요."; }
    }
    root.addEventListener("input", () => { render(); save(); });
    root.querySelector("#post-save").addEventListener("click", () => save());

    async function getPost(path) {
      const response = await window.fetch(`/api/post?path=${encodeURIComponent(path)}`, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "게시물을 불러오지 못했습니다.");
      return result;
    }
    async function refreshPosts() {
      const selected = active?.path || postSelect.value || "";
      const response = await window.fetch("/api/posts", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("게시물 목록을 불러오지 못했습니다.");
      const result = await response.json();
      const fresh = document.createElement("option"); fresh.value = ""; fresh.textContent = "새 글 작성";
      postSelect.replaceChildren(fresh);
      for (const post of result.posts) {
        if (!managedPath(post.path)) continue;
        const option = document.createElement("option"); option.value = post.path; option.textContent = post.title;
        postSelect.append(option);
      }
      postSelect.value = selected;
    }
    function adopt(post) {
      active = { path: post.path, sha: post.sha };
      title.value = post.title; body.value = post.body;
      baseline = fingerprint(); submission = null; deletion = null;
      postSelect.value = post.path; render(); save(true); controls();
    }
    function startNew() {
      if (busy) return;
      save(true);
      try {
        const previous = localStorage.getItem(key);
        const draft = JSON.parse(previous);
        if (draft && (draft.title || draft.body)) localStorage.setItem(`${key}:previous:new`, previous);
      } catch { /* Existing post drafts are still saved independently. */ }
      active = null; submission = null; deletion = null;
      title.value = ""; body.value = ""; postSelect.value = "";
      baseline = fingerprint(); imageStatus.textContent = "붙여넣기 · 끌어놓기";
      render(); controls(); save(true); status.textContent = "새 글을 작성하세요.";
    }
    postSelect.addEventListener("change", () => { if (!postSelect.value) startNew(); });
    loadButton.addEventListener("click", async () => {
      if (busy) return;
      const path = postSelect.value;
      if (!path) { startNew(); return; }
      if (fingerprint() !== baseline && !await ask("작성 중인 내용은 임시저장됩니다. 선택한 글을 불러오시겠습니까?", "불러오기")) { postSelect.value = active?.path || ""; return; }
      save(true); setBusy(true);
      try {
        {
          const post = await getPost(path);
          let draft;
          try { draft = JSON.parse(localStorage.getItem(`${key}:${path}`)); } catch { /* Load repository version. */ }
          if (draft?.active?.path === path && typeof draft.baseline === "string" && JSON.stringify([draft.title, draft.body]) !== draft.baseline && await ask("이 글의 저장된 수정 초안을 불러오시겠습니까? 취소하면 서버의 최신 글을 불러옵니다.", "초안 복원")) {
            active = null; submission = null; deletion = null; restore(draft); render(); save(true);
            status.textContent = "수정 초안을 복원했습니다. 서버의 글이 변경됐다면 게시 시 충돌을 안내합니다.";
          } else {
            // Keep the previous edit draft recoverable when loading a newer version.
            if (draft?.active?.path === path) try { localStorage.setItem(`${key}:previous:${path}`, JSON.stringify(draft)); } catch { /* Best effort only. */ }
            adopt(post); status.textContent = "게시물을 불러왔습니다.";
          }
        }
      } catch (error) { status.textContent = error.message; postSelect.value = active?.path || ""; }
      finally { setBusy(false); }
    });

    async function uploadImages(files) {
      if (busy || !files.length) return;
      setBusy(true);
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
      finally { setBusy(false); images.value = ""; }
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
            showLink(published.deleted ? "삭제가 블로그에 반영됐습니다." : "배포가 완료됐습니다.", published.url, published.deleted ? "게시물 목록 열기" : "게시물 열기"); return;
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
      const requestFingerprint = JSON.stringify([active?.path || "", active?.sha || "", title.value.trim(), body.value]);
      if (!submission || submission.fingerprint !== requestFingerprint) submission = { id: window.crypto.randomUUID(), fingerprint: requestFingerprint };
      save(true);
      const wasNew = !active;
      setBusy(true);
      status.textContent = "게시물을 main에 커밋하는 중…";
      try {
        const response = await window.fetch(active ? "/api/post" : "/api/posts", {
          method: active ? "PUT" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
          body: JSON.stringify({ request_id: submission.id, title: title.value.trim(), body: body.value, ...(active ? { path: active.path, sha: active.sha } : {}) }),
        });
        if (response.status === 401) {
          showLink("로그인이 만료됐습니다. 초안을 저장한 뒤 다시 로그인하세요.", "/auth/login", "GitHub 로그인"); return;
        }
        const result = await response.json();
        if (!response.ok) { status.textContent = result.error || "게시하지 못했습니다. 다시 시도하세요."; return; }
        if (result.unchanged) { baseline = fingerprint(); save(true); status.textContent = "변경된 내용이 없습니다."; return; }
        submission.published = result;
        save(true);
        if (managedPath(result.path)) {
          try {
            const post = await getPost(result.path);
            adopt(post);
            if (wasNew) try { localStorage.setItem(key, JSON.stringify({ title: "", body: "" })); } catch { /* The published draft remains recoverable. */ }
            await refreshPosts();
          } catch { /* A committed post can be reloaded from the list later. */ }
        }
        await watchDeployment(result);
      } catch {
        status.textContent = "게시 결과를 확인하지 못했습니다. 같은 내용으로 다시 누르면 중복 글 없이 확인합니다.";
      } finally {
        setBusy(false);
      }
    });
    deleteButton.addEventListener("click", async () => {
      if (busy || !active) return;
      if (!await ask(`「${title.value || active.path}」 글을 삭제하시겠습니까?\n${active.path}\n삭제 후 블로그 배포가 실행됩니다.`, "삭제")) return;
      if (!deletion || deletion.path !== active.path || deletion.sha !== active.sha) deletion = { id: window.crypto.randomUUID(), path: active.path, sha: active.sha };
      save(true); setBusy(true); status.textContent = "삭제를 main에 반영하는 중…";
      try {
        const response = await window.fetch("/api/post", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf }, body: JSON.stringify({ request_id: deletion.id, path: deletion.path, sha: deletion.sha }) });
        const result = await response.json();
        if (!response.ok) { status.textContent = result.error || "삭제하지 못했습니다. 다시 시도하세요."; return; }
        active = null; submission = null; deletion = null; title.value = ""; body.value = ""; baseline = fingerprint();
        try { localStorage.setItem(`${key}:selected`, ""); } catch { /* Session state still clears. */ }
        render(); controls();
        try { await refreshPosts(); } catch { /* Deletion is already committed. */ }
        await watchDeployment(result);
      } catch { status.textContent = "삭제 결과를 확인하지 못했습니다. 다시 누르면 같은 요청의 결과를 확인합니다."; }
      finally { setBusy(false); }
    });
    controls();
    void refreshPosts().catch(error => { status.textContent = error.message; });
    render();
  }
  if (typeof document$ !== "undefined") document$.subscribe(initialize);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
