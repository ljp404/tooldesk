use crate::diagnostics::log_flow;
use crate::storage::StorageRuntimeState;
use crate::{quick_tool, screenshot};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

const QUICK_LAUNCHER_ID: &str = "quickLauncher";
const SCREEN_RECORDER_ID: &str = "screenRecorder";
const SCREENSHOT_ID: &str = "screenshot";
const SUPER_CLIPBOARD_ID: &str = "superClipboard";
const DEFAULT_QUICK_LAUNCHER_ACCELERATOR: &str = "Ctrl+Alt+Space";
const DEFAULT_SCREEN_RECORDER_ACCELERATOR: &str = "Ctrl+Shift+R";
const DEFAULT_SCREENSHOT_ACCELERATOR: &str = "Ctrl+Shift+A";
const DEFAULT_SUPER_CLIPBOARD_ACCELERATOR: &str = "Ctrl+Alt+V";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalShortcutBinding {
    accelerator: Option<String>,
    enabled: Option<bool>,
    id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlobalShortcutRegistrationResult {
    accelerator: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    id: String,
    registered: bool,
}

#[derive(Default)]
pub(crate) struct GlobalShortcutRuntimeState {
    last_accelerators: Mutex<HashMap<String, String>>,
    suspended: Mutex<bool>,
}

fn normalize_accelerator(value: &str) -> String {
    value
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| match part {
            "Control" => "Ctrl".to_string(),
            "CommandOrControl" if cfg!(target_os = "macos") => "Command".to_string(),
            "CommandOrControl" => "Ctrl".to_string(),
            "Option" => "Alt".to_string(),
            "Meta" if cfg!(target_os = "macos") => "Command".to_string(),
            "Meta" => "Super".to_string(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn default_accelerator(id: &str) -> &'static str {
    match id {
        SCREEN_RECORDER_ID => DEFAULT_SCREEN_RECORDER_ACCELERATOR,
        SCREENSHOT_ID => DEFAULT_SCREENSHOT_ACCELERATOR,
        SUPER_CLIPBOARD_ID => DEFAULT_SUPER_CLIPBOARD_ACCELERATOR,
        _ => DEFAULT_QUICK_LAUNCHER_ACCELERATOR,
    }
}

fn default_binding(id: &str) -> GlobalShortcutBinding {
    GlobalShortcutBinding {
        accelerator: Some(default_accelerator(id).to_string()),
        enabled: Some(true),
        id: Some(id.to_string()),
    }
}

fn parse_migrated_bindings(settings: Value) -> Vec<GlobalShortcutBinding> {
    let bindings = settings
        .get("globalShortcuts")
        .and_then(|value| value.get("bindings"))
        .cloned()
        .unwrap_or(Value::Null);
    let parsed = serde_json::from_value::<Vec<GlobalShortcutBinding>>(bindings).unwrap_or_default();

    [
        QUICK_LAUNCHER_ID,
        SCREENSHOT_ID,
        SCREEN_RECORDER_ID,
        SUPER_CLIPBOARD_ID,
    ]
    .into_iter()
    .map(|id| {
        parsed
            .iter()
            .find(|binding| binding.id.as_deref() == Some(id))
            .cloned()
            .unwrap_or_else(|| default_binding(id))
    })
    .collect()
}

fn lock_error() -> String {
    "快捷键状态不可用".to_string()
}

fn unregister_current_shortcuts(
    app: &AppHandle,
    state: &GlobalShortcutRuntimeState,
) -> Result<(), String> {
    let mut last_accelerators = state.last_accelerators.lock().map_err(|_| lock_error())?;

    for accelerator in last_accelerators
        .drain()
        .map(|(_, accelerator)| accelerator)
    {
        if let Err(error) = app.global_shortcut().unregister(accelerator.as_str()) {
            eprintln!("[tauri-shortcut] unregister failed: {error}");
        }
    }

    Ok(())
}

fn open_shortcut_target(app: &AppHandle, id: &str) {
    log_flow("shortcut", format!("trigger id={id}"));
    match id {
        SCREENSHOT_ID => {
            let runtime = app.state::<StorageRuntimeState>();
            match screenshot::open_screenshot_selection_window(app.clone(), &runtime) {
                Ok(value) => log_flow("shortcut", format!("screenshot open result={value}")),
                Err(error) => log_flow("shortcut", format!("screenshot open failed error={error}")),
            }
        }
        SCREEN_RECORDER_ID => {
            let runtime = app.state::<StorageRuntimeState>();
            let shortcut_content = app.state::<quick_tool::ShortcutContentState>();
            let _ = quick_tool::open_named_quick_tool_with_options(
                app,
                &runtime,
                &shortcut_content,
                "screen-recorder".to_string(),
                String::new(),
                quick_tool::QuickToolWindowOptions {
                    anchor_rect: None,
                    compact: true,
                    force_new: true,
                },
            );
        }
        SUPER_CLIPBOARD_ID => {
            let runtime = app.state::<StorageRuntimeState>();
            let shortcut_content = app.state::<quick_tool::ShortcutContentState>();
            let _ = quick_tool::open_named_quick_tool(
                app,
                &runtime,
                &shortcut_content,
                "super-clipboard".to_string(),
                String::new(),
                false,
            );
        }
        _ => {
            quick_tool::open_quick_launcher(app);
            log_flow("shortcut", "quickLauncher open call finished");
        }
    }
}

fn register_shortcut(
    app: &AppHandle,
    state: &GlobalShortcutRuntimeState,
    id: String,
    accelerator: String,
) -> GlobalShortcutRegistrationResult {
    let shortcut_accelerator = accelerator.clone();
    let shortcut_id = id.clone();
    let registration = app.global_shortcut().on_shortcut(
        shortcut_accelerator.as_str(),
        move |app, _shortcut: &Shortcut, event: ShortcutEvent| {
            if event.state == ShortcutState::Pressed {
                open_shortcut_target(app, &shortcut_id);
            }
        },
    );

    match registration {
        Ok(()) => {
            log_flow(
                "shortcut",
                format!("register ok id={id} accelerator={accelerator}"),
            );
            if let Ok(mut last_accelerators) = state.last_accelerators.lock() {
                last_accelerators.insert(id.clone(), accelerator.clone());
            }

            GlobalShortcutRegistrationResult {
                accelerator,
                error: None,
                id,
                registered: true,
            }
        }
        Err(error) => {
            log_flow(
                "shortcut",
                format!("register failed id={id} accelerator={accelerator} error={error}"),
            );
            GlobalShortcutRegistrationResult {
                accelerator,
                error: Some(format!(
                    "快捷键注册失败，可能已被系统或其他应用占用: {error}"
                )),
                id,
                registered: false,
            }
        }
    }
}

#[tauri::command]
pub(crate) fn sync_global_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, GlobalShortcutRuntimeState>,
    settings: Value,
) -> Result<Vec<GlobalShortcutRegistrationResult>, String> {
    unregister_current_shortcuts(&app, &state)?;

    if *state.suspended.lock().map_err(|_| lock_error())? {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();

    let screenshot_enabled = settings
        .get("screenshot")
        .and_then(|value| value.get("enabled"))
        .and_then(|value| value.as_bool())
        .unwrap_or(true);

    for binding in parse_migrated_bindings(settings) {
        let id = binding.id.unwrap_or_else(|| QUICK_LAUNCHER_ID.to_string());
        let accelerator = normalize_accelerator(
            binding
                .accelerator
                .as_deref()
                .unwrap_or(default_accelerator(&id)),
        );

        if !binding.enabled.unwrap_or(true)
            || accelerator.is_empty()
            || (id == SCREENSHOT_ID && !screenshot_enabled)
        {
            results.push(GlobalShortcutRegistrationResult {
                accelerator,
                error: None,
                id,
                registered: false,
            });
            continue;
        }

        results.push(register_shortcut(&app, &state, id, accelerator));
    }

    Ok(results)
}

#[tauri::command]
pub(crate) fn suspend_global_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, GlobalShortcutRuntimeState>,
) -> Result<serde_json::Value, String> {
    {
        let mut suspended = state.suspended.lock().map_err(|_| lock_error())?;
        *suspended = true;
    }

    unregister_current_shortcuts(&app, &state)?;
    Ok(serde_json::json!({ "suspended": true }))
}

#[tauri::command]
pub(crate) fn resume_global_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, GlobalShortcutRuntimeState>,
    settings: Value,
) -> Result<serde_json::Value, String> {
    {
        let mut suspended = state.suspended.lock().map_err(|_| lock_error())?;
        *suspended = false;
    }

    let results = sync_global_shortcuts(app, state, settings)?;
    Ok(serde_json::json!({
        "registered": results.iter().any(|result| result.registered),
        "results": results
    }))
}
