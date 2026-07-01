use crate::storage::{path_to_string, StorageRuntimeState};
use base64::{engine::general_purpose::URL_SAFE, Engine as _};
use hmac::{Hmac, Mac};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::prelude::Accessor;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

const MUSIC_DIR: &str = "music-player";
const SETTINGS_FILE: &str = "settings.json";
const FAVORITES_FILE: &str = "favorites.json";
const RECENT_FILE: &str = "recent.json";
const PLAYLISTS_FILE: &str = "playlists.json";
const DOWNLOADS_FILE: &str = "downloads.json";
const MUSIC_EXTENSIONS: &[&str] = &["mp3", "flac", "m4a", "wav", "aac", "ogg", "wma"];
const NETEASE_SEARCH_URL: &str = "https://music.163.com/api/search/get/web";
const NETEASE_OUTER_URL: &str = "https://music.163.com/song/media/outer/url";
const ALIYUN_TOKEN_URL: &str = "https://auth.aliyundrive.com/v2/account/token";
const ALIYUN_AUTHORIZE_URL: &str = "https://auth.aliyundrive.com/v2/oauth/authorize?client_id=25dzX3vbYqktVxyX&redirect_uri=https%3A%2F%2Fwww.aliyundrive.com%2Fsign%2Fcallback&response_type=code&login_type=custom&state=%7B%22origin%22%3A%22https%3A%2F%2Fwww.aliyundrive.com%22%7D";
const ALIYUN_QR_GENERATE_URL: &str = "https://passport.aliyundrive.com/newlogin/qrcode/generate.do?appName=aliyun_drive&fromSite=52&appEntrance=web&isMobile=false&lang=zh_CN&returnUrl=&bizParams=&_bx-v=2.2.3";
const ALIYUN_QR_QUERY_URL: &str =
    "https://passport.aliyundrive.com/newlogin/qrcode/query.do?appName=aliyun_drive&fromSite=52&_bx-v=2.2.3";
const ALIYUN_USER_URL: &str = "https://api.aliyundrive.com/v2/user/get";
const ALIYUN_FILE_LIST_URL: &str = "https://api.aliyundrive.com/adrive/v3/file/list";
const ALIYUN_DOWNLOAD_URL: &str = "https://api.aliyundrive.com/v2/file/get_download_url";
const DEFAULT_QINIU_PREFIX: &str = "tooldesk/music/";
const QINIU_UPLOAD_HOST_Z0: &str = "https://up.qiniup.com";
const QINIU_UPLOAD_HOST_Z1: &str = "https://up-z1.qiniup.com";
const QINIU_UPLOAD_HOST_Z2: &str = "https://up-z2.qiniup.com";
const QINIU_UPLOAD_HOST_NA0: &str = "https://up-na0.qiniup.com";
const QINIU_UPLOAD_HOST_AS0: &str = "https://up-as0.qiniup.com";

type HmacSha1 = Hmac<sha1::Sha1>;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicPlayerSettings {
    audio_quality: String,
    cache_enabled: bool,
    download_dir: String,
    local_music_dir: String,
    save_download_dir: String,
    volume: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicCacheStats {
    bytes: u64,
    cache_dir: String,
    file_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    music_cloud: Option<MusicCloudSettings>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicCloudSettings {
    provider: Option<String>,
    qiniu: Option<QiniuMusicCloudSettings>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QiniuMusicCloudSettings {
    access_key: Option<String>,
    bucket: Option<String>,
    domain: Option<String>,
    prefix: Option<String>,
    region: Option<String>,
    secret_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicTrackMetadata {
    id: String,
    source: String,
    album: String,
    artist: String,
    duration: u64,
    file_name: String,
    lrc: Option<String>,
    name: String,
    path: String,
    title: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct OnlineSongItem {
    id: String,
    name: String,
    artist: Vec<String>,
    album: String,
    pic_id: String,
    url_id: String,
    lyric_id: String,
    source: String,
    cover: Option<String>,
    duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnlineLyricPayload {
    album: Option<String>,
    artist: Option<String>,
    lyric_id: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackLyricsRequest {
    lrc: Option<String>,
    lrc_text: Option<String>,
    path: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackMetadataProbeItem {
    cloud_file_id: Option<String>,
    cloud_provider: Option<String>,
    file_name: Option<String>,
    id: String,
    local_path: Option<String>,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackMetadataProbeResult {
    album: Option<String>,
    artist: Option<String>,
    cloud_provider: Option<String>,
    cover: Option<String>,
    duration: Option<u64>,
    id: String,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicCloudUploadResult {
    bucket: String,
    hash: String,
    key: String,
    provider: String,
    size: u64,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicCloudDownloadResult {
    cached_path: String,
    key: String,
    play_url: String,
    provider: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicCloudValidateResult {
    bucket: String,
    domain: String,
    provider: String,
    region: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AliyunRefreshResult {
    access_token: String,
    refresh_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AliyunQrCodeResult {
    qr_code_content: String,
    sid: String,
    t: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AliyunQrCheckPayload {
    t: String,
    sid: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AliyunCloudPlayResult {
    play_url: String,
    cached_path: String,
    cover: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u64>,
}

fn default_settings() -> MusicPlayerSettings {
    MusicPlayerSettings {
        audio_quality: "standard".to_string(),
        cache_enabled: true,
        download_dir: String::new(),
        local_music_dir: String::new(),
        save_download_dir: String::new(),
        volume: 0.8,
    }
}

fn normalize_settings(settings: MusicPlayerSettings) -> MusicPlayerSettings {
    MusicPlayerSettings {
        audio_quality: if settings.audio_quality == "high" {
            "high".to_string()
        } else {
            "standard".to_string()
        },
        cache_enabled: settings.cache_enabled,
        download_dir: settings.download_dir,
        local_music_dir: settings.local_music_dir,
        save_download_dir: settings.save_download_dir,
        volume: settings.volume.clamp(0.0, 1.0),
    }
}

fn music_data_dir(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.data_dir.join(MUSIC_DIR)
}

fn app_settings_path(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.data_dir.join("settings.json")
}

fn music_cache_dir(runtime: &StorageRuntimeState, settings: &MusicPlayerSettings) -> PathBuf {
    let configured = settings.download_dir.trim();

    if configured.is_empty() {
        runtime.cache_dir.join(MUSIC_DIR)
    } else {
        PathBuf::from(configured)
    }
}

fn default_download_dir() -> PathBuf {
    if let Ok(value) = std::env::var("USERPROFILE") {
        return PathBuf::from(value).join("Downloads");
    }

    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn target_download_dir(settings: &MusicPlayerSettings, target_dir: Option<&str>) -> PathBuf {
    if let Some(value) = target_dir {
        let trimmed = value.trim();

        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let configured = settings.save_download_dir.trim();

    if configured.is_empty() {
        default_download_dir()
    } else {
        PathBuf::from(configured)
    }
}

fn safe_file_name(value: &str, fallback: &str) -> String {
    let sanitized = value
        .chars()
        .map(|item| {
            if matches!(item, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                item
            }
        })
        .collect::<String>()
        .trim()
        .to_string();

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn safe_cache_ext(value: &str) -> String {
    let path = Path::new(value);
    let ext = path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("");

    if ext.is_empty() {
        ".mp3".to_string()
    } else {
        format!(".{}", ext.to_ascii_lowercase())
    }
}

fn resolve_unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let safe_name = safe_file_name(file_name, "download.mp3");
    let candidate = dir.join(&safe_name);

    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(&safe_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    for index in 1..100 {
        let next_name = if ext.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{ext}")
        };
        let next = dir.join(next_name);

        if !next.exists() {
            return next;
        }
    }

    candidate
}

fn json_path(runtime: &StorageRuntimeState, file_name: &str) -> PathBuf {
    music_data_dir(runtime).join(file_name)
}

fn read_json_file<T>(path: &Path, fallback: T) -> T
where
    T: for<'de> Deserialize<'de>,
{
    let Ok(raw) = fs::read_to_string(path) else {
        return fallback;
    };

    serde_json::from_str::<T>(&raw).unwrap_or(fallback)
}

fn write_json_file<T>(path: &Path, value: &T) -> Result<(), String>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let raw = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, format!("{raw}\n")).map_err(|error| error.to_string())
}

fn read_app_settings(runtime: &StorageRuntimeState) -> AppSettings {
    read_json_file(
        &app_settings_path(runtime),
        AppSettings { music_cloud: None },
    )
}

fn normalize_qiniu_prefix(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("").trim().trim_start_matches('/');

    if trimmed.is_empty() {
        DEFAULT_QINIU_PREFIX.to_string()
    } else if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{trimmed}/")
    }
}

fn normalize_qiniu_domain(domain: &str) -> String {
    let trimmed = domain.trim().trim_end_matches('/');

    if trimmed.is_empty() {
        String::new()
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

fn normalize_qiniu_setting_value(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn get_qiniu_upload_host(region: &str) -> &'static str {
    match region {
        "as0" => QINIU_UPLOAD_HOST_AS0,
        "na0" => QINIU_UPLOAD_HOST_NA0,
        "z1" => QINIU_UPLOAD_HOST_Z1,
        "z2" => QINIU_UPLOAD_HOST_Z2,
        _ => QINIU_UPLOAD_HOST_Z0,
    }
}

fn assert_qiniu_settings(runtime: &StorageRuntimeState) -> Result<QiniuMusicCloudSettings, String> {
    let settings = read_app_settings(runtime).music_cloud;

    if settings
        .as_ref()
        .and_then(|value| value.provider.as_deref())
        != Some("qiniu")
    {
        return Err("未启用七牛云音乐存储".to_string());
    }

    let raw = settings
        .and_then(|value| value.qiniu)
        .unwrap_or(QiniuMusicCloudSettings {
            access_key: None,
            bucket: None,
            domain: None,
            prefix: None,
            region: None,
            secret_key: None,
        });
    let qiniu = QiniuMusicCloudSettings {
        access_key: Some(normalize_qiniu_setting_value(raw.access_key)),
        bucket: Some(normalize_qiniu_setting_value(raw.bucket)),
        domain: Some(normalize_qiniu_setting_value(raw.domain)),
        prefix: Some(normalize_qiniu_prefix(raw.prefix.as_deref())),
        region: Some({
            let region = normalize_qiniu_setting_value(raw.region);
            if region.is_empty() {
                "z0".to_string()
            } else {
                region
            }
        }),
        secret_key: Some(normalize_qiniu_setting_value(raw.secret_key)),
    };

    let access_key = qiniu.access_key.as_deref().unwrap_or("");
    let secret_key = qiniu.secret_key.as_deref().unwrap_or("");
    let bucket = qiniu.bucket.as_deref().unwrap_or("");
    let domain = qiniu.domain.as_deref().unwrap_or("");

    if access_key.is_empty() || secret_key.is_empty() || bucket.is_empty() || domain.is_empty() {
        return Err("请先填写七牛云 AccessKey、SecretKey、Bucket 和访问域名".to_string());
    }

    if access_key
        .chars()
        .any(|item| item.is_whitespace() || item == '\\')
        || secret_key
            .chars()
            .any(|item| item.is_whitespace() || item == '\\')
    {
        return Err(
            "七牛云 AccessKey / SecretKey 不能包含空格、换行或反斜杠，请从七牛云控制台重新复制完整密钥"
                .to_string(),
        );
    }

    Ok(qiniu)
}

fn qiniu_value(value: &Option<String>) -> &str {
    value.as_deref().unwrap_or("")
}

fn base64_url_bytes(input: &[u8]) -> String {
    URL_SAFE.encode(input)
}

fn base64_url_text(input: &str) -> String {
    base64_url_bytes(input.as_bytes())
}

fn sign_qiniu(value: &str, secret_key: &str) -> Result<String, String> {
    let mut mac =
        HmacSha1::new_from_slice(secret_key.as_bytes()).map_err(|error| error.to_string())?;
    mac.update(value.as_bytes());
    Ok(base64_url_bytes(&mac.finalize().into_bytes()))
}

fn create_qiniu_upload_token(qiniu: &QiniuMusicCloudSettings, key: &str) -> Result<String, String> {
    let deadline = chrono::Utc::now().timestamp() + 3600;
    let policy = serde_json::json!({
        "deadline": deadline,
        "scope": format!("{}:{key}", qiniu_value(&qiniu.bucket)),
    });
    let encoded_policy = base64_url_text(&policy.to_string());
    let encoded_sign = sign_qiniu(&encoded_policy, qiniu_value(&qiniu.secret_key))?;

    Ok(format!(
        "{}:{encoded_sign}:{encoded_policy}",
        qiniu_value(&qiniu.access_key)
    ))
}

fn qiniu_upload_error(status: reqwest::StatusCode, body: &str) -> String {
    let trimmed = body.trim();

    if status.as_u16() == 401 && trimmed.to_ascii_lowercase().contains("bad token") {
        return "七牛云上传凭证无效：请检查 AccessKey / SecretKey 是否复制完整，Bucket 是否属于这组密钥，电脑时间是否准确。"
            .to_string();
    }

    if status.as_u16() == 401 {
        return format!(
            "七牛云上传鉴权失败 HTTP 401: {}",
            if trimmed.is_empty() {
                "请检查 AccessKey / SecretKey"
            } else {
                trimmed
            }
        );
    }

    if status.as_u16() == 614 {
        return "七牛云文件已存在，请更换存储路径前缀后重试".to_string();
    }

    format!("七牛云上传失败 HTTP {}: {trimmed}", status.as_u16())
}

fn get_qiniu_public_url(qiniu: &QiniuMusicCloudSettings, key: &str) -> String {
    let domain = normalize_qiniu_domain(qiniu_value(&qiniu.domain));
    let encoded_key = key
        .split('/')
        .map(|item| urlencoding::encode(item).into_owned())
        .collect::<Vec<String>>()
        .join("/");

    format!("{domain}/{encoded_key}")
}

fn create_qiniu_download_url(qiniu: &QiniuMusicCloudSettings, key: &str) -> Result<String, String> {
    let public_url = get_qiniu_public_url(qiniu, key);
    let separator = if public_url.contains('?') { "&" } else { "?" };
    let unsigned_url = format!(
        "{public_url}{separator}e={}",
        chrono::Utc::now().timestamp() + 3600
    );
    let encoded_sign = sign_qiniu(&unsigned_url, qiniu_value(&qiniu.secret_key))?;

    Ok(format!(
        "{unsigned_url}&token={}:{}",
        qiniu_value(&qiniu.access_key),
        encoded_sign
    ))
}

fn hash_file_sha256(file_path: &Path) -> Result<String, String> {
    let bytes = fs::read(file_path).map_err(|error| error.to_string())?;
    use sha2::Digest as _;
    Ok(hex::encode(sha2::Sha256::digest(bytes)))
}

fn hash_text_sha1(value: &str) -> String {
    use sha1::Digest as _;
    hex::encode(sha1::Sha1::digest(value.as_bytes()))
}

fn build_qiniu_music_key(qiniu: &QiniuMusicCloudSettings, file_path: &Path, hash: &str) -> String {
    let ext = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_ascii_lowercase()))
        .unwrap_or_else(|| ".mp3".to_string());

    format!(
        "{}{hash}{ext}",
        normalize_qiniu_prefix(qiniu.prefix.as_deref())
    )
}

fn audio_mime_type(file_path: &Path) -> &'static str {
    match file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        Some("m4a") => "audio/mp4",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("wma") => "audio/x-ms-wma",
        _ => "audio/mpeg",
    }
}

async fn upload_qiniu_object(
    qiniu: &QiniuMusicCloudSettings,
    key: &str,
    content: Vec<u8>,
    file_name: &str,
    mime_type: &str,
) -> Result<(), String> {
    let client = create_http_client()?;
    let token = create_qiniu_upload_token(qiniu, key)?;
    let part = reqwest::multipart::Part::bytes(content)
        .file_name(file_name.replace('"', ""))
        .mime_str(mime_type)
        .map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("token", token)
        .text("key", key.to_string())
        .part("file", part);
    let response = client
        .post(get_qiniu_upload_host(qiniu_value(&qiniu.region)))
        .multipart(form)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let response_text = response.text().await.map_err(|error| error.to_string())?;

    if status.is_success() {
        Ok(())
    } else {
        Err(qiniu_upload_error(status, &response_text))
    }
}

fn scan_cache_dir(path: &Path) -> MusicCacheStats {
    let mut bytes = 0_u64;
    let mut file_count = 0_u64;
    let mut stack = vec![path.to_path_buf()];

    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(current) else {
            continue;
        };

        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                bytes = bytes.saturating_add(metadata.len());
                file_count = file_count.saturating_add(1);
            }
        }
    }

    MusicCacheStats {
        bytes,
        cache_dir: path_to_string(path),
        file_count,
    }
}

fn parse_artist_title(title: &str) -> (String, String) {
    let separators = [" - ", "-", " – ", " — "];

    for separator in separators {
        if let Some((artist, song)) = title.split_once(separator) {
            let artist = artist.trim();
            let song = song.trim();

            if !artist.is_empty() && !song.is_empty() {
                return (artist.to_string(), song.to_string());
            }
        }
    }

    ("未知艺术家".to_string(), title.to_string())
}

fn is_music_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| MUSIC_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_music_file_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| MUSIC_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn find_lrc_path(path: &Path) -> Option<String> {
    let lrc_path = path.with_extension("lrc");

    if lrc_path.is_file() {
        Some(path_to_string(&lrc_path))
    } else {
        None
    }
}

fn track_from_path(path: &Path) -> MusicTrackMetadata {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("music")
        .to_string();
    let title_base = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name.as_str());
    let (artist, title) = parse_artist_title(title_base);
    let path_text = path_to_string(path);

    MusicTrackMetadata {
        id: path_text.clone(),
        source: "local".to_string(),
        album: String::new(),
        artist,
        duration: 0,
        file_name: file_name.clone(),
        lrc: find_lrc_path(path),
        name: file_name,
        path: path_text,
        title,
    }
}

fn mime_from_picture(picture: &lofty::picture::Picture) -> String {
    picture
        .mime_type()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "image/jpeg".to_string())
}

fn extract_audio_metadata(path: &Path) -> TrackMetadataProbeResult {
    let mut result = TrackMetadataProbeResult {
        album: None,
        artist: None,
        cloud_provider: None,
        cover: None,
        duration: None,
        id: path_to_string(path),
        source: "local".to_string(),
    };

    let Ok(tagged_file) = Probe::open(path).and_then(|probe| probe.read()) else {
        return result;
    };

    let duration = tagged_file.properties().duration().as_secs();
    if duration > 0 {
        result.duration = Some(duration);
    }

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    if let Some(tag) = tag {
        result.album = tag.album().map(|value| value.to_string());
        result.artist = tag.artist().map(|value| value.to_string());

        if let Some(picture) = tag.pictures().first() {
            let mime = mime_from_picture(picture);
            let data = base64::engine::general_purpose::STANDARD.encode(picture.data());
            result.cover = Some(format!("data:{mime};base64,{data}"));
        }
    }

    result
}

fn probe_cloud_cache_metadata(
    runtime: &StorageRuntimeState,
    track: &TrackMetadataProbeItem,
) -> TrackMetadataProbeResult {
    let mut result = TrackMetadataProbeResult {
        album: None,
        artist: None,
        cloud_provider: track.cloud_provider.clone(),
        cover: None,
        duration: None,
        id: track.id.clone(),
        source: track.source.clone(),
    };
    let Some(file_id) = track.cloud_file_id.as_deref() else {
        return result;
    };
    let Some(file_name) = track.file_name.as_deref() else {
        return result;
    };
    let settings = normalize_settings(read_json_file(
        &json_path(runtime, SETTINGS_FILE),
        default_settings(),
    ));
    let cached_path = aliyun_cache_path(runtime, &settings, file_id, file_name);

    if !cached_path.is_file() {
        return result;
    }

    let metadata = extract_audio_metadata(&cached_path);
    result.album = metadata.album;
    result.artist = metadata.artist;
    result.cover = metadata.cover;
    result.duration = metadata.duration;
    result
}

fn create_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| error.to_string())
}

fn ensure_netease(platform: &str) -> Result<(), String> {
    if platform == "netease" {
        Ok(())
    } else {
        Err("Tauri 当前仅支持网易云在线音乐".to_string())
    }
}

fn get_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cursor = value;

    for key in path {
        cursor = cursor.get(*key)?;
    }

    Some(cursor)
}

fn netease_album_cover(album: &Value) -> Option<String> {
    album
        .get("picUrl")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            album
                .get("blurPicUrl")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn netease_song_item(song: &Value) -> OnlineSongItem {
    let id = song
        .get("id")
        .and_then(Value::as_i64)
        .unwrap_or_default()
        .to_string();
    let album = song.get("album").unwrap_or(&Value::Null);
    let artist = song
        .get("artists")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let cover = netease_album_cover(album);
    let pic_id = album
        .get("picId")
        .and_then(Value::as_i64)
        .map(|value| value.to_string())
        .unwrap_or_else(|| id.clone());

    OnlineSongItem {
        id: id.clone(),
        name: song
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("未知歌曲")
            .to_string(),
        artist,
        album: album
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        pic_id,
        url_id: id.clone(),
        lyric_id: id,
        source: "netease".to_string(),
        cover,
        duration: song
            .get("duration")
            .and_then(Value::as_u64)
            .map(|value| value / 1000),
    }
}

async fn resolve_netease_remote_url(song_id: &str) -> Result<String, String> {
    let client = create_http_client()?;
    let response = client
        .get(NETEASE_OUTER_URL)
        .query(&[("id", format!("{song_id}.mp3"))])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let url = response.url().to_string();

    if url.contains("404") || url == NETEASE_OUTER_URL {
        Err("获取在线播放链接失败".to_string())
    } else {
        Ok(url)
    }
}

async fn download_remote_file(url: &str, target_path: &Path) -> Result<(), String> {
    let client = create_http_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status().as_u16()));
    }

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;

    if bytes.is_empty() {
        return Err("下载的音频文件为空".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(target_path, bytes).map_err(|error| error.to_string())
}

async fn download_remote_audio_file(url: &str, target_path: &Path) -> Result<(), String> {
    let client = create_http_client()?;
    let response = client
        .get(url)
        .header("Referer", "https://www.aliyundrive.com/")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status().as_u16()));
    }

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;

    if bytes.is_empty() {
        return Err("下载的音频文件为空".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(target_path, bytes).map_err(|error| error.to_string())
}

fn parse_cloud_duration_value(value: Option<&Value>) -> u64 {
    let Some(value) = value else {
        return 0;
    };

    let raw = match value {
        Value::Number(number) => number.as_f64().unwrap_or(0.0),
        Value::String(text) => text.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    };

    if !raw.is_finite() || raw <= 0.0 {
        0
    } else if raw > 60_000.0 {
        (raw / 1000.0).round() as u64
    } else {
        raw.round() as u64
    }
}

fn extract_cloud_file_duration(file: &Value) -> u64 {
    let direct = parse_cloud_duration_value(file.get("duration"));
    if direct > 0 {
        return direct;
    }

    let audio = parse_cloud_duration_value(file.pointer("/audio_media_metadata/duration"));
    if audio > 0 {
        return audio;
    }

    let video = parse_cloud_duration_value(file.pointer("/video_media_metadata/duration"));
    if video > 0 {
        return video;
    }

    parse_cloud_duration_value(
        file.pointer("/video_media_metadata/video_media_audio_stream/0/duration"),
    )
}

fn extract_thumbnail_url(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Object(map)) => ["url", "cover", "thumbnail", "default"]
            .iter()
            .find_map(|key| map.get(*key).and_then(Value::as_str))
            .map(ToString::to_string),
        _ => None,
    }
}

fn normalize_aliyun_file_item(mut file: Value) -> Value {
    let Some(object) = file.as_object_mut() else {
        return file;
    };
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if object.get("duration").is_none() && is_music_file_name(&name) {
        let duration = extract_cloud_file_duration(&Value::Object(object.clone()));
        if duration > 0 {
            object.insert("duration".to_string(), Value::from(duration));
        }
    }

    if object.get("cover").is_none() {
        if let Some(cover) = extract_thumbnail_url(object.get("thumbnail")) {
            object.insert("cover".to_string(), Value::String(cover));
        }
    }

    file
}

fn map_aliyun_cloud_track(file: &Value) -> Value {
    let name = file
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("music")
        .to_string();
    let cover = extract_thumbnail_url(file.get("thumbnail")).or_else(|| {
        file.get("cover")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    });
    let duration = extract_cloud_file_duration(file);

    serde_json::json!({
        "file_id": file.get("file_id").cloned().unwrap_or(Value::Null),
        "name": name,
        "type": file.get("type").and_then(Value::as_str).unwrap_or("file"),
        "thumbnail": cover,
        "duration": duration,
        "cover": cover
    })
}

async fn aliyun_post_json(
    access_token: Option<&str>,
    url: &str,
    body: Value,
) -> Result<Value, String> {
    let client = create_http_client()?;
    let mut request = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Referer", "https://www.aliyundrive.com/");

    if let Some(token) = access_token {
        request = request.bearer_auth(token);
    }

    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let raw = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        return Err(format!(
            "阿里云盘请求失败 HTTP {}: {}",
            status.as_u16(),
            raw.trim()
        ));
    }

    serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string())
}

async fn aliyun_get_json(url: &str) -> Result<Value, String> {
    let client = create_http_client()?;
    let response = client
        .get(url)
        .header("Referer", "https://www.aliyundrive.com/")
        .header("Accept", "application/json, text/plain")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let raw = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        return Err(format!(
            "阿里云盘请求失败 HTTP {}: {}",
            status.as_u16(),
            raw.trim()
        ));
    }

    serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string())
}

async fn aliyun_post_form(url: &str, body: &str) -> Result<Value, String> {
    let client = create_http_client()?;
    let response = client
        .post(url)
        .header("Referer", "https://www.aliyundrive.com/")
        .header("Accept", "application/json, text/plain")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body.to_string())
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let raw = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        return Err(format!(
            "阿里云盘请求失败 HTTP {}: {}",
            status.as_u16(),
            raw.trim()
        ));
    }

    serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string())
}

async fn aliyun_pre_login() -> Result<(), String> {
    let client = create_http_client()?;
    let response = client
        .get(ALIYUN_AUTHORIZE_URL)
        .header("Referer", "https://www.aliyundrive.com/")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if response.status().as_u16() < 400 {
        Ok(())
    } else {
        Err(format!(
            "阿里云盘预登录失败 HTTP {}",
            response.status().as_u16()
        ))
    }
}

fn parse_aliyun_biz_ext(biz_ext: &str) -> (Option<String>, Option<String>) {
    if biz_ext.trim().is_empty() {
        return (None, None);
    }

    let mut candidates = vec![biz_ext.to_string()];

    if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(biz_ext) {
        candidates.push(String::from_utf8_lossy(&decoded).into_owned());
    }

    for candidate in candidates {
        let Ok(value) = serde_json::from_str::<Value>(&candidate) else {
            continue;
        };
        let login = value.get("pds_login_result").unwrap_or(&Value::Null);
        let refresh_token = login
            .get("refreshToken")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let access_token = login
            .get("accessToken")
            .and_then(Value::as_str)
            .map(ToString::to_string);

        if refresh_token.is_some() || access_token.is_some() {
            return (refresh_token, access_token);
        }
    }

    (None, None)
}

async fn get_aliyun_drive_id(access_token: &str) -> Result<String, String> {
    let value =
        aliyun_post_json(Some(access_token), ALIYUN_USER_URL, serde_json::json!({})).await?;
    let drive_id = value
        .get("default_drive_id")
        .or_else(|| value.get("resource_drive_id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    if drive_id.is_empty() {
        Err("获取阿里云盘 drive_id 失败".to_string())
    } else {
        Ok(drive_id)
    }
}

fn aliyun_cache_path(
    runtime: &StorageRuntimeState,
    settings: &MusicPlayerSettings,
    file_id: &str,
    file_name: &str,
) -> PathBuf {
    let cache_dir = music_cache_dir(runtime, settings);
    let cache_name = format!(
        "aliyun-{}{}",
        hash_text_sha1(file_id),
        safe_cache_ext(file_name)
    );

    cache_dir.join(cache_name)
}

async fn get_aliyun_download_url(access_token: &str, file_id: &str) -> Result<String, String> {
    let drive_id = get_aliyun_drive_id(access_token).await?;
    let value = aliyun_post_json(
        Some(access_token),
        ALIYUN_DOWNLOAD_URL,
        serde_json::json!({
            "drive_id": drive_id,
            "file_id": file_id,
            "expire_sec": 14400
        }),
    )
    .await?;

    let url = value
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    if url.is_empty() {
        Err("获取阿里云盘下载链接失败".to_string())
    } else {
        Ok(url)
    }
}

fn write_sibling_lyric(
    audio_path: &Path,
    lyric: Option<&OnlineLyricPayload>,
) -> Result<(), String> {
    let Some(lyric) = lyric else {
        return Ok(());
    };
    let _ = (&lyric.album, &lyric.artist, &lyric.lyric_id);
    let Some(title) = lyric
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let Some(parent) = audio_path.parent() else {
        return Ok(());
    };
    let lrc_name = audio_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.lrc"))
        .unwrap_or_else(|| format!("{}.lrc", safe_file_name(title, "music")));
    let lrc_path = parent.join(lrc_name);

    if lrc_path.exists() {
        return Ok(());
    }

    fs::write(lrc_path, format!("[00:00.00]{title}\n")).map_err(|error| error.to_string())
}

fn scan_directory(root: &Path) -> Vec<MusicTrackMetadata> {
    let mut tracks = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(current) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && is_music_file(&path) {
                tracks.push(track_from_path(&path));
            }
        }
    }

    tracks.sort_by(|left, right| left.path.cmp(&right.path));
    tracks
}

#[tauri::command]
pub(crate) fn get_music_player_settings(
    runtime: State<'_, StorageRuntimeState>,
) -> MusicPlayerSettings {
    normalize_settings(read_json_file(
        &json_path(&runtime, SETTINGS_FILE),
        default_settings(),
    ))
}

#[tauri::command]
pub(crate) fn save_music_player_settings(
    runtime: State<'_, StorageRuntimeState>,
    settings: MusicPlayerSettings,
) -> Result<MusicPlayerSettings, String> {
    let normalized = normalize_settings(settings);
    write_json_file(&json_path(&runtime, SETTINGS_FILE), &normalized)?;
    Ok(normalized)
}

#[tauri::command]
pub(crate) fn get_music_favorites(runtime: State<'_, StorageRuntimeState>) -> Vec<Value> {
    read_json_file(&json_path(&runtime, FAVORITES_FILE), Vec::<Value>::new())
}

#[tauri::command]
pub(crate) fn save_music_favorites(
    runtime: State<'_, StorageRuntimeState>,
    favorites: Vec<Value>,
) -> Result<(), String> {
    write_json_file(&json_path(&runtime, FAVORITES_FILE), &favorites)
}

#[tauri::command]
pub(crate) fn get_music_recent(runtime: State<'_, StorageRuntimeState>) -> Vec<Value> {
    read_json_file(&json_path(&runtime, RECENT_FILE), Vec::<Value>::new())
}

#[tauri::command]
pub(crate) fn save_music_recent(
    runtime: State<'_, StorageRuntimeState>,
    recent: Vec<Value>,
) -> Result<(), String> {
    write_json_file(&json_path(&runtime, RECENT_FILE), &recent)
}

#[tauri::command]
pub(crate) fn clear_music_recent(runtime: State<'_, StorageRuntimeState>) -> Result<(), String> {
    let path = json_path(&runtime, RECENT_FILE);

    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn get_music_playlists(runtime: State<'_, StorageRuntimeState>) -> Vec<Value> {
    read_json_file(&json_path(&runtime, PLAYLISTS_FILE), Vec::<Value>::new())
}

#[tauri::command]
pub(crate) fn save_music_playlists(
    runtime: State<'_, StorageRuntimeState>,
    playlists: Vec<Value>,
) -> Result<(), String> {
    write_json_file(&json_path(&runtime, PLAYLISTS_FILE), &playlists)
}

#[tauri::command]
pub(crate) fn get_music_downloads(runtime: State<'_, StorageRuntimeState>) -> Vec<Value> {
    read_json_file(&json_path(&runtime, DOWNLOADS_FILE), Vec::<Value>::new())
}

#[tauri::command]
pub(crate) fn save_music_downloads(
    runtime: State<'_, StorageRuntimeState>,
    downloads: Vec<Value>,
) -> Result<(), String> {
    write_json_file(&json_path(&runtime, DOWNLOADS_FILE), &downloads)
}

#[tauri::command]
pub(crate) fn get_music_cache_stats(runtime: State<'_, StorageRuntimeState>) -> MusicCacheStats {
    let settings = get_music_player_settings(runtime.clone());
    let cache_dir = music_cache_dir(&runtime, &settings);
    scan_cache_dir(&cache_dir)
}

#[tauri::command]
pub(crate) fn clear_music_cache(runtime: State<'_, StorageRuntimeState>) -> Result<(), String> {
    let settings = get_music_player_settings(runtime.clone());
    let cache_dir = music_cache_dir(&runtime, &settings);

    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn invalidate_cloud_cache(
    runtime: State<'_, StorageRuntimeState>,
    file_id: String,
    file_name: String,
) -> Result<(), String> {
    let settings = get_music_player_settings(runtime.clone());
    let cached_path = aliyun_cache_path(&runtime, &settings, file_id.trim(), file_name.trim());

    if cached_path.is_file() {
        fs::remove_file(cached_path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn scan_music_files(folder_path: String) -> Result<Vec<MusicTrackMetadata>, String> {
    let root = PathBuf::from(folder_path.trim());

    if !root.is_dir() {
        return Err("请选择有效的音乐目录".to_string());
    }

    Ok(scan_directory(&root))
}

#[tauri::command]
pub(crate) fn probe_tracks_metadata(
    runtime: State<'_, StorageRuntimeState>,
    tracks: Vec<TrackMetadataProbeItem>,
) -> Vec<TrackMetadataProbeResult> {
    tracks
        .iter()
        .map(|track| {
            if track.source == "local" {
                if let Some(local_path) = track.local_path.as_deref() {
                    let mut result = extract_audio_metadata(Path::new(local_path));
                    result.id = track.id.clone();
                    result.source = track.source.clone();
                    result.cloud_provider = track.cloud_provider.clone();
                    return result;
                }
            }

            if track.source == "cloud" && track.cloud_provider.as_deref() != Some("qiniu") {
                return probe_cloud_cache_metadata(&runtime, track);
            }

            TrackMetadataProbeResult {
                album: None,
                artist: None,
                cloud_provider: track.cloud_provider.clone(),
                cover: None,
                duration: None,
                id: track.id.clone(),
                source: track.source.clone(),
            }
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn search_online_music(
    platform: String,
    keyword: String,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<OnlineSongItem>, String> {
    ensure_netease(&platform)?;
    let keyword = keyword.trim();

    if keyword.is_empty() {
        return Ok(Vec::new());
    }

    let client = create_http_client()?;
    let params = [
        ("s", keyword.to_string()),
        ("type", "1".to_string()),
        ("limit", limit.unwrap_or(30).clamp(1, 50).to_string()),
        (
            "offset",
            ((page.unwrap_or(1).max(1) - 1) * limit.unwrap_or(30).clamp(1, 50)).to_string(),
        ),
    ];
    let response = client
        .post(NETEASE_SEARCH_URL)
        .form(&params)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "在线音乐搜索失败: HTTP {}",
            response.status().as_u16()
        ));
    }

    let raw = response.text().await.map_err(|error| error.to_string())?;
    let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| error.to_string())?;
    let songs = get_path(&parsed, &["result", "songs"])
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(songs.iter().map(netease_song_item).collect())
}

#[tauri::command]
pub(crate) async fn resolve_online_play_url(
    platform: String,
    song_id: String,
) -> Result<String, String> {
    ensure_netease(&platform)?;
    resolve_netease_remote_url(song_id.trim()).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicDownloadResult {
    file_path: String,
    skipped: bool,
}

#[tauri::command]
pub(crate) async fn download_online_music(
    runtime: State<'_, StorageRuntimeState>,
    platform: String,
    song_id: String,
    file_name: String,
    target_dir: Option<String>,
    lyric: Option<OnlineLyricPayload>,
) -> Result<MusicDownloadResult, String> {
    ensure_netease(&platform)?;
    let settings = get_music_player_settings(runtime.clone());
    let save_dir = target_download_dir(&settings, target_dir.as_deref());
    fs::create_dir_all(&save_dir).map_err(|error| error.to_string())?;

    let safe_name = safe_file_name(&file_name, &format!("{song_id}.mp3"));
    let existing = save_dir.join(&safe_name);

    if existing.is_file() {
        write_sibling_lyric(&existing, lyric.as_ref())?;
        return Ok(MusicDownloadResult {
            file_path: path_to_string(&existing),
            skipped: true,
        });
    }

    let target_path = resolve_unique_path(&save_dir, &safe_name);
    let remote_url = resolve_netease_remote_url(song_id.trim()).await?;
    download_remote_file(&remote_url, &target_path).await?;
    write_sibling_lyric(&target_path, lyric.as_ref())?;

    Ok(MusicDownloadResult {
        file_path: path_to_string(&target_path),
        skipped: false,
    })
}

#[tauri::command]
pub(crate) async fn upload_music_cloud_storage_file(
    runtime: State<'_, StorageRuntimeState>,
    file_path: String,
) -> Result<MusicCloudUploadResult, String> {
    let qiniu = assert_qiniu_settings(&runtime)?;
    let path = PathBuf::from(file_path.trim());
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;

    if !metadata.is_file() {
        return Err("请选择有效的音乐文件".to_string());
    }

    if !is_music_file(&path) {
        return Err("仅支持上传音乐文件".to_string());
    }

    let hash = hash_file_sha256(&path)?;
    let key = build_qiniu_music_key(&qiniu, &path, &hash);
    let content = fs::read(&path).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("music.mp3")
        .to_string();
    upload_qiniu_object(&qiniu, &key, content, &file_name, audio_mime_type(&path)).await?;

    Ok(MusicCloudUploadResult {
        bucket: qiniu_value(&qiniu.bucket).to_string(),
        hash,
        key: key.clone(),
        provider: "qiniu".to_string(),
        size: metadata.len(),
        url: get_qiniu_public_url(&qiniu, &key),
    })
}

#[tauri::command]
pub(crate) async fn download_music_cloud_storage_file(
    runtime: State<'_, StorageRuntimeState>,
    key: String,
    file_name: Option<String>,
) -> Result<MusicCloudDownloadResult, String> {
    let qiniu = assert_qiniu_settings(&runtime)?;
    let safe_key = key.trim().trim_start_matches('/').to_string();

    if safe_key.is_empty() {
        return Err("云端文件 key 不能为空".to_string());
    }

    let settings = get_music_player_settings(runtime.clone());
    let cache_dir = music_cache_dir(&runtime, &settings);
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

    let ext_source = file_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&safe_key);
    let cache_name = format!(
        "qiniu-{}{}",
        hash_text_sha1(&safe_key),
        safe_cache_ext(ext_source)
    );
    let cached_path = cache_dir.join(cache_name);

    if cached_path.is_file()
        && fs::metadata(&cached_path)
            .map(|item| item.len())
            .unwrap_or(0)
            > 0
    {
        let cached_path_text = path_to_string(&cached_path);
        return Ok(MusicCloudDownloadResult {
            cached_path: cached_path_text.clone(),
            key: safe_key,
            play_url: cached_path_text,
            provider: "qiniu".to_string(),
        });
    }

    let download_url = create_qiniu_download_url(&qiniu, &safe_key)?;
    download_remote_file(&download_url, &cached_path).await?;
    let cached_path_text = path_to_string(&cached_path);

    Ok(MusicCloudDownloadResult {
        cached_path: cached_path_text.clone(),
        key: safe_key,
        play_url: cached_path_text,
        provider: "qiniu".to_string(),
    })
}

#[tauri::command]
pub(crate) async fn resolve_music_cloud_storage_play_url(
    runtime: State<'_, StorageRuntimeState>,
    key: String,
    file_name: Option<String>,
) -> Result<MusicCloudDownloadResult, String> {
    download_music_cloud_storage_file(runtime, key, file_name).await
}

#[tauri::command]
pub(crate) async fn validate_music_cloud_storage(
    runtime: State<'_, StorageRuntimeState>,
) -> Result<MusicCloudValidateResult, String> {
    let qiniu = assert_qiniu_settings(&runtime)?;
    let probe_key = format!(
        "{}.tooldesk-probe/config-test.txt",
        normalize_qiniu_prefix(qiniu.prefix.as_deref())
    );
    let content = format!("tooldesk qiniu probe {}\n", chrono::Utc::now().to_rfc3339());
    upload_qiniu_object(
        &qiniu,
        &probe_key,
        content.into_bytes(),
        "config-test.txt",
        "text/plain; charset=utf-8",
    )
    .await?;

    Ok(MusicCloudValidateResult {
        bucket: qiniu_value(&qiniu.bucket).to_string(),
        domain: normalize_qiniu_domain(qiniu_value(&qiniu.domain)),
        provider: "qiniu".to_string(),
        region: qiniu_value(&qiniu.region).to_string(),
    })
}

#[tauri::command]
pub(crate) async fn aliyun_generate_qrcode() -> Result<AliyunQrCodeResult, String> {
    aliyun_pre_login().await?;
    let value = aliyun_get_json(ALIYUN_QR_GENERATE_URL).await?;
    let data = value.pointer("/content/data").unwrap_or(&Value::Null);
    let qr_code_content = data
        .get("codeContent")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let sid = data
        .get("ck")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let t = data
        .get("t")
        .map(|item| match item {
            Value::String(text) => text.clone(),
            Value::Number(number) => number.to_string(),
            _ => String::new(),
        })
        .unwrap_or_default();

    if qr_code_content.is_empty() || sid.is_empty() || t.is_empty() {
        return Err("生成阿里云盘登录二维码失败".to_string());
    }

    Ok(AliyunQrCodeResult {
        qr_code_content,
        sid,
        t,
    })
}

#[tauri::command]
pub(crate) async fn aliyun_check_qrcode(payload: AliyunQrCheckPayload) -> Result<Value, String> {
    let t = payload.t.trim();
    let sid = payload.sid.trim();

    if t.is_empty() || sid.is_empty() {
        return Ok(serde_json::json!({ "status": "WaitLogin" }));
    }

    let body = [
        ("t", t),
        ("ck", sid),
        ("appName", "aliyun_drive"),
        ("appEntrance", "web"),
        ("isMobile", "false"),
        ("lang", "zh_CN"),
        ("returnUrl", ""),
        ("fromSite", "52"),
        ("bizParams", ""),
        ("navlanguage", "zh-CN"),
        ("navPlatform", "Win32"),
    ]
    .iter()
    .map(|(key, value)| format!("{key}={}", urlencoding::encode(value)))
    .collect::<Vec<String>>()
    .join("&");
    let value = aliyun_post_form(ALIYUN_QR_QUERY_URL, &body).await?;
    let data = value.pointer("/content/data").unwrap_or(&Value::Null);
    let status = data
        .get("qrCodeStatus")
        .and_then(Value::as_str)
        .unwrap_or("NEW");

    match status {
        "CONFIRMED" => {
            let (refresh_token, access_token) =
                parse_aliyun_biz_ext(data.get("bizExt").and_then(Value::as_str).unwrap_or(""));
            Ok(serde_json::json!({
                "status": "LoginSuccess",
                "refresh_token": refresh_token,
                "access_token": access_token
            }))
        }
        "EXPIRED" => Ok(serde_json::json!({ "status": "QRCodeExpired" })),
        "SCANED" => Ok(serde_json::json!({ "status": "ScanSuccess" })),
        "CANCELED" => Ok(serde_json::json!({ "status": "Canceled" })),
        _ => Ok(serde_json::json!({ "status": "WaitLogin" })),
    }
}

#[tauri::command]
pub(crate) async fn aliyun_refresh_token(
    refresh_token: String,
) -> Result<AliyunRefreshResult, String> {
    let refresh_token = refresh_token.trim();

    if refresh_token.is_empty() {
        return Err("阿里云盘 refresh_token 不能为空".to_string());
    }

    let value = aliyun_post_json(
        None,
        ALIYUN_TOKEN_URL,
        serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }),
    )
    .await?;
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    if access_token.is_empty() {
        return Err("刷新阿里云盘访问令牌失败".to_string());
    }

    Ok(AliyunRefreshResult {
        access_token,
        refresh_token: value
            .get("refresh_token")
            .and_then(Value::as_str)
            .unwrap_or(refresh_token)
            .to_string(),
    })
}

#[tauri::command]
pub(crate) async fn aliyun_list_files(
    access_token: String,
    parent_id: Option<String>,
) -> Result<Vec<Value>, String> {
    let access_token = access_token.trim();

    if access_token.is_empty() {
        return Err("阿里云盘 access_token 不能为空".to_string());
    }

    let drive_id = get_aliyun_drive_id(access_token).await?;
    let parent_id = parent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("root");
    let mut marker = String::new();
    let mut items = Vec::new();

    loop {
        let value = aliyun_post_json(
            Some(access_token),
            ALIYUN_FILE_LIST_URL,
            serde_json::json!({
                "drive_id": drive_id,
                "parent_file_id": parent_id,
                "limit": 200,
                "marker": marker,
                "all": false,
                "url_expire_sec": 14400,
                "fields": "*"
            }),
        )
        .await?;

        if let Some(next_items) = value.get("items").and_then(Value::as_array) {
            items.extend(next_items.iter().cloned().map(normalize_aliyun_file_item));
        }

        marker = value
            .get("next_marker")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        if marker.is_empty() {
            break;
        }
    }

    Ok(items)
}

#[tauri::command]
pub(crate) async fn aliyun_get_download_url(
    access_token: String,
    file_id: String,
    _audio_quality: Option<String>,
) -> Result<String, String> {
    let access_token = access_token.trim();
    let file_id = file_id.trim();

    if access_token.is_empty() || file_id.is_empty() {
        return Err("阿里云盘 access_token 和 file_id 不能为空".to_string());
    }

    get_aliyun_download_url(access_token, file_id).await
}

#[tauri::command]
pub(crate) async fn aliyun_scan_all_music(access_token: String) -> Result<Vec<Value>, String> {
    let access_token = access_token.trim();

    if access_token.is_empty() {
        return Err("阿里云盘 access_token 不能为空".to_string());
    }

    let mut tracks = Vec::new();
    let mut queue = vec!["root".to_string()];

    while let Some(folder_id) = queue.pop() {
        let files = aliyun_list_files(access_token.to_string(), Some(folder_id)).await?;

        for file in files {
            let file_type = file.get("type").and_then(Value::as_str).unwrap_or("");
            let name = file.get("name").and_then(Value::as_str).unwrap_or("");

            if file_type == "folder" {
                if let Some(file_id) = file.get("file_id").and_then(Value::as_str) {
                    queue.push(file_id.to_string());
                }
            } else if is_music_file_name(name) {
                tracks.push(map_aliyun_cloud_track(&file));
            }
        }
    }

    Ok(tracks)
}

#[tauri::command]
pub(crate) async fn resolve_cloud_play_url(
    runtime: State<'_, StorageRuntimeState>,
    access_token: String,
    file_id: String,
    file_name: String,
) -> Result<AliyunCloudPlayResult, String> {
    let access_token = access_token.trim();
    let file_id = file_id.trim();

    if access_token.is_empty() || file_id.is_empty() {
        return Err("阿里云盘 access_token 和 file_id 不能为空".to_string());
    }

    let settings = get_music_player_settings(runtime.clone());
    let cached_path = aliyun_cache_path(&runtime, &settings, file_id, &file_name);

    if !cached_path.is_file()
        || fs::metadata(&cached_path)
            .map(|item| item.len())
            .unwrap_or_default()
            == 0
    {
        let remote_url = get_aliyun_download_url(access_token, file_id).await?;
        download_remote_audio_file(&remote_url, &cached_path).await?;
    }

    let cached_path_text = path_to_string(&cached_path);

    Ok(AliyunCloudPlayResult {
        play_url: cached_path_text.clone(),
        cached_path: cached_path_text,
        cover: None,
        artist: None,
        album: None,
        duration: None,
    })
}

#[tauri::command]
pub(crate) async fn download_cloud_music(
    runtime: State<'_, StorageRuntimeState>,
    access_token: String,
    file_id: String,
    file_name: String,
    target_dir: Option<String>,
) -> Result<MusicDownloadResult, String> {
    let access_token = access_token.trim();
    let file_id = file_id.trim();

    if access_token.is_empty() || file_id.is_empty() {
        return Err("阿里云盘 access_token 和 file_id 不能为空".to_string());
    }

    let settings = get_music_player_settings(runtime.clone());
    let save_dir = target_download_dir(&settings, target_dir.as_deref());
    fs::create_dir_all(&save_dir).map_err(|error| error.to_string())?;

    let safe_name = safe_file_name(&file_name, &format!("{file_id}.mp3"));
    let existing = save_dir.join(&safe_name);

    if existing.is_file()
        && fs::metadata(&existing)
            .map(|item| item.len())
            .unwrap_or_default()
            > 0
    {
        return Ok(MusicDownloadResult {
            file_path: path_to_string(&existing),
            skipped: true,
        });
    }

    let target_path = resolve_unique_path(&save_dir, &safe_name);
    let cached_path = aliyun_cache_path(&runtime, &settings, file_id, &safe_name);

    if cached_path.is_file()
        && fs::metadata(&cached_path)
            .map(|item| item.len())
            .unwrap_or_default()
            > 0
    {
        fs::copy(&cached_path, &target_path).map_err(|error| error.to_string())?;
        return Ok(MusicDownloadResult {
            file_path: path_to_string(&target_path),
            skipped: false,
        });
    }

    let remote_url = get_aliyun_download_url(access_token, file_id).await?;
    download_remote_audio_file(&remote_url, &target_path).await?;

    Ok(MusicDownloadResult {
        file_path: path_to_string(&target_path),
        skipped: false,
    })
}

#[tauri::command]
pub(crate) fn resolve_track_lyrics(track: TrackLyricsRequest) -> Result<Option<String>, String> {
    if let Some(text) = track.lrc_text {
        let trimmed = text.trim();

        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    if track.source.as_deref() != Some("local") {
        return Ok(None);
    }

    let lrc_path = track.lrc.or_else(|| {
        track
            .path
            .map(|value| path_to_string(&PathBuf::from(value).with_extension("lrc")))
    });

    let Some(lrc_path) = lrc_path else {
        return Ok(None);
    };
    let path = PathBuf::from(lrc_path);

    if !path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_string()))
    }
}
