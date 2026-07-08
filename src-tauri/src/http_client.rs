use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpRequestPayload {
    body: Option<String>,
    headers: HashMap<String, String>,
    method: String,
    timeout_ms: Option<u64>,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpResponsePayload {
    body: String,
    body_byte_length: usize,
    body_encoding: String,
    duration_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    headers: HashMap<String, String>,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    set_cookies: Option<Vec<String>>,
    status: u16,
    status_text: String,
}

fn supports_request_body(method: &str) -> bool {
    matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
}

fn is_text_content_type(value: &str) -> bool {
    let content_type = value.to_ascii_lowercase();

    content_type.is_empty()
        || content_type.contains("application/json")
        || content_type.contains("image/svg+xml")
        || content_type.contains("application/xml")
        || content_type.contains("text/xml")
        || content_type.contains("+xml")
        || content_type.starts_with("text/")
        || content_type.contains("javascript")
}

fn create_http_error(message: String, started_at: Instant) -> HttpResponsePayload {
    HttpResponsePayload {
        body: String::new(),
        body_byte_length: 0,
        body_encoding: "utf-8".to_string(),
        duration_ms: started_at.elapsed().as_millis(),
        error: Some(message),
        headers: HashMap::new(),
        ok: false,
        set_cookies: None,
        status: 0,
        status_text: String::new(),
    }
}

#[tauri::command]
pub(crate) async fn send_http_request(payload: HttpRequestPayload) -> HttpResponsePayload {
    let started_at = Instant::now();
    let method = payload.method.to_ascii_uppercase();
    let timeout = Duration::from_millis(payload.timeout_ms.unwrap_or(30_000).max(1));
    let parsed_method = match reqwest::Method::from_bytes(method.as_bytes()) {
        Ok(value) => value,
        Err(error) => return create_http_error(error.to_string(), started_at),
    };
    let client = match reqwest::Client::builder().timeout(timeout).build() {
        Ok(value) => value,
        Err(error) => return create_http_error(error.to_string(), started_at),
    };
    let mut request = client.request(parsed_method, payload.url);

    for (key, value) in payload.headers {
        request = request.header(key, value);
    }

    if supports_request_body(&method) {
        if let Some(body) = payload.body {
            request = request.body(body);
        }
    }

    let response = match request.send().await {
        Ok(value) => value,
        Err(error) => {
            let message = if error.is_timeout() {
                "请求超时".to_string()
            } else {
                error.to_string()
            };

            return create_http_error(message, started_at);
        }
    };
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let ok = status.is_success();
    let mut headers = HashMap::new();
    let mut set_cookies = Vec::new();

    for (key, value) in response.headers() {
        if let Ok(text) = value.to_str() {
            let key_text = key.as_str().to_string();
            if key_text.eq_ignore_ascii_case("set-cookie") {
                set_cookies.push(text.to_string());
            }
            headers.insert(key_text, text.to_string());
        }
    }

    let content_type = headers
        .get("content-type")
        .or_else(|| headers.get("Content-Type"))
        .map(String::as_str)
        .unwrap_or("");
    let is_text = is_text_content_type(content_type);
    let bytes = match response.bytes().await {
        Ok(value) => value,
        Err(error) => return create_http_error(error.to_string(), started_at),
    };
    let body_byte_length = bytes.len();
    let body = if is_text {
        String::from_utf8_lossy(&bytes).into_owned()
    } else {
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    };

    HttpResponsePayload {
        body,
        body_byte_length,
        body_encoding: if is_text { "utf-8" } else { "base64" }.to_string(),
        duration_ms: started_at.elapsed().as_millis(),
        error: None,
        headers,
        ok,
        set_cookies: Some(set_cookies),
        status: status.as_u16(),
        status_text,
    }
}
