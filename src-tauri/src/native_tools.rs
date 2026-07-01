use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

use crate::storage::StorageRuntimeState;

#[cfg(target_os = "windows")]
use std::os::windows::ffi::{OsStrExt, OsStringExt};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginNativeToolRequest {
    args: Option<Vec<String>>,
    cwd: Option<String>,
    plugin_id: String,
    tool: String,
}

struct ResolvedNativeToolCommand {
    args: Vec<String>,
    tool_path: PathBuf,
    working_dir: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginNativeToolResult {
    exit_code: i32,
    ok: bool,
    stderr: String,
    stdout: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    native_tools: Option<HashMap<String, String>>,
}

fn sanitize_plugin_id(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() || matches!(item, '-' | '_' | '.') {
                item
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '_', '.'])
        .to_string()
}

fn is_inside_directory(root: &Path, target: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let Ok(target) = target.canonicalize() else {
        return false;
    };

    target.starts_with(root)
}

#[cfg(target_os = "windows")]
fn get_short_path(path: &Path) -> Option<PathBuf> {
    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let required = unsafe { GetShortPathNameW(wide.as_ptr(), std::ptr::null_mut(), 0) };
    if required == 0 {
        return None;
    }

    let mut buffer = vec![0u16; required as usize + 1];
    let length =
        unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };
    if length == 0 {
        return None;
    }

    buffer.truncate(length as usize);
    Some(PathBuf::from(std::ffi::OsString::from_wide(&buffer)))
}

#[cfg(target_os = "windows")]
fn normalize_native_tool_arg(arg: String) -> String {
    if !arg.contains('\\') && !arg.contains('/') {
        return arg;
    }

    let path = PathBuf::from(&arg);
    if path.exists() {
        return get_short_path(&path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
    }

    let Some(parent) = path.parent() else {
        return arg;
    };
    if !parent.exists() {
        return arg;
    }

    let Some(file_name) = path.file_name() else {
        return arg;
    };
    let parent = get_short_path(parent).unwrap_or_else(|| parent.to_path_buf());
    parent.join(file_name).to_string_lossy().to_string()
}

#[cfg(not(target_os = "windows"))]
fn normalize_native_tool_arg(arg: String) -> String {
    arg
}

fn plugin_root(runtime: &StorageRuntimeState, plugin_id: &str) -> Result<PathBuf, String> {
    let plugin_id = sanitize_plugin_id(plugin_id);
    if plugin_id.is_empty() {
        return Err("插件标识无效".to_string());
    }

    let root = runtime.data_dir.join("plugins").join(plugin_id);
    if root.join("plugin.json").is_file() {
        return Ok(root);
    }

    Err("插件未安装或插件包不完整".to_string())
}

fn read_native_tools(root: &Path) -> Result<HashMap<String, String>, String> {
    let raw = fs::read_to_string(root.join("plugin.json")).map_err(|error| error.to_string())?;
    let manifest: PluginManifest = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    Ok(manifest.native_tools.unwrap_or_default())
}

fn resolve_tool_path(root: &Path, tool: &str) -> Result<PathBuf, String> {
    let tool_name = tool.trim();
    if !tool_name
        .chars()
        .all(|item| item.is_ascii_alphanumeric() || matches!(item, '-' | '_' | '.'))
    {
        return Err("工具名称无效".to_string());
    }

    let tools = read_native_tools(root)?;
    let relative_path = tools
        .get(tool_name)
        .ok_or_else(|| format!("插件未声明 nativeTools.{tool_name}"))?;
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.is_empty() || normalized.starts_with('/') || normalized.contains("..") {
        return Err(format!("nativeTools.{tool_name} 路径无效"));
    }

    let tool_path = root.join(normalized);
    if !tool_path.is_file() {
        return Err(format!("插件包不完整，缺少工具：{tool_name}"));
    }
    if !is_inside_directory(root, &tool_path) {
        return Err("工具路径越界".to_string());
    }

    Ok(tool_path)
}

fn resolve_native_tool_command(
    payload: PluginNativeToolRequest,
    runtime: &StorageRuntimeState,
) -> Result<ResolvedNativeToolCommand, String> {
    let root = plugin_root(runtime, &payload.plugin_id)?;
    let tool_path = resolve_tool_path(&root, &payload.tool)?;
    let working_dir = match payload.cwd {
        Some(value) if !value.trim().is_empty() => {
            let directory = PathBuf::from(value.trim());
            if !directory.is_dir() {
                return Err("工作目录不存在".to_string());
            }
            directory
        }
        _ => tool_path.parent().unwrap_or(&root).to_path_buf(),
    };

    Ok(ResolvedNativeToolCommand {
        args: payload
            .args
            .unwrap_or_default()
            .into_iter()
            .map(normalize_native_tool_arg)
            .collect(),
        tool_path,
        working_dir,
    })
}

#[tauri::command]
pub(crate) async fn run_plugin_tool(
    payload: PluginNativeToolRequest,
    runtime: State<'_, StorageRuntimeState>,
) -> Result<PluginNativeToolResult, String> {
    let command = resolve_native_tool_command(payload, &runtime)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new(&command.tool_path)
            .args(command.args)
            .current_dir(command.working_dir)
            .output()
            .map_err(|error| format!("执行插件工具失败：{error}"))?;

        Ok(PluginNativeToolResult {
            exit_code: output.status.code().unwrap_or(-1),
            ok: output.status.success(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        })
    })
    .await
    .map_err(|error| format!("执行插件工具失败：{error}"))?
}
