CREATE TABLE post_views (
    path TEXT PRIMARY KEY NOT NULL,
    views INTEGER NOT NULL CHECK (views >= 0),
    first_viewed_at INTEGER NOT NULL,
    last_viewed_at INTEGER NOT NULL
) STRICT;

-- Random per-page-load request IDs, not persistent visitor identifiers.
CREATE TABLE view_requests (
    visit_id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
) STRICT;

CREATE INDEX view_requests_recorded_at ON view_requests (recorded_at);

-- Trigger and INSERT are one SQLite transaction. A failed counter update rolls
-- back the request ID too, so a subsequent retry can safely try again.
CREATE TRIGGER count_new_view
AFTER INSERT ON view_requests
BEGIN
    INSERT INTO post_views (path, views, first_viewed_at, last_viewed_at)
    VALUES (NEW.path, 1, NEW.recorded_at, NEW.recorded_at)
    ON CONFLICT (path) DO UPDATE SET
        views = post_views.views + 1,
        last_viewed_at = max(post_views.last_viewed_at, excluded.last_viewed_at);

    -- Opportunistic indexed cleanup retains deduplication IDs for seven days.
    -- Aggregate counts are retained. No scheduler or extra Worker is required.
    DELETE FROM view_requests WHERE recorded_at < NEW.recorded_at - 604800;
END;
