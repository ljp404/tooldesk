use crate::diagnostics;
use crate::quick_tool::{self, ShortcutContentState};
use crate::screenshot;
use crate::storage::{self, StorageRuntimeState};
use serde::Serialize;
use serde_json::json;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tokio::time::{sleep, Duration};

const TRAY_MENU_LABEL: &str = "tray-menu";
const TRAY_MENU_WIDTH: f64 = 244.0;
const TRAY_MENU_ESTIMATED_HEIGHT: f64 = 352.0;
const MAIN_WINDOW_DEFAULT_HEIGHT: f64 = 760.0;
const MAIN_WINDOW_DEFAULT_WIDTH: f64 = 1120.0;
const MAIN_WINDOW_MIN_HEIGHT: u32 = 620;
const MAIN_WINDOW_MIN_WIDTH: u32 = 920;

const QUICK_LAUNCHER_ID: &str = "quickLauncher";
const SCREEN_RECORDER_ID: &str = "screenRecorder";
const SCREENSHOT_ID: &str = "screenshot";
const SUPER_CLIPBOARD_ID: &str = "superClipboard";
const DEFAULT_QUICK_LAUNCHER_ACCELERATOR: &str = "Ctrl+Alt+Space";
const DEFAULT_SCREEN_RECORDER_ACCELERATOR: &str = "Ctrl+Shift+R";
const DEFAULT_SCREENSHOT_ACCELERATOR: &str = "Ctrl+Shift+A";
const DEFAULT_SUPER_CLIPBOARD_ACCELERATOR: &str = "Ctrl+Alt+V";

#[derive(Default)]
struct TrayMenuState {
    last_right_click_at: Option<Instant>,
    size: Option<(u32, u32)>,
    target: Option<(f64, f64)>,
}

static TRAY_MENU_STATE: OnceLock<Mutex<TrayMenuState>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrayMenuShortcuts {
    launcher: String,
    record: String,
    screenshot: String,
    super_clipboard: String,
}

fn tray_menu_state() -> &'static Mutex<TrayMenuState> {
    TRAY_MENU_STATE.get_or_init(|| Mutex::new(TrayMenuState::default()))
}

fn shortcut_label(settings: &serde_json::Value, id: &str, fallback: &str) -> String {
    settings
        .get("globalShortcuts")
        .and_then(|value| value.get("bindings"))
        .and_then(|value| value.as_array())
        .and_then(|bindings| {
            bindings
                .iter()
                .find(|binding| binding.get("id").and_then(|value| value.as_str()) == Some(id))
        })
        .map(|binding| {
            if binding
                .get("enabled")
                .and_then(|value| value.as_bool())
                .unwrap_or(true)
            {
                binding
                    .get("accelerator")
                    .and_then(|value| value.as_str())
                    .unwrap_or(fallback)
                    .trim()
                    .to_string()
            } else {
                String::new()
            }
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn read_tray_menu_shortcuts(runtime: &StorageRuntimeState) -> TrayMenuShortcuts {
    let defaults = json!({
        "globalShortcuts": {
            "bindings": [
                { "accelerator": DEFAULT_QUICK_LAUNCHER_ACCELERATOR, "enabled": true, "id": QUICK_LAUNCHER_ID },
                { "accelerator": DEFAULT_SCREENSHOT_ACCELERATOR, "enabled": true, "id": SCREENSHOT_ID },
                { "accelerator": DEFAULT_SCREEN_RECORDER_ACCELERATOR, "enabled": true, "id": SCREEN_RECORDER_ID },
                { "accelerator": DEFAULT_SUPER_CLIPBOARD_ACCELERATOR, "enabled": true, "id": SUPER_CLIPBOARD_ID }
            ]
        }
    });
    let settings = storage::read_app_settings_value(runtime, defaults);

    TrayMenuShortcuts {
        launcher: shortcut_label(
            &settings,
            QUICK_LAUNCHER_ID,
            DEFAULT_QUICK_LAUNCHER_ACCELERATOR,
        ),
        record: shortcut_label(
            &settings,
            SCREEN_RECORDER_ID,
            DEFAULT_SCREEN_RECORDER_ACCELERATOR,
        ),
        screenshot: shortcut_label(&settings, SCREENSHOT_ID, DEFAULT_SCREENSHOT_ACCELERATOR),
        super_clipboard: shortcut_label(
            &settings,
            SUPER_CLIPBOARD_ID,
            DEFAULT_SUPER_CLIPBOARD_ACCELERATOR,
        ),
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        if window
            .inner_size()
            .map(|size| size.width < MAIN_WINDOW_MIN_WIDTH || size.height < MAIN_WINDOW_MIN_HEIGHT)
            .unwrap_or(false)
        {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                MAIN_WINDOW_DEFAULT_WIDTH,
                MAIN_WINDOW_DEFAULT_HEIGHT,
            )));
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn navigate_main_window(app: &AppHandle, target: &str) {
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("app:navigate", target);
    }
}

fn close_tray_menu(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(TRAY_MENU_LABEL) {
        let _ = window.hide();
    }
}

fn create_tray_menu_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(TRAY_MENU_LABEL) {
        return Some(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        TRAY_MENU_LABEL,
        WebviewUrl::App("tauri-tray-menu.html".into()),
    )
    .always_on_top(true)
    .decorations(false)
    .focused(false)
    .inner_size(TRAY_MENU_WIDTH, TRAY_MENU_ESTIMATED_HEIGHT)
    .position(-10_000.0, -10_000.0)
    .resizable(false)
    .skip_taskbar(true)
    .title("tooldesk 托盘菜单")
    .transparent(false)
    .visible(false)
    .build();

    let Ok(window) = window else {
        if let Err(error) = window {
            diagnostics::log_flow("tray", format!("menu window create failed error={error}"));
        }
        return None;
    };

    let window_for_event = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            let _ = window_for_event.hide();
        }
    });

    Some(window)
}

fn place_tray_menu_window(window: &tauri::WebviewWindow, x: f64, y: f64) {
    let (width, height) = tray_menu_state()
        .lock()
        .ok()
        .and_then(|state| state.size)
        .unwrap_or((TRAY_MENU_WIDTH as u32, TRAY_MENU_ESTIMATED_HEIGHT as u32));
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let left = x.round() as i32;
    let top = (y - height as f64 * scale_factor - 1.0).max(0.0).round() as i32;

    let _ = window.set_size(tauri::Size::Logical(LogicalSize::new(
        width as f64,
        height as f64,
    )));
    let _ = window.set_position(LogicalPosition::new(
        left as f64 / scale_factor,
        top as f64 / scale_factor,
    ));
}

fn show_custom_tray_menu(app: &AppHandle, x: f64, y: f64) {
    if let Ok(mut state) = tray_menu_state().lock() {
        state.target = Some((x, y));
    }

    diagnostics::log_flow("tray", format!("menu show requested x={x:.1} y={y:.1}"));
    let Some(window) = create_tray_menu_window(app) else {
        diagnostics::log_flow("tray", "menu show skipped no window");
        return;
    };

    place_tray_menu_window(&window, x, y);
    let runtime = app.state::<StorageRuntimeState>();
    let _ = window.emit("tray-menu:shortcuts", read_tray_menu_shortcuts(&runtime));
    match window.show() {
        Ok(()) => diagnostics::log_flow("tray", "menu show ok"),
        Err(error) => diagnostics::log_flow("tray", format!("menu show failed error={error}")),
    }
    match window.set_focus() {
        Ok(()) => diagnostics::log_flow("tray", "menu focus ok"),
        Err(error) => diagnostics::log_flow("tray", format!("menu focus failed error={error}")),
    }
}

fn should_open_tray_menu() -> bool {
    let Ok(mut state) = tray_menu_state().lock() else {
        return true;
    };
    let now = Instant::now();
    let should_open = state
        .last_right_click_at
        .map(|last| now.duration_since(last) >= Duration::from_millis(300))
        .unwrap_or(true);
    state.last_right_click_at = Some(now);
    should_open
}

pub(crate) fn create_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let icon = Image::from_path(app.path().resource_dir()?.join("icons").join("32x32.png"))?;
    let _ = create_tray_menu_window(&app.handle().clone());

    TrayIconBuilder::with_id("tooldesk-tray")
        .icon(icon)
        .tooltip("tooldesk")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                position,
                ..
            } = event
            {
                diagnostics::log_flow(
                    "tray",
                    format!(
                        "click button={button:?} state={button_state:?} x={:.1} y={:.1}",
                        position.x, position.y
                    ),
                );
                match button {
                    MouseButton::Left if button_state == MouseButtonState::Up => {
                        show_main_window(tray.app_handle());
                    }
                    MouseButton::Right
                        if matches!(
                            button_state,
                            MouseButtonState::Down | MouseButtonState::Up
                        ) && should_open_tray_menu() =>
                    {
                        show_custom_tray_menu(tray.app_handle(), position.x, position.y);
                    }
                    _ => {}
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn resize_tray_menu(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(TRAY_MENU_LABEL) else {
        return Ok(());
    };
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let next_width = width.max(TRAY_MENU_WIDTH).round() as u32;
    let next_height = height.max(1.0).round() as u32;
    let target = {
        let mut state = tray_menu_state()
            .lock()
            .map_err(|error| error.to_string())?;
        state.size = Some((next_width, next_height));
        state.target
    };

    window
        .set_size(tauri::Size::Logical(LogicalSize::new(
            next_width as f64,
            next_height as f64,
        )))
        .map_err(|error| error.to_string())?;

    if let Some((x, y)) = target {
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        window
            .set_position(LogicalPosition::new(
                x / scale_factor,
                (y - next_height as f64 * scale_factor - 1.0).max(0.0) / scale_factor,
            ))
            .map_err(|error| error.to_string())?;
    } else {
        let _ = position;
        let _ = size;
    }

    if target.is_some() {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn get_tray_menu_shortcuts(
    runtime: tauri::State<'_, StorageRuntimeState>,
) -> TrayMenuShortcuts {
    read_tray_menu_shortcuts(&runtime)
}

#[tauri::command]
pub(crate) fn run_tray_menu_action(app: AppHandle, action: String) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(80)).await;
        close_tray_menu(&app);
        run_tray_menu_action_inner(app, action);
    });

    Ok(())
}

fn run_tray_menu_action_inner(app: AppHandle, action: String) {
    let runtime = app.state::<StorageRuntimeState>();
    let shortcut_content = app.state::<ShortcutContentState>();

    match action.as_str() {
        "show" => show_main_window(&app),
        "launcher" => quick_tool::open_quick_launcher(&app),
        "screenshot" => {
            let _ = screenshot::open_screenshot_selection_window(app.clone(), &runtime);
        }
        "record" => {
            let _ = quick_tool::open_named_quick_tool(
                &app,
                &runtime,
                &shortcut_content,
                "screen-recorder".to_string(),
                String::new(),
                false,
            );
        }
        "super-clipboard" => {
            let _ = quick_tool::open_named_quick_tool(
                &app,
                &runtime,
                &shortcut_content,
                "super-clipboard".to_string(),
                String::new(),
                false,
            );
        }
        "calendar" => quick_tool::open_taskbar_calendar_popup(&app),
        "extensions" => navigate_main_window(&app, "extensions"),
        "settings" => navigate_main_window(&app, "settings"),
        "quit" => app.exit(0),
        _ => {}
    }
}
