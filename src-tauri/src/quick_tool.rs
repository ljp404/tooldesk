use crate::diagnostics::log_flow;
use crate::plugins;
use crate::screenshot;
use crate::storage::StorageRuntimeState;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::{thread, time::Duration};
use tauri::image::Image;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND as WindowsHwnd;
#[cfg(target_os = "windows")]
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, SetForegroundWindow, SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE,
    SWP_NOSIZE, SWP_SHOWWINDOW,
};

#[derive(Debug, Default)]
pub(crate) struct ShortcutContentState(Mutex<Option<ShortcutContentPayload>>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutContentPayload {
    content: String,
    kind: String,
    triggered_at: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickToolAnchorRect {
    pub(crate) height: f64,
    pub(crate) width: f64,
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenQuickToolPayload {
    anchor_rect: Option<QuickToolAnchorRect>,
    compact: Option<bool>,
    content: Option<String>,
    force_new: Option<bool>,
    kind: String,
}

#[derive(Clone, Debug)]
pub(crate) struct QuickToolWindowOptions {
    pub(crate) anchor_rect: Option<QuickToolAnchorRect>,
    pub(crate) compact: bool,
    pub(crate) force_new: bool,
}

#[derive(Clone, Debug)]
struct QuickToolWindowSize {
    height: f64,
    min_height: f64,
    min_width: f64,
    width: f64,
}

const TASKBAR_CALENDAR_TOOL_KEY: &str = "plugin:tooldesk-calendar";
const QUICK_LAUNCHER_HEIGHT: f64 = 440.0;
const QUICK_LAUNCHER_SHOW_DELAY_MS: u64 = 16;
const QUICK_LAUNCHER_WIDTH: f64 = 820.0;
static QUICK_LAUNCHER_OUTSIDE_CLICK_GUARD_ID: AtomicU64 = AtomicU64::new(0);

fn log_window_state(area: &str, stage: &str, window: &tauri::WebviewWindow) {
    let label = window.label();
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
        area,
        format!(
            "{stage} label={label} visible={visible:?} focused={focused:?} position={position} size={size}"
        ),
    );
}

fn log_quick_windows_snapshot(app: &AppHandle, stage: &str) {
    let mut entries = Vec::new();

    for (label, window) in app.webview_windows() {
        if label != "main" && !label.starts_with("quick-") {
            continue;
        }

        let visible = window.is_visible().ok();
        let focused = window.is_focused().ok();
        let position = window
            .outer_position()
            .map(|value| format!("{},{}", value.x, value.y))
            .unwrap_or_else(|_| "?".to_string());
        let size = window
            .outer_size()
            .map(|value| format!("{}x{}", value.width, value.height))
            .unwrap_or_else(|_| "?".to_string());

        entries.push(format!(
            "{label}:visible={visible:?},focused={focused:?},pos={position},size={size}"
        ));
    }

    entries.sort();
    log_flow(
        "quick-window",
        format!("{stage} count={} [{}]", entries.len(), entries.join(" | ")),
    );
}

fn quick_tool_window_title(kind: &str) -> &str {
    match kind {
        "launcher" => "tooldesk 搜索",
        "translator" => "翻译",
        "keepass" => "KeePassXC 搜索",
        "music-player" => "音乐播放器",
        "screenshot" => "截图",
        "screen-recorder" => "录屏",
        "super-clipboard" => "超级剪切板",
        "obsidian" => "Obsidian 搜索",
        TASKBAR_CALENDAR_TOOL_KEY => "日历",
        _ => "tooldesk",
    }
}

fn sanitize_window_label(value: &str) -> String {
    value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() || matches!(item, '-' | '_' | ':' | '/') {
                item
            } else {
                '_'
            }
        })
        .collect()
}

fn build_quick_tool_url(kind: &str, compact: bool) -> String {
    let encoded = kind
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect::<String>();

    if compact {
        format!("index.html?quick={encoded}&compact=1")
    } else {
        format!("index.html?quick={encoded}")
    }
}

fn quick_tool_window_size(kind: &str, compact: bool) -> QuickToolWindowSize {
    if kind == "screen-recorder" && compact {
        return QuickToolWindowSize {
            height: 48.0,
            min_height: 48.0,
            min_width: 430.0,
            width: 430.0,
        };
    }

    if kind == TASKBAR_CALENDAR_TOOL_KEY && compact {
        return QuickToolWindowSize {
            height: 560.0,
            min_height: 560.0,
            min_width: 500.0,
            width: 500.0,
        };
    }

    QuickToolWindowSize {
        height: 720.0,
        min_height: 360.0,
        min_width: 760.0,
        width: 940.0,
    }
}

fn set_quick_tool_window_icon(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
    kind: &str,
    window: &tauri::WebviewWindow,
) {
    let Some(path) = plugins::plugin_window_icon_path(app, runtime, kind) else {
        return;
    };

    if let Ok(icon) = Image::from_path(path) {
        let _ = window.set_icon(icon);
    }
}

#[cfg(target_os = "windows")]
fn sanitize_windows_app_id_part(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '.'
            }
        })
        .collect();

    sanitized.trim_matches('.').to_string()
}

#[cfg(target_os = "windows")]
fn quick_tool_app_user_model_id(kind: &str) -> String {
    let tool_id = kind
        .strip_prefix("plugin:")
        .map(sanitize_windows_app_id_part)
        .unwrap_or_else(|| sanitize_windows_app_id_part(kind));

    if tool_id.is_empty() {
        "tooldesk.tool".to_string()
    } else {
        format!("tooldesk.tool.{tool_id}")
    }
}

#[cfg(target_os = "windows")]
fn set_quick_tool_window_app_user_model_id(kind: &str, window: &tauri::WebviewWindow) {
    let app_id = quick_tool_app_user_model_id(kind);
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let result: windows::core::Result<()> = (|| unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(WindowsHwnd(hwnd.0 as isize as _))?;
        let value = PROPVARIANT::from(app_id.as_str());
        store.SetValue(&PKEY_AppUserModel_ID, &value)?;
        store.Commit()
    })();

    if let Err(error) = result {
        log_flow(
            "quick-tool",
            format!("set window app user model id failed app_id={app_id} error={error:?}"),
        );
    } else {
        log_flow(
            "quick-tool",
            format!("set window app user model id app_id={app_id}"),
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn set_quick_tool_window_app_user_model_id(_kind: &str, _window: &tauri::WebviewWindow) {}

fn anchored_position(
    app: &AppHandle,
    size: &QuickToolWindowSize,
    anchor_rect: Option<&QuickToolAnchorRect>,
) -> Option<(f64, f64)> {
    let monitor = if let Some(anchor) = anchor_rect {
        let center_x = anchor.x + anchor.width / 2.0;
        let center_y = anchor.y + anchor.height / 2.0;
        app.available_monitors()
            .ok()?
            .into_iter()
            .find(|monitor| {
                let scale_factor = monitor.scale_factor();
                let position = monitor.position();
                let size = monitor.size();
                let x = position.x as f64 / scale_factor;
                let y = position.y as f64 / scale_factor;
                let width = size.width as f64 / scale_factor;
                let height = size.height as f64 / scale_factor;

                center_x >= x && center_x <= x + width && center_y >= y && center_y <= y + height
            })
            .or_else(|| app.primary_monitor().ok().flatten())?
    } else {
        app.primary_monitor().ok().flatten()?
    };
    let monitor_size = monitor.work_area().size;
    let monitor_work_position = monitor.work_area().position;
    let scale_factor = monitor.scale_factor();
    let work_x = monitor_work_position.x as f64 / scale_factor;
    let work_y = monitor_work_position.y as f64 / scale_factor;
    let work_width = monitor_size.width as f64 / scale_factor;
    let work_height = monitor_size.height as f64 / scale_factor;
    let gap = 8.0;
    let (desired_x, desired_y) = if let Some(anchor) = anchor_rect {
        let anchor_center_x = anchor.x + anchor.width / 2.0;
        let below_y = anchor.y + anchor.height + gap;
        let above_y = anchor.y - size.height - gap;
        let has_space_below = below_y + size.height <= work_y + work_height - gap;
        let has_space_above = above_y >= work_y + gap;
        let fallback_y = anchor.y + anchor.height - size.height - gap;
        let y = if has_space_below {
            below_y
        } else if has_space_above {
            above_y
        } else {
            fallback_y
        };

        (anchor_center_x - size.width / 2.0, y)
    } else {
        (
            work_x + work_width - size.width - 16.0,
            work_y + work_height - size.height - 16.0,
        )
    };
    let max_x = work_x + work_width - size.width - gap;
    let max_y = work_y + work_height - size.height - gap;

    Some((
        desired_x.max(work_x + gap).min(max_x),
        desired_y.max(work_y + gap).min(max_y),
    ))
}

fn centered_position(app: &AppHandle, width: f64, height: f64) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position;
    let size = work_area.size;
    let work_x = position.x as f64 / scale_factor;
    let work_y = position.y as f64 / scale_factor;
    let work_width = size.width as f64 / scale_factor;
    let work_height = size.height as f64 / scale_factor;

    Some((
        (work_x + (work_width - width) / 2.0).round(),
        (work_y + (work_height - height) / 2.0).round(),
    ))
}

fn reset_quick_launcher_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    let _ = window.unmaximize();
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
        QUICK_LAUNCHER_WIDTH,
        QUICK_LAUNCHER_HEIGHT,
    )));

    if let Some((x, y)) = centered_position(app, QUICK_LAUNCHER_WIDTH, QUICK_LAUNCHER_HEIGHT) {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
}

#[cfg(target_os = "windows")]
fn is_left_mouse_pressed() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON as i32) & 0x8000u16 as i16) != 0 }
}

#[cfg(not(target_os = "windows"))]
fn is_left_mouse_pressed() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn cursor_position() -> Option<(i32, i32)> {
    let mut point = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };

    if ok == 0 {
        None
    } else {
        Some((point.x, point.y))
    }
}

#[cfg(target_os = "windows")]
fn start_quick_launcher_outside_click_guard(app: AppHandle) {
    let guard_id = QUICK_LAUNCHER_OUTSIDE_CLICK_GUARD_ID.fetch_add(1, Ordering::Relaxed) + 1;

    thread::spawn(move || {
        let mut was_pressed = is_left_mouse_pressed();

        for _ in 0..300 {
            thread::sleep(Duration::from_millis(50));

            if QUICK_LAUNCHER_OUTSIDE_CLICK_GUARD_ID.load(Ordering::Relaxed) != guard_id {
                return;
            }

            let pressed = is_left_mouse_pressed();
            if pressed && !was_pressed {
                let Some((cursor_x, cursor_y)) = cursor_position() else {
                    was_pressed = pressed;
                    continue;
                };
                let app_for_main = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let Some(window) = app_for_main.get_webview_window("quick-launcher") else {
                        return;
                    };

                    if !window.is_visible().unwrap_or(false) {
                        return;
                    }

                    if screenshot::is_screenshot_overlay_active(&app_for_main) {
                        log_flow(
                            "quick-launcher",
                            "outside_click_guard hide skipped screenshot_overlay_active",
                        );
                        return;
                    }

                    let Ok(position) = window.outer_position() else {
                        return;
                    };
                    let Ok(size) = window.outer_size() else {
                        return;
                    };
                    let right = position.x.saturating_add(size.width as i32);
                    let bottom = position.y.saturating_add(size.height as i32);
                    let inside = cursor_x >= position.x
                        && cursor_x <= right
                        && cursor_y >= position.y
                        && cursor_y <= bottom;

                    if inside {
                        return;
                    }

                    match window.hide() {
                        Ok(()) => log_flow(
                            "quick-launcher",
                            format!(
                                "outside_click_guard hide ok cursor_x={cursor_x} cursor_y={cursor_y} window_x={} window_y={} window_w={} window_h={}",
                                position.x, position.y, size.width, size.height
                            ),
                        ),
                        Err(error) => log_flow(
                            "quick-launcher",
                            format!(
                                "outside_click_guard hide failed cursor_x={cursor_x} cursor_y={cursor_y} error={error}"
                            ),
                        ),
                    }
                });
            }

            was_pressed = pressed;
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn start_quick_launcher_outside_click_guard(_app: AppHandle) {}

#[cfg(target_os = "windows")]
fn promote_quick_window_to_front(window: &tauri::WebviewWindow, keep_topmost: bool) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        SetWindowPos(
            hwnd.0 as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        let _ = SetForegroundWindow(hwnd.0 as _);

        if !keep_topmost {
            SetWindowPos(
                hwnd.0 as _,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn promote_quick_window_to_front(window: &tauri::WebviewWindow, keep_topmost: bool) {
    let _ = (window, keep_topmost);
}

fn close_existing_compact_recorder_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("quick-compact-screen-recorder") {
            let _ = window.close();
        }
    }
}

fn current_timestamp_ms() -> Result<u64, String> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64)
}

fn store_shortcut_payload(
    shortcut_content: &ShortcutContentState,
    kind: String,
    content: String,
) -> Result<ShortcutContentPayload, String> {
    let payload = ShortcutContentPayload {
        content,
        kind,
        triggered_at: current_timestamp_ms()?,
    };

    let mut state = shortcut_content
        .0
        .lock()
        .map_err(|_| "快捷启动内容状态不可用。".to_string())?;
    *state = Some(payload.clone());

    Ok(payload)
}

#[tauri::command]
pub(crate) fn open_quick_tool(
    app: AppHandle,
    runtime: tauri::State<'_, StorageRuntimeState>,
    shortcut_content: tauri::State<'_, ShortcutContentState>,
    payload: OpenQuickToolPayload,
) -> Result<(), String> {
    let kind = payload.kind;
    let content = payload.content.unwrap_or_default();
    let options = QuickToolWindowOptions {
        anchor_rect: payload.anchor_rect,
        compact: payload.compact.unwrap_or(false),
        force_new: payload.force_new.unwrap_or(false),
    };

    if options.force_new && !options.compact {
        store_shortcut_payload(&shortcut_content, kind.clone(), content)?;
        let app_for_thread = app.clone();
        let runtime_for_thread = runtime.inner().clone();

        thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            let app_for_main = app_for_thread.clone();
            let _ = app_for_thread.run_on_main_thread(move || {
                let _ = open_quick_tool_window(&app_for_main, &runtime_for_thread, kind, options);
            });
        });

        return Ok(());
    }

    open_named_quick_tool_with_options(&app, &runtime, &shortcut_content, kind, content, options)
        .map(|_| ())
}

pub(crate) fn open_named_quick_tool(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
    shortcut_content: &ShortcutContentState,
    kind: String,
    content: String,
    force_new: bool,
) -> Result<String, String> {
    open_named_quick_tool_with_options(
        app,
        runtime,
        shortcut_content,
        kind,
        content,
        QuickToolWindowOptions {
            anchor_rect: None,
            compact: false,
            force_new,
        },
    )
}

pub(crate) fn open_named_quick_tool_with_options(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
    shortcut_content: &ShortcutContentState,
    kind: String,
    content: String,
    options: QuickToolWindowOptions,
) -> Result<String, String> {
    log_flow(
        "quick-tool",
        format!(
            "open requested kind={kind} compact={} force_new={} content_len={}",
            options.compact,
            options.force_new,
            content.len()
        ),
    );
    if let Some(plugin_id) = kind.strip_prefix("plugin:") {
        if !plugins::is_plugin_installed(runtime, plugin_id) {
            log_flow(
                "quick-tool",
                format!("open skipped uninstalled plugin kind={kind}"),
            );
            return Err("插件未安装".to_string());
        }
    }

    store_shortcut_payload(shortcut_content, kind.clone(), content)?;
    open_quick_tool_window(app, runtime, kind, options)
}

fn open_quick_tool_window(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
    kind: String,
    options: QuickToolWindowOptions,
) -> Result<String, String> {
    if kind == "screen-recorder" && options.compact {
        close_existing_compact_recorder_windows(app);
    }

    let base_label_source = if options.compact {
        format!("quick-compact-{kind}")
    } else {
        format!("quick-{kind}")
    };
    let base_label = sanitize_window_label(&base_label_source);
    let label = if options.force_new {
        format!("{base_label}-{}", current_timestamp_ms()?)
    } else {
        base_label
    };
    log_flow(
        "quick-tool",
        format!(
            "resolve label kind={kind} label={label} compact={} force_new={}",
            options.compact, options.force_new
        ),
    );

    if !options.force_new {
        if let Some(window) = app.get_webview_window(&label) {
            log_window_state("quick-tool", "reuse before_show", &window);
            match window.show() {
                Ok(()) => log_flow("quick-tool", format!("reuse show ok label={label}")),
                Err(error) => log_flow(
                    "quick-tool",
                    format!("reuse show failed label={label} error={error}"),
                ),
            }
            if options.compact {
                let _ = window.set_always_on_top(true);
            }
            window.set_focus().map_err(|error| error.to_string())?;
            promote_quick_window_to_front(&window, options.compact);
            log_window_state("quick-tool", "reuse after_show", &window);
            log_quick_windows_snapshot(app, "after quick tool reuse");
            return Ok(label);
        }
    }

    let size = quick_tool_window_size(&kind, options.compact);
    log_flow(
        "quick-tool",
        format!(
            "create start kind={kind} label={label} compact={} force_new={} size={}x{} min={}x{}",
            options.compact,
            options.force_new,
            size.width,
            size.height,
            size.min_width,
            size.min_height
        ),
    );
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(build_quick_tool_url(&kind, options.compact).into()),
    )
    .always_on_top(options.compact)
    .title(quick_tool_window_title(&kind))
    .inner_size(size.width, size.height)
    .min_inner_size(size.min_width, size.min_height)
    .resizable(!options.compact)
    .decorations(false)
    .skip_taskbar(options.compact)
    .shadow(!options.compact)
    .transparent(options.compact)
    .visible(options.compact)
    .data_directory(runtime.data_dir.clone());

    if !options.compact {
        if let Some(path) = plugins::plugin_window_icon_path(app, runtime, &kind) {
            if let Ok(icon) = Image::from_path(&path) {
                builder = builder.icon(icon).map_err(|error| error.to_string())?;
            }
        }
    }

    if options.compact {
        if let Some((x, y)) = anchored_position(app, &size, options.anchor_rect.as_ref()) {
            builder = builder.position(x, y);
        } else {
            builder = builder.center();
        }
    } else {
        builder = builder.center();
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    log_window_state("quick-tool", "create built", &window);

    if !options.compact {
        set_quick_tool_window_app_user_model_id(&kind, &window);
        set_quick_tool_window_icon(app, runtime, &kind, &window);
    }

    if options.compact && kind == TASKBAR_CALENDAR_TOOL_KEY {
        let app_handle = app.clone();
        let window_label = window.label().to_string();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Focused(false)) {
                if screenshot::is_screenshot_overlay_active(&app_handle) {
                    return;
                }

                if let Some(window) = app_handle.get_webview_window(&window_label) {
                    let _ = window.hide();
                }
            }
        });
    }

    if options.compact {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        promote_quick_window_to_front(&window, true);
        log_window_state("quick-tool", "compact shown", &window);
        log_quick_windows_snapshot(app, "after compact show");
    } else {
        schedule_show_quick_window(app.clone(), window.label().to_string());
    }

    Ok(window.label().to_string())
}

fn schedule_show_quick_window(app: AppHandle, label: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(220));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = app_for_main.get_webview_window(&label) {
                log_window_state("quick-tool", "scheduled_show before", &window);
                if !window.is_visible().unwrap_or(false) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    promote_quick_window_to_front(&window, false);
                }
                log_window_state("quick-tool", "scheduled_show after", &window);
                log_quick_windows_snapshot(&app_for_main, "after scheduled quick tool show");
            }
        });
    });
}

fn schedule_show_quick_launcher_window(app: AppHandle, delay_ms: u64, stage: &'static str) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(delay_ms));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = app_for_main.get_webview_window("quick-launcher") {
                log_window_state("quick-launcher", &format!("{stage} before"), &window);
                match window.show() {
                    Ok(()) => log_flow("quick-launcher", format!("{stage} show ok")),
                    Err(error) => log_flow(
                        "quick-launcher",
                        format!("{stage} show failed error={error}"),
                    ),
                }
                match window.set_focus() {
                    Ok(()) => log_flow("quick-launcher", format!("{stage} focus ok")),
                    Err(error) => log_flow(
                        "quick-launcher",
                        format!("{stage} focus failed error={error}"),
                    ),
                }
                promote_quick_window_to_front(&window, false);
                start_quick_launcher_outside_click_guard(app_for_main.clone());
                log_window_state("quick-launcher", &format!("{stage} after"), &window);
                log_quick_windows_snapshot(&app_for_main, &format!("after quick launcher {stage}"));
            } else {
                log_flow("quick-launcher", format!("{stage} skipped window_missing"));
                log_quick_windows_snapshot(
                    &app_for_main,
                    &format!("after quick launcher {stage} missing"),
                );
            }
        });
    });
}

fn create_quick_launcher_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    let runtime = app.state::<StorageRuntimeState>();
    let mut builder = WebviewWindowBuilder::new(
        app,
        "quick-launcher",
        WebviewUrl::App("index.html?quick=launcher".into()),
    )
    .title("tooldesk 搜索")
    .inner_size(QUICK_LAUNCHER_WIDTH, QUICK_LAUNCHER_HEIGHT)
    .min_inner_size(QUICK_LAUNCHER_WIDTH, QUICK_LAUNCHER_HEIGHT)
    .resizable(false)
    .decorations(false)
    .skip_taskbar(true)
    .shadow(false)
    .transparent(true)
    .visible(false)
    .data_directory(runtime.data_dir.clone());

    if let Some((x, y)) = centered_position(app, QUICK_LAUNCHER_WIDTH, QUICK_LAUNCHER_HEIGHT) {
        builder = builder.position(x, y);
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            if screenshot::is_screenshot_overlay_active(&app_handle) {
                log_flow(
                    "quick-launcher",
                    "focus_lost_hide skipped screenshot_overlay_active",
                );
                return;
            }

            if let Some(window) = app_handle.get_webview_window("quick-launcher") {
                let visible_before = window.is_visible().unwrap_or(false);
                let focused_before = window.is_focused().unwrap_or(false);
                if !visible_before {
                    log_flow(
                        "quick-launcher",
                        format!(
                            "focus_lost_hide skipped hidden focused_before={focused_before}"
                        ),
                    );
                    return;
                }
                if is_left_mouse_pressed() {
                    log_flow(
                        "quick-launcher",
                        format!(
                            "focus_lost_hide skipped left_mouse_pressed focused_before={focused_before}"
                        ),
                    );
                    return;
                }
                match window.hide() {
                    Ok(()) => log_flow(
                        "quick-launcher",
                        format!(
                            "focus_lost_hide ok visible_before={visible_before} focused_before={focused_before} visible_after={}",
                            window.is_visible().unwrap_or(false)
                        ),
                    ),
                    Err(error) => log_flow(
                        "quick-launcher",
                        format!(
                            "focus_lost_hide failed visible_before={visible_before} focused_before={focused_before} error={error}"
                        ),
                    ),
                }
            } else {
                log_flow("quick-launcher", "focus_lost_hide skipped window_missing");
            }
        }
    });

    reset_quick_launcher_window(app, &window);
    Ok(window)
}

pub(crate) fn warm_quick_launcher(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(900));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = app_for_main.get_webview_window("quick-launcher") {
                log_window_state("quick-launcher", "warm skipped existing", &window);
                return;
            }

            match create_quick_launcher_window(&app_for_main) {
                Ok(window) => {
                    log_window_state("quick-launcher", "warm built", &window);
                    log_quick_windows_snapshot(&app_for_main, "after quick launcher warm");
                }
                Err(error) => {
                    log_flow("quick-launcher", format!("warm failed error={error}"));
                    log_quick_windows_snapshot(&app_for_main, "after quick launcher warm failed");
                }
            }
        });
    });
}

pub(crate) fn open_taskbar_calendar_popup(app: &AppHandle) {
    let runtime = app.state::<StorageRuntimeState>();
    let shortcut_content = app.state::<ShortcutContentState>();
    if open_named_quick_tool_with_options(
        app,
        &runtime,
        &shortcut_content,
        TASKBAR_CALENDAR_TOOL_KEY.to_string(),
        String::new(),
        QuickToolWindowOptions {
            anchor_rect: None,
            compact: true,
            force_new: false,
        },
    )
    .is_ok()
    {
        let _ = app.emit("taskbar-calendar:popup-opened", ());
    }
}

pub(crate) fn open_quick_launcher(app: &AppHandle) {
    log_flow("quick-launcher", "open entry");
    let content = match app.clipboard().read_text() {
        Ok(value) => {
            log_flow(
                "quick-launcher",
                format!("clipboard read ok content_len={}", value.len()),
            );
            value
        }
        Err(error) => {
            log_flow(
                "quick-launcher",
                format!("clipboard read failed error={error}"),
            );
            String::new()
        }
    };
    let shortcut_content = app.state::<ShortcutContentState>();
    let Ok(payload) = store_shortcut_payload(&shortcut_content, "launcher".to_string(), content)
    else {
        log_flow("quick-launcher", "store shortcut payload failed");
        return;
    };
    log_flow(
        "quick-launcher",
        format!(
            "open requested content_len={} existing={}",
            payload.content.len(),
            app.get_webview_window("quick-launcher").is_some()
        ),
    );

    if let Some(window) = app.get_webview_window("quick-launcher") {
        log_window_state("quick-launcher", "reuse before_emit", &window);
        match window.emit("shortcut:clipboard-content", &payload) {
            Ok(()) => log_flow("quick-launcher", "reuse emit clipboard ok"),
            Err(error) => log_flow(
                "quick-launcher",
                format!("reuse emit clipboard failed error={error}"),
            ),
        }
        schedule_show_quick_launcher_window(
            app.clone(),
            QUICK_LAUNCHER_SHOW_DELAY_MS,
            "scheduled_show",
        );
        return;
    }

    let window = match create_quick_launcher_window(app) {
        Ok(window) => window,
        Err(error) => {
            log_flow("quick-launcher", format!("create failed error={error}"));
            log_quick_windows_snapshot(app, "after quick launcher create failed");
            return;
        }
    };
    log_window_state("quick-launcher", "create built", &window);

    match window.emit("shortcut:clipboard-content", &payload) {
        Ok(()) => log_flow("quick-launcher", "create emit clipboard ok"),
        Err(error) => log_flow(
            "quick-launcher",
            format!("create emit clipboard failed error={error}"),
        ),
    }

    schedule_show_quick_launcher_window(
        app.clone(),
        QUICK_LAUNCHER_SHOW_DELAY_MS,
        "scheduled_show",
    );
    schedule_show_quick_launcher_window(app.clone(), 260, "scheduled_show_retry");
}

#[tauri::command]
pub(crate) fn get_last_content(
    shortcut_content: tauri::State<'_, ShortcutContentState>,
) -> Result<Option<ShortcutContentPayload>, String> {
    let mut payload = shortcut_content
        .0
        .lock()
        .map_err(|_| "快捷启动内容状态不可用。".to_string())?;

    Ok(payload.take())
}
