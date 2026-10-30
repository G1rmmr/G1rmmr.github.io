# MyBlog

## 로컬 빌드

```powershell
python -m pip install zensical
python scripts/build_blog.py
```

빌드 시 `docs/posts/*.md`에서 게시물 목록을 자동 생성합니다.

## 글 작성

블로그의 **W R I T E** 메뉴에서 빈 TITLE과 CONTENT에 글을 작성합니다.
PREVIEW에서 기본 Markdown 서식을 확인할 수 있습니다. 버튼은 **임시저장**, **게시** 두 개입니다.
파일 이름은 날짜와 UUID로 자동 생성합니다. **게시**를 누르면 파일명과 본문이 채워진
GitHub 작성 화면이 열립니다. 내용을 확인하고 커밋하면 기존 GitHub Pages workflow가 빌드·배포합니다.
긴 글은 URL 길이 제한 때문에 파일로 내려받고 GitHub 업로드 화면으로 연결합니다.
저장소 쓰기 권한이 필요하며, 임시저장은 브라우저와 기기에 종속됩니다.
단순화 전 초안은 기존 저장 키에 그대로 남기고, 새 편집창은 빈 상태에서 시작합니다.

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
