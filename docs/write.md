<div id="blog-editor" hidden>
  <h1>글쓰기</h1>
  <div class="editor-post-tools">
    <label for="post-select">편집할 글</label>
    <select id="post-select"><option value="">새 글 작성</option></select>
  </div>
  <label for="post-title">제목</label>
  <input id="post-title" type="text" maxlength="200" autocomplete="off">
  <div class="editor-columns">
    <div>
      <label for="post-body">본문</label>
      <textarea id="post-body" rows="20" spellcheck="false"></textarea>
    </div>
    <details class="editor-preview" open><summary>미리보기</summary><div id="post-preview"></div></details>
  </div>
  <div class="editor-toolbar">
    <button type="button" class="editor-image-add">이미지 추가</button>
    <input id="post-images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
    <button type="button" id="post-delete" hidden>삭제</button>
    <button type="button" id="post-save">임시저장</button>
    <button type="button" id="post-publish">게시</button>
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
