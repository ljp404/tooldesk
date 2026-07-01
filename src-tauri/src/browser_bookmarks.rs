use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserBookmarkItem {
    browser: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
    domain: String,
    id: String,
    path: Vec<String>,
    profile: String,
    title: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserBookmarkSummary {
    count: usize,
    name: String,
    profiles: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserBookmarksResult {
    browsers: Vec<BrowserBookmarkSummary>,
    items: Vec<BrowserBookmarkItem>,
    scanned_at: String,
}

#[derive(Debug)]
struct BrowserCandidate {
    name: &'static str,
    user_data_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
struct ChromiumBookmarkNode {
    children: Option<Vec<ChromiumBookmarkNode>>,
    date_added: Option<String>,
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "type")]
    node_type: Option<String>,
    url: Option<String>,
}

fn now_text() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().to_string())
        .unwrap_or_default()
}

fn local_app_data_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("USERPROFILE")
                .map(|home| PathBuf::from(home).join("AppData").join("Local"))
                .unwrap_or_else(|_| PathBuf::from(""))
        })
}

fn browser_candidates() -> Vec<BrowserCandidate> {
    let local_app_data = local_app_data_dir();

    vec![
        BrowserCandidate {
            name: "Chrome",
            user_data_dir: local_app_data
                .join("Google")
                .join("Chrome")
                .join("User Data"),
        },
        BrowserCandidate {
            name: "Edge",
            user_data_dir: local_app_data
                .join("Microsoft")
                .join("Edge")
                .join("User Data"),
        },
        BrowserCandidate {
            name: "Brave",
            user_data_dir: local_app_data
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join("User Data"),
        },
        BrowserCandidate {
            name: "Chromium",
            user_data_dir: local_app_data.join("Chromium").join("User Data"),
        },
        BrowserCandidate {
            name: "360 极速浏览器",
            user_data_dir: local_app_data
                .join("360Chrome")
                .join("Chrome")
                .join("User Data"),
        },
        BrowserCandidate {
            name: "360 安全浏览器",
            user_data_dir: local_app_data.join("360se6").join("User Data"),
        },
    ]
}

fn bookmark_file_names() -> [&'static str; 2] {
    ["Bookmarks", "AccountBookmarks"]
}

fn root_label(root_key: &str, fallback: Option<&String>) -> String {
    match root_key {
        "bookmark_bar" => "书签栏".to_string(),
        "other" => "其他书签".to_string(),
        "synced" => "移动设备书签".to_string(),
        _ => fallback.cloned().unwrap_or_else(|| root_key.to_string()),
    }
}

fn has_bookmark_file(profile_dir: &Path) -> bool {
    bookmark_file_names()
        .into_iter()
        .any(|name| profile_dir.join(name).is_file())
}

fn list_profile_dirs(candidate: &BrowserCandidate) -> Vec<String> {
    let Ok(entries) = fs::read_dir(&candidate.user_data_dir) else {
        return Vec::new();
    };
    let mut profiles = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if has_bookmark_file(&entry.path()) {
                Some(name)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    profiles.sort_by(|current, next| {
        if current == "Default" {
            std::cmp::Ordering::Less
        } else if next == "Default" {
            std::cmp::Ordering::Greater
        } else {
            current.cmp(next)
        }
    });
    profiles
}

fn chrome_time_to_text(value: Option<&str>) -> Option<String> {
    value
        .and_then(|item| item.parse::<u128>().ok())
        .filter(|item| *item > 0)
        .map(|microseconds| {
            let epoch_offset_ms = -11_644_473_600_000_i128;
            ((microseconds / 1000) as i128 + epoch_offset_ms).to_string()
        })
}

fn domain_from_url(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_string()
}

fn walk_node(
    browser: &str,
    profile: &str,
    node: &ChromiumBookmarkNode,
    path_parts: &[String],
    items: &mut Vec<BrowserBookmarkItem>,
) {
    if node.node_type.as_deref() == Some("url") {
        if let Some(url) = node.url.as_deref() {
            let title = node
                .name
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(url)
                .to_string();
            items.push(BrowserBookmarkItem {
                browser: browser.to_string(),
                created_at: chrome_time_to_text(node.date_added.as_deref()),
                domain: domain_from_url(url),
                id: format!(
                    "{}:{}:{}:{}",
                    browser,
                    profile,
                    node.id.as_deref().unwrap_or(""),
                    url
                ),
                path: path_parts
                    .iter()
                    .filter(|item| !item.is_empty())
                    .cloned()
                    .collect(),
                profile: profile.to_string(),
                title,
                url: url.to_string(),
            });
        }
        return;
    }

    let mut next_path = path_parts.to_vec();
    if let Some(name) = node.name.as_ref().filter(|value| !value.trim().is_empty()) {
        next_path.push(name.clone());
    }

    for child in node.children.as_deref().unwrap_or_default() {
        walk_node(browser, profile, child, &next_path, items);
    }
}

fn read_profile_bookmarks(candidate: &BrowserCandidate, profile: &str) -> Vec<BrowserBookmarkItem> {
    let mut by_id = HashMap::new();

    for file_name in bookmark_file_names() {
        let file_path = candidate.user_data_dir.join(profile).join(file_name);
        let Ok(content) = fs::read_to_string(file_path) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<Value>(&content) else {
            continue;
        };
        let Some(roots) = data.get("roots").and_then(Value::as_object) else {
            continue;
        };

        for (root_key, root_value) in roots {
            let Ok(root_node) = serde_json::from_value::<ChromiumBookmarkNode>(root_value.clone())
            else {
                continue;
            };
            let mut items = Vec::new();
            walk_node(
                candidate.name,
                profile,
                &root_node,
                &[root_label(root_key, root_node.name.as_ref())],
                &mut items,
            );

            for item in items {
                by_id.insert(item.id.clone(), item);
            }
        }
    }

    by_id.into_values().collect()
}

#[tauri::command]
pub(crate) fn list_browser_bookmarks() -> BrowserBookmarksResult {
    let mut items = Vec::new();
    let mut browsers = Vec::new();

    for candidate in browser_candidates() {
        let profiles = list_profile_dirs(&candidate);
        let mut browser_items = Vec::new();

        for profile in &profiles {
            browser_items.extend(read_profile_bookmarks(&candidate, profile));
        }

        if !profiles.is_empty() || !browser_items.is_empty() {
            browsers.push(BrowserBookmarkSummary {
                count: browser_items.len(),
                name: candidate.name.to_string(),
                profiles,
            });
            items.extend(browser_items);
        }
    }

    items.sort_by(|current, next| current.title.cmp(&next.title));

    BrowserBookmarksResult {
        browsers,
        items,
        scanned_at: now_text(),
    }
}
