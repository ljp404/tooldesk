use crate::storage::{self, StorageRuntimeState};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
    GWLP_WNDPROC, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WNDPROC,
    WS_SYSMENU,
};

#[cfg(target_os = "windows")]
static MAIN_WINDOW_PROCS: OnceLock<Mutex<HashMap<isize, isize>>> = OnceLock::new();
#[cfg(target_os = "windows")]
static MAIN_WINDOW_LABELS: OnceLock<Mutex<HashMap<isize, String>>> = OnceLock::new();
#[cfg(target_os = "windows")]
static MAIN_WINDOW_APP: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "windows")]
fn main_window_labels() -> &'static Mutex<HashMap<isize, String>> {
    MAIN_WINDOW_LABELS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "windows")]
fn main_window_procs() -> &'static Mutex<HashMap<isize, isize>> {
    MAIN_WINDOW_PROCS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "windows")]
fn emit_alt_space_recorded(hwnd: HWND) {
    let Some(label) = main_window_labels()
        .lock()
        .ok()
        .and_then(|labels| labels.get(&(hwnd as isize)).cloned())
    else {
        return;
    };

    let Some(app) = MAIN_WINDOW_APP.get() else {
        return;
    };

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.emit("shortcut:recorded", "Alt+Space");
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn main_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    const WM_SYSCOMMAND: u32 = 0x0112;
    const WM_SYSKEYDOWN: u32 = 0x0104;
    const SC_KEYMENU: usize = 0xF100;
    const VK_SPACE: usize = 0x20;

    if msg == WM_SYSCOMMAND && (wparam & 0xFFF0) == SC_KEYMENU {
        if (lparam as usize & 0xFFFF) == VK_SPACE
            || (GetAsyncKeyState(VK_SPACE as i32) & 0x8000u16 as i16) != 0
        {
            emit_alt_space_recorded(hwnd);
        }
        return 0;
    }

    if msg == WM_SYSKEYDOWN && wparam == VK_SPACE {
        emit_alt_space_recorded(hwnd);
        return 0;
    }

    let previous = main_window_procs()
        .lock()
        .ok()
        .and_then(|procs| procs.get(&(hwnd as isize)).copied())
        .unwrap_or_default();

    if previous != 0 {
        let previous_proc: WNDPROC = std::mem::transmute(previous);
        return CallWindowProcW(previous_proc, hwnd, msg, wparam, lparam);
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn disable_system_menu(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd.0 as _, GWL_STYLE);
        let next_style = style & !(WS_SYSMENU as isize);

        if next_style != style {
            SetWindowLongPtrW(hwnd.0 as _, GWL_STYLE, next_style);
            SetWindowPos(
                hwnd.0 as _,
                0 as _,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn intercept_system_menu_shortcut(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let key = hwnd.0 as isize;
    if let Ok(mut labels) = main_window_labels().lock() {
        labels.insert(key, window.label().to_string());
    }

    if main_window_procs()
        .lock()
        .ok()
        .is_some_and(|procs| procs.contains_key(&key))
    {
        return;
    }

    unsafe {
        let previous = SetWindowLongPtrW(
            hwnd.0 as _,
            GWLP_WNDPROC,
            main_window_proc as *const () as isize,
        );
        if previous != 0 {
            if let Ok(mut procs) = main_window_procs().lock() {
                procs.insert(key, previous);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn intercept_system_menu_shortcut(window: &tauri::WebviewWindow) {
    let _ = window;
}

#[cfg(not(target_os = "windows"))]
fn disable_system_menu(window: &tauri::WebviewWindow) {
    let _ = window;
}

const MAIN_WINDOW_HEIGHT: f64 = 760.0;
const MAIN_WINDOW_WIDTH: f64 = 1120.0;

fn main_window_center_position(app: &tauri::App) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let position = work_area.position;
    let size = work_area.size;
    let x = position.x as f64 / scale_factor
        + (size.width as f64 / scale_factor - MAIN_WINDOW_WIDTH) / 2.0;
    let y = position.y as f64 / scale_factor
        + (size.height as f64 / scale_factor - MAIN_WINDOW_HEIGHT) / 2.0;

    Some((x.round(), y.round()))
}

pub(crate) fn create_main_window(
    app: &tauri::App,
    runtime: &StorageRuntimeState,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("tooldesk")
        .inner_size(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
        .min_inner_size(920.0, 620.0)
        .resizable(true)
        .decorations(false)
        .shadow(true)
        .data_directory(runtime.data_dir.clone());

    if let Some((x, y)) = main_window_center_position(app) {
        builder = builder.position(x, y);
    }

    let window = builder.build()?;

    #[cfg(target_os = "windows")]
    let _ = MAIN_WINDOW_APP.set(app.handle().clone());

    disable_system_menu(&window);
    intercept_system_menu_shortcut(&window);

    let app_handle = app.handle().clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let runtime = app_handle.state::<StorageRuntimeState>();

            if storage::read_close_to_tray(&runtime) {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        }
    });

    Ok(())
}
