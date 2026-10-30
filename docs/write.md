# 포스팅 작성

Markdown으로 글을 작성하세요. 임시저장은 이 브라우저에만 보관됩니다.
게시하려면 Markdown 파일을 내려받아 GitHub의 `docs/posts`에 업로드하고 커밋하세요.
저장소 쓰기 권한이 있는 계정으로 로그인해야 하며, 커밋 후 블로그 빌드가 실행됩니다.

<div id="blog-editor">
  <label for="post-title">제목</label>
  <input id="post-title" type="text" maxlength="200" placeholder="글 제목" autocomplete="off">
  <label for="post-slug">파일 이름 (영문·숫자·하이픈·밑줄)</label>
  <input id="post-slug" type="text" maxlength="248" placeholder="2026-10-30-my-post" autocomplete="off" pattern="[A-Za-z0-9][A-Za-z0-9_-]*">
  <div class="editor-toolbar" role="group" aria-label="Markdown 서식">
    <button type="button" data-format="heading">제목</button>
    <button type="button" data-format="bold">굵게</button>
    <button type="button" data-format="italic">기울임</button>
    <button type="button" data-format="link">링크</button>
    <button type="button" data-format="list">목록</button>
    <button type="button" data-format="code">코드</button>
  </div>
  <div class="editor-columns">
    <div><label for="post-body">본문 (Markdown)</label><textarea id="post-body" rows="20" spellcheck="false" placeholder="내용을 입력하세요."></textarea></div>
    <div><h2>미리보기</h2><p class="editor-hint">기본 Markdown 서식을 표시합니다. 블로그 전용 확장 문법은 게시 후 표시와 다를 수 있습니다.</p><div id="post-preview" class="md-typeset"></div></div>
  </div>
  <div class="editor-toolbar">
    <button type="button" id="post-save">임시저장</button>
    <button type="button" id="post-download">Markdown 내려받기</button>
    <a href="https://github.com/G1rmmr/G1rmmr.github.io/upload/main/docs/posts" target="_blank" rel="noopener noreferrer">GitHub에서 게시</a>
  </div>
  <p id="editor-status" role="status" aria-live="polite"></p>
</div>

<noscript>편집창을 사용하려면 JavaScript를 활성화하세요.</noscript>
