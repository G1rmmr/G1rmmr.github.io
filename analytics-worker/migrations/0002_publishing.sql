-- Additive only: existing post_views and view_requests are unchanged.
CREATE TABLE publisher_oauth (
    state_hash TEXT PRIMARY KEY NOT NULL,
    verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX publisher_oauth_expiry ON publisher_oauth(expires_at);

CREATE TABLE publisher_sessions (
    session_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token_ciphertext TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX publisher_sessions_expiry ON publisher_sessions(expires_at);

CREATE TABLE publisher_posts (
    request_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    content_hash TEXT NOT NULL,
    commit_sha TEXT,
    created_at INTEGER NOT NULL
) STRICT;
