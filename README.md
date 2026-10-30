# MyBlog

## 로컬 빌드

```powershell
python -m pip install zensical
python scripts/build_blog.py
```

빌드 시 `docs/posts/*.md`에서 게시물 목록을 자동 생성합니다.

## 글 작성

블로그의 **W R I T E** 메뉴에서 제목과 본문을 작성합니다. 기본 Markdown 미리보기,
서식 버튼, 브라우저 임시저장, `.md` 내보내기를 제공합니다.
파일을 내려받고 **GitHub에서 게시**를 열어 `main` 브랜치의 `docs/posts`에 업로드한 뒤
커밋하면 기존 GitHub Pages workflow가 빌드·배포합니다. 저장소 쓰기 권한이 필요합니다.
같은 파일 이름을 사용하면 기존 게시물과 충돌할 수 있으므로 새 글에는 고유한 이름을 사용하세요.
임시저장은 브라우저와 기기에 종속되므로 중요한 초안은 파일로 보관하세요.

## 조회수 API

기존 D1의 `post_views`를 사용하며 스키마 변경은 없습니다.
`POST /views`는 중복 방문 ID를 제거하여 집계한 후 `{ "path": "/posts/slug/", "views": 1 }`을 반환합니다.
`GET /views?path=/posts/slug/`는 집계 없이 조회합니다. 두 요청 모두 기존 `ALLOWED_ORIGIN`을 검사합니다.
로컬·미리보기에서는 운영 조회수를 기록하지 않습니다.

프런트엔드를 공개하기 전에 변경한 Worker를 배포해야 합니다.

```powershell
cd analytics-worker
npm run deploy
```

이후 저장소 변경을 `main`에 반영하면 GitHub Pages가 배포됩니다.

## 확인

```powershell
node --test tests/*.test.mjs
cargo test --manifest-path analytics-worker/Cargo.toml --locked
cargo check --manifest-path analytics-worker/Cargo.toml --target wasm32-unknown-unknown --locked
python analytics-worker/tests/test_database.py
```
