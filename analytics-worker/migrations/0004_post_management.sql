CREATE TABLE publisher_operations (
    request_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('update', 'delete')),
    expected_sha TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    commit_sha TEXT,
    blob_sha TEXT,
    created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE publisher_titles (
    path TEXT PRIMARY KEY NOT NULL,
    blob_sha TEXT NOT NULL,
    title TEXT NOT NULL
) STRICT;
