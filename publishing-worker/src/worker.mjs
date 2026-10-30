const REPO = "G1rmmr/G1rmmr.github.io";
const BLOG = "https://g1rmmr.github.io";
const SESSION = "__Host-blog_session";
const OAUTH = "__Host-blog_oauth";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const enc = new TextEncoder();
const IMAGE_LIMIT = 5 * 1024 * 1024;
const now = () => Math.floor(Date.now() / 1000);
const b64 = bytes => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const url64 = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => url64(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async text => url64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));

class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function cookie(req, name) {
  return (req.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(name + "="))?.slice(name.length + 1);
}

function setCookie(res, name, value, seconds) {
  res.headers.append("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`);
  return res;
}

function redirect(location) { return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } }); }

function setupPage() {
  return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WRITE 설정</title><body style="font-family:system-ui;background:#101116;color:#eee;max-width:40rem;margin:15vh auto;padding:2rem"><h1>GitHub 로그인 설정이 필요합니다.</h1><p>블로그 관리자가 GitHub App을 등록하고 Worker의 Client ID와 Client Secret을 설정하면 글을 작성할 수 있습니다.</p><a style="color:#aaa" href="https://g1rmmr.github.io/">블로그로 돌아가기</a></body></html>', { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function configured(env) {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY && /^\d+$/.test(env.GITHUB_OWNER_ID || ""));
}

async function tokenKey(env) {
  const bytes = unb64(env.TOKEN_ENCRYPTION_KEY);
  if (bytes.length !== 32) throw new Error("Invalid key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(REPO) }, await tokenKey(env), enc.encode(token));
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}

async function decryptToken(value, env) {
  const [iv, ciphertext] = value.split(".");
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(REPO) }, await tokenKey(env), unb64(ciphertext));
  return new TextDecoder().decode(bytes);
}

async function github(token, path, options = {}, accept = "application/vnd.github+json") {
  return fetch(`https://api.github.com${path}`, {
    ...options, redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Accept: accept, Authorization: `Bearer ${token}`, "User-Agent": "realm-blog-publisher", "X-GitHub-Api-Version": "2022-11-28", ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
}

async function githubData(response) {
  if (response.status === 401) throw new Problem(401, "GitHub 로그인이 만료됐습니다. 다시 로그인하세요.");
  if (response.status === 403) throw new Problem(403, "GitHub App의 저장소 권한 또는 API 사용 한도를 확인하세요.");
  if (!response.ok) throw new Problem(502, "GitHub 요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.");
  return response.json();
}

async function cleanup(env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM publisher_oauth WHERE expires_at <= ?1").bind(now()),
    env.DB.prepare("DELETE FROM publisher_sessions WHERE expires_at <= ?1").bind(now()),
  ]);
}

async function login(req, env) {
  await cleanup(env);
  const state = random();
  const verifier = random();
  await env.DB.prepare("INSERT INTO publisher_oauth (state_hash, verifier, expires_at) VALUES (?1, ?2, ?3)").bind(await hash(state), verifier, now() + 600).run();
  const target = new URL("https://github.com/login/oauth/authorize");
  target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${env.PUBLISHER_ORIGIN}/auth/callback`, state, code_challenge: await hash(verifier), code_challenge_method: "S256", login: "G1rmmr", allow_signup: "false" });
  return setCookie(redirect(target.href), OAUTH, state, 600);
}

async function callback(req, env, url) {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || state !== cookie(req, OAUTH)) throw new Problem(400, "로그인 요청을 확인할 수 없습니다. WRITE에서 다시 시작하세요.");
  // Consume before exchanging the code: callbacks cannot be replayed.
  const pending = await env.DB.prepare("DELETE FROM publisher_oauth WHERE state_hash = ?1 RETURNING verifier, expires_at").bind(await hash(state)).first();
  if (!pending || pending.expires_at <= now() || !code || code.length > 512) throw new Problem(400, "로그인 요청이 만료됐거나 취소됐습니다. WRITE에서 다시 시작하세요.");
  const exchange = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${env.PUBLISHER_ORIGIN}/auth/callback`, code_verifier: pending.verifier }),
  });
  if (!exchange.ok) throw new Problem(502, "GitHub 로그인에 실패했습니다. 다시 시도하세요.");
  const grant = await exchange.json();
  if (!grant.access_token || grant.error) throw new Problem(401, "GitHub 로그인이 거절됐습니다. 다시 로그인하세요.");
  const user = await githubData(await github(grant.access_token, "/user"));
  if (String(user.id) !== env.GITHUB_OWNER_ID) throw new Problem(403, "블로그 소유자 계정만 글을 작성할 수 있습니다.");
  const repo = await githubData(await github(grant.access_token, `/repos/${REPO}`));
  if (!repo.permissions?.push) throw new Problem(403, "블로그 저장소에 대한 쓰기 권한이 필요합니다. GitHub App 설치를 확인하세요.");
  const session = random();
  const csrf = random();
  const lifetime = Math.max(1, Math.min(28800, Number(grant.expires_in) || 28800));
  await env.DB.prepare("INSERT INTO publisher_sessions (session_hash, user_id, token_ciphertext, csrf_token, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(await hash(session), String(user.id), await encryptToken(grant.access_token, env), csrf, now() + lifetime).run();
  const old = cookie(req, SESSION);
  if (old) await env.DB.prepare("DELETE FROM publisher_sessions WHERE session_hash = ?1").bind(await hash(old)).run();
  return setCookie(setCookie(redirect(`${env.PUBLISHER_ORIGIN}/write/`), OAUTH, "", 0), SESSION, session, lifetime);
}

async function session(req, env) {
  const value = cookie(req, SESSION);
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const row = await env.DB.prepare("SELECT * FROM publisher_sessions WHERE session_hash = ?1 AND expires_at > ?2").bind(await hash(value), now()).first();
  if (!row || row.user_id !== env.GITHUB_OWNER_ID) return null;
  return { ...row, token: await decryptToken(row.token_ciphertext, env) };
}

function checkMutation(req, env, user, contentType = "application/json") {
  if (req.headers.get("Origin") !== env.PUBLISHER_ORIGIN || req.headers.get("X-CSRF-Token") !== user.csrf_token) throw new Problem(403, "게시 요청을 확인할 수 없습니다. 페이지를 새로고침하세요.");
  if (req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== contentType) throw new Problem(415, "요청 파일 형식이 올바르지 않습니다.");
}

export function imageFormat(bytes) {
  const starts = signature => signature.every((value, index) => bytes[index] === value);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return { extension: "png", type: "image/png" };
  if (starts([255, 216, 255])) return { extension: "jpg", type: "image/jpeg" };
  const ascii = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (/^GIF8[79]a/.test(ascii)) return { extension: "gif", type: "image/gif" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { extension: "webp", type: "image/webp" };
  return null;
}

async function readBytes(req, limit) {
  if (Number(req.headers.get("Content-Length")) > limit) throw new Problem(413, "이미지는 5 MiB 이하여야 합니다.");
  const reader = req.body?.getReader();
  if (!reader) throw new Problem(400, "파일이 필요합니다.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Problem(413, "이미지는 5 MiB 이하여야 합니다."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function uploadImage(req, env, user) {
  const type = req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type)) throw new Problem(415, "PNG, JPEG, WebP, GIF 이미지를 선택하세요.");
  checkMutation(req, env, user, type);
  const bytes = await readBytes(req, IMAGE_LIMIT);
  const format = imageFormat(bytes);
  if (!format || format.type !== type) throw new Problem(415, "이미지의 실제 형식과 파일 형식이 일치하지 않습니다.");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  const name = `${digest}.${format.extension}`;
  const path = `docs/img/uploads/${name}`;
  const endpoint = `/repos/${REPO}/contents/${path}`;
  const existing = await github(user.token, `${endpoint}?ref=main`);
  if (existing.status !== 404) await githubData(existing);
  else {
    const created = await github(user.token, endpoint, { method: "PUT", body: JSON.stringify({ branch: "main", message: `[image] ${name}`, content: b64(bytes) }) });
    if ([409, 422].includes(created.status)) await githubData(await github(user.token, `${endpoint}?ref=main`));
    else await githubData(created);
  }
  return json({ path: `/img/uploads/${name}`, preview: `/media/${name}` });
}

async function imagePreview(url, user) {
  const match = url.pathname.match(/^\/media\/([0-9a-f]{64}\.(png|jpg|webp|gif))$/);
  if (!match) throw new Problem(404, "이미지를 찾을 수 없습니다.");
  const image = await github(user.token, `/repos/${REPO}/contents/docs/img/uploads/${match[1]}?ref=main`, {}, "application/vnd.github.raw+json");
  if (!image.ok) throw new Problem(image.status === 404 ? 404 : 502, "이미지를 불러오지 못했습니다.");
  return new Response(image.body, { headers: { "Content-Type": `image/${match[2] === "jpg" ? "jpeg" : match[2]}`, "Cache-Control": "private, max-age=300" } });
}

export function validPost(value) {
  return value && Object.keys(value).every(k => ["request_id", "title", "body"].includes(k)) && UUID.test(value.request_id || "") && typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 200 && !/[\r\n\x00-\x1f]/.test(value.title) && typeof value.body === "string" && value.body.trim().length > 0 && value.body.length <= 200000;
}

async function readPost(req) {
  const reader = req.body?.getReader();
  if (!reader) throw new Problem(400, "본문이 필요합니다.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024 * 1024) { await reader.cancel(); throw new Problem(413, "게시물은 1 MiB 이하여야 합니다."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Problem(400, "본문 형식이 올바르지 않습니다."); }
}

function publication(post, sha) {
  const slug = post.path.slice("docs/posts/".length, -3);
  return { path: post.path, sha, url: `${BLOG}/posts/${slug}/`, commit_url: `https://github.com/${REPO}/commit/${sha}` };
}

export function validManagedPath(path) {
  return typeof path === "string" && /^docs\/posts\/[A-Za-z0-9][A-Za-z0-9_-]{0,247}\.md$/.test(path) && path !== "docs/posts/index.md";
}

export function splitPost(content, fallback = "") {
  const heading = /^# ([^\r\n]+)(?:\r?\n|$)/m.exec(content);
  if (!heading) return { title: fallback, body: content, prefix: "", newline: content.includes("\r\n") ? "\r\n" : "\n" };
  return { title: heading[1], body: content.slice(heading.index + heading[0].length).replace(/^\r?\n/, ""), prefix: content.slice(0, heading.index), newline: content.includes("\r\n") ? "\r\n" : "\n" };
}

async function readRepositoryPost(token, path) {
  const response = await github(token, `/repos/${REPO}/contents/${path}?ref=main`);
  if (response.status === 404) return null;
  const file = await githubData(response);
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string" || file.size > 1024 * 1024 || !SHA.test(file.sha || "")) throw new Problem(422, "이 글의 파일 형식이나 크기는 편집기에서 지원하지 않습니다.");
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(unb64(file.content.replace(/\s/g, ""))); }
  catch { throw new Problem(422, "UTF-8 형식의 게시물만 편집할 수 있습니다."); }
  return { ...splitPost(content, path.slice(11, -3)), path, sha: file.sha, content };
}

async function cacheTitle(env, path, sha, title) {
  await env.DB.prepare("INSERT INTO publisher_titles (path, blob_sha, title) VALUES (?1, ?2, ?3) ON CONFLICT(path) DO UPDATE SET blob_sha = excluded.blob_sha, title = excluded.title").bind(path, sha, title).run();
}

async function listPosts(env, user) {
  const files = await githubData(await github(user.token, `/repos/${REPO}/contents/docs/posts?ref=main`));
  if (!Array.isArray(files)) throw new Problem(502, "게시물 목록을 확인하지 못했습니다.");
  const cached = (await env.DB.prepare("SELECT path, blob_sha, title FROM publisher_titles").all()).results;
  const titles = new Map(cached.map(row => [row.path, row]));
  const posts = files.filter(file => file.type === "file" && validManagedPath(file.path)).sort((a, b) => b.name.localeCompare(a.name));
  // Warm a bounded number of legacy titles; new titles are cached on read/write.
  let remaining = 10;
  const result = [];
  for (const file of posts) {
    let title = titles.get(file.path);
    if ((!title || title.blob_sha !== file.sha) && remaining-- > 0) {
      try {
        const post = await readRepositoryPost(user.token, file.path);
        if (!post) continue;
        await cacheTitle(env, file.path, post.sha, post.title);
        title = { title: post.title, blob_sha: post.sha };
      } catch (error) { if (!(error instanceof Problem) || error.status !== 422) throw error; }
    }
    result.push({ path: file.path, sha: file.sha, title: title?.blob_sha === file.sha ? title.title : file.name.slice(0, -3) });
  }
  return json({ posts: result });
}

async function loadPost(env, user, url) {
  const path = url.searchParams.get("path");
  if (!validManagedPath(path)) throw new Problem(400, "편집할 게시물 경로가 올바르지 않습니다.");
  const post = await readRepositoryPost(user.token, path);
  if (!post) throw new Problem(404, "글이 삭제됐거나 존재하지 않습니다. 목록을 새로 불러오세요.");
  await cacheTitle(env, post.path, post.sha, post.title);
  return json({ path: post.path, sha: post.sha, title: post.title, body: post.body });
}

async function previousOperationCommit(token, operation) {
  const commits = await githubData(await github(token, `/repos/${REPO}/commits?sha=main&path=${encodeURIComponent(operation.path)}&per_page=10`));
  return commits.find(commit => SHA.test(commit.sha || "") && commit.commit?.message?.endsWith(`[write:${operation.request_id}]`))?.sha || null;
}

function operationResult(operation, sha, blobSha) {
  return { ...publication(operation, sha), blob_sha: blobSha || null, deleted: operation.kind === "delete", ...(operation.kind === "delete" ? { url: `${BLOG}/posts/` } : {}) };
}

async function managePost(req, env, user) {
  checkMutation(req, env, user);
  const data = await readPost(req);
  const deleting = req.method === "DELETE";
  const allowed = deleting ? ["request_id", "path", "sha"] : ["request_id", "path", "sha", "title", "body"];
  if (!data || typeof data !== "object" || Object.keys(data).some(key => !allowed.includes(key)) || !UUID.test(data.request_id || "") || !validManagedPath(data.path) || !SHA.test(data.sha || "") || (!deleting && !validPost({ request_id: data.request_id, title: data.title, body: data.body }))) throw new Problem(400, "게시물 경로·버전·내용을 확인하세요.");
  const kind = deleting ? "delete" : "update";
  const digest = await hash(JSON.stringify([data.path, data.sha, kind, deleting ? null : data.title.trim(), deleting ? null : data.body]));
  await env.DB.prepare("INSERT OR IGNORE INTO publisher_operations (request_id, user_id, path, kind, expected_sha, content_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(data.request_id, user.user_id, data.path, kind, data.sha, digest, now()).run();
  const operation = await env.DB.prepare("SELECT * FROM publisher_operations WHERE request_id = ?1").bind(data.request_id).first();
  if (operation.user_id !== user.user_id || operation.path !== data.path || operation.kind !== kind || operation.content_hash !== digest) throw new Problem(409, "다른 작업에 사용된 요청입니다. 글을 다시 불러온 뒤 시도하세요.");
  if (operation.commit_sha) return json(operationResult(operation, operation.commit_sha, operation.blob_sha));
  const current = await readRepositoryPost(user.token, data.path);
  if (!current || current.sha !== data.sha) {
    const recovered = await previousOperationCommit(user.token, operation);
    if (recovered) {
      await env.DB.prepare("UPDATE publisher_operations SET commit_sha = ?1 WHERE request_id = ?2").bind(recovered, data.request_id).run();
      return json(operationResult(operation, recovered, null));
    }
    throw new Problem(current ? 409 : 404, current ? "다른 곳에서 글이 변경됐습니다. 초안은 유지됩니다. 글을 다시 불러온 뒤 수정·삭제하세요." : "글이 이미 삭제됐거나 존재하지 않습니다. 목록을 새로 불러오세요.");
  }
  const content = deleting ? null : `${current.prefix}# ${data.title.trim()}${current.newline}${current.newline}${data.body.replace(/\r?\n/g, current.newline)}`;
  if (!deleting && content === current.content) return json({ unchanged: true, path: data.path, blob_sha: current.sha, url: publication(operation, "").url });
  const response = await github(user.token, `/repos/${REPO}/contents/${data.path}`, {
    method: deleting ? "DELETE" : "PUT",
    body: JSON.stringify({ branch: "main", sha: data.sha, message: `[blog ${kind}] ${deleting ? current.title : data.title.trim()} [write:${data.request_id}]`, ...(!deleting ? { content: b64(enc.encode(content)) } : {}) }),
  });
  let result;
  if ([409, 422, 404].includes(response.status)) {
    const recovered = await previousOperationCommit(user.token, operation);
    if (!recovered) throw new Problem(409, "글이 변경됐거나 삭제됐습니다. 다시 불러온 뒤 시도하세요.");
    result = { commit: { sha: recovered } };
  } else result = await githubData(response);
  if (!SHA.test(result.commit?.sha || "")) throw new Problem(502, "커밋 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도하세요.");
  const blobSha = SHA.test(result.content?.sha || "") ? result.content.sha : null;
  await env.DB.prepare("UPDATE publisher_operations SET commit_sha = ?1, blob_sha = ?2 WHERE request_id = ?3").bind(result.commit.sha, blobSha, data.request_id).run();
  if (deleting) await env.DB.prepare("DELETE FROM publisher_titles WHERE path = ?1").bind(data.path).run();
  else if (blobSha) await cacheTitle(env, data.path, blobSha, data.title.trim());
  return json(operationResult(operation, result.commit.sha, blobSha));
}

async function recoverCommit(token, post, content) {
  const response = await github(token, `/repos/${REPO}/contents/${post.path}?ref=main`);
  if (response.status === 404) return null;
  const file = await githubData(response);
  if (file.type !== "file" || file.encoding !== "base64" || file.content.replace(/\s/g, "") !== b64(enc.encode(content))) throw new Problem(409, "같은 파일 이름의 다른 글이 있습니다. 새 게시 요청으로 다시 시도하세요.");
  const commits = await githubData(await github(token, `/repos/${REPO}/commits?sha=main&path=${encodeURIComponent(post.path)}&per_page=1`));
  const sha = commits[0]?.sha;
  if (!SHA.test(sha || "")) throw new Problem(502, "게시 커밋을 확인하지 못했습니다. 다시 시도하세요.");
  return sha;
}

async function publish(req, env, user) {
  checkMutation(req, env, user);
  const data = await readPost(req);
  if (!validPost(data)) throw new Problem(400, "TITLE과 CONTENT, 게시 요청 ID를 확인하세요.");
  const content = `# ${data.title.trim()}\n\n${data.body}\n`;
  const digest = await hash(content);
  const path = `docs/posts/${new Date().toISOString().slice(0, 10)}-${data.request_id}.md`;
  await env.DB.prepare("INSERT OR IGNORE INTO publisher_posts (request_id, user_id, path, content_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(data.request_id, user.user_id, path, digest, now()).run();
  const post = await env.DB.prepare("SELECT * FROM publisher_posts WHERE request_id = ?1").bind(data.request_id).first();
  if (post.user_id !== user.user_id || post.content_hash !== digest) throw new Problem(409, "이 게시 요청은 다른 내용에 사용됐습니다. 내용을 수정한 뒤 다시 게시하세요.");
  if (post.commit_sha) return json(publication(post, post.commit_sha));
  let sha = await recoverCommit(user.token, post, content);
  if (!sha) {
    // No `sha` means create-only. Never overwrite an existing file on a retry.
    const response = await github(user.token, `/repos/${REPO}/contents/${post.path}`, { method: "PUT", body: JSON.stringify({ message: `[blog] ${data.title.trim()}`, content: b64(enc.encode(content)), branch: "main" }) });
    if (response.status === 409 || response.status === 422) sha = await recoverCommit(user.token, post, content);
    else sha = (await githubData(response)).commit?.sha;
  }
  if (!SHA.test(sha || "")) throw new Problem(502, "게시 커밋을 확인하지 못했습니다. 같은 내용으로 다시 시도하세요.");
  await env.DB.prepare("UPDATE publisher_posts SET commit_sha = ?1 WHERE request_id = ?2").bind(sha, data.request_id).run();
  return json(publication(post, sha));
}

async function deployment(url, user) {
  const sha = url.searchParams.get("sha");
  if (!SHA.test(sha || "")) throw new Problem(400, "올바른 커밋 ID가 필요합니다.");
  const data = await githubData(await github(user.token, `/repos/${REPO}/actions/workflows/docs.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=5`));
  const run = data.workflow_runs?.filter(r => r.head_sha === sha).sort((a, b) => b.id - a.id)[0];
  if (!run) return json({ status: "pending" });
  return json({ status: run.status === "completed" ? (run.conclusion === "success" ? "success" : "failure") : "running", workflow_url: run.html_url });
}

async function route(req, env) {
  const url = new URL(req.url);
  if (url.origin !== env.PUBLISHER_ORIGIN) return json({ error: "올바른 WRITE 주소를 이용하세요." }, 400);
  const assets = url.pathname.startsWith("/assets/") || ["/stylesheets/extra.css", "/javascripts/editor.js", "/javascripts/pageviews.js", "/javascripts/likes.js", "/img/favicon.png", "/search.json", "/sitemap.xml"].includes(url.pathname);
  if (assets && ["GET", "HEAD"].includes(req.method)) return env.ASSETS.fetch(req);
  if (url.pathname === "/" && req.method === "GET") return redirect(`${env.PUBLISHER_ORIGIN}/write/`);
  const editor = ["/write", "/write/", "/write/index.html"].includes(url.pathname);
  if (!editor && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/") && !url.pathname.startsWith("/media/")) return redirect(`${BLOG}${url.pathname}${url.search}`);
  if (!configured(env)) return (editor || url.pathname === "/auth/login") ? setupPage() : json({ error: "GitHub App 설정이 필요합니다." }, 503);
  if (url.pathname === "/auth/login" && req.method === "GET") return login(req, env);
  if (url.pathname === "/auth/callback" && req.method === "GET") return callback(req, env, url);
  const user = await session(req, env);
  if (!user) return editor ? redirect(`${env.PUBLISHER_ORIGIN}/auth/login`) : json({ error: "GitHub 로그인이 필요합니다." }, 401);
  if (editor && req.method === "GET") {
    const target = new URL("/write/", url.origin);
    const response = await env.ASSETS.fetch(new Request(target.href, req));
    const copy = new Response(response.body, response);
    copy.headers.set("Cache-Control", "no-store");
    // Navigation belongs to the public blog; only WRITE stays on this origin.
    return new HTMLRewriter().on("a[href]", {
      element(element) {
        const href = element.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        const link = new URL(href, target);
        if (link.origin === url.origin && !link.pathname.startsWith("/write")) element.setAttribute("href", `${BLOG}${link.pathname}${link.search}${link.hash}`);
      },
    }).transform(copy);
  }
  if (url.pathname === "/api/session" && req.method === "GET") return json({ login: "G1rmmr", csrf: user.csrf_token, expires_at: user.expires_at });
  if (url.pathname === "/api/images" && req.method === "POST") return uploadImage(req, env, user);
  if (url.pathname.startsWith("/media/") && req.method === "GET") return imagePreview(url, user);
  if (url.pathname === "/api/posts" && req.method === "POST") return publish(req, env, user);
  if (url.pathname === "/api/posts" && req.method === "GET") return listPosts(env, user);
  if (url.pathname === "/api/post" && req.method === "GET") return loadPost(env, user, url);
  if (url.pathname === "/api/post" && ["PUT", "DELETE"].includes(req.method)) return managePost(req, env, user);
  if (url.pathname === "/api/deployment" && req.method === "GET") return deployment(url, user);
  if (url.pathname === "/auth/logout" && req.method === "POST") {
    checkMutation(req, env, user);
    await env.DB.prepare("DELETE FROM publisher_sessions WHERE session_hash = ?1").bind(user.session_hash).run();
    return setCookie(json({ ok: true }), SESSION, "", 0);
  }
  return json({ error: "요청 경로 또는 메서드가 올바르지 않습니다." }, 404);
}

export default {
  async fetch(req, env) {
    let response;
    try { response = await route(req, env); }
    catch (error) { response = json({ error: error instanceof Problem ? error.message : "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요." }, error instanceof Problem ? error.status : 503); }
    response = new Response(response.body, response);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return response;
  },
};
