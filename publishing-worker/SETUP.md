# GitHub 로그인·자동 게시 설정

## 구현된 동작

- 공개 블로그의 WRITE와 `/write/` 북마크는 인증용 Worker로 연결됩니다.
- 로그인 전에는 편집창 HTML을 반환하지 않습니다. GitHub의 사용자 ID `52289794` (G1rmmr)만 허용합니다.
- 세션은 최대 8시간이며 만료되면 다시 로그인합니다. GitHub 토큰은 브라우저에 전달하지 않고 D1에 AES-GCM으로 암호화해 보관합니다.
- 게시 요청은 `G1rmmr/G1rmmr.github.io`의 `main`, `docs/posts`로 고정합니다.
- 파일명은 서버에서 날짜와 요청 UUID로 생성합니다. 같은 요청을 재시도해도 중복 커밋하거나 기존 파일을 덮어쓰지 않습니다.
- main 커밋 후 기존 `Blog` GitHub Actions가 배포하며, 편집창에서 대기·진행·성공·실패를 구분해 표시합니다.
- 이미지 선택·붙여넣기·끌어놓기는 인증된 `/api/images`를 통해 PNG·JPEG·WebP·GIF를 업로드합니다 (장당 최대 5 MiB).
- 이미지는 해시 기반 파일명으로 `docs/img/uploads`에 즉시 커밋합니다. 같은 이미지는 재사용합니다. 이미지 전용 커밋은 배포하지 않으며 이후 글 커밋 때 Pages에 반영합니다.
- 기존 Contents 쓰기 권한으로 이미지도 저장하므로 GitHub App이나 Cloudflare에 추가 권한·저장소 설정은 필요하지 않습니다.
- 기존 GitHub Pages 원점의 임시저장은 Worker 원점과 별개입니다. 이전 초안은 삭제하지 않습니다.

## 사용자가 직접 해야 할 설정

GitHub 계정과 Cloudflare 관리 화면에서 아래 설정을 완료해야 실제 로그인이 활성화됩니다.
비밀값을 채팅이나 저장소에 붙여 넣지 마세요.

### 1. GitHub App 등록

GitHub → 프로필 사진 → **Settings → Developer settings → GitHub Apps → New GitHub App**.

| 항목 | 입력값 |
| --- | --- |
| GitHub App name | 계정에서 구분할 수 있는 고유 이름 (예: `G1rmmr Realm Publisher`) |
| Homepage URL | `https://g1rmmr.github.io/` |
| Callback URL | `https://g1rmmr-blog-publisher.blckhnd-std.workers.dev/auth/callback` |
| Expire user authorization tokens | 활성화 |
| Request user authorization (OAuth) during installation | 비활성화 (WRITE에서 인증을 시작함) |
| Enable Device Flow | 비활성화 |
| Webhook → Active | 비활성화 |
| Repository permissions → Contents | **Read and write** |
| Repository permissions → Actions | **Read-only** (배포 상태 확인) |
| Repository permissions → Metadata | **Read-only** (기본값) |
| Where can this GitHub App be installed? | **Only on this account** |

다른 권한과 Webhook 이벤트 구독은 필요하지 않습니다. 앱을 등록합니다.

### 2. 블로그 저장소에 설치

등록한 앱 → **Install App → G1rmmr → Only select repositories** →
`G1rmmr.github.io`만 선택 → **Install**.

### 3. Client ID·Client Secret 저장

앱 설정 **General**에서 **Client ID**를 확인하고 **Generate a new client secret**을 실행합니다.
App ID와 Client ID는 서로 다릅니다. 이 구현은 private key를 사용하지 않습니다.

Cloudflare Dashboard → **Workers & Pages → g1rmmr-blog-publisher → Settings → Variables and Secrets → Add**.
아래 두 값을 각각 **Secret** 유형으로 추가하고 적용/배포합니다.

| 이름 | 값 |
| --- | --- |
| `GITHUB_CLIENT_ID` | GitHub App의 Client ID |
| `GITHUB_CLIENT_SECRET` | 생성한 Client Secret |

`TOKEN_ENCRYPTION_KEY`는 배포 과정에서 생성한 값을 그대로 유지합니다. 변경하면 기존 세션을 복호화할 수 없어 재로그인이 필요합니다.

### 4. 실제 게시 확인

1. `https://g1rmmr.github.io/write/` 또는 블로그의 WRITE로 진입합니다.
2. GitHub에 **G1rmmr 계정**으로 로그인하고 앱을 승인합니다.
3. TITLE·CONTENT를 입력하고 **게시**를 누릅니다.
4. `main 커밋 완료` 후 `배포가 완료됐습니다`가 표시되면 **게시물 열기**로 확인합니다.

앱 등록 전에는 WRITE에 설정 필요 화면이 표시되고 게시 API는 차단됩니다.
브랜치 보호 정책에 의해 GitHub App의 직접 main 쓰기가 차단된 경우 API가 권한 오류를 반환합니다. 이를 자동으로 우회하거나 정책을 변경하지 않습니다.

## 개발·배포

Node.js 22 이상과 `analytics-worker`의 기존 npm 의존성을 사용합니다.

```powershell
node --test tests/*.test.mjs
node --test publishing-worker/tests/*.test.mjs
.venv/Scripts/python.exe scripts/build_blog.py
node analytics-worker/node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config publishing-worker/wrangler.toml
node analytics-worker/node_modules/wrangler/bin/wrangler.js deploy --config publishing-worker/wrangler.toml
node scripts/set-publisher-encryption-key.mjs
```

마이그레이션 `0002_publishing.sql`은 새 테이블만 추가하며 기존 조회수 테이블은 수정하지 않습니다.
Worker와 GitHub Pages는 별도 배포입니다. 편집기 코드를 변경하면 위 Worker 배포도 실행해야 합니다.

## 참고 문서

- [GitHub App 사용자 인증](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [저장소 파일 생성 API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
- [Actions 실행 조회 API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)
