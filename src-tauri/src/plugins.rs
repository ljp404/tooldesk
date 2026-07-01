use crate::app_config;
use crate::storage::{is_allowed_storage_key, path_to_string, StorageRuntimeState};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PLUGINS_DIR_NAME: &str = "plugins";
const PLUGIN_SDK_SOURCE: &str = include_str!("../../public/tooldesk-plugin-sdk.js");
const MARKET_HTTP_TIMEOUT_SECS: u64 = 30;
const PLUGIN_DOWNLOAD_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginSettingsManifest {
    accent: Option<String>,
    entry: Option<String>,
    icon: Option<String>,
    label: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginSyncManifest {
    local_storage_keys: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginClipboardMatchConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<i64>,
    r#type: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginMarketConfig {
    market_url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    accent: Option<String>,
    capabilities: Option<Vec<String>>,
    caption: Option<String>,
    category: Option<String>,
    clipboard_match: Option<serde_json::Value>,
    default_alias: Option<String>,
    entry: Option<String>,
    icon: Option<String>,
    id: Option<String>,
    keywords: Option<Vec<String>>,
    name: Option<String>,
    permissions: Option<Vec<String>>,
    settings: Option<PluginSettingsManifest>,
    sync: Option<PluginSyncManifest>,
    version: Option<String>,
    window_icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginMarketItem {
    accent: String,
    caption: String,
    category: String,
    default_alias: String,
    download_url: String,
    icon: String,
    keywords: Vec<String>,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_url: Option<String>,
    permissions: Vec<String>,
    plugin_id: String,
    publisher: String,
    sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature_url: Option<String>,
    trusted: bool,
    trust_level: String,
    updated_at: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_icon: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginMarketCatalog {
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    items: Vec<PluginMarketItem>,
    market_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
    version: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginSettingsRegistration {
    accent: String,
    entry_url: String,
    icon: String,
    label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginSyncRegistration {
    local_storage_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginToolRegistration {
    accent: String,
    capabilities: Vec<String>,
    caption: String,
    category: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    clipboard_match: Vec<PluginClipboardMatchConfig>,
    default_alias: String,
    entry_url: String,
    icon: String,
    install_path: String,
    key: String,
    keywords: Vec<String>,
    label: String,
    manifest_version: String,
    permissions: Vec<String>,
    plugin_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    settings: Option<PluginSettingsRegistration>,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sync: Option<PluginSyncRegistration>,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_icon: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    details: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_id: Option<String>,
    tools: Vec<PluginToolRegistration>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated: Option<bool>,
}

fn sanitize_plugin_id(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() || matches!(item, '.' | '_' | '-') {
                item
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn normalize_plugin_category(value: Option<&str>) -> String {
    match value.unwrap_or("").trim() {
        "text" | "dev" | "image" | "json" | "finance" | "life" | "document" => {
            value.unwrap_or("").trim().to_string()
        }
        _ => "dev".to_string(),
    }
}

fn normalize_plugin_permissions(value: Option<Vec<String>>) -> Vec<String> {
    value
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| {
            matches!(
                item.as_str(),
                "browser-bookmarks"
                    | "clipboard"
                    | "docker"
                    | "filesystem"
                    | "hosts"
                    | "http"
                    | "mail"
                    | "keepass"
                    | "local-library"
                    | "music"
                    | "native-tool"
                    | "ssh"
            )
        })
        .collect()
}

fn normalize_market_permissions(value: Option<Vec<String>>) -> Vec<String> {
    normalize_plugin_permissions(value)
}

fn normalize_string_list(value: Option<Vec<String>>) -> Vec<String> {
    value
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn normalize_plugin_clipboard_match_entry(
    value: &serde_json::Value,
) -> Option<PluginClipboardMatchConfig> {
    let item = value.as_object()?;
    let match_type = item.get("type")?.as_str()?.trim().to_string();

    if match_type.is_empty() {
        return None;
    }

    Some(PluginClipboardMatchConfig {
        priority: item.get("priority").and_then(|value| value.as_i64()),
        r#type: match_type,
    })
}

fn normalize_plugin_clipboard_match(
    value: Option<serde_json::Value>,
) -> Vec<PluginClipboardMatchConfig> {
    match value {
        Some(serde_json::Value::Array(entries)) => entries
            .iter()
            .filter_map(normalize_plugin_clipboard_match_entry)
            .collect(),
        Some(value) => normalize_plugin_clipboard_match_entry(&value)
            .into_iter()
            .collect(),
        None => Vec::new(),
    }
}

fn normalize_http_url(value: Option<&str>) -> String {
    let value = value.unwrap_or_default().trim();

    if value.is_empty() {
        return String::new();
    }

    let Ok(parsed) = reqwest::Url::parse(value) else {
        return String::new();
    };

    if matches!(parsed.scheme(), "http" | "https") {
        parsed.to_string()
    } else {
        String::new()
    }
}

fn normalize_sha256(value: Option<&str>) -> String {
    let value = value.unwrap_or_default().trim().to_ascii_lowercase();

    if value.len() == 64 && value.chars().all(|item| item.is_ascii_hexdigit()) {
        value
    } else {
        String::new()
    }
}

fn normalize_trust_level(value: Option<&str>) -> String {
    match value.unwrap_or_default().trim() {
        "official" => "official".to_string(),
        "verified" => "verified".to_string(),
        _ => "community".to_string(),
    }
}

fn is_inside_directory(parent: &Path, target: &Path) -> bool {
    let Ok(parent) = parent.canonicalize() else {
        return false;
    };
    let Ok(target) = target.canonicalize() else {
        return false;
    };

    target.starts_with(parent)
}

fn plugins_dir(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.data_dir.join(PLUGINS_DIR_NAME)
}

pub(crate) fn is_plugin_installed(runtime: &StorageRuntimeState, plugin_id: &str) -> bool {
    let plugin_id = sanitize_plugin_id(plugin_id);

    if plugin_id.is_empty() {
        return false;
    }

    plugins_dir(runtime)
        .join(plugin_id)
        .join("plugin.json")
        .is_file()
}

fn close_plugin_windows(app: &AppHandle, plugin_id: &str) {
    let plugin_id = sanitize_plugin_id(plugin_id);

    if plugin_id.is_empty() {
        return;
    }

    let quick_prefix = format!("quick-plugin:{plugin_id}");
    let compact_prefix = format!("quick-compact-plugin:{plugin_id}");

    for (label, window) in app.webview_windows() {
        if label == quick_prefix
            || label.starts_with(&format!("{quick_prefix}-"))
            || label == compact_prefix
            || label.starts_with(&format!("{compact_prefix}-"))
        {
            let _ = window.close();
        }
    }
}

fn read_plugin_market_config(app: &AppHandle) -> PluginMarketConfig {
    let Ok(resource_dir) = app.path().resource_dir() else {
        return PluginMarketConfig::default();
    };
    let candidates = [
        resource_dir.join("config").join("pluginMarketConfig.json"),
        resource_dir
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| resource_dir.clone())
            .join("config")
            .join("pluginMarketConfig.json"),
    ];

    for path in candidates {
        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(config) = serde_json::from_str::<PluginMarketConfig>(&raw) else {
            continue;
        };

        return config;
    }

    PluginMarketConfig::default()
}

fn plugin_market_url(app: &AppHandle) -> String {
    let public_base_url = normalize_http_url(Some(&app_config::read_os_env_value(
        "TOOLDESK_PUBLIC_BASE_URL",
    )));

    if !public_base_url.is_empty() {
        return format!(
            "{}/tooldesk/plugins/market.json",
            public_base_url.trim_end_matches('/')
        );
    }

    let config = read_plugin_market_config(app);
    normalize_http_url(config.market_url.as_deref())
}

fn resolve_plugin_asset(root: &Path, relative_path: &str) -> Option<PathBuf> {
    let relative_path = relative_path.trim();

    if relative_path.is_empty() || Path::new(relative_path).is_absolute() {
        return None;
    }

    let resolved = root.join(relative_path);
    let normalized_root = root.canonicalize().ok()?;
    let normalized_resolved = resolved.canonicalize().ok()?;

    if normalized_resolved.starts_with(normalized_root) {
        Some(normalized_resolved)
    } else {
        None
    }
}

fn read_plugin_manifest(root: &Path) -> Option<PluginManifest> {
    let raw = fs::read_to_string(root.join("plugin.json")).ok()?;
    serde_json::from_str::<PluginManifest>(&raw).ok()
}

fn normalize_market_item(value: &serde_json::Value) -> Option<PluginMarketItem> {
    let raw = value.as_object()?;
    let plugin_id = sanitize_plugin_id(
        raw.get("pluginId")
            .or_else(|| raw.get("id"))
            .and_then(|value| value.as_str())
            .unwrap_or_default(),
    );
    let label = raw
        .get("label")
        .or_else(|| raw.get("name"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let version = raw
        .get("version")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let download_url = normalize_http_url(raw.get("downloadUrl").and_then(|value| value.as_str()));
    let sha256 = normalize_sha256(raw.get("sha256").and_then(|value| value.as_str()));

    if plugin_id.is_empty()
        || label.is_empty()
        || version.is_empty()
        || download_url.is_empty()
        || sha256.is_empty()
    {
        return None;
    }

    let category = normalize_plugin_category(raw.get("category").and_then(|value| value.as_str()));
    let permissions = raw
        .get("permissions")
        .and_then(|value| serde_json::from_value::<Vec<String>>(value.clone()).ok());
    let keywords = raw
        .get("keywords")
        .and_then(|value| serde_json::from_value::<Vec<String>>(value.clone()).ok());

    Some(PluginMarketItem {
        accent: raw
            .get("accent")
            .and_then(|value| value.as_str())
            .unwrap_or("blue")
            .trim()
            .to_string(),
        caption: raw
            .get("caption")
            .or_else(|| raw.get("description"))
            .and_then(|value| value.as_str())
            .unwrap_or(&label)
            .trim()
            .to_string(),
        category,
        default_alias: raw
            .get("defaultAlias")
            .and_then(|value| value.as_str())
            .unwrap_or(&plugin_id)
            .trim()
            .to_string(),
        download_url,
        icon: raw
            .get("icon")
            .and_then(|value| value.as_str())
            .unwrap_or("toolbox")
            .trim()
            .to_string(),
        keywords: normalize_string_list(keywords),
        label,
        manifest_url: {
            let value = normalize_http_url(raw.get("manifestUrl").and_then(|value| value.as_str()));
            if value.is_empty() {
                None
            } else {
                Some(value)
            }
        },
        permissions: normalize_market_permissions(permissions),
        plugin_id,
        publisher: raw
            .get("publisher")
            .and_then(|value| value.as_str())
            .unwrap_or("tooldesk")
            .trim()
            .to_string(),
        sha256,
        signature: raw
            .get("signature")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        signature_url: {
            let value =
                normalize_http_url(raw.get("signatureUrl").and_then(|value| value.as_str()));
            if value.is_empty() {
                None
            } else {
                Some(value)
            }
        },
        trusted: raw
            .get("trusted")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        trust_level: normalize_trust_level(raw.get("trustLevel").and_then(|value| value.as_str())),
        updated_at: raw
            .get("updatedAt")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string(),
        version,
        window_icon: raw
            .get("windowIcon")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

fn normalize_market_catalog(raw: serde_json::Value, market_url: String) -> PluginMarketCatalog {
    let raw_object = raw.as_object();
    let items_value = raw_object
        .and_then(|object| object.get("plugins").or_else(|| object.get("items")))
        .cloned()
        .unwrap_or_else(|| raw.clone());
    let items = items_value
        .as_array()
        .map(|items| items.iter().filter_map(normalize_market_item).collect())
        .unwrap_or_default();

    PluginMarketCatalog {
        error: None,
        items,
        market_url,
        updated_at: raw_object
            .and_then(|object| object.get("updatedAt"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        version: raw_object
            .and_then(|object| object.get("version"))
            .and_then(|value| value.as_u64())
            .unwrap_or(1)
            .try_into()
            .unwrap_or(1),
    }
}

fn normalize_plugin_sync(sync: Option<PluginSyncManifest>) -> Option<PluginSyncRegistration> {
    let local_storage_keys = sync
        .and_then(|value| value.local_storage_keys)
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| is_allowed_storage_key(item))
        .collect::<Vec<_>>();

    if local_storage_keys.is_empty() {
        None
    } else {
        Some(PluginSyncRegistration { local_storage_keys })
    }
}

fn normalize_plugin_manifest(root: &Path) -> Option<PluginToolRegistration> {
    let manifest = read_plugin_manifest(root)?;
    let plugin_id = sanitize_plugin_id(manifest.id.as_deref().unwrap_or(""));
    let name = manifest.name.unwrap_or_default().trim().to_string();
    let version = manifest.version.unwrap_or_default().trim().to_string();
    let entry = manifest.entry.unwrap_or_default().trim().to_string();

    if plugin_id.is_empty() || name.is_empty() || version.is_empty() {
        return None;
    }

    let entry_path = resolve_plugin_asset(root, &entry)?;
    let settings = manifest.settings.and_then(|settings| {
        let settings_entry = settings.entry.unwrap_or_default().trim().to_string();
        let settings_entry_path = resolve_plugin_asset(root, &settings_entry)?;

        Some(PluginSettingsRegistration {
            accent: settings.accent.unwrap_or_else(|| {
                manifest
                    .accent
                    .clone()
                    .unwrap_or_else(|| "blue".to_string())
            }),
            entry_url: path_to_string(&settings_entry_path),
            icon: settings.icon.unwrap_or_else(|| {
                manifest
                    .icon
                    .clone()
                    .unwrap_or_else(|| "toolbox".to_string())
            }),
            label: settings.label.unwrap_or_else(|| format!("{name} 设置")),
        })
    });
    let window_icon = manifest
        .window_icon
        .as_deref()
        .and_then(|value| resolve_plugin_asset(root, value))
        .map(|path| path_to_string(&path));

    Some(PluginToolRegistration {
        accent: manifest.accent.unwrap_or_else(|| "blue".to_string()),
        capabilities: normalize_string_list(manifest.capabilities),
        caption: manifest.caption.unwrap_or_else(|| format!("插件 {name}")),
        category: normalize_plugin_category(manifest.category.as_deref()),
        clipboard_match: normalize_plugin_clipboard_match(manifest.clipboard_match),
        default_alias: manifest.default_alias.unwrap_or_else(|| plugin_id.clone()),
        entry_url: path_to_string(&entry_path),
        icon: manifest.icon.unwrap_or_else(|| "toolbox".to_string()),
        install_path: path_to_string(root),
        key: format!("plugin:{plugin_id}"),
        keywords: normalize_string_list(manifest.keywords),
        label: name,
        manifest_version: version,
        permissions: normalize_plugin_permissions(manifest.permissions),
        plugin_id,
        settings,
        source: "plugin".to_string(),
        sync: normalize_plugin_sync(manifest.sync),
        window_icon,
    })
}

fn list_installed_plugin_tools_from_runtime(
    runtime: &StorageRuntimeState,
) -> Vec<PluginToolRegistration> {
    let root = plugins_dir(runtime);
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut tools = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| normalize_plugin_manifest(&path))
        .collect::<Vec<_>>();

    tools.sort_by(|current, next| current.label.cmp(&next.label));
    tools
}

fn plugin_window_icon_path_from_root(root: &Path) -> Option<PathBuf> {
    let manifest = read_plugin_manifest(root)?;
    manifest
        .window_icon
        .as_deref()
        .and_then(|value| resolve_plugin_asset(root, value))
}

fn bundled_plugin_resource_icon_path(
    app: &AppHandle,
    plugin_id: &str,
    file_name: &str,
) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let path = resource_dir
        .join("plugin-icons")
        .join(plugin_id)
        .join(file_name);

    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn system_tool_window_icon_path(app: &AppHandle, kind: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("system-tool-icons")
                .join(format!("{kind}.png")),
        );
    }

    if let Ok(path) = app.path().resolve(
        format!("system-tool-icons/{kind}.png"),
        tauri::path::BaseDirectory::Resource,
    ) {
        candidates.push(path);
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("system-tool-icons")
            .join(format!("{kind}.png")),
    );

    if let Some(project_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(
            project_root
                .join("src")
                .join("tools")
                .join(kind)
                .join("assets")
                .join("window-icon.png"),
        );
    }

    candidates.into_iter().find(|path| path.is_file())
}

pub(crate) fn plugin_window_icon_path(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
    kind: &str,
) -> Option<PathBuf> {
    if let Some(path) = system_tool_window_icon_path(app, kind) {
        return Some(path);
    }

    let plugin_id = sanitize_plugin_id(kind.strip_prefix("plugin:")?);

    if plugin_id.is_empty() {
        return None;
    }

    let installed_root = plugins_dir(runtime).join(&plugin_id);
    if let Some(path) = plugin_window_icon_path_from_root(&installed_root) {
        return Some(path);
    }

    for file_name in ["window-icon.png"] {
        if let Some(path) = bundled_plugin_resource_icon_path(app, &plugin_id, file_name) {
            return Some(path);
        }
    }

    let current_dir = std::env::current_dir().ok();
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from);
    let candidate_bases = [
        current_dir.as_ref().map(|path| path.join("plugins")),
        current_dir
            .as_ref()
            .map(|path| path.join("public").join("plugins")),
        current_dir
            .as_ref()
            .map(|path| path.join("dist").join("plugins")),
        current_dir
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.join("plugins"))),
        source_root.as_ref().map(|path| path.join("plugins")),
        source_root
            .as_ref()
            .map(|path| path.join("public").join("plugins")),
        source_root
            .as_ref()
            .map(|path| path.join("dist").join("plugins")),
    ];

    candidate_bases
        .into_iter()
        .flatten()
        .map(|base| base.join(&plugin_id))
        .find_map(|root| plugin_window_icon_path_from_root(&root))
}

fn plugin_install_error(
    runtime: &StorageRuntimeState,
    error: String,
    details: Vec<String>,
) -> PluginInstallResult {
    PluginInstallResult {
        canceled: Some(false),
        details,
        error: Some(error),
        plugin_id: None,
        tools: list_installed_plugin_tools_from_runtime(runtime),
        updated: None,
    }
}

fn inject_plugin_sdk_into_html(html: &str) -> String {
    if html.contains("data-tooldesk-sdk=\"1\"") || html.contains("data-tooldesk-sdk='1'") {
        return html.to_string();
    }

    let script = format!(
        "<script data-tooldesk-sdk=\"1\">{}</script>",
        PLUGIN_SDK_SOURCE.replace("</script", "<\\/script")
    );
    let lower = html.to_ascii_lowercase();

    if let Some(head_start) = lower.find("<head") {
        if let Some(head_end) = lower[head_start..].find('>') {
            let insert_at = head_start + head_end + 1;
            let mut output = String::with_capacity(html.len() + script.len());
            output.push_str(&html[..insert_at]);
            output.push_str(&script);
            output.push_str(&html[insert_at..]);
            return output;
        }
    }

    format!("{script}{html}")
}

fn copy_plugin_dir(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;

    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            copy_plugin_dir(&source_path, &target_path)?;
            continue;
        }

        if file_type.is_file() {
            fs::create_dir_all(target_path.parent().unwrap_or(target))
                .map_err(|error| error.to_string())?;
            let is_html = source_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| matches!(value.to_ascii_lowercase().as_str(), "html" | "htm"))
                .unwrap_or(false);

            if is_html {
                let html = fs::read_to_string(&source_path).map_err(|error| error.to_string())?;
                fs::write(target_path, inject_plugin_sdk_into_html(&html))
                    .map_err(|error| error.to_string())?;
            } else {
                fs::copy(&source_path, target_path).map_err(|error| error.to_string())?;
            }
        }
    }

    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn create_market_extract_dir(
    runtime: &StorageRuntimeState,
    plugin_id: &str,
) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let root = runtime
        .cache_dir
        .join("plugin-install")
        .join(format!("{plugin_id}-{timestamp}"));
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn extract_zip_safely(buffer: &[u8], target_dir: &Path) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(buffer)).map_err(|error| error.to_string())?;
    let target_root = target_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(safe_name) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            return Err("扩展包包含无效路径".to_string());
        };
        let target_path = target_root.join(safe_name);

        if target_path != target_root && !target_path.starts_with(&target_root) {
            return Err("扩展包包含越界路径".to_string());
        }

        if file.is_dir() {
            fs::create_dir_all(&target_path).map_err(|error| error.to_string())?;
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let mut output = fs::File::create(&target_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, &mut output).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn find_extracted_plugin_root(extract_root: &Path) -> Option<PathBuf> {
    if extract_root.join("plugin.json").exists() {
        return Some(extract_root.to_path_buf());
    }

    let candidates = fs::read_dir(extract_root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join("plugin.json").exists())
        .collect::<Vec<_>>();

    if candidates.len() == 1 {
        candidates.into_iter().next()
    } else {
        None
    }
}

#[tauri::command]
pub(crate) fn list_installed_plugin_tools(
    runtime: tauri::State<'_, StorageRuntimeState>,
) -> Vec<PluginToolRegistration> {
    list_installed_plugin_tools_from_runtime(&runtime)
}

#[tauri::command]
pub(crate) fn install_local_plugin(
    runtime: tauri::State<'_, StorageRuntimeState>,
    source_path: String,
) -> PluginInstallResult {
    let source_root = PathBuf::from(source_path.trim());

    if !source_root.is_absolute() || !source_root.is_dir() {
        return plugin_install_error(
            &runtime,
            "插件目录无效".to_string(),
            vec![path_to_string(&source_root)],
        );
    }

    let Some(registration) = normalize_plugin_manifest(&source_root) else {
        return plugin_install_error(
            &runtime,
            "未找到有效的 plugin.json".to_string(),
            vec![path_to_string(&source_root)],
        );
    };

    let plugins_root = plugins_dir(&runtime);
    let target_root = plugins_root.join(&registration.plugin_id);
    let was_installed = target_root.exists();

    if fs::create_dir_all(&plugins_root).is_err() {
        return plugin_install_error(
            &runtime,
            "插件目录创建失败".to_string(),
            vec![path_to_string(&plugins_root)],
        );
    }

    if target_root.exists() && fs::remove_dir_all(&target_root).is_err() {
        return plugin_install_error(
            &runtime,
            "旧插件目录删除失败".to_string(),
            vec![path_to_string(&target_root)],
        );
    }

    if let Err(error) = copy_plugin_dir(&source_root, &target_root) {
        return plugin_install_error(
            &runtime,
            error,
            vec![path_to_string(&source_root), path_to_string(&target_root)],
        );
    }

    PluginInstallResult {
        canceled: Some(false),
        details: Vec::new(),
        error: None,
        plugin_id: Some(registration.plugin_id),
        tools: list_installed_plugin_tools_from_runtime(&runtime),
        updated: Some(was_installed),
    }
}

#[tauri::command]
pub(crate) async fn list_plugin_market(app: AppHandle) -> PluginMarketCatalog {
    list_plugin_market_from_app(&app).await
}

async fn list_plugin_market_from_app(app: &AppHandle) -> PluginMarketCatalog {
    let market_url = plugin_market_url(app);

    if market_url.is_empty() {
        return PluginMarketCatalog {
            error: Some(
                "扩展市场地址未配置，请先配置 config/pluginMarketConfig.json 的 marketUrl。"
                    .to_string(),
            ),
            items: Vec::new(),
            market_url,
            updated_at: None,
            version: 1,
        };
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(MARKET_HTTP_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| Client::new());
    let Ok(response) = client
        .get(&market_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
    else {
        return PluginMarketCatalog {
            error: Some("扩展市场拉取失败，请检查网络或 marketUrl。".to_string()),
            items: Vec::new(),
            market_url,
            updated_at: None,
            version: 1,
        };
    };

    if !response.status().is_success() {
        return PluginMarketCatalog {
            error: Some(format!("扩展市场拉取失败：HTTP {}", response.status())),
            items: Vec::new(),
            market_url,
            updated_at: None,
            version: 1,
        };
    }

    let Ok(raw) = response.json::<serde_json::Value>().await else {
        return PluginMarketCatalog {
            error: Some("扩展市场清单不是合法 JSON。".to_string()),
            items: Vec::new(),
            market_url,
            updated_at: None,
            version: 1,
        };
    };

    normalize_market_catalog(raw, market_url)
}

#[tauri::command]
pub(crate) async fn install_market_plugin(
    app: AppHandle,
    runtime: tauri::State<'_, StorageRuntimeState>,
    plugin_id: String,
) -> Result<PluginInstallResult, String> {
    let normalized_plugin_id = sanitize_plugin_id(&plugin_id);

    if normalized_plugin_id.is_empty() {
        return Ok(plugin_install_error(
            &runtime,
            "扩展标识无效".to_string(),
            vec![format!("pluginId: {plugin_id}")],
        ));
    }

    let catalog = list_plugin_market_from_app(&app).await;
    let Some(item) = catalog
        .items
        .iter()
        .find(|item| item.plugin_id == normalized_plugin_id)
        .cloned()
    else {
        return Ok(plugin_install_error(
            &runtime,
            "扩展市场中未找到该扩展".to_string(),
            vec![
                format!("pluginId: {normalized_plugin_id}"),
                format!("marketUrl: {}", catalog.market_url),
            ],
        ));
    };

    let extract_root = match create_market_extract_dir(&runtime, &normalized_plugin_id) {
        Ok(path) => path,
        Err(error) => {
            return Ok(plugin_install_error(
                &runtime,
                "临时目录创建失败".to_string(),
                vec![error],
            ));
        }
    };

    let result = async {
        let client = Client::builder()
            .timeout(Duration::from_secs(PLUGIN_DOWNLOAD_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| Client::new());
        let package = client
            .get(&item.download_url)
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !package.status().is_success() {
            return Err(format!("扩展下载失败：HTTP {}", package.status()));
        }

        let bytes = package.bytes().await.map_err(|error| error.to_string())?;
        let actual_sha256 = sha256_hex(&bytes);

        if actual_sha256 != item.sha256 {
            return Err(format!(
                "扩展包校验失败\nexpectedSha256: {}\nactualSha256: {}",
                item.sha256, actual_sha256
            ));
        }

        extract_zip_safely(&bytes, &extract_root)?;

        let plugin_root = find_extracted_plugin_root(&extract_root)
            .ok_or_else(|| "扩展包缺少有效 plugin.json".to_string())?;
        let registration =
            normalize_plugin_manifest(&plugin_root).ok_or_else(|| "扩展清单无效".to_string())?;

        if registration.plugin_id != normalized_plugin_id {
            return Err(format!(
                "扩展包标识与市场信息不一致\nmarketPluginId: {}\npackagePluginId: {}",
                normalized_plugin_id, registration.plugin_id
            ));
        }

        let plugins_root = plugins_dir(&runtime);
        let target_root = plugins_root.join(&registration.plugin_id);

        fs::create_dir_all(&plugins_root).map_err(|error| error.to_string())?;

        if target_root.exists() && !is_inside_directory(&plugins_root, &target_root) {
            return Err("扩展安装目录无效".to_string());
        }

        let was_installed = target_root.exists();

        if target_root.exists() {
            fs::remove_dir_all(&target_root).map_err(|error| error.to_string())?;
        }

        copy_plugin_dir(&plugin_root, &target_root)?;

        Ok((registration.plugin_id, was_installed))
    }
    .await;

    let _ = fs::remove_dir_all(&extract_root);

    match result {
        Ok((plugin_id, was_installed)) => Ok(PluginInstallResult {
            canceled: Some(false),
            details: Vec::new(),
            error: None,
            plugin_id: Some(plugin_id),
            tools: list_installed_plugin_tools_from_runtime(&runtime),
            updated: Some(was_installed),
        }),
        Err(error) => Ok(plugin_install_error(
            &runtime,
            error,
            vec![
                format!("pluginId: {normalized_plugin_id}"),
                format!("downloadUrl: {}", item.download_url),
            ],
        )),
    }
}

#[tauri::command]
pub(crate) fn uninstall_plugin(
    app: AppHandle,
    runtime: tauri::State<'_, StorageRuntimeState>,
    plugin_id: String,
) -> PluginInstallResult {
    let plugin_id = sanitize_plugin_id(&plugin_id);

    if plugin_id.is_empty() {
        return plugin_install_error(&runtime, "插件标识无效".to_string(), Vec::new());
    }

    let plugins_root = plugins_dir(&runtime);
    let target_root = plugins_root.join(&plugin_id);
    close_plugin_windows(&app, &plugin_id);

    if target_root.exists() && !is_inside_directory(&plugins_root, &target_root) {
        return plugin_install_error(
            &runtime,
            "插件目录越界".to_string(),
            vec![path_to_string(&target_root)],
        );
    }

    if target_root.exists() && fs::remove_dir_all(&target_root).is_err() {
        return plugin_install_error(
            &runtime,
            "插件卸载失败".to_string(),
            vec![path_to_string(&target_root)],
        );
    }

    PluginInstallResult {
        canceled: Some(false),
        details: Vec::new(),
        error: None,
        plugin_id: Some(plugin_id),
        tools: list_installed_plugin_tools_from_runtime(&runtime),
        updated: None,
    }
}
