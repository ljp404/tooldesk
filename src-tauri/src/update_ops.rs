use crate::app_config;
use crate::storage::{path_to_string, StorageRuntimeState};
use base64::Engine;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use std::cmp::Ordering;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    has_update: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha512: Option<String>,
    success: bool,
    version: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct UpdateRuntimeState(Mutex<Option<PendingUpdate>>);

#[derive(Clone, Debug)]
struct PendingUpdate {
    file_path: PathBuf,
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadUpdatePayload {
    download_url: String,
    file_name: Option<String>,
    sha512: Option<String>,
    version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadUpdateResult {
    file_path: String,
    version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    downloaded_bytes: u64,
    percent: u64,
    total_bytes: u64,
    version: String,
}

fn normalize_url(value: &str) -> String {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        String::new()
    } else if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{trimmed}/")
    }
}

fn read_project_update_url(app: &AppHandle) -> String {
    let Ok(resource_dir) = app.path().resource_dir() else {
        return String::new();
    };
    let candidates = [
        resource_dir.join("config").join("cosUpdate.json"),
        resource_dir
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| resource_dir.clone())
            .join("config")
            .join("cosUpdate.json"),
    ];

    for path in candidates {
        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let public_base_url = parsed
            .get("publicBaseUrl")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();

        if !public_base_url.is_empty() {
            return normalize_url(public_base_url);
        }
    }

    String::new()
}

fn resolve_update_feed_url(app: &AppHandle) -> String {
    let public_base_url = normalize_url(&app_config::read_os_env_value("TOOLDESK_PUBLIC_BASE_URL"));

    if !public_base_url.is_empty() {
        return format!(
            "{}/tooldesk/releases/win/",
            public_base_url.trim_end_matches('/')
        );
    }

    read_project_update_url(app)
}

fn parse_latest_manifest_version(raw: &str) -> Option<String> {
    for line in raw.lines() {
        let trimmed = line.trim();

        if !trimmed.starts_with("version:") {
            continue;
        }

        let version = trimmed
            .split_once(':')
            .map(|(_, value)| value.trim().trim_matches(['"', '\'']))
            .unwrap_or("");

        if !version.is_empty() {
            return Some(version.to_string());
        }
    }

    None
}

fn parse_manifest_value(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim();
    let remainder = trimmed
        .strip_prefix(&format!("{key}:"))
        .or_else(|| trimmed.strip_prefix(&format!("- {key}:")))?;
    let value = remainder.trim().trim_matches(['"', '\'']);

    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn preferred_asset_score(value: &str) -> Option<u8> {
    let lower = value.to_ascii_lowercase();

    if lower.ends_with(".blockmap") || lower.ends_with(".yml") || lower.ends_with(".yaml") {
        return None;
    }

    #[cfg(target_os = "windows")]
    {
        if lower.ends_with(".exe") {
            return Some(10);
        }

        if lower.ends_with(".msi") {
            return Some(9);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if lower.ends_with(".dmg") {
            return Some(10);
        }

        if lower.ends_with(".app.tar.gz") {
            return Some(8);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if lower.ends_with(".appimage") {
            return Some(10);
        }

        if lower.ends_with(".deb") {
            return Some(8);
        }

        if lower.ends_with(".rpm") {
            return Some(7);
        }
    }

    None
}

fn resolve_asset_url(feed_url: &str, value: &str) -> Option<String> {
    if value.starts_with("http://") || value.starts_with("https://") {
        return Some(value.to_string());
    }

    reqwest::Url::parse(feed_url)
        .ok()
        .and_then(|base| base.join(value).ok())
        .map(|url| url.to_string())
}

fn infer_file_name(download_url: &str, value: &str, version: &str) -> String {
    let from_value = PathBuf::from(value)
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .filter(|item| !item.trim().is_empty());

    if let Some(file_name) = from_value {
        return file_name;
    }

    reqwest::Url::parse(download_url)
        .ok()
        .and_then(|url| {
            url.path_segments()
                .and_then(|mut segments| segments.next_back())
                .map(|item| item.to_string())
        })
        .filter(|item| !item.trim().is_empty())
        .unwrap_or_else(|| format!("tooldesk-{version}-update"))
}

fn parse_update_manifest(raw: &str, feed_url: &str) -> Option<(String, String, Option<String>)> {
    let lines = raw.lines().collect::<Vec<_>>();
    let mut best: Option<(u8, usize, String)> = None;

    for (index, line) in lines.iter().enumerate() {
        let Some(value) =
            parse_manifest_value(line, "url").or_else(|| parse_manifest_value(line, "path"))
        else {
            continue;
        };
        let Some(score) = preferred_asset_score(&value) else {
            continue;
        };

        let should_replace = best
            .as_ref()
            .map(|(current_score, _, _)| score > *current_score)
            .unwrap_or(true);

        if should_replace {
            best = Some((score, index, value));
        }
    }

    let (_, index, asset) = best?;
    let download_url = resolve_asset_url(feed_url, &asset)?;
    let version = parse_latest_manifest_version(raw).unwrap_or_default();
    let file_name = infer_file_name(&download_url, &asset, &version);
    let sha512 = lines
        .iter()
        .skip(index)
        .take(8)
        .find_map(|line| parse_manifest_value(line, "sha512"))
        .or_else(|| {
            lines
                .iter()
                .find_map(|line| parse_manifest_value(line, "sha512"))
        });

    Some((download_url, file_name, sha512))
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .split(['.', '-', '+'])
        .map(|part| {
            part.chars()
                .take_while(|item| item.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn compare_versions(current: &str, latest: &str) -> Ordering {
    let current_parts = parse_version_parts(current);
    let latest_parts = parse_version_parts(latest);
    let length = current_parts.len().max(latest_parts.len());

    for index in 0..length {
        let current_part = current_parts.get(index).copied().unwrap_or(0);
        let latest_part = latest_parts.get(index).copied().unwrap_or(0);

        match latest_part.cmp(&current_part) {
            Ordering::Equal => {}
            ordering => return ordering,
        }
    }

    Ordering::Equal
}

#[tauri::command]
pub(crate) async fn check_for_updates(app: AppHandle) -> UpdateCheckResult {
    let feed_url = resolve_update_feed_url(&app);

    if feed_url.is_empty() {
        return UpdateCheckResult {
            download_url: None,
            file_name: None,
            has_update: false,
            message: "未配置更新源".to_string(),
            sha512: None,
            success: false,
            version: None,
        };
    }

    let latest_url = format!("{feed_url}latest.yml");
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(value) => value,
        Err(error) => {
            return UpdateCheckResult {
                download_url: None,
                file_name: None,
                has_update: false,
                message: format!("检查更新失败: {error}"),
                sha512: None,
                success: false,
                version: None,
            };
        }
    };
    let response = match client.get(latest_url).send().await {
        Ok(value) => value,
        Err(error) => {
            return UpdateCheckResult {
                download_url: None,
                file_name: None,
                has_update: false,
                message: format!("检查更新失败: {error}"),
                sha512: None,
                success: false,
                version: None,
            };
        }
    };

    if !response.status().is_success() {
        return UpdateCheckResult {
            download_url: None,
            file_name: None,
            has_update: false,
            message: format!("检查更新失败: HTTP {}", response.status().as_u16()),
            sha512: None,
            success: false,
            version: None,
        };
    }

    let manifest = match response.text().await {
        Ok(value) => value,
        Err(error) => {
            return UpdateCheckResult {
                download_url: None,
                file_name: None,
                has_update: false,
                message: format!("检查更新失败: {error}"),
                sha512: None,
                success: false,
                version: None,
            };
        }
    };
    let Some(latest_version) = parse_latest_manifest_version(&manifest) else {
        return UpdateCheckResult {
            download_url: None,
            file_name: None,
            has_update: false,
            message: "检查更新失败: 更新清单缺少版本号".to_string(),
            sha512: None,
            success: false,
            version: None,
        };
    };
    let current_version = app.package_info().version.to_string();
    let has_update = compare_versions(&current_version, &latest_version) == Ordering::Greater;

    let asset = if has_update {
        parse_update_manifest(&manifest, &feed_url)
    } else {
        None
    };

    let message = if has_update {
        if asset.is_some() {
            format!("发现新版本 {latest_version}")
        } else {
            format!("发现新版本 {latest_version}，但更新清单缺少当前系统安装包")
        }
    } else {
        "已是最新版本".to_string()
    };
    let result = UpdateCheckResult {
        download_url: asset
            .as_ref()
            .map(|(download_url, _, _)| download_url.clone()),
        file_name: asset.as_ref().map(|(_, file_name, _)| file_name.clone()),
        has_update,
        message,
        sha512: asset.and_then(|(_, _, sha512)| sha512),
        success: true,
        version: Some(latest_version),
    };

    if result.has_update {
        let _ = app.emit(
            "update-available",
            serde_json::json!({ "version": result.version.clone().unwrap_or_default() }),
        );
    }
    let _ = app.emit(
        "update-check-complete",
        serde_json::json!({ "hasUpdate": result.has_update, "version": result.version }),
    );

    result
}

fn safe_update_file_name(value: Option<&str>, version: &str) -> String {
    let value = value
        .unwrap_or("")
        .trim()
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() || matches!(item, '.' | '-' | '_' | ' ') {
                item
            } else {
                '_'
            }
        })
        .collect::<String>();

    if value.is_empty() {
        format!("tooldesk-{version}-update")
    } else {
        value
    }
}

fn verify_sha512(file_path: &PathBuf, expected: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };

    let data = fs::read(file_path).map_err(|error| error.to_string())?;
    let actual = base64::engine::general_purpose::STANDARD.encode(Sha512::digest(data));

    if actual == expected {
        Ok(())
    } else {
        let _ = fs::remove_file(file_path);
        Err("更新包校验失败，已删除下载文件".to_string())
    }
}

#[tauri::command]
pub(crate) async fn download_update(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    state: State<'_, UpdateRuntimeState>,
    payload: DownloadUpdatePayload,
) -> Result<DownloadUpdateResult, String> {
    let version = payload.version.trim().to_string();

    if version.is_empty() {
        return Err("更新版本号不能为空".to_string());
    }

    let url = payload.download_url.trim().to_string();

    if url.is_empty() {
        return Err("更新下载地址不能为空".to_string());
    }

    let file_name = safe_update_file_name(payload.file_name.as_deref(), &version);
    let update_dir = runtime.cache_dir.join("updates");
    fs::create_dir_all(&update_dir).map_err(|error| error.to_string())?;
    let file_path = update_dir.join(file_name);

    let _ = app.emit(
        "update-download-start",
        serde_json::json!({ "version": version }),
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client.get(&url).send().await.map_err(|error| {
        let message = format!("下载更新失败: {error}");
        let _ = app.emit(
            "update-download-error",
            serde_json::json!({ "error": message }),
        );
        message
    })?;

    if !response.status().is_success() {
        let message = format!("下载更新失败: HTTP {}", response.status().as_u16());
        let _ = app.emit(
            "update-download-error",
            serde_json::json!({ "error": message }),
        );
        return Err(message);
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut downloaded_bytes = 0_u64;
    let mut stream = response.bytes_stream();
    let mut output = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            let message = format!("下载更新失败: {error}");
            let _ = app.emit(
                "update-download-error",
                serde_json::json!({ "error": message }),
            );
            message
        })?;
        downloaded_bytes += chunk.len() as u64;
        output.extend_from_slice(&chunk);
        let percent = downloaded_bytes
            .saturating_mul(100)
            .checked_div(total_bytes)
            .unwrap_or(0)
            .min(100);
        let _ = app.emit(
            "update-download-progress",
            UpdateDownloadProgress {
                downloaded_bytes,
                percent,
                total_bytes,
                version: version.clone(),
            },
        );
    }

    fs::write(&file_path, output).map_err(|error| {
        let message = format!("保存更新包失败: {error}");
        let _ = app.emit(
            "update-download-error",
            serde_json::json!({ "error": message }),
        );
        message
    })?;

    if let Err(error) = verify_sha512(&file_path, payload.sha512.as_deref()) {
        let _ = app.emit(
            "update-download-error",
            serde_json::json!({ "error": error }),
        );
        return Err(error);
    }

    {
        let mut pending = state.0.lock().map_err(|_| "更新状态不可用".to_string())?;
        *pending = Some(PendingUpdate {
            file_path: file_path.clone(),
            version: version.clone(),
        });
    }

    let _ = app.emit(
        "update-download-complete",
        serde_json::json!({ "version": version }),
    );

    Ok(DownloadUpdateResult {
        file_path: path_to_string(&file_path),
        version,
    })
}

#[tauri::command]
pub(crate) fn install_downloaded_update(
    app: AppHandle,
    state: State<'_, UpdateRuntimeState>,
) -> Result<(), String> {
    let pending = state
        .0
        .lock()
        .map_err(|_| "更新状态不可用".to_string())?
        .clone()
        .ok_or_else(|| "没有可安装的更新包".to_string())?;

    if !pending.file_path.is_file() {
        return Err("更新包不存在，请重新检查更新".to_string());
    }

    let _ = app.emit(
        "update-install-start",
        serde_json::json!({ "version": pending.version }),
    );

    #[cfg(target_os = "windows")]
    let result = Command::new("cmd")
        .args(["/C", "start", "", &path_to_string(&pending.file_path)])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&pending.file_path).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&pending.file_path).spawn();

    result.map_err(|error| format!("启动安装包失败: {error}"))?;
    app.exit(0);
    Ok(())
}
