use keepass::{
    db::{fields, EntryRef, GroupRef},
    Database, DatabaseKey,
};
use serde::Serialize;
use std::fs::File;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeePassEntry {
    uuid: String,
    title: String,
    username: String,
    url: String,
    notes: String,
    group: String,
    password: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified_time: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeePassUnlockResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    db_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entries: Option<Vec<KeePassEntry>>,
}

#[derive(Clone, Debug)]
struct KeePassSession {
    db_path: String,
    entries: Vec<KeePassEntry>,
}

#[derive(Default)]
pub(crate) struct KeePassSessionState {
    session: Mutex<Option<KeePassSession>>,
}

fn normalize_db_path(db_path: &str) -> String {
    PathBuf::from(db_path.trim()).to_string_lossy().to_string()
}

fn empty_unlock_result(message: impl Into<String>) -> KeePassUnlockResult {
    KeePassUnlockResult {
        success: false,
        error: Some(message.into()),
        db_path: None,
        entries: None,
    }
}

fn entry_field(entry: &EntryRef<'_>, field: &str) -> String {
    entry.get(field).unwrap_or_default().to_string()
}

fn collect_group_entries(group: GroupRef<'_>, parent_path: &str, entries: &mut Vec<KeePassEntry>) {
    let group_path = if parent_path.is_empty() {
        group.name.clone()
    } else {
        format!("{parent_path}/{}", group.name)
    };

    let is_recycle_bin = group_path
        .split('/')
        .any(|part| part.eq_ignore_ascii_case("Recycle Bin"));

    if !is_recycle_bin {
        for entry in group.entries() {
            let title = entry_field(&entry, fields::TITLE);

            if title.eq_ignore_ascii_case("Recycle Bin") {
                continue;
            }

            entries.push(KeePassEntry {
                uuid: entry.id().to_string(),
                title,
                username: entry_field(&entry, fields::USERNAME),
                url: entry_field(&entry, fields::URL),
                notes: entry_field(&entry, fields::NOTES),
                group: group_path.clone(),
                password: entry_field(&entry, fields::PASSWORD),
                modified_time: entry
                    .times
                    .last_modification
                    .map(|value| value.and_utc().timestamp_millis()),
            });
        }
    }

    for child in group.groups() {
        collect_group_entries(child, &group_path, entries);
    }
}

fn load_entries_from_database(db_path: &str, password: &str) -> Result<Vec<KeePassEntry>, String> {
    let mut source = File::open(db_path).map_err(|error| format!("无法打开数据库文件: {error}"))?;
    let key = DatabaseKey::new().with_password(password);
    let db =
        Database::open(&mut source, key).map_err(|error| format!("密码错误或文件损坏: {error}"))?;
    let mut entries = Vec::new();

    collect_group_entries(db.root(), "", &mut entries);

    entries.sort_by(|left, right| {
        left.group
            .cmp(&right.group)
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.username.cmp(&right.username))
    });

    Ok(entries)
}

#[tauri::command]
pub(crate) async fn unlock_keepass_database(
    state: State<'_, KeePassSessionState>,
    db_path: String,
    password: String,
) -> Result<KeePassUnlockResult, String> {
    let normalized_path = normalize_db_path(&db_path);

    if normalized_path.is_empty() {
        return Ok(empty_unlock_result("请选择数据库文件"));
    }

    {
        let session = state
            .session
            .lock()
            .map_err(|_| "KeePass 会话状态不可用".to_string())?;

        if let Some(active_session) = session.as_ref() {
            if active_session.db_path == normalized_path {
                return Ok(KeePassUnlockResult {
                    success: true,
                    error: None,
                    db_path: Some(active_session.db_path.clone()),
                    entries: Some(active_session.entries.clone()),
                });
            }
        }
    }

    let entries = match load_entries_from_database(&normalized_path, &password) {
        Ok(value) => value,
        Err(error) => {
            return Ok(KeePassUnlockResult {
                success: false,
                error: Some(format!("解锁失败: {error}")),
                db_path: None,
                entries: None,
            });
        }
    };

    let next_session = KeePassSession {
        db_path: normalized_path.clone(),
        entries: entries.clone(),
    };
    let mut session = state
        .session
        .lock()
        .map_err(|_| "KeePass 会话状态不可用".to_string())?;
    *session = Some(next_session);

    Ok(KeePassUnlockResult {
        success: true,
        error: None,
        db_path: Some(normalized_path),
        entries: Some(entries),
    })
}

#[tauri::command]
pub(crate) fn get_keepass_session(
    state: State<'_, KeePassSessionState>,
    db_path: Option<String>,
) -> Result<KeePassUnlockResult, String> {
    let normalized_path = db_path.as_deref().map(normalize_db_path);
    let session = state
        .session
        .lock()
        .map_err(|_| "KeePass 会话状态不可用".to_string())?;

    if let Some(active_session) = session.as_ref() {
        if normalized_path
            .as_ref()
            .is_none_or(|path| path == &active_session.db_path)
        {
            return Ok(KeePassUnlockResult {
                success: true,
                error: None,
                db_path: Some(active_session.db_path.clone()),
                entries: Some(active_session.entries.clone()),
            });
        }
    }

    Ok(KeePassUnlockResult {
        success: false,
        error: None,
        db_path: None,
        entries: None,
    })
}

#[tauri::command]
pub(crate) fn lock_keepass_database(
    state: State<'_, KeePassSessionState>,
) -> Result<serde_json::Value, String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "KeePass 会话状态不可用".to_string())?;
    *session = None;
    Ok(serde_json::json!({ "success": true }))
}
