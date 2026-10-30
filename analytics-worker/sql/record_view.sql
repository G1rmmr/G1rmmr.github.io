INSERT INTO view_requests (visit_id, path, recorded_at)
VALUES (?1, ?2, unixepoch())
ON CONFLICT (visit_id) DO NOTHING;
