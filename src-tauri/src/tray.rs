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
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tokio::time::{sleep, Duration};

const TRAY_MENU_LABEL: &str = "tray-menu";
const TRAY_MENU_WIDTH: f64 = 244.0;
const TRAY_MENU_ESTIMATED_HEIGHT: f64 = 352.0;
const TRAY_MENU_EDGE_GAP: f64 = 1.0;

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
    crate::window::show_main_window(app);
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

fn anchored_menu_position(
    anchor_x: f64,
    anchor_y: f64,
    menu_width: f64,
    menu_height: f64,
    work_x: f64,
    work_y: f64,
    work_width: f64,
    work_height: f64,
) -> (i32, i32) {
    let work_right = work_x + work_width;
    let work_bottom = work_y + work_height;
    let min_left = work_x + TRAY_MENU_EDGE_GAP;
    let max_left = (work_right - menu_width - TRAY_MENU_EDGE_GAP).max(min_left);
    let left = anchor_x.max(min_left).min(max_left);

    let min_top = work_y + TRAY_MENU_EDGE_GAP;
    let max_top = (work_bottom - menu_height - TRAY_MENU_EDGE_GAP).max(min_top);
    let below_top = (anchor_y + TRAY_MENU_EDGE_GAP).max(min_top);
    let above_top = anchor_y - menu_height - TRAY_MENU_EDGE_GAP;
    let can_open_below = below_top <= max_top;
    let can_open_above = above_top >= min_top;
    let prefer_below = anchor_y <= work_y + work_height / 2.0;
    let desired_top = if prefer_below && can_open_below {
        below_top
    } else if can_open_above {
        above_top
    } else if can_open_below {
        below_top
    } else {
        anchor_y - menu_height / 2.0
    };
    let top = desired_top.max(min_top).min(max_top);

    (left.round() as i32, top.round() as i32)
}

fn tray_menu_position(
    app: &AppHandle,
    x: f64,
    y: f64,
    width: u32,
    height: u32,
) -> Option<(i32, i32)> {
    let monitors = app.available_monitors().ok()?;
    let monitor = monitors
        .iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            x >= position.x as f64
                && x <= position.x as f64 + size.width as f64
                && y >= position.y as f64
                && y <= position.y as f64 + size.height as f64
        })
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();

    Some(anchored_menu_position(
        x,
        y,
        width as f64 * scale_factor,
        height as f64 * scale_factor,
        work_area.position.x as f64,
        work_area.position.y as f64,
        work_area.size.width as f64,
        work_area.size.height as f64,
    ))
}

fn place_tray_menu_window(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let (width, height) = tray_menu_state()
        .lock()
        .ok()
        .and_then(|state| state.size)
        .unwrap_or((TRAY_MENU_WIDTH as u32, TRAY_MENU_ESTIMATED_HEIGHT as u32));
    let (left, top) = tray_menu_position(app, x, y, width, height).unwrap_or_else(|| {
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        (
            x.round() as i32,
            (y - height as f64 * scale_factor - TRAY_MENU_EDGE_GAP)
                .max(0.0)
                .round() as i32,
        )
    });

    window
        .set_size(tauri::Size::Logical(LogicalSize::new(
            width as f64,
            height as f64,
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(left, top))
        .map_err(|error| error.to_string())?;
    diagnostics::log_flow(
        "tray",
        format!("menu placed left={left} top={top} width={width} height={height}"),
    );
    Ok(())
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

    if let Err(error) = place_tray_menu_window(app, &window, x, y) {
        diagnostics::log_flow("tray", format!("menu place failed error={error}"));
    }
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
    let next_width = width.max(TRAY_MENU_WIDTH).round() as u32;
    let next_height = height.max(1.0).round() as u32;
    let target = {
        let mut state = tray_menu_state()
            .lock()
            .map_err(|error| error.to_string())?;
        state.size = Some((next_width, next_height));
        state.target
    };

    if let Some((x, y)) = target {
        place_tray_menu_window(&app, &window, x, y)?;
    } else {
        window
            .set_size(tauri::Size::Logical(LogicalSize::new(
                next_width as f64,
                next_height as f64,
            )))
            .map_err(|error| error.to_string())?;
    }

    if target.is_some() {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::anchored_menu_position;

    #[test]
    fn opens_below_a_top_tray_anchor() {
        let position = anchored_menu_position(300.0, 12.0, 244.0, 352.0, 0.0, 24.0, 1440.0, 876.0);

        assert_eq!(position, (300, 25));
    }

    #[test]
    fn opens_above_a_bottom_taskbar_anchor() {
        let position =
            anchored_menu_position(120.0, 1070.0, 244.0, 352.0, 0.0, 0.0, 1920.0, 1040.0);

        assert_eq!(position, (120, 687));
    }

    #[test]
    fn keeps_the_menu_inside_the_work_area() {
        let position =
            anchored_menu_position(1900.0, 1070.0, 244.0, 352.0, 0.0, 0.0, 1920.0, 1040.0);

        assert_eq!(position, (1675, 687));
    }
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
