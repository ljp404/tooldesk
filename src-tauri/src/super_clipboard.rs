use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use xcap::image::{ImageFormat, ImageReader};

use crate::storage::StorageRuntimeState;

const STORE_DIR: &str = "super-clipboard";
const MANIFEST_FILE: &str = "manifest.enc";
const MASTER_KEY_FILE: &str = "master.tauri.key";
const KEY_LENGTH: usize = 32;
const NONCE_LENGTH: usize = 12;

type SuperClipboardCategory = String;
type SuperClipboardContentType = String;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardSettings {
    enabled: bool,
    ignore_duplicates: bool,
    max_image_bytes: usize,
    max_items: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardQuery {
    category: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
    search: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardEntryMeta {
    category: SuperClipboardCategory,
    char_count: usize,
    content_hash: String,
    created_at: u64,
    id: String,
    preview: String,
    thumbnail_data_url: Option<String>,
    #[serde(rename = "type")]
    content_type: SuperClipboardContentType,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardEntryDetail {
    category: SuperClipboardCategory,
    char_count: usize,
    content_hash: String,
    created_at: u64,
    html: Option<String>,
    id: String,
    image_preview_data_url: Option<String>,
    preview: String,
    text: Option<String>,
    #[serde(rename = "type")]
    content_type: SuperClipboardContentType,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardQueryResult {
    items: Vec<SuperClipboardEntryMeta>,
    total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardStats {
    by_category: SuperClipboardStatsByCategory,
    enabled: bool,
    storage_bytes: u64,
    total: usize,
}

#[derive(Default, Debug, Serialize)]
struct SuperClipboardStatsByCategory {
    code: usize,
    html: usize,
    image: usize,
    json: usize,
    link: usize,
    path: usize,
    text: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct ManifestFile {
    entries: Vec<SuperClipboardEntryMeta>,
    version: u8,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardPayload {
    html: Option<String>,
    image_png: Option<String>,
    image_preview_png: Option<String>,
    text: Option<String>,
    #[serde(rename = "type")]
    content_type: SuperClipboardContentType,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuperClipboardCapturePayload {
    html: Option<String>,
    image_png: Option<String>,
    text: Option<String>,
    #[serde(rename = "type")]
    content_type: Option<SuperClipboardContentType>,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn store_dir(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.data_dir.join(STORE_DIR)
}

fn blobs_dir(runtime: &StorageRuntimeState) -> PathBuf {
    store_dir(runtime).join("blobs")
}

fn manifest_path(runtime: &StorageRuntimeState) -> PathBuf {
    store_dir(runtime).join(MANIFEST_FILE)
}

fn master_key_path(runtime: &StorageRuntimeState) -> PathBuf {
    store_dir(runtime).join(MASTER_KEY_FILE)
}

fn blob_path(runtime: &StorageRuntimeState, id: &str) -> PathBuf {
    blobs_dir(runtime).join(format!("{id}.enc"))
}

fn ensure_store(runtime: &StorageRuntimeState) -> Result<(), String> {
    fs::create_dir_all(blobs_dir(runtime)).map_err(|error| error.to_string())
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buffer = [0_u8; N];
    rand::thread_rng().fill_bytes(&mut buffer);
    buffer
}

fn load_or_create_master_key(runtime: &StorageRuntimeState) -> Result<[u8; KEY_LENGTH], String> {
    ensure_store(runtime)?;
    let path = master_key_path(runtime);

    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
        let bytes = hex::decode(raw.trim()).map_err(|error| error.to_string())?;
        let key: [u8; KEY_LENGTH] = bytes
            .try_into()
            .map_err(|_| "Invalid Tauri super clipboard key length.".to_string())?;
        return Ok(key);
    }

    let key = random_bytes::<KEY_LENGTH>();
    fs::write(path, format!("{}\n", hex::encode(key))).map_err(|error| error.to_string())?;
    Ok(key)
}

fn encrypt_bytes(runtime: &StorageRuntimeState, plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = load_or_create_master_key(runtime)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce_bytes = random_bytes::<NONCE_LENGTH>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let encrypted = cipher
        .encrypt(nonce, plain)
        .map_err(|error| error.to_string())?;
    let mut payload = nonce_bytes.to_vec();
    payload.extend(encrypted);
    Ok(payload)
}

fn decrypt_bytes(runtime: &StorageRuntimeState, payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() <= NONCE_LENGTH {
        return Err("Encrypted payload is too short.".to_string());
    }

    let key = load_or_create_master_key(runtime)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce = Nonce::from_slice(&payload[..NONCE_LENGTH]);
    cipher
        .decrypt(nonce, &payload[NONCE_LENGTH..])
        .map_err(|error| error.to_string())
}

fn quarantine_unreadable_store(runtime: &StorageRuntimeState) -> Result<(), String> {
    let source = store_dir(runtime);

    if !source.exists() {
        return Ok(());
    }

    let target = runtime
        .data_dir
        .join(format!("{STORE_DIR}.unreadable-{}", now_millis()));
    fs::rename(source, target).map_err(|error| error.to_string())
}

fn load_manifest(runtime: &StorageRuntimeState) -> Result<ManifestFile, String> {
    ensure_store(runtime)?;
    let path = manifest_path(runtime);

    if !path.exists() {
        return Ok(ManifestFile {
            entries: Vec::new(),
            version: 1,
        });
    }

    let raw = fs::read(path).map_err(|error| error.to_string())?;
    match decrypt_bytes(runtime, &raw).and_then(|plain| {
        serde_json::from_slice::<ManifestFile>(&plain).map_err(|error| error.to_string())
    }) {
        Ok(manifest) => Ok(manifest),
        Err(_) => {
            quarantine_unreadable_store(runtime)?;
            ensure_store(runtime)?;
            Ok(ManifestFile {
                entries: Vec::new(),
                version: 1,
            })
        }
    }
}

fn save_manifest(runtime: &StorageRuntimeState, manifest: &ManifestFile) -> Result<(), String> {
    ensure_store(runtime)?;
    let plain = serde_json::to_vec(manifest).map_err(|error| error.to_string())?;
    fs::write(manifest_path(runtime), encrypt_bytes(runtime, &plain)?)
        .map_err(|error| error.to_string())
}

fn load_payload(
    runtime: &StorageRuntimeState,
    id: &str,
) -> Result<Option<SuperClipboardPayload>, String> {
    let path = blob_path(runtime, id);

    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read(path).map_err(|error| error.to_string())?;
    let plain = decrypt_bytes(runtime, &raw)?;
    let payload = serde_json::from_slice::<SuperClipboardPayload>(&plain)
        .map_err(|error| error.to_string())?;
    Ok(Some(payload))
}

fn save_payload(
    runtime: &StorageRuntimeState,
    id: &str,
    payload: &SuperClipboardPayload,
) -> Result<(), String> {
    ensure_store(runtime)?;
    let plain = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    fs::write(blob_path(runtime, id), encrypt_bytes(runtime, &plain)?)
        .map_err(|error| error.to_string())
}

fn remove_blob(runtime: &StorageRuntimeState, id: &str) {
    let _ = fs::remove_file(blob_path(runtime, id));
}

fn directory_size(path: &Path) -> u64 {
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };

    if metadata.is_file() {
        return metadata.len();
    }

    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    entries
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

fn hash_content(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();

    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            hasher.update([0x1f]);
        }
        hasher.update(part.as_bytes());
    }

    hex::encode(hasher.finalize())
}

fn strip_html(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut in_tag = false;

    for char_item in html.chars() {
        match char_item {
            '<' => {
                in_tag = true;
                output.push(' ');
            }
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(char_item),
            _ => {}
        }
    }

    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn looks_like_json(text: &str) -> bool {
    let trimmed = text.trim();

    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return false;
    }

    serde_json::from_str::<serde_json::Value>(trimmed).is_ok()
}

fn looks_like_html_source(text: &str) -> bool {
    let trimmed = text.trim();
    let head = trimmed
        .chars()
        .take(4096)
        .collect::<String>()
        .to_lowercase();

    head.starts_with("<!doctype html")
        || head.starts_with("<html")
        || (head.contains("<!doctype") && text.to_lowercase().contains("<html"))
        || looks_like_html_tag_snippet(trimmed)
}

fn looks_like_html_tag_snippet(text: &str) -> bool {
    let trimmed = text.trim_start();

    if !trimmed.starts_with('<') {
        return false;
    }

    let tag_start = trimmed
        .chars()
        .skip(1)
        .take_while(|value| *value == '/' || value.is_ascii_alphanumeric())
        .collect::<String>()
        .trim_start_matches('/')
        .to_lowercase();

    if tag_start.is_empty() || !trimmed.contains('>') {
        return false;
    }

    [
        "a", "article", "body", "button", "canvas", "code", "div", "footer", "form", "h1", "h2",
        "h3", "head", "header", "html", "img", "input", "label", "li", "link", "main", "meta",
        "nav", "ol", "p", "pre", "script", "section", "select", "span", "style", "svg", "table",
        "tbody", "td", "template", "textarea", "th", "thead", "tr", "ul",
    ]
    .contains(&tag_start.as_str())
}

fn looks_like_code(text: &str) -> bool {
    if looks_like_html_source(text) {
        return false;
    }

    let trimmed = text.trim_start();
    [
        "function ",
        "const ",
        "let ",
        "var ",
        "import ",
        "export ",
        "class ",
        "interface ",
        "#include",
        "def ",
        "public ",
        "private ",
    ]
    .iter()
    .any(|prefix| trimmed.starts_with(prefix))
        || trimmed.contains("<?xml")
}

fn detect_category(content_type: &str, text: &str, html: Option<&str>) -> String {
    let trimmed = text.trim();

    if content_type == "image" {
        return "image".to_string();
    }

    if looks_like_html_source(trimmed)
        || (trimmed.is_empty() && html.is_some_and(looks_like_html_source))
    {
        return "html".to_string();
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return "link".to_string();
    }

    if looks_like_windows_path(trimmed) || looks_like_unix_path(trimmed) {
        return "path".to_string();
    }

    if looks_like_json(trimmed) {
        return "json".to_string();
    }

    if looks_like_code(trimmed) {
        return "code".to_string();
    }

    "text".to_string()
}

fn looks_like_windows_path(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() > 3
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
        && bytes[0].is_ascii_alphabetic()
        && !text.contains(['\n', '*', '?', '"', '<', '>', '|'])
}

fn looks_like_unix_path(text: &str) -> bool {
    text.starts_with('/') && text.matches('/').count() >= 2 && !text.contains('\n')
}

fn build_preview(content_type: &str, text: &str, html: Option<&str>) -> String {
    if content_type == "image" {
        return "[图片]".to_string();
    }

    let source = if text.trim().is_empty() {
        strip_html(html.unwrap_or_default())
    } else {
        text.trim().to_string()
    };

    if source.is_empty() {
        return "[空内容]".to_string();
    }

    source
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(160)
        .collect()
}

fn stats_from_manifest(
    runtime: &StorageRuntimeState,
    manifest: &ManifestFile,
    enabled: bool,
) -> SuperClipboardStats {
    let mut by_category = SuperClipboardStatsByCategory::default();

    for entry in &manifest.entries {
        match entry.category.as_str() {
            "code" => by_category.code += 1,
            "html" => by_category.html += 1,
            "image" => by_category.image += 1,
            "json" => by_category.json += 1,
            "link" => by_category.link += 1,
            "path" => by_category.path += 1,
            _ => by_category.text += 1,
        }
    }

    SuperClipboardStats {
        by_category,
        enabled,
        storage_bytes: directory_size(&store_dir(runtime)),
        total: manifest.entries.len(),
    }
}

fn prune_entries(
    runtime: &StorageRuntimeState,
    manifest: &mut ManifestFile,
    max_items: usize,
) -> Result<(), String> {
    manifest
        .entries
        .sort_by_key(|entry| Reverse(entry.created_at));

    let removed = manifest
        .entries
        .split_off(max_items.min(manifest.entries.len()));

    for entry in removed {
        remove_blob(runtime, &entry.id);
    }

    Ok(())
}

fn build_resized_image_base64(image_base64: &str, max_size: u32) -> Option<String> {
    let bytes = BASE64_STANDARD.decode(image_base64).ok()?;
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let image = reader.decode().ok()?;
    let preview = image.thumbnail(max_size, max_size);
    let mut output = Cursor::new(Vec::new());

    preview.write_to(&mut output, ImageFormat::Png).ok()?;
    Some(BASE64_STANDARD.encode(output.into_inner()))
}

fn png_data_url(image_base64: &str) -> String {
    format!("data:image/png;base64,{image_base64}")
}

fn capture_super_clipboard_payload(
    runtime: tauri::State<'_, StorageRuntimeState>,
    payload: SuperClipboardCapturePayload,
    settings: SuperClipboardSettings,
) -> Result<Option<SuperClipboardEntryMeta>, String> {
    if !settings.enabled {
        return Ok(None);
    }

    let text = payload.text.unwrap_or_default();
    let trimmed_text = text.trim().to_string();
    let image_png = payload.image_png.and_then(|value| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    });
    let requested_type = payload.content_type.unwrap_or_else(|| "text".to_string());
    let content_type = if image_png.is_some() || requested_type == "image" {
        "image".to_string()
    } else if payload
        .html
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        "text".to_string()
    } else {
        "html".to_string()
    };

    if content_type == "image" && image_png.is_none() {
        return Ok(None);
    }

    if content_type != "image" && trimmed_text.is_empty() {
        return Ok(None);
    }

    let image_bytes_len = image_png
        .as_deref()
        .and_then(|image| BASE64_STANDARD.decode(image).ok())
        .map(|bytes| bytes.len())
        .unwrap_or(0);

    if content_type == "image" && image_bytes_len > settings.max_image_bytes {
        return Ok(None);
    }

    let image_hash_part = image_png.as_deref().unwrap_or_default();
    let content_hash = if content_type == "image" {
        hash_content(&[&content_type, image_hash_part, &trimmed_text])
    } else {
        hash_content(&[
            &content_type,
            &trimmed_text,
            payload.html.as_deref().unwrap_or_default(),
        ])
    };
    let mut manifest = load_manifest(&runtime)?;

    if settings.ignore_duplicates
        && manifest
            .entries
            .iter()
            .any(|entry| entry.content_hash == content_hash)
    {
        return Ok(None);
    }

    let id = uuid_like_id();
    let category = detect_category(&content_type, &trimmed_text, payload.html.as_deref());
    let char_count = if content_type == "image" {
        image_bytes_len
    } else {
        trimmed_text.chars().count()
    };
    let image_thumbnail_png = image_png
        .as_deref()
        .and_then(|image| build_resized_image_base64(image, 96));
    let image_preview_png = image_png
        .as_deref()
        .and_then(|image| build_resized_image_base64(image, 720));
    let entry = SuperClipboardEntryMeta {
        category,
        char_count,
        content_hash,
        created_at: now_millis(),
        id: id.clone(),
        preview: build_preview(&content_type, &trimmed_text, payload.html.as_deref()),
        thumbnail_data_url: image_thumbnail_png.as_deref().map(png_data_url),
        content_type: content_type.clone(),
    };
    let stored_payload = SuperClipboardPayload {
        html: payload.html,
        image_png,
        image_preview_png,
        text: if trimmed_text.is_empty() {
            None
        } else {
            Some(trimmed_text)
        },
        content_type,
    };

    save_payload(&runtime, &id, &stored_payload)?;
    manifest.entries.insert(0, entry.clone());
    prune_entries(&runtime, &mut manifest, settings.max_items)?;
    save_manifest(&runtime, &manifest)?;

    Ok(Some(entry))
}

#[tauri::command]
pub(crate) fn capture_super_clipboard(
    runtime: tauri::State<'_, StorageRuntimeState>,
    payload: SuperClipboardCapturePayload,
    settings: SuperClipboardSettings,
) -> Result<Option<SuperClipboardEntryMeta>, String> {
    capture_super_clipboard_payload(runtime, payload, settings)
}

#[tauri::command]
pub(crate) fn capture_super_clipboard_text(
    runtime: tauri::State<'_, StorageRuntimeState>,
    payload: SuperClipboardCapturePayload,
    settings: SuperClipboardSettings,
) -> Result<Option<SuperClipboardEntryMeta>, String> {
    capture_super_clipboard_payload(runtime, payload, settings)
}

fn uuid_like_id() -> String {
    let bytes = random_bytes::<16>();
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        u16::from_be_bytes([bytes[4], bytes[5]]),
        u16::from_be_bytes([bytes[6], bytes[7]]),
        u16::from_be_bytes([bytes[8], bytes[9]]),
        u64::from_be_bytes([
            0, 0, bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ])
    )
}

#[tauri::command]
pub(crate) fn query_super_clipboard(
    runtime: tauri::State<'_, StorageRuntimeState>,
    query: SuperClipboardQuery,
) -> Result<SuperClipboardQueryResult, String> {
    let manifest = load_manifest(&runtime)?;
    let category = query.category.unwrap_or_else(|| "all".to_string());
    let search = query.search.unwrap_or_default().trim().to_lowercase();
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(50);
    let mut items: Vec<SuperClipboardEntryMeta> = manifest
        .entries
        .into_iter()
        .filter(|entry| category == "all" || entry.category == category)
        .filter(|entry| search.is_empty() || entry.preview.to_lowercase().contains(&search))
        .collect();
    let total = items.len();

    if offset >= items.len() {
        items.clear();
    } else {
        items = items
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
    }

    Ok(SuperClipboardQueryResult { items, total })
}

#[tauri::command]
pub(crate) fn get_super_clipboard_detail(
    runtime: tauri::State<'_, StorageRuntimeState>,
    id: String,
) -> Result<Option<SuperClipboardEntryDetail>, String> {
    let manifest = load_manifest(&runtime)?;
    let Some(meta) = manifest.entries.into_iter().find(|entry| entry.id == id) else {
        return Ok(None);
    };
    let Some(payload) = load_payload(&runtime, &meta.id)? else {
        return Ok(None);
    };
    let image_preview_data_url = payload.image_preview_png.as_deref().map(png_data_url);

    Ok(Some(SuperClipboardEntryDetail {
        category: meta.category,
        char_count: meta.char_count,
        content_hash: meta.content_hash,
        created_at: meta.created_at,
        html: payload.html,
        id: meta.id,
        image_preview_data_url,
        preview: meta.preview,
        text: payload.text,
        content_type: meta.content_type,
    }))
}

#[tauri::command]
pub(crate) fn delete_super_clipboard_item(
    runtime: tauri::State<'_, StorageRuntimeState>,
    id: String,
) -> Result<bool, String> {
    let mut manifest = load_manifest(&runtime)?;
    let before = manifest.entries.len();
    manifest.entries.retain(|entry| entry.id != id);

    if before == manifest.entries.len() {
        return Ok(false);
    }

    remove_blob(&runtime, &id);
    save_manifest(&runtime, &manifest)?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn clear_super_clipboard(
    runtime: tauri::State<'_, StorageRuntimeState>,
    category: Option<String>,
) -> Result<usize, String> {
    let mut manifest = load_manifest(&runtime)?;
    let category = category.unwrap_or_else(|| "all".to_string());

    if category == "all" {
        let count = manifest.entries.len();
        let _ = fs::remove_dir_all(blobs_dir(&runtime));
        ensure_store(&runtime)?;
        manifest.entries.clear();
        save_manifest(&runtime, &manifest)?;
        return Ok(count);
    }

    let mut removed = Vec::new();
    manifest.entries.retain(|entry| {
        if entry.category == category {
            removed.push(entry.id.clone());
            false
        } else {
            true
        }
    });

    for id in &removed {
        remove_blob(&runtime, id);
    }

    save_manifest(&runtime, &manifest)?;
    Ok(removed.len())
}

#[tauri::command]
pub(crate) fn get_super_clipboard_stats(
    runtime: tauri::State<'_, StorageRuntimeState>,
    enabled: bool,
) -> Result<SuperClipboardStats, String> {
    let manifest = load_manifest(&runtime)?;
    Ok(stats_from_manifest(&runtime, &manifest, enabled))
}

#[tauri::command]
pub(crate) fn get_super_clipboard_payload(
    runtime: tauri::State<'_, StorageRuntimeState>,
    id: String,
) -> Result<Option<SuperClipboardPayload>, String> {
    let Some(payload) = load_payload(&runtime, &id)? else {
        return Ok(None);
    };

    Ok(Some(payload))
}

#[cfg(test)]
mod tests {
    use super::detect_category;

    #[test]
    fn rich_text_clipboard_html_with_plain_text_stays_text() {
        let category = detect_category(
            "html",
            "为啥会有",
            Some("<html><body><span>为啥会有</span></body></html>"),
        );

        assert_eq!(category, "text");
    }

    #[test]
    fn visible_html_tag_text_is_html() {
        let category = detect_category("text", "<div class=\"app\">hello</div>", None);

        assert_eq!(category, "html");
    }

    #[test]
    fn rich_text_link_still_detects_link() {
        let category = detect_category(
            "html",
            "https://example.com",
            Some(
                "<html><body><a href=\"https://example.com\">https://example.com</a></body></html>",
            ),
        );

        assert_eq!(category, "link");
    }
}
