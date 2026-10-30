use serde::Deserialize;

pub const MAX_BODY_BYTES: usize = 1_024;
pub const MAX_PATH_BYTES: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewRequest {
    pub path: String,
    pub visit_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LikeRequest {
    pub path: String,
    pub like_id: String,
    pub liked: bool,
}

pub fn parse_like(bytes: &[u8]) -> Option<LikeRequest> {
    if bytes.len() > MAX_BODY_BYTES { return None; }
    let mut like: LikeRequest = serde_json::from_slice(bytes).ok()?;
    if !valid_post_path(&like.path) || !valid_visit_id(&like.like_id) { return None; }
    like.like_id.make_ascii_lowercase();
    Some(like)
}

pub fn valid_post_path(path: &str) -> bool {
    if path.len() > MAX_PATH_BYTES {
        return false;
    }
    let Some(slug) = path.strip_prefix("/posts/").and_then(|s| s.strip_suffix('/')) else {
        return false;
    };
    !slug.is_empty()
        && slug.as_bytes()[0].is_ascii_alphanumeric()
        && slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn valid_visit_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'A' | b'b' | b'B')
}

pub fn valid_origin(origin: Option<&str>, allowed_origin: &str) -> bool {
    !allowed_origin.is_empty() && allowed_origin != "null" && origin == Some(allowed_origin)
}

pub fn valid_content_type(content_type: Option<&str>) -> bool {
    content_type.is_some_and(|value| {
        value.split(';').next().is_some_and(|media_type| {
            media_type.trim().eq_ignore_ascii_case("application/json")
        })
    })
}

pub fn valid_preflight(method: Option<&str>, headers: Option<&str>) -> bool {
    method == Some("POST")
        && headers.is_none_or(|value| {
            value.split(',').all(|header| header.trim().eq_ignore_ascii_case("content-type"))
        })
}

pub fn parse_view(bytes: &[u8]) -> Option<ViewRequest> {
    if bytes.len() > MAX_BODY_BYTES {
        return None;
    }
    let mut view: ViewRequest = serde_json::from_slice(bytes).ok()?;
    if !valid_post_path(&view.path) || !valid_visit_id(&view.visit_id) {
        return None;
    }
    // UUID casing must not bypass the database's unique request key.
    view.visit_id.make_ascii_lowercase();
    Some(view)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "4b71a562-9091-469d-a89d-8fb160bb9b1d";

    #[test]
    fn validates_like_state_and_rejects_unknown_or_invalid_input() {
        for liked in [true, false] {
            let body = format!(r#"{{"path":"/posts/a/","like_id":"{}","liked":{liked}}}"#, ID.to_uppercase());
            let like = parse_like(body.as_bytes()).unwrap();
            assert_eq!(like.like_id, ID);
            assert_eq!(like.liked, liked);
        }
        for body in [format!(r#"{{"path":"/posts/a/","like_id":"{ID}","liked":1}}"#), format!(r#"{{"path":"/","like_id":"{ID}","liked":true}}"#), format!(r#"{{"path":"/posts/a/","like_id":"{ID}","liked":true,"extra":1}}"#)] {
            assert!(parse_like(body.as_bytes()).is_none());
        }
        assert!(parse_like(&vec![b' '; MAX_BODY_BYTES + 1]).is_none());
    }

    #[test]
    fn accepts_current_posts_and_future_ascii_slugs() {
        for path in ["/posts/2025-12-8/", "/posts/2025-1-22/", "/posts/2024-12-12/", "/posts/Rust_notes-2/"] {
            assert!(valid_post_path(path), "{path}");
        }
    }

    #[test]
    fn rejects_nonpost_noncanonical_and_sensitive_paths() {
        for path in ["/", "/posts/", "/posts/a", "/posts//", "/posts/a/b/", "/posts/../", "/posts/a/?secret=1", "/posts/a/#fragment", "/posts/a%2Fb/", "/posts/글/", "/posts/-a/", "https://g1rmmr.github.io/posts/a/", "/posts/a\\b/", "/posts/a\n/"] {
            assert!(!valid_post_path(path), "{path}");
        }
    }

    #[test]
    fn limits_path_by_bytes_including_prefix_and_slashes() {
        let exact = format!("/posts/{}/", "a".repeat(MAX_PATH_BYTES - 8));
        assert_eq!(exact.len(), MAX_PATH_BYTES);
        assert!(valid_post_path(&exact));
        assert!(!valid_post_path(&format!("/posts/{}/", "a".repeat(MAX_PATH_BYTES - 7))));
    }

    #[test]
    fn requires_uuid_v4_with_rfc_variant() {
        assert!(valid_visit_id(ID));
        assert!(valid_visit_id(&ID.to_uppercase()));
        for id in ["", "4b71a5629091469da89d8fb160bb9b1d", "4b71a562-9091-169d-a89d-8fb160bb9b1d", "4b71a562-9091-469d-789d-8fb160bb9b1d", "gb71a562-9091-469d-a89d-8fb160bb9b1d", "4b71a562-9091-469d-a89d-8fb160bb9b1d\n"] {
            assert!(!valid_visit_id(id), "{id}");
        }
    }

    #[test]
    fn requires_exact_nonempty_origin() {
        let allowed = "https://g1rmmr.github.io";
        assert!(valid_origin(Some(allowed), allowed));
        for origin in [None, Some("null"), Some("http://g1rmmr.github.io"), Some("https://g1rmmr.github.io/"), Some("https://g1rmmr.github.io.attacker.example")] {
            assert!(!valid_origin(origin, allowed));
        }
        assert!(!valid_origin(Some(""), ""));
        assert!(!valid_origin(Some("null"), "null"));
    }

    #[test]
    fn accepts_json_media_type_and_rejects_simple_cross_origin_types() {
        assert!(valid_content_type(Some("application/json; charset=utf-8")));
        assert!(valid_content_type(Some("Application/JSON")));
        for content_type in [None, Some("text/plain"), Some("application/jsonp"), Some("application/x-www-form-urlencoded")] {
            assert!(!valid_content_type(content_type));
        }
    }

    #[test]
    fn restricts_preflight_to_post_with_content_type() {
        assert!(valid_preflight(Some("POST"), Some("Content-Type")));
        assert!(valid_preflight(Some("POST"), None));
        assert!(!valid_preflight(Some("GET"), Some("content-type")));
        assert!(!valid_preflight(None, Some("content-type")));
        assert!(!valid_preflight(Some("POST"), Some("content-type, authorization")));
    }

    #[test]
    fn normalizes_uuid_and_rejects_unknown_fields_missing_fields_and_large_bodies() {
        let body = format!(r#"{{"path":"/posts/a/","visit_id":"{}"}}"#, ID.to_uppercase());
        assert_eq!(parse_view(body.as_bytes()).unwrap().visit_id, ID);
        assert!(parse_view(br#"{"path":"/posts/a/"}"#).is_none());
        let unknown = format!(r#"{{"path":"/posts/a/","visit_id":"{ID}","ip":"private"}}"#);
        assert!(parse_view(unknown.as_bytes()).is_none());
        assert!(parse_view(&vec![b' '; MAX_BODY_BYTES + 1]).is_none());
        assert!(parse_view(br#"not json"#).is_none());
    }
}
