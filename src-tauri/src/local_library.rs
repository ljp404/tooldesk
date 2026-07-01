use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalLibraryConfig {
    enabled: bool,
    extensions: Vec<String>,
    #[serde(default)]
    icon: Option<String>,
    keyword: String,
    name: String,
    open_with: String,
    path: String,
    #[serde(default)]
    typora_path: Option<String>,
    #[serde(default)]
    vault_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalLibrarySettings {
    libraries: Vec<LocalLibraryConfig>,
    max_files_to_scan: usize,
    max_results: usize,
    search_content: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalLibrarySearchResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    file_name: String,
    file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    matched_keyword: Option<String>,
    modified_time: u128,
    relative_path: String,
}

#[derive(Debug)]
struct ScannedFile {
    modified_time: u128,
    path: PathBuf,
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn relative_path(base: &Path, file: &Path) -> String {
    file.strip_prefix(base)
        .map(path_to_string)
        .unwrap_or_else(|_| path_to_string(file))
}

fn modified_time_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn normalize_extensions(extensions: &[String]) -> Vec<String> {
    extensions
        .iter()
        .map(|item| item.trim().to_lowercase())
        .filter(|item| !item.is_empty())
        .map(|item| {
            if item.starts_with('.') {
                item
            } else {
                format!(".{item}")
            }
        })
        .collect()
}

fn scan_directory(
    dir: &Path,
    extensions: &[String],
    max_files: usize,
    results: &mut Vec<ScannedFile>,
) {
    if results.len() >= max_files {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        if results.len() >= max_files {
            break;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') || name == "node_modules" {
            continue;
        }

        if path.is_dir() {
            scan_directory(&path, extensions, max_files, results);
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
            .unwrap_or_default();

        if extensions.contains(&ext) {
            results.push(ScannedFile {
                modified_time: modified_time_ms(&path),
                path,
            });
        }
    }
}

fn file_result(file: &ScannedFile, base_path: &Path) -> LocalLibrarySearchResult {
    LocalLibrarySearchResult {
        content: None,
        file_name: file_name(&file.path),
        file_path: path_to_string(&file.path),
        line: None,
        matched_keyword: None,
        modified_time: file.modified_time,
        relative_path: relative_path(base_path, &file.path),
    }
}

fn search_file_names(
    files: &[ScannedFile],
    keyword: &str,
    base_path: &Path,
    max_results: usize,
) -> Vec<LocalLibrarySearchResult> {
    let lower_keyword = keyword.to_lowercase();
    let mut results = Vec::new();

    for file in files {
        if results.len() >= max_results {
            break;
        }

        if file_name(&file.path)
            .to_lowercase()
            .contains(&lower_keyword)
        {
            results.push(file_result(file, base_path));
        }
    }

    results
}

fn previous_char_boundary(value: &str, index: usize) -> usize {
    let mut boundary = index.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

fn next_char_boundary(value: &str, index: usize) -> usize {
    let mut boundary = index.min(value.len());
    while boundary < value.len() && !value.is_char_boundary(boundary) {
        boundary += 1;
    }
    boundary
}

fn matched_line_snippet(line: &str, match_index: usize, keyword_len: usize) -> String {
    let raw_start = match_index.saturating_sub(50);
    let raw_end = match_index
        .saturating_add(keyword_len)
        .saturating_add(50)
        .min(line.len());
    let start = previous_char_boundary(line, raw_start);
    let end = next_char_boundary(line, raw_end).max(start);
    let mut snippet = line[start..end].trim().to_string();

    if start > 0 {
        snippet = format!("...{snippet}");
    }
    if end < line.len() {
        snippet.push_str("...");
    }

    snippet
}

fn search_contents(
    files: &[ScannedFile],
    keyword: &str,
    base_path: &Path,
    max_results: usize,
) -> Vec<LocalLibrarySearchResult> {
    let lower_keyword = keyword.to_lowercase();
    let mut results = Vec::new();

    for file in files {
        if results.len() >= max_results {
            break;
        }

        let Ok(content) = fs::read_to_string(&file.path) else {
            continue;
        };

        for (index, line) in content.lines().enumerate() {
            if results.len() >= max_results {
                break;
            }

            let lower_line = line.to_lowercase();
            let Some(match_index) = lower_line.find(&lower_keyword) else {
                continue;
            };
            let snippet = matched_line_snippet(line, match_index, keyword.len());

            results.push(LocalLibrarySearchResult {
                content: Some(snippet),
                file_name: file_name(&file.path),
                file_path: path_to_string(&file.path),
                line: Some(index + 1),
                matched_keyword: Some(keyword.to_string()),
                modified_time: file.modified_time,
                relative_path: relative_path(base_path, &file.path),
            });
            break;
        }
    }

    results
}

fn find_library<'a>(
    settings: &'a LocalLibrarySettings,
    keyword: &str,
) -> Option<&'a LocalLibraryConfig> {
    settings
        .libraries
        .iter()
        .find(|library| library.enabled && library.keyword == keyword)
}

#[tauri::command]
pub(crate) fn get_local_libraries(settings: LocalLibrarySettings) -> Vec<LocalLibraryConfig> {
    settings
        .libraries
        .into_iter()
        .filter(|library| library.enabled)
        .collect()
}

#[tauri::command]
pub(crate) fn search_local_library(
    settings: LocalLibrarySettings,
    library_keyword: String,
    search_keyword: String,
) -> Vec<LocalLibrarySearchResult> {
    let Some(library) = find_library(&settings, &library_keyword) else {
        return Vec::new();
    };
    let base_path = PathBuf::from(&library.path);

    if !base_path.exists() {
        return Vec::new();
    }

    let extensions = normalize_extensions(&library.extensions);
    let max_files = settings.max_files_to_scan.max(1);
    let max_results = settings.max_results.max(1);
    let mut files = Vec::new();
    scan_directory(&base_path, &extensions, max_files, &mut files);
    files.sort_by_key(|file| Reverse(file.modified_time));

    let keyword = search_keyword.trim();
    if keyword.is_empty() {
        return files
            .iter()
            .take(max_results)
            .map(|file| file_result(file, &base_path))
            .collect();
    }

    let mut results = search_file_names(&files, keyword, &base_path, max_results);
    if settings.search_content && results.len() < max_results {
        results.extend(search_contents(
            &files,
            keyword,
            &base_path,
            max_results - results.len(),
        ));
    }

    results
}

fn spawn_detached(command_name: &str, args: &[String]) -> Result<(), String> {
    let mut command = Command::new(command_name);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut command);
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn open_local_library_file(
    settings: LocalLibrarySettings,
    file_path: String,
    library_keyword: String,
    line: Option<usize>,
) -> Result<Option<String>, String> {
    let library =
        find_library(&settings, &library_keyword).ok_or_else(|| "库不存在".to_string())?;
    let file_path = PathBuf::from(file_path.trim());

    if !file_path.is_file() {
        return Err("文件不存在".to_string());
    }

    match library.open_with.as_str() {
        "vscode" => {
            let target = line
                .filter(|value| *value > 0)
                .map(|value| format!("{}:{value}:1", path_to_string(&file_path)))
                .unwrap_or_else(|| path_to_string(&file_path));
            spawn_detached("code", &["--goto".to_string(), target])?;
            Ok(None)
        }
        "typora" => {
            if let Some(typora_path) = library
                .typora_path
                .as_deref()
                .filter(|value| !value.trim().is_empty() && PathBuf::from(value).is_file())
            {
                spawn_detached(typora_path, &[path_to_string(&file_path)])?;
                Ok(None)
            } else {
                Ok(Some(path_to_string(&file_path)))
            }
        }
        _ => Ok(Some(path_to_string(&file_path))),
    }
}

#[cfg(test)]
mod tests {
    use super::matched_line_snippet;

    #[test]
    fn matched_line_snippet_keeps_chinese_char_boundaries() {
        let line = "中文内容用于测试字符串边界，继续补充一些内容，接下来搜索关键字，再继续补充一些内容用于触发截断。";
        let match_index = line.find("关键字").expect("keyword should exist");

        let snippet = matched_line_snippet(line, match_index, "关键字".len());

        assert!(snippet.contains("关键字"));
    }

    #[test]
    fn matched_line_snippet_does_not_panic_when_context_starts_inside_multibyte_char() {
        let line = "前置内容内容内容内容内容内容内容内容内容内容接下来搜索关键字，后续内容内容内容内容内容内容内容内容内容内容。";
        let match_index = line.find("关键字").expect("keyword should exist");

        let snippet = matched_line_snippet(line, match_index, "关键字".len());

        assert!(snippet.starts_with("..."));
        assert!(snippet.contains("关键字"));
    }
}
