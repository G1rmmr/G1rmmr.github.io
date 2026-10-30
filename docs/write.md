<div id="blog-editor" hidden>
  <div class="editor-post-tools">
    <label for="post-select">POST</label>
    <select id="post-select"><option value="">새 글 작성</option></select>
  </div>
  <label for="post-title">TITLE</label>
  <input id="post-title" type="text" maxlength="200" autocomplete="off">
  <div class="editor-columns">
    <div>
      <label for="post-body">CONTENT</label>
      <textarea id="post-body" rows="20" spellcheck="false"></textarea>
    </div>
    <div><h2>PREVIEW</h2><div id="post-preview" class="md-typeset"></div></div>
  </div>
  <div class="editor-toolbar">
    <button type="button" class="editor-image-add" aria-label="이미지 추가" title="이미지 추가">🖼️</button>
    <input id="post-images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
    <button type="button" id="post-save">임시저장</button>
    <button type="button" id="post-publish">게시</button>
    <button type="button" id="post-delete" hidden>삭제</button>
  </div>
  <p id="image-status" role="status" aria-live="polite"></p>
  <p id="editor-status" role="status" aria-live="polite"></p>
  <dialog id="post-confirm" aria-labelledby="post-confirm-title">
    <h2 id="post-confirm-title">게시물 확인</h2>
    <p id="post-confirm-message"></p>
    <div class="editor-toolbar">
      <button type="button" id="post-confirm-cancel">취소</button>
      <button type="button" id="post-confirm-accept">확인</button>
    </div>
  </dialog>
</div>

<noscript>편집창을 사용하려면 JavaScript를 활성화하세요.</noscript>
