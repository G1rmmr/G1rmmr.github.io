# R E A L M

John Nam의 개발 블로그. GitHub Pages에서 정적 사이트로 배포합니다.

## 게시와 빌드

메뉴의 **글쓰기**에서 GitHub 계정으로 로그인하면 이미지 업로드와 글 작성·수정·삭제가 가능합니다. 인증과 발행 요청은 Cloudflare Worker가 처리합니다. [발행 서버 설정](publishing-worker/SETUP.md)

`docs/posts/YYYY-MM-DD-제목.md`에 글을 작성합니다. 첫 번째 1단계 제목이 목록에 표시되며 파일명의 날짜로 최신순 정렬합니다.

```sh
python -m pip install -r requirements.txt
python scripts/build_blog.py
```
