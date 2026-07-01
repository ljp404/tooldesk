use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::storage::StorageRuntimeState;

#[derive(Debug, Default)]
pub(crate) struct TextExportState(Mutex<HashMap<String, TextExportSession>>);

#[derive(Debug)]
struct TextExportSession {
    file_path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextExportResult {
    export_id: String,
    file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextExportPathResult {
    file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostsFileResult {
    content: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostsWriteResult {
    path: String,
    saved_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostsUpdateResult {
    backup_path: String,
    domain: String,
    ip: String,
    path: String,
    saved_at: String,
    updated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncManifestItem {
    classification: String,
    description: String,
    exists: bool,
    id: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    relative_path: Option<String>,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

#[derive(Debug)]
struct PathStats {
    exists: bool,
    size: u64,
    updated_at: Option<String>,
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn now_millis() -> Result<u128, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis())
}

fn now_text() -> Result<String, String> {
    Ok(now_millis()?.to_string())
}

fn sanitize_file_name(value: Option<String>) -> String {
    let mut name = value
        .unwrap_or_else(|| "line-extract-result.txt".to_string())
        .trim()
        .chars()
        .map(|item| {
            if matches!(item, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || item.is_control()
            {
                '-'
            } else {
                item
            }
        })
        .collect::<String>();

    name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    name.truncate(120);

    if name.is_empty() {
        name = "line-extract-result".to_string();
    }

    if name.ends_with(".txt") {
        name
    } else {
        format!("{name}.txt")
    }
}

fn get_hosts_path() -> PathBuf {
    #[cfg(windows)]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        PathBuf::from(system_root)
            .join("System32")
            .join("drivers")
            .join("etc")
            .join("hosts")
    }

    #[cfg(not(windows))]
    {
        PathBuf::from("/etc/hosts")
    }
}

fn normalize_hosts_domain(value: &str) -> String {
    let value = value.trim().to_lowercase();
    let value = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
        .unwrap_or(&value);

    value
        .split('/')
        .next()
        .unwrap_or("")
        .chars()
        .filter(|item| !item.is_whitespace())
        .collect()
}

fn is_valid_hosts_ip(value: &str) -> bool {
    let trimmed = value.trim();

    if trimmed.split('.').count() == 4 {
        return trimmed
            .split('.')
            .all(|part| part.parse::<u8>().map(|_| true).unwrap_or(false));
    }

    trimmed.contains(':')
        && trimmed
            .chars()
            .all(|item| item.is_ascii_hexdigit() || item == ':')
}

fn create_hosts_backup_name() -> Result<String, String> {
    Ok(format!("hosts.{}.bak", now_millis()?))
}

fn file_error(action: &str, error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => {
            format!("{action}失败：当前没有管理员权限，请用管理员身份运行 tooldesk 后重试。")
        }
        _ => format!("{action}失败：{error}"),
    }
}

#[tauri::command]
pub(crate) fn open_path(target_path: String) -> Result<(), String> {
    let trimmed = target_path.trim();

    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }

    let path = PathBuf::from(trimmed);

    if !path.exists() {
        return Err("路径不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|error| file_error("打开路径", error))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| file_error("打开路径", error))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|error| file_error("打开路径", error))?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn read_text_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(file_path.trim()).map_err(|error| file_error("读取文件", error))
}

#[tauri::command]
pub(crate) fn read_binary_file(file_path: String) -> Result<Vec<u8>, String> {
    fs::read(file_path.trim()).map_err(|error| file_error("读取文件", error))
}

#[tauri::command]
pub(crate) fn write_binary_file(file_path: String, content: Vec<u8>) -> Result<String, String> {
    let file_path = PathBuf::from(file_path.trim());

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| file_error("创建目录", error))?;
    }

    fs::write(&file_path, content).map_err(|error| file_error("写入文件", error))?;
    Ok(path_to_string(&file_path))
}

#[tauri::command]
pub(crate) fn remove_file(file_path: String) -> Result<bool, String> {
    let file_path = PathBuf::from(file_path.trim());

    if !file_path.exists() {
        return Ok(false);
    }

    fs::remove_file(&file_path).map_err(|error| file_error("删除文件", error))?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn write_text_file(file_path: String, content: String) -> Result<String, String> {
    let file_path = PathBuf::from(file_path.trim());

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| file_error("创建目录", error))?;
    }

    fs::write(&file_path, content).map_err(|error| file_error("写入文件", error))?;
    Ok(path_to_string(&file_path))
}

#[tauri::command]
pub(crate) fn create_text_export(
    state: tauri::State<'_, TextExportState>,
    suggested_name: Option<String>,
) -> Result<TextExportResult, String> {
    let export_id = format!("export-{}", now_millis()?);
    let directory = std::env::temp_dir().join("tooldesk-exports");
    let file_name = format!("{}-{}", now_millis()?, sanitize_file_name(suggested_name));
    let file_path = directory.join(file_name);

    fs::create_dir_all(&directory).map_err(|error| file_error("创建导出目录", error))?;
    fs::write(&file_path, "").map_err(|error| file_error("创建导出文件", error))?;

    let mut sessions = state
        .0
        .lock()
        .map_err(|_| "导出会话状态不可用。".to_string())?;
    sessions.insert(
        export_id.clone(),
        TextExportSession {
            file_path: file_path.clone(),
        },
    );

    Ok(TextExportResult {
        export_id,
        file_path: path_to_string(&file_path),
    })
}

#[tauri::command]
pub(crate) fn append_text_export(
    state: tauri::State<'_, TextExportState>,
    export_id: String,
    chunk: String,
) -> Result<TextExportPathResult, String> {
    let sessions = state
        .0
        .lock()
        .map_err(|_| "导出会话状态不可用。".to_string())?;
    let session = sessions
        .get(export_id.trim())
        .ok_or_else(|| "导出会话不存在".to_string())?;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&session.file_path)
        .map_err(|error| file_error("写入导出文件", error))?;

    file.write_all(chunk.as_bytes())
        .map_err(|error| file_error("写入导出文件", error))?;

    Ok(TextExportPathResult {
        file_path: path_to_string(&session.file_path),
    })
}

#[tauri::command]
pub(crate) fn finish_text_export(
    state: tauri::State<'_, TextExportState>,
    export_id: String,
) -> Result<TextExportPathResult, String> {
    let mut sessions = state
        .0
        .lock()
        .map_err(|_| "导出会话状态不可用。".to_string())?;
    let session = sessions
        .remove(export_id.trim())
        .ok_or_else(|| "导出会话不存在".to_string())?;

    Ok(TextExportPathResult {
        file_path: path_to_string(&session.file_path),
    })
}

#[tauri::command]
pub(crate) fn get_hosts_folder() -> Result<String, String> {
    get_hosts_path()
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| "hosts 目录不存在。".to_string())
}

#[tauri::command]
pub(crate) fn read_hosts_file() -> Result<HostsFileResult, String> {
    let file_path = get_hosts_path();
    let content =
        fs::read_to_string(&file_path).map_err(|error| file_error("读取 hosts", error))?;

    Ok(HostsFileResult {
        content,
        path: path_to_string(&file_path),
    })
}

#[tauri::command]
pub(crate) fn write_hosts_file(content: String) -> Result<HostsWriteResult, String> {
    let file_path = get_hosts_path();
    fs::write(&file_path, content).map_err(|error| file_error("保存 hosts", error))?;

    Ok(HostsWriteResult {
        path: path_to_string(&file_path),
        saved_at: now_text()?,
    })
}

#[tauri::command]
pub(crate) fn update_hosts_entry(domain: String, ip: String) -> Result<HostsUpdateResult, String> {
    let file_path = get_hosts_path();
    let domain = normalize_hosts_domain(&domain);
    let ip = ip.trim().to_string();

    if domain.is_empty() || domain.contains('#') {
        return Err("更新 hosts 失败：域名无效。".to_string());
    }

    if !is_valid_hosts_ip(&ip) {
        return Err("更新 hosts 失败：IP 地址无效。".to_string());
    }

    let content =
        fs::read_to_string(&file_path).map_err(|error| file_error("读取 hosts", error))?;
    let backup_path = file_path.with_file_name(create_hosts_backup_name()?);
    fs::copy(&file_path, &backup_path).map_err(|error| file_error("备份 hosts", error))?;

    let has_trailing_line_break = content.ends_with('\n');
    let line_break = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let lines = content
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line).to_string())
        .collect::<Vec<_>>();
    let effective_lines = if has_trailing_line_break && !lines.is_empty() {
        &lines[..lines.len() - 1]
    } else {
        &lines[..]
    };
    let mut updated = false;
    let mut next_lines = Vec::with_capacity(effective_lines.len() + 1);

    for line in effective_lines {
        let comment_index = line.find('#');
        let mapping = comment_index.map(|index| &line[..index]).unwrap_or(line);
        let comment = comment_index.map(|index| &line[index..]).unwrap_or("");
        let columns = mapping.split_whitespace().collect::<Vec<_>>();

        if columns.len() < 2 {
            next_lines.push(line.clone());
            continue;
        }

        let domains = &columns[1..];
        if !domains.iter().any(|item| item.to_lowercase() == domain) {
            next_lines.push(line.clone());
            continue;
        }

        updated = true;
        let suffix = if comment.is_empty() {
            String::new()
        } else {
            format!(" {}", comment.trim_start())
        };
        next_lines.push(format!("{ip} {}{suffix}", domains.join(" ")));
    }

    if !updated {
        next_lines.push(format!("{ip} {domain}"));
    }

    fs::write(
        &file_path,
        format!("{}{}", next_lines.join(line_break), line_break),
    )
    .map_err(|error| file_error("更新 hosts", error))?;

    Ok(HostsUpdateResult {
        backup_path: path_to_string(&backup_path),
        domain,
        ip,
        path: path_to_string(&file_path),
        saved_at: now_text()?,
        updated,
    })
}

fn system_time_to_text(value: SystemTime) -> Option<String> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().to_string())
}

fn pick_latest_time(current: Option<String>, next: Option<String>) -> Option<String> {
    match (current, next) {
        (Some(current), Some(next)) => {
            if next.parse::<u128>().unwrap_or(0) > current.parse::<u128>().unwrap_or(0) {
                Some(next)
            } else {
                Some(current)
            }
        }
        (Some(current), None) => Some(current),
        (None, Some(next)) => Some(next),
        (None, None) => None,
    }
}

fn recursive_path_stats(path: &Path) -> PathStats {
    let Ok(metadata) = fs::metadata(path) else {
        return PathStats {
            exists: false,
            size: 0,
            updated_at: None,
        };
    };
    let updated_at = metadata.modified().ok().and_then(system_time_to_text);

    if metadata.is_file() {
        return PathStats {
            exists: true,
            size: metadata.len(),
            updated_at,
        };
    }

    let Ok(entries) = fs::read_dir(path) else {
        return PathStats {
            exists: true,
            size: 0,
            updated_at,
        };
    };
    let mut summary = PathStats {
        exists: true,
        size: 0,
        updated_at,
    };

    for entry in entries.filter_map(Result::ok) {
        let stats = recursive_path_stats(&entry.path());
        summary.size += stats.size;
        summary.updated_at = pick_latest_time(summary.updated_at, stats.updated_at);
    }

    summary
}

fn sync_manifest_item(
    runtime: &StorageRuntimeState,
    id: &str,
    label: &str,
    classification: &str,
    description: &str,
    relative_path: Option<&str>,
) -> SyncManifestItem {
    let stats = relative_path
        .map(|value| recursive_path_stats(&runtime.data_dir.join(value)))
        .unwrap_or(PathStats {
            exists: false,
            size: 0,
            updated_at: None,
        });

    SyncManifestItem {
        classification: classification.to_string(),
        description: description.to_string(),
        exists: stats.exists,
        id: id.to_string(),
        label: label.to_string(),
        relative_path: relative_path.map(str::to_string),
        size: stats.size,
        updated_at: stats.updated_at,
    }
}

#[tauri::command]
pub(crate) fn get_sync_manifest(
    runtime: tauri::State<'_, StorageRuntimeState>,
) -> Vec<SyncManifestItem> {
    vec![
        sync_manifest_item(
            &runtime,
            "app-settings",
            "应用设置",
            "syncable",
            "应用通用设置的安全子集，例如快捷键、截图开关、超级剪贴板设置。",
            Some("settings.json"),
        ),
        sync_manifest_item(
            &runtime,
            "installed-plugins",
            "已安装扩展",
            "syncable",
            "已安装扩展的清单信息，仅同步扩展标识和版本，不同步扩展源码。",
            Some("plugins"),
        ),
        sync_manifest_item(
            &runtime,
            "super-clipboard",
            "超级剪贴板记录",
            "local",
            "超级剪贴板记录属于本机隐私数据，默认不参与云端同步。",
            Some("super-clipboard"),
        ),
        sync_manifest_item(
            &runtime,
            "aliyun-token",
            "阿里云盘令牌",
            "sensitive",
            "阿里云盘登录令牌只保存在本机，不参与云端同步。",
            Some("aliyun-token.json"),
        ),
        sync_manifest_item(
            &runtime,
            "secrets",
            "敏感密钥",
            "sensitive",
            "KeePass、OCR、翻译等密钥配置不得明文同步。",
            Some("settings.json"),
        ),
    ]
}
