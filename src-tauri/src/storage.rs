use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const BOOTSTRAP_CONFIG_FILE: &str = "tooldesk-bootstrap.json";
const APP_SETTINGS_FILE: &str = "settings.json";
const PLUGIN_STORAGE_FILE: &str = "plugin-storage.json";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapConfig {
    cache_dir: Option<String>,
    data_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageDirectoryItem {
    configured_path: String,
    current_path: String,
    default_path: String,
    pending_path: String,
    requires_restart: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageDirectoryConfig {
    cache: StorageDirectoryItem,
    config_path: String,
    data: StorageDirectoryItem,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CacheCleanupResult {
    bytes_freed: u64,
    path: String,
}

#[derive(Clone, Debug)]
pub(crate) struct StorageRuntimeState {
    pub(crate) cache_dir: PathBuf,
    pub(crate) data_dir: PathBuf,
    close_to_tray_cache: Arc<Mutex<Option<bool>>>,
}

pub(crate) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub(crate) fn merge_json_value(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(base_object), Value::Object(patch_object)) => {
            for (key, value) in patch_object {
                if let Some(existing) = base_object.get_mut(&key) {
                    merge_json_value(existing, value);
                } else {
                    base_object.insert(key, value);
                }
            }
        }
        (base_slot, value) => {
            *base_slot = value;
        }
    }
}

pub(crate) fn object_or_empty(value: Value) -> Value {
    if value.is_object() {
        value
    } else {
        Value::Object(Map::new())
    }
}

pub(crate) fn is_allowed_storage_key(value: &str) -> bool {
    let length = value.chars().count();

    if !(3..=120).contains(&length) {
        return false;
    }

    value
        .chars()
        .all(|item| item.is_ascii_alphanumeric() || matches!(item, '.' | '_' | ':' | '-'))
}

fn normalize_directory_path(value: Option<&str>) -> Option<PathBuf> {
    let trimmed = value?.trim();

    if trimmed.is_empty() {
        return None;
    }

    let path = PathBuf::from(trimmed);

    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

fn bootstrap_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(BOOTSTRAP_CONFIG_FILE))
        .map_err(|error| error.to_string())
}

fn default_storage_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;

    Ok((data_dir, cache_dir))
}

pub(crate) fn effective_storage_paths(app: &AppHandle) -> Result<StorageRuntimeState, String> {
    let bootstrap = read_bootstrap_config(app);
    let (default_data_dir, default_cache_dir) = default_storage_paths(app)?;
    let data_dir =
        normalize_directory_path(bootstrap.data_dir.as_deref()).unwrap_or(default_data_dir);
    let cache_dir =
        normalize_directory_path(bootstrap.cache_dir.as_deref()).unwrap_or(default_cache_dir);

    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

    Ok(StorageRuntimeState {
        cache_dir,
        close_to_tray_cache: Arc::new(Mutex::new(None)),
        data_dir,
    })
}

fn read_bootstrap_config(app: &AppHandle) -> BootstrapConfig {
    let Ok(config_path) = bootstrap_config_path(app) else {
        return BootstrapConfig::default();
    };
    let Ok(raw) = fs::read_to_string(config_path) else {
        return BootstrapConfig::default();
    };
    let Ok(parsed) = serde_json::from_str::<BootstrapConfig>(&raw) else {
        return BootstrapConfig::default();
    };

    BootstrapConfig {
        cache_dir: normalize_directory_path(parsed.cache_dir.as_deref())
            .map(|path| path_to_string(&path)),
        data_dir: normalize_directory_path(parsed.data_dir.as_deref())
            .map(|path| path_to_string(&path)),
    }
}

fn write_bootstrap_config(app: &AppHandle, config: &BootstrapConfig) -> Result<(), String> {
    let config_path = bootstrap_config_path(app)?;
    let payload = BootstrapConfig {
        cache_dir: normalize_directory_path(config.cache_dir.as_deref())
            .map(|path| path_to_string(&path)),
        data_dir: normalize_directory_path(config.data_dir.as_deref())
            .map(|path| path_to_string(&path)),
    };

    if payload.cache_dir.is_some() || payload.data_dir.is_some() {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let raw = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
        fs::write(config_path, format!("{raw}\n")).map_err(|error| error.to_string())?;
        return Ok(());
    }

    if config_path.exists() {
        fs::remove_file(config_path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn create_storage_directory_item(
    configured_path: Option<&str>,
    current_path: &Path,
    default_path: &Path,
) -> StorageDirectoryItem {
    let configured_path =
        normalize_directory_path(configured_path).map(|path| path_to_string(&path));
    let current_path_text = path_to_string(current_path);
    let default_path_text = path_to_string(default_path);
    let pending_path = configured_path
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| current_path_text.clone());

    StorageDirectoryItem {
        configured_path: configured_path.unwrap_or_default(),
        current_path: current_path_text.clone(),
        default_path: default_path_text,
        pending_path: pending_path.clone(),
        requires_restart: pending_path != current_path_text,
    }
}

fn build_storage_directory_config(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
) -> Result<StorageDirectoryConfig, String> {
    let bootstrap = read_bootstrap_config(app);
    let (default_data_dir, default_cache_dir) = default_storage_paths(app)?;
    let config_path = bootstrap_config_path(app)?;

    Ok(StorageDirectoryConfig {
        cache: create_storage_directory_item(
            bootstrap.cache_dir.as_deref(),
            &runtime.cache_dir,
            &default_cache_dir,
        ),
        config_path: path_to_string(&config_path),
        data: create_storage_directory_item(
            bootstrap.data_dir.as_deref(),
            &runtime.data_dir,
            &default_data_dir,
        ),
    })
}

fn app_settings_path(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.data_dir.join(APP_SETTINGS_FILE)
}

pub(crate) fn read_app_settings_value(
    runtime: &StorageRuntimeState,
    default_settings: Value,
) -> Value {
    let mut settings = object_or_empty(default_settings);
    let path = app_settings_path(runtime);
    let Ok(raw) = fs::read_to_string(path) else {
        return settings;
    };
    let Ok(saved) = serde_json::from_str::<Value>(&raw) else {
        return settings;
    };

    merge_json_value(&mut settings, object_or_empty(saved));
    cache_close_to_tray(runtime, &settings);
    settings
}

pub(crate) fn read_close_to_tray(runtime: &StorageRuntimeState) -> bool {
    if let Ok(cache) = runtime.close_to_tray_cache.lock() {
        if let Some(value) = *cache {
            return value;
        }
    }

    let path = app_settings_path(runtime);
    let Ok(raw) = fs::read_to_string(path) else {
        return true;
    };
    let Ok(saved) = serde_json::from_str::<Value>(&raw) else {
        return true;
    };

    let value = saved
        .get("closeToTray")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if let Ok(mut cache) = runtime.close_to_tray_cache.lock() {
        *cache = Some(value);
    }
    value
}

fn cache_close_to_tray(runtime: &StorageRuntimeState, settings: &Value) {
    if let Some(value) = settings.get("closeToTray").and_then(Value::as_bool) {
        if let Ok(mut cache) = runtime.close_to_tray_cache.lock() {
            *cache = Some(value);
        }
    }
}

fn write_app_settings_value(runtime: &StorageRuntimeState, settings: &Value) -> Result<(), String> {
    fs::create_dir_all(&runtime.data_dir).map_err(|error| error.to_string())?;
    let raw = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(app_settings_path(runtime), format!("{raw}\n")).map_err(|error| error.to_string())?;
    cache_close_to_tray(runtime, settings);
    Ok(())
}

fn plugin_storage_path(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.data_dir.join(PLUGIN_STORAGE_FILE)
}

fn read_plugin_storage(runtime: &StorageRuntimeState) -> HashMap<String, String> {
    let path = plugin_storage_path(runtime);
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(parsed) = serde_json::from_str::<HashMap<String, String>>(&raw) else {
        return HashMap::new();
    };

    parsed
        .into_iter()
        .filter(|(key, _)| is_allowed_storage_key(key))
        .collect()
}

fn write_plugin_storage(
    runtime: &StorageRuntimeState,
    storage: &HashMap<String, String>,
) -> Result<(), String> {
    fs::create_dir_all(&runtime.data_dir).map_err(|error| error.to_string())?;
    let raw = serde_json::to_string_pretty(storage).map_err(|error| error.to_string())?;
    fs::write(plugin_storage_path(runtime), format!("{raw}\n")).map_err(|error| error.to_string())
}

fn validate_plugin_storage_key(key: String) -> Result<String, String> {
    let key = key.trim().to_string();

    if is_allowed_storage_key(&key) {
        Ok(key)
    } else {
        Err("Plugin storage key is not allowed.".to_string())
    }
}

#[tauri::command]
pub(crate) fn get_app_settings(
    runtime: tauri::State<'_, StorageRuntimeState>,
    default_settings: Value,
) -> Value {
    read_app_settings_value(&runtime, default_settings)
}

#[tauri::command]
pub(crate) fn set_app_settings(
    runtime: tauri::State<'_, StorageRuntimeState>,
    default_settings: Value,
    settings: Value,
) -> Result<Value, String> {
    let mut next_settings = read_app_settings_value(&runtime, default_settings);
    merge_json_value(&mut next_settings, object_or_empty(settings));
    write_app_settings_value(&runtime, &next_settings)?;
    Ok(next_settings)
}

#[tauri::command]
pub(crate) fn get_plugin_storage_item(
    runtime: tauri::State<'_, StorageRuntimeState>,
    key: String,
) -> Result<Option<String>, String> {
    let key = validate_plugin_storage_key(key)?;
    Ok(read_plugin_storage(&runtime).get(&key).cloned())
}

#[tauri::command]
pub(crate) fn set_plugin_storage_item(
    runtime: tauri::State<'_, StorageRuntimeState>,
    key: String,
    value: String,
) -> Result<bool, String> {
    let key = validate_plugin_storage_key(key)?;
    let mut storage = read_plugin_storage(&runtime);
    storage.insert(key, value);
    write_plugin_storage(&runtime, &storage)?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn remove_plugin_storage_item(
    runtime: tauri::State<'_, StorageRuntimeState>,
    key: String,
) -> Result<bool, String> {
    let key = validate_plugin_storage_key(key)?;
    let mut storage = read_plugin_storage(&runtime);
    storage.remove(&key);
    write_plugin_storage(&runtime, &storage)?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn get_storage_directories(
    app: AppHandle,
    runtime: tauri::State<'_, StorageRuntimeState>,
) -> Result<StorageDirectoryConfig, String> {
    build_storage_directory_config(&app, &runtime)
}

#[tauri::command]
pub(crate) fn set_storage_directory(
    app: AppHandle,
    runtime: tauri::State<'_, StorageRuntimeState>,
    kind: String,
    target_path: String,
) -> Result<StorageDirectoryConfig, String> {
    let target = normalize_directory_path(Some(&target_path)).ok_or_else(|| {
        if kind == "data" {
            "数据目录必须是有效的绝对路径。".to_string()
        } else {
            "缓存目录必须是有效的绝对路径。".to_string()
        }
    })?;

    fs::create_dir_all(&target).map_err(|error| error.to_string())?;

    let mut bootstrap = read_bootstrap_config(&app);
    let (default_data_dir, default_cache_dir) = default_storage_paths(&app)?;

    if kind == "data" {
        bootstrap.data_dir = if target == default_data_dir {
            None
        } else {
            Some(path_to_string(&target))
        };
    } else if kind == "cache" {
        bootstrap.cache_dir = if target == default_cache_dir {
            None
        } else {
            Some(path_to_string(&target))
        };
    } else {
        return Err("未知存储目录类型。".to_string());
    }

    write_bootstrap_config(&app, &bootstrap)?;
    build_storage_directory_config(&app, &runtime)
}

#[tauri::command]
pub(crate) fn reset_storage_directory(
    app: AppHandle,
    runtime: tauri::State<'_, StorageRuntimeState>,
    kind: String,
) -> Result<StorageDirectoryConfig, String> {
    let mut bootstrap = read_bootstrap_config(&app);

    if kind == "data" {
        bootstrap.data_dir = None;
    } else if kind == "cache" {
        bootstrap.cache_dir = None;
    } else {
        return Err("未知存储目录类型。".to_string());
    }

    write_bootstrap_config(&app, &bootstrap)?;
    build_storage_directory_config(&app, &runtime)
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

#[tauri::command]
pub(crate) fn clear_app_cache(
    runtime: tauri::State<'_, StorageRuntimeState>,
) -> Result<CacheCleanupResult, String> {
    let cache_dir = runtime.cache_dir.clone();
    let bytes_freed = directory_size(&cache_dir);

    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    }

    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

    Ok(CacheCleanupResult {
        bytes_freed,
        path: path_to_string(&cache_dir),
    })
}
