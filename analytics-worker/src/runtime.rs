use crate::protocol::{
    parse_view, valid_post_path, valid_content_type, valid_origin, valid_preflight, MAX_BODY_BYTES,
};
use futures_util::StreamExt;
use worker::{event, Context, Env, Method, Request, Response, Result};

const INSERT_VIEW: &str = include_str!("../sql/record_view.sql");

#[event(fetch)]
async fn fetch(mut req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let url = match req.url() {
        Ok(url) => url,
        Err(_) => return respond(400, None, false),
    };
    if url.path() != "/views" || (url.query().is_some() && req.method() != Method::Get) {
        return respond(404, None, false);
    }

    let allowed_origin = match env.var("ALLOWED_ORIGIN") {
        Ok(value) => value.to_string(),
        Err(_) => return respond(503, None, false),
    };
    let origin = req.headers().get("Origin")?;
    if !valid_origin(origin.as_deref(), &allowed_origin) {
        return respond(403, None, false);
    }

    if req.method() == Method::Get {
        let params: Vec<_> = url.query_pairs().collect();
        if params.len() != 1 || params[0].0 != "path" || !valid_post_path(&params[0].1) {
            return respond(400, Some(&allowed_origin), false);
        }
        return view_count(&env, &params[0].1, &allowed_origin).await;
    }

    if req.method() == Method::Options {
        let method = req.headers().get("Access-Control-Request-Method")?;
        let headers = req.headers().get("Access-Control-Request-Headers")?;
        return if valid_preflight(method.as_deref(), headers.as_deref()) {
            respond(204, Some(&allowed_origin), true)
        } else {
            respond(403, Some(&allowed_origin), false)
        };
    }
    if req.method() != Method::Post {
        return respond(405, Some(&allowed_origin), false);
    }
    let content_type = req.headers().get("Content-Type")?;
    if !valid_content_type(content_type.as_deref()) {
        return respond(415, Some(&allowed_origin), false);
    }
    if let Some(length) = req.headers().get("Content-Length")? {
        match length.parse::<usize>() {
            Ok(length) if length > MAX_BODY_BYTES => return respond(413, Some(&allowed_origin), false),
            Err(_) => return respond(400, Some(&allowed_origin), false),
            _ => {}
        }
    }

    // Bound streamed bodies too: Content-Length may be absent or untrustworthy.
    let mut stream = match req.stream() {
        Ok(stream) => stream,
        Err(_) => return respond(400, Some(&allowed_origin), false),
    };
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(_) => return respond(400, Some(&allowed_origin), false),
        };
        if chunk.len() > MAX_BODY_BYTES.saturating_sub(body.len()) {
            return respond(413, Some(&allowed_origin), false);
        }
        body.extend_from_slice(&chunk);
    }
    let view = match parse_view(&body) {
        Some(view) => view,
        None => return respond(400, Some(&allowed_origin), false),
    };

    let path = view.path.clone();
    let outcome = async {
        let db = env.d1("DB")?;
        // The INSERT trigger performs the increment atomically. A repeated UUID
        // does not insert a row, so its trigger cannot increment the counter.
        db.prepare(INSERT_VIEW)
            .bind(&[view.visit_id.into(), view.path.into()])?
            .run()
            .await?;
        Ok::<(), worker::Error>(())
    }
    .await;

    if outcome.is_err() {
        // Database errors may include SQL or binding details; never return them.
        return respond(503, Some(&allowed_origin), false);
    }
    view_count(&env, &path, &allowed_origin).await
}

async fn view_count(env: &Env, path: &str, origin: &str) -> Result<Response> {
    let result = async {
        env.d1("DB")?
            .prepare("SELECT views FROM post_views WHERE path = ?1")
            .bind(&[path.into()])?
            .first::<u64>(Some("views"))
            .await
    }.await;
    match result {
        Ok(views) => {
            let mut response = Response::from_json(&serde_json::json!({"path": path, "views": views.unwrap_or(0)}))?;
            let headers = response.headers_mut();
            headers.set("Cache-Control", "no-store")?;
            headers.set("Vary", "Origin")?;
            headers.set("Access-Control-Allow-Origin", origin)?;
            Ok(response)
        }
        Err(_) => respond(503, Some(origin), false),
    }
}

fn respond(status: u16, origin: Option<&str>, preflight: bool) -> Result<Response> {
    let mut response = Response::empty()?.with_status(status);
    let headers = response.headers_mut();
    headers.set("Cache-Control", "no-store")?;
    headers.set("Vary", "Origin")?;
    if let Some(origin) = origin {
        headers.set("Access-Control-Allow-Origin", origin)?;
    }
    if preflight {
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")?;
        headers.set("Access-Control-Allow-Headers", "Content-Type")?;
        headers.set("Access-Control-Max-Age", "86400")?;
        headers.set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")?;
    }
    if status == 405 {
        headers.set("Allow", "GET, POST, OPTIONS")?;
    }
    Ok(response)
}
