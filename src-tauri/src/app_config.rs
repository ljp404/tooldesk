use hex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(target_os = "windows")]
use std::ffi::OsStr;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
};

const APP_CONFIG_FILE_NAME: &str = "tooldesk.config.json";
const DEVICE_ID_FILE_NAME: &str = "service-device.json";

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalServiceGatewayConfig {
    api_key: Option<String>,
    client_token: Option<String>,
    function_url: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSyncCloudConfig {
    api_key: Option<String>,
    bucket: Option<String>,
    function_url: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAppConfig {
    service_gateway: Option<LocalServiceGatewayConfig>,
    sync_cloud: Option<LocalSyncCloudConfig>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceGatewayConfig {
    api_key: String,
    bucket: String,
    client_token_configured: bool,
    function_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceGatewaySignPayload {
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceGatewaySignature {
    pub(crate) body_sha256: String,
    pub(crate) device_id: String,
    pub(crate) nonce: String,
    pub(crate) signature: String,
    pub(crate) timestamp: String,
}

fn normalize_text(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn normalize_url(value: Option<String>) -> String {
    let value = normalize_text(value);

    if value.starts_with("http://") || value.starts_with("https://") {
        value
    } else {
        String::new()
    }
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn read_windows_registry_env_value(root: HKEY, subkey: &str, name: &str) -> String {
    let subkey = wide_null(subkey);
    let value_name = wide_null(name);
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
    let mut byte_len: u32 = 0;
    let status = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut byte_len,
        )
    };

    if status != ERROR_SUCCESS && status != ERROR_MORE_DATA {
        return String::new();
    }

    if byte_len < 2 {
        return String::new();
    }

    let mut buffer = vec![0_u16; (byte_len as usize + 1) / 2];
    let status = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut byte_len,
        )
    };

    if status != ERROR_SUCCESS {
        return String::new();
    }

    let len = buffer
        .iter()
        .position(|item| *item == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len]).trim().to_string()
}

#[cfg(target_os = "windows")]
pub(crate) fn read_os_env_value(name: &str) -> String {
    let process_value = std::env::var(name).unwrap_or_default().trim().to_string();

    if !process_value.is_empty() {
        return process_value;
    }

    let user_value = read_windows_registry_env_value(HKEY_CURRENT_USER, "Environment", name);

    if !user_value.is_empty() {
        return user_value;
    }

    read_windows_registry_env_value(
        HKEY_LOCAL_MACHINE,
        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
        name,
    )
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn read_os_env_value(name: &str) -> String {
    std::env::var(name).unwrap_or_default().trim().to_string()
}

fn resolve_supabase_function_url() -> Option<String> {
    let service_function_url =
        normalize_url(Some(read_os_env_value("TOOLDESK_SERVICE_FUNCTION_URL")));

    if !service_function_url.is_empty() {
        return Some(service_function_url);
    }

    let supabase_url = normalize_url(Some(read_os_env_value("TOOLDESK_SUPABASE_URL")));

    if supabase_url.is_empty() {
        return None;
    }

    if supabase_url.contains("/functions/v1/") {
        return Some(supabase_url);
    }

    Some(format!(
        "{}/functions/v1/tooldesk-services",
        supabase_url.trim_end_matches('/')
    ))
}

fn read_json(path: PathBuf) -> Option<LocalAppConfig> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<LocalAppConfig>(&raw).ok()
}

fn config_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        paths.push(current_dir.join(APP_CONFIG_FILE_NAME));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        paths.push(resource_dir.join(APP_CONFIG_FILE_NAME));
        paths.push(
            resource_dir
                .parent()
                .map(PathBuf::from)
                .unwrap_or(resource_dir)
                .join(APP_CONFIG_FILE_NAME),
        );
    }

    if let Ok(config_dir) = app.path().app_config_dir() {
        paths.push(config_dir.join(APP_CONFIG_FILE_NAME));
    }

    paths
}

fn load_local_config(app: &AppHandle) -> LocalAppConfig {
    for path in config_candidates(app) {
        if let Some(config) = read_json(path) {
            return config;
        }
    }

    LocalAppConfig::default()
}

pub(crate) fn resolve_service_gateway_config(app: &AppHandle) -> ServiceGatewayConfig {
    let local = load_local_config(app);
    let service = local.service_gateway.unwrap_or_default();
    let sync = local.sync_cloud.unwrap_or_default();
    let function_url = normalize_url(
        resolve_supabase_function_url()
            .or(service.function_url)
            .or(sync.function_url),
    );
    let api_key = normalize_text(
        Some(read_os_env_value("TOOLDESK_SERVICE_API_KEY"))
            .filter(|value| !value.is_empty())
            .or(Some(read_os_env_value("TOOLDESK_SUPABASE_ANON_KEY")))
            .filter(|value| !value.is_empty())
            .or(service.api_key)
            .or(sync.api_key),
    );
    let client_token = normalize_text(
        Some(read_os_env_value("TOOLDESK_SERVICE_CLIENT_TOKEN"))
            .filter(|value| !value.is_empty())
            .or(service.client_token),
    );
    let bucket = normalize_text(sync.bucket.or_else(|| Some("tooldesk-sync".to_string())));

    ServiceGatewayConfig {
        api_key,
        bucket,
        client_token_configured: !client_token.is_empty(),
        function_url,
    }
}

fn resolve_client_token(app: &AppHandle) -> String {
    let local = load_local_config(app);
    normalize_text(
        Some(read_os_env_value("TOOLDESK_SERVICE_CLIENT_TOKEN"))
            .filter(|value| !value.is_empty())
            .or(local.service_gateway.and_then(|value| value.client_token)),
    )
}

fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    const BLOCK_SIZE: usize = 64;
    let mut normalized_key = if key.len() > BLOCK_SIZE {
        Sha256::digest(key).to_vec()
    } else {
        key.to_vec()
    };
    normalized_key.resize(BLOCK_SIZE, 0);

    let mut outer_key_pad = [0x5c_u8; BLOCK_SIZE];
    let mut inner_key_pad = [0x36_u8; BLOCK_SIZE];

    for index in 0..BLOCK_SIZE {
        outer_key_pad[index] ^= normalized_key[index];
        inner_key_pad[index] ^= normalized_key[index];
    }

    let mut inner = Sha256::new();
    inner.update(inner_key_pad);
    inner.update(message);
    let inner_hash = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_key_pad);
    outer.update(inner_hash);
    hex::encode(outer.finalize())
}

fn normalize_device_id(value: &str) -> String {
    let value = value.trim().to_ascii_lowercase();

    if (32..=64).contains(&value.len())
        && value
            .chars()
            .all(|item| item.is_ascii_hexdigit() || item == '-')
    {
        value
    } else {
        String::new()
    }
}

fn get_service_device_id(app: &AppHandle) -> String {
    let Ok(config_dir) = app.path().app_config_dir() else {
        return uuid_like_nonce();
    };
    let file_path = config_dir.join(DEVICE_ID_FILE_NAME);

    if let Ok(raw) = fs::read_to_string(&file_path) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            let device_id = normalize_device_id(
                value
                    .get("deviceId")
                    .and_then(|item| item.as_str())
                    .unwrap_or_default(),
            );

            if !device_id.is_empty() {
                return device_id;
            }
        }
    }

    let device_id = uuid_like_nonce();

    if let Some(parent) = file_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(
        file_path,
        format!(
            "{}\n",
            serde_json::json!({ "deviceId": device_id }).to_string()
        ),
    );

    device_id
}

#[tauri::command]
pub(crate) fn get_service_gateway_config(app: AppHandle) -> ServiceGatewayConfig {
    resolve_service_gateway_config(&app)
}

pub(crate) fn sign_service_gateway_body(
    app: &AppHandle,
    body: String,
) -> Result<Option<ServiceGatewaySignature>, String> {
    let token = resolve_client_token(app);

    if token.is_empty() {
        return Ok(None);
    }

    let timestamp = chrono::Utc::now().timestamp_millis().to_string();
    let nonce = uuid_like_nonce();
    let body_sha256 = hex::encode(Sha256::digest(body.as_bytes()));
    let message = format!("{timestamp}.{nonce}.{body_sha256}");
    let signature = hmac_sha256_hex(token.as_bytes(), message.as_bytes());
    let device_id = get_service_device_id(app);

    Ok(Some(ServiceGatewaySignature {
        body_sha256,
        device_id,
        nonce,
        signature,
        timestamp,
    }))
}

#[tauri::command]
pub(crate) fn sign_service_gateway_request(
    app: AppHandle,
    payload: ServiceGatewaySignPayload,
) -> Result<Option<ServiceGatewaySignature>, String> {
    sign_service_gateway_body(&app, payload.body)
}

fn uuid_like_nonce() -> String {
    let seed = format!(
        "{}:{}:{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id(),
        rand::random::<u64>()
    );
    hex::encode(Sha256::digest(seed.as_bytes()))
}
