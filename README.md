# MyBlog

## 로컬 빌드

```powershell
python -m pip install zensical
python scripts/build_blog.py
```

빌드 시 `docs/posts/*.md`에서 게시물 목록을 자동 생성합니다.

## 글 작성

**W R I T E**는 인증용 Cloudflare Worker에서 열립니다. G1rmmr GitHub 계정으로 로그인한 뒤
TITLE·CONTENT를 작성하고 **게시**를 누르면 main에 자동 커밋하고 기존 GitHub Pages 배포를 추적합니다.
파일명은 서버에서 자동 생성합니다. 버튼은 **임시저장**, **게시** 두 개이며 초안은 브라우저에 보관합니다.
GitHub App의 최초 등록·설치는 계정 소유자가 완료해야 합니다.
설정값과 절차는 [GitHub App 설정 안내](publishing-worker/SETUP.md)를 참고하세요.

이미지는 **이미지 추가**, 본문 붙여넣기, 끌어놓기로 추가합니다. PNG·JPEG·WebP·GIF를
한 장에 5 MiB까지 지원합니다. 선택한 이미지는 즉시 `docs/img/uploads`에 저장하고 본문에 삽입합니다.
이미지만 올릴 때는 Pages 배포를 생략하며, 글을 게시할 때 함께 반영합니다.
미리보기에서는 배포를 기다리지 않고 이미지를 확인할 수 있습니다.

## 라이크와 배포 속도

게시물 하단에 조회수와 라이크를 표시합니다. 라이크는 글별·브라우저별 임의 ID로 중복을 방지하며,
다시 누르면 취소합니다. 로그인이나 IP 주소를 사용하지 않습니다. 브라우저 저장소를 지우면 같은 이용자를 식별할 수 없습니다.

글만 변경하면 Worker 테스트·Node 설정·npm 설치를 생략합니다. 코드나 설정을 변경하거나 수동 배포하면
전체 검증을 유지합니다. npm·pip 다운로드 캐시와 버전별 Python 가상환경 캐시를 사용합니다.
첫 배포는 캐시를 생성하며 이후 같은 의존성의 글 배포부터 캐시를 재사용합니다.

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
