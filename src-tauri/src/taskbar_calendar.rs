use crate::diagnostics::log_flow;
use crate::quick_tool::{self, QuickToolAnchorRect, QuickToolWindowOptions, ShortcutContentState};
use crate::screenshot;
use crate::storage::StorageRuntimeState;
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Mutex, OnceLock,
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder,
};

const HOTZONE_LABEL: &str = "taskbar-calendar-hotzone";
const TASKBAR_CALENDAR_TOOL_KEY: &str = "plugin:tooldesk-calendar";
static LAST_NATIVE_OPEN_AT_MS: AtomicI64 = AtomicI64::new(0);
#[cfg(target_os = "windows")]
static NATIVE_HOOK_APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

#[derive(Clone, Copy, Debug)]
struct HotzoneBounds {
    height: f64,
    width: f64,
    x: f64,
    y: f64,
}

fn resolve_hotzone_bounds(app: &AppHandle) -> Option<HotzoneBounds> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        None
    }

    #[cfg(target_os = "windows")]
    {
        let monitor = app.primary_monitor().ok()??;
        let scale_factor = monitor.scale_factor();
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let work_area = monitor.work_area();

        let bounds_x = monitor_position.x as f64 / scale_factor;
        let bounds_y = monitor_position.y as f64 / scale_factor;
        let bounds_width = monitor_size.width as f64 / scale_factor;
        let bounds_height = monitor_size.height as f64 / scale_factor;
        let work_y = work_area.position.y as f64 / scale_factor;
        let work_height = work_area.size.height as f64 / scale_factor;
        let taskbar_height = bounds_y + bounds_height - (work_y + work_height);

        let right_inset = 6.0;
        let width = 90.0;
        let height = if taskbar_height >= 28.0 && (work_y - bounds_y).abs() <= 0.5 {
            taskbar_height.clamp(40.0, 64.0)
        } else {
            56.0
        };

        Some(HotzoneBounds {
            height,
            width,
            x: bounds_x + bounds_width - right_inset - width,
            y: bounds_y + bounds_height - height,
        })
    }
}

fn apply_hotzone_bounds(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(HOTZONE_LABEL) else {
        return false;
    };
    let Some(bounds) = resolve_hotzone_bounds(app) else {
        let _ = window.close();
        return false;
    };

    let _ = window.set_position(PhysicalPosition::new(
        bounds.x.round() as i32,
        bounds.y.round() as i32,
    ));
    let _ = window.set_size(PhysicalSize::new(
        bounds.width.round() as u32,
        bounds.height.round() as u32,
    ));
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    true
}

pub(crate) fn start_hotzone(app: &tauri::App) {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }

    #[cfg(target_os = "windows")]
    {
        let Some(bounds) = resolve_hotzone_bounds(app.handle()) else {
            return;
        };

        let Ok(window) = WebviewWindowBuilder::new(
            app,
            HOTZONE_LABEL,
            WebviewUrl::App("tauri-taskbar-calendar-hotzone.html".into()),
        )
        .always_on_top(true)
        .decorations(false)
        .focusable(true)
        .inner_size(bounds.width, bounds.height)
        .position(bounds.x, bounds.y)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .title("tooldesk 日历热区")
        .transparent(true)
        .build() else {
            return;
        };

        let _ = window.set_always_on_top(true);
        let _ = apply_hotzone_bounds(app.handle());
        start_native_mouse_hook(app.handle().clone());
    }
}

#[cfg(target_os = "windows")]
fn point_in_hotzone(app: &AppHandle, x: i32, y: i32) -> bool {
    let Some(bounds) = resolve_hotzone_bounds(app) else {
        return false;
    };
    let x = x as f64;
    let y = y as f64;

    x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
}

#[cfg(target_os = "windows")]
fn point_in_calendar_popup(app: &AppHandle, x: i32, y: i32) -> bool {
    let Some(window) = app.get_webview_window("quick-compact-plugin:tooldesk-calendar") else {
        return false;
    };

    if !window.is_visible().unwrap_or(false) {
        return false;
    }

    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.outer_size() else {
        return false;
    };

    x >= position.x
        && x <= position.x + size.width as i32
        && y >= position.y
        && y <= position.y + size.height as i32
}

#[cfg(target_os = "windows")]
fn hide_calendar_popup_if_outside(app: &AppHandle, x: i32, y: i32) {
    if screenshot::is_screenshot_overlay_active(app) {
        return;
    }

    if point_in_hotzone(app, x, y) || point_in_calendar_popup(app, x, y) {
        return;
    }

    if let Some(window) = app.get_webview_window("quick-compact-plugin:tooldesk-calendar") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
    }
}

#[cfg(target_os = "windows")]
fn should_open_from_native_click(app: &AppHandle, x: i32, y: i32) -> bool {
    if !point_in_hotzone(app, x, y) {
        return false;
    }

    let now = chrono::Utc::now().timestamp_millis();
    let last = LAST_NATIVE_OPEN_AT_MS.load(Ordering::Relaxed);

    if now - last < 350 {
        return false;
    }

    LAST_NATIVE_OPEN_AT_MS.store(now, Ordering::Relaxed);
    true
}

fn open_taskbar_calendar_popup_inner(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
    shortcut_content: &ShortcutContentState,
) -> Result<(), String> {
    log_flow("calendar", "open requested");
    if let Some(window) = app.get_webview_window("quick-compact-plugin:tooldesk-calendar") {
        if window.is_visible().unwrap_or(false) {
            let position = window
                .outer_position()
                .map(|value| format!("{},{}", value.x, value.y))
                .unwrap_or_else(|error| format!("err:{error}"));
            let size = window
                .outer_size()
                .map(|value| format!("{}x{}", value.width, value.height))
                .unwrap_or_else(|error| format!("err:{error}"));
            log_flow(
                "calendar",
                format!("hide visible popup position={position} size={size}"),
            );
            let _ = window.hide();
            return Ok(());
        }
    }

    let anchor_rect = resolve_hotzone_bounds(app).map(|bounds| QuickToolAnchorRect {
        height: bounds.height,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
    });

    quick_tool::open_named_quick_tool_with_options(
        app,
        runtime,
        shortcut_content,
        TASKBAR_CALENDAR_TOOL_KEY.to_string(),
        String::new(),
        QuickToolWindowOptions {
            anchor_rect,
            compact: true,
            force_new: false,
        },
    )?;

    let _ = app.emit("taskbar-calendar:popup-opened", ());
    if let Some(window) = app.get_webview_window("quick-compact-plugin:tooldesk-calendar") {
        let visible = window.is_visible().ok();
        let focused = window.is_focused().ok();
        let position = window
            .outer_position()
            .map(|value| format!("{},{}", value.x, value.y))
            .unwrap_or_else(|error| format!("err:{error}"));
        let size = window
            .outer_size()
            .map(|value| format!("{}x{}", value.width, value.height))
            .unwrap_or_else(|error| format!("err:{error}"));
        log_flow(
            "calendar",
            format!(
                "open done visible={visible:?} focused={focused:?} position={position} size={size}"
            ),
        );
    } else {
        log_flow("calendar", "open done window_missing");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn start_native_mouse_hook(app: AppHandle) {
    std::thread::spawn(move || {
        use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, HHOOK, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONDOWN,
            WM_LBUTTONUP,
        };

        unsafe extern "system" fn hook_proc(
            code: i32,
            w_param: WPARAM,
            l_param: LPARAM,
        ) -> LRESULT {
            if code >= 0 && (w_param as u32 == WM_LBUTTONDOWN || w_param as u32 == WM_LBUTTONUP) {
                let info = &*(l_param as *const MSLLHOOKSTRUCT);
                let app = NATIVE_HOOK_APP
                    .get()
                    .and_then(|state| state.lock().ok().and_then(|guard| guard.clone()));

                if let Some(app) = app {
                    if w_param as u32 == WM_LBUTTONDOWN {
                        hide_calendar_popup_if_outside(&app, info.pt.x, info.pt.y);
                    }

                    if !point_in_hotzone(&app, info.pt.x, info.pt.y) {
                        return CallNextHookEx(0 as HHOOK, code, w_param, l_param);
                    }

                    if w_param as u32 == WM_LBUTTONDOWN
                        && should_open_from_native_click(&app, info.pt.x, info.pt.y)
                    {
                        log_flow(
                            "calendar",
                            format!("native click x={} y={}", info.pt.x, info.pt.y),
                        );
                        tauri::async_runtime::spawn(async move {
                            let runtime = app.state::<StorageRuntimeState>();
                            let shortcut_content = app.state::<ShortcutContentState>();
                            let _ = open_taskbar_calendar_popup_inner(
                                &app,
                                &runtime,
                                &shortcut_content,
                            );
                        });
                    }

                    return 1;
                }
            }

            CallNextHookEx(0 as HHOOK, code, w_param, l_param)
        }

        unsafe {
            let hook_state = NATIVE_HOOK_APP.get_or_init(|| Mutex::new(None));
            if let Ok(mut value) = hook_state.lock() {
                *value = Some(app);
            }
            let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(hook_proc), 0 as _, 0);

            if hook.is_null() {
                if let Ok(mut value) = hook_state.lock() {
                    *value = None;
                }
                return;
            }

            let mut message = std::mem::zeroed::<MSG>();

            while GetMessageW(&mut message, 0 as _, 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }

            UnhookWindowsHookEx(hook);
            if let Ok(mut value) = hook_state.lock() {
                *value = None;
            }
        }
    });
}

#[tauri::command]
pub(crate) fn refresh_taskbar_calendar_hotzone(app: AppHandle) -> Result<(), String> {
    apply_hotzone_bounds(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn open_taskbar_calendar_hotzone(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    shortcut_content: State<'_, ShortcutContentState>,
) -> Result<(), String> {
    open_taskbar_calendar_popup_inner(&app, &runtime, &shortcut_content)
}
