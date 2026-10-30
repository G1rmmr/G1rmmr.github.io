CREATE TABLE post_likes (
    path TEXT NOT NULL,
    like_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (path, like_id)
) STRICT;
