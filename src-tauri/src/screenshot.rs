use crate::app_config;
use crate::diagnostics::{log_flow, log_memory};
use crate::quick_tool::{self, ShortcutContentState};
use crate::screen_recorder::RegionRecordingState;
use crate::storage::{self, StorageRuntimeState};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(not(target_os = "windows"))]
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
#[cfg(target_os = "windows")]
use std::mem;
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::MenuBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::GlobalFree;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{BITMAPINFOHEADER, BI_RGB};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Ole::CF_DIB;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetCursorPos, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, HWND_TOPMOST,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WS_CAPTION,
    WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
};
use xcap::Monitor;

static SCREENSHOT_OVERLAY_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static SCREENSHOT_PIN_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static SCREENSHOT_OVERLAY_OPENING_UNTIL_MS: AtomicI64 = AtomicI64::new(0);
static SCREENSHOT_OVERLAY_FINISHING: AtomicBool = AtomicBool::new(false);
static SCREENSHOT_OVERLAY_REOPEN_PENDING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotCaptureResult {
    captured_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
    data_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    height: u32,
    width: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotPinPayload {
    captured_at: i64,
    data_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    overlay_label: Option<String>,
    placement: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pixel_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pixel_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    screen_rect: Option<ScreenshotSelectionRect>,
    width: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotFrameResult {
    data_url: String,
    height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    rgba: Option<Vec<u8>>,
    width: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotColorFrameBounds {
    height: f64,
    width: f64,
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotColorFrame {
    bounds: ScreenshotColorFrameBounds,
    data_url: String,
    height: u32,
    scale: f64,
    width: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotMagnifierFrameOptions {
    sample_size: Option<u32>,
    x: i32,
    y: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotSampledColor {
    b: u8,
    g: u8,
    hex: String,
    r: u8,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotCursorPosition {
    x: i32,
    y: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotPickerSnapshot {
    color: Option<ScreenshotSampledColor>,
    frame: ScreenshotFrameResult,
    x: i32,
    y: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotActionStatus {
    message: String,
    ok: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotSelectionRect {
    height: f64,
    width: f64,
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegionRecordingPlaybackPayload {
    buffer: Vec<u8>,
    crop_rect: ScreenshotSelectionRect,
    duration_ms: Option<u64>,
    source_height: f64,
    source_width: f64,
}

#[derive(Default)]
pub(crate) struct ScreenshotRuntimeState {
    color_frames: Mutex<Vec<ScreenshotColorFrame>>,
    last_capture: Mutex<Option<ScreenshotCaptureResult>>,
    pin_menu_payload: Mutex<Option<ScreenshotPinMenuPayload>>,
    pin_payloads: Mutex<HashMap<String, ScreenshotPinPayload>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotPinMenuPayload {
    client_x: Option<f64>,
    client_y: Option<f64>,
    label: String,
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotOverlayOptions {
    mode: Option<String>,
    warm: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotOverlayOcrOptions {
    mode: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotOverlayOcrWord {
    height: u32,
    text: String,
    width: u32,
    x: u32,
    y: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotOverlayOcrResult {
    error: Option<String>,
    image_height: u32,
    image_width: u32,
    lines: Vec<String>,
    raw_text: String,
    words: Vec<ScreenshotOverlayOcrWord>,
}

#[derive(Clone, Debug, Deserialize)]
struct ServiceGatewayOcrWordLocation {
    height: Option<u32>,
    left: Option<u32>,
    top: Option<u32>,
    width: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
struct ServiceGatewayOcrWord {
    location: Option<ServiceGatewayOcrWordLocation>,
    words: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceGatewayOcrResponse {
    #[serde(alias = "words_result")]
    words_result: Option<Vec<ServiceGatewayOcrWord>>,
}

#[derive(Clone, Debug, Deserialize)]
struct ServiceGatewayTranslateResponse {
    provider: Option<String>,
    text: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct BaiduOcrTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct BaiduTranslateResponse {
    error_code: Option<String>,
    error_msg: Option<String>,
    trans_result: Option<Vec<BaiduTranslateItem>>,
}

#[derive(Clone, Debug, Deserialize)]
struct BaiduTranslateItem {
    dst: String,
}

fn default_screenshot_dir(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.cache_dir.join("screenshots")
}

fn default_recording_dir(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.cache_dir.join("recordings")
}

fn screenshot_file_name() -> String {
    format!(
        "tooldesk-{}.png",
        chrono::Local::now().format("%Y-%m-%dT%H-%M-%S-%3f")
    )
}

fn user_screenshot_file_name() -> String {
    format!(
        "screenshot-{}.png",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

fn recording_file_name() -> String {
    format!(
        "region-recording-{}.webm",
        chrono::Local::now().format("%Y-%m-%dT%H-%M-%S-%3f")
    )
}

fn encode_png(image: &xcap::image::RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), xcap::image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn capture_primary_monitor_png() -> Result<(u32, u32, Vec<u8>), String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let monitor = monitors
        .iter()
        .find(|item| item.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "未找到可截图的显示器".to_string())?;
    let image = monitor.capture_image().map_err(|error| error.to_string())?;
    let width = image.width();
    let height = image.height();
    let png = encode_png(&image)?;

    Ok((width, height, png))
}

fn capture_screenshot_color_frames() -> Result<Vec<ScreenshotColorFrame>, String> {
    let monitor = primary_monitor()?;
    let width = monitor.width().map_err(|error| error.to_string())?;
    let height = monitor.height().map_err(|error| error.to_string())?;
    let monitor_x = monitor.x().map_err(|error| error.to_string())?;
    let monitor_y = monitor.y().map_err(|error| error.to_string())?;
    let scale = f64::from(monitor.scale_factor().unwrap_or(1.0));
    let image = monitor.capture_image().map_err(|error| error.to_string())?;
    let png = encode_png(&image)?;

    Ok(vec![ScreenshotColorFrame {
        bounds: ScreenshotColorFrameBounds {
            height: height as f64,
            width: width as f64,
            x: monitor_x as f64,
            y: monitor_y as f64,
        },
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&png)),
        height,
        scale,
        width,
    }])
}

fn primary_monitor() -> Result<Monitor, String> {
    let mut monitors = Monitor::all().map_err(|error| error.to_string())?;
    let index = monitors
        .iter()
        .position(|item| item.is_primary().unwrap_or(false))
        .unwrap_or(0);

    if monitors.is_empty() {
        Err("未找到可截图的显示器".to_string())
    } else {
        Ok(monitors.remove(index))
    }
}

fn display_bounds_for_rect(rect: &ScreenshotSelectionRect) -> Result<(f64, f64, f64, f64), String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let center_x = rect.x + rect.width / 2.0;
    let center_y = rect.y + rect.height / 2.0;
    let matched = monitors
        .iter()
        .find(|monitor| {
            let Ok(x) = monitor.x() else {
                return false;
            };
            let Ok(y) = monitor.y() else {
                return false;
            };
            let Ok(width) = monitor.width() else {
                return false;
            };
            let Ok(height) = monitor.height() else {
                return false;
            };
            let x = x as f64;
            let y = y as f64;
            center_x >= x
                && center_x <= x + width as f64
                && center_y >= y
                && center_y <= y + height as f64
        })
        .or_else(|| {
            monitors
                .iter()
                .find(|item| item.is_primary().unwrap_or(false))
        })
        .or_else(|| monitors.first())
        .ok_or_else(|| "未找到可录制的显示器".to_string())?;

    Ok((
        matched.x().map_err(|error| error.to_string())? as f64,
        matched.y().map_err(|error| error.to_string())? as f64,
        matched.width().map_err(|error| error.to_string())? as f64,
        matched.height().map_err(|error| error.to_string())? as f64,
    ))
}

fn display_scale_for_rect(rect: &ScreenshotSelectionRect) -> f64 {
    let Ok(monitors) = Monitor::all() else {
        return 1.0;
    };
    let center_x = rect.x + rect.width / 2.0;
    let center_y = rect.y + rect.height / 2.0;
    monitors
        .iter()
        .find(|monitor| {
            let Ok(x) = monitor.x() else {
                return false;
            };
            let Ok(y) = monitor.y() else {
                return false;
            };
            let Ok(width) = monitor.width() else {
                return false;
            };
            let Ok(height) = monitor.height() else {
                return false;
            };
            let x = x as f64;
            let y = y as f64;
            center_x >= x
                && center_x <= x + width as f64
                && center_y >= y
                && center_y <= y + height as f64
        })
        .or_else(|| {
            monitors
                .iter()
                .find(|item| item.is_primary().unwrap_or(false))
        })
        .or_else(|| monitors.first())
        .and_then(|monitor| monitor.scale_factor().ok())
        .map(f64::from)
        .filter(|scale| scale.is_finite() && *scale > 0.0)
        .unwrap_or(1.0)
}

fn capture_primary_monitor_region_png(
    rect: &ScreenshotSelectionRect,
) -> Result<(u32, u32, Vec<u8>), String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let center_x = rect.x + rect.width / 2.0;
    let center_y = rect.y + rect.height / 2.0;
    let monitor = monitors
        .into_iter()
        .find(|monitor| {
            let Ok(x) = monitor.x() else {
                return false;
            };
            let Ok(y) = monitor.y() else {
                return false;
            };
            let Ok(width) = monitor.width() else {
                return false;
            };
            let Ok(height) = monitor.height() else {
                return false;
            };

            center_x >= x as f64
                && center_x < (x + width as i32) as f64
                && center_y >= y as f64
                && center_y < (y + height as i32) as f64
        })
        .or_else(|| primary_monitor().ok())
        .ok_or_else(|| "未找到可截图的显示器".to_string())?;
    let monitor_x = monitor.x().map_err(|error| error.to_string())?;
    let monitor_y = monitor.y().map_err(|error| error.to_string())?;
    let monitor_width = monitor.width().map_err(|error| error.to_string())?;
    let monitor_height = monitor.height().map_err(|error| error.to_string())?;
    let local_x = rect.x - monitor_x as f64;
    let local_y = rect.y - monitor_y as f64;
    let x = local_x
        .round()
        .clamp(0.0, monitor_width.saturating_sub(1) as f64) as u32;
    let y = local_y
        .round()
        .clamp(0.0, monitor_height.saturating_sub(1) as f64) as u32;
    let width = rect
        .width
        .round()
        .clamp(1.0, monitor_width.saturating_sub(x) as f64) as u32;
    let height = rect
        .height
        .round()
        .clamp(1.0, monitor_height.saturating_sub(y) as f64) as u32;
    let image = monitor
        .capture_region(x, y, width, height)
        .map_err(|error| error.to_string())?;
    let png = encode_png(&image)?;

    Ok((image.width(), image.height(), png))
}

#[cfg(target_os = "windows")]
fn capture_current_screen_region_png(
    rect: &ScreenshotSelectionRect,
) -> Result<(u32, u32, Vec<u8>), String> {
    let (width, height, png, _rgba) = capture_current_screen_region_png_with_rgba(rect)?;
    Ok((width, height, png))
}

#[cfg(target_os = "windows")]
fn capture_current_screen_region_png_with_rgba(
    rect: &ScreenshotSelectionRect,
) -> Result<(u32, u32, Vec<u8>, Vec<u8>), String> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
    use xcap::image::{Rgba, RgbaImage};

    let width = rect.width.round().clamp(1.0, 120.0) as u32;
    let height = rect.height.round().clamp(1.0, 120.0) as u32;
    let left = rect.x.round() as i32;
    let top = rect.y.round() as i32;

    unsafe {
        let desktop: HWND = std::ptr::null_mut();
        let hdc = GetDC(desktop);

        if hdc.is_null() {
            return Err("无法获取屏幕 DC".to_string());
        }

        let mut image = RgbaImage::new(width, height);
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);

        for y in 0..height {
            for x in 0..width {
                let color_ref = GetPixel(hdc, left + x as i32, top + y as i32);
                let pixel = if color_ref == 0xFFFF_FFFF {
                    [0, 0, 0, 255]
                } else {
                    [
                        (color_ref & 0xFF) as u8,
                        ((color_ref >> 8) & 0xFF) as u8,
                        ((color_ref >> 16) & 0xFF) as u8,
                        255,
                    ]
                };

                rgba.extend_from_slice(&pixel);
                image.put_pixel(x, y, Rgba(pixel));
            }
        }

        let _ = ReleaseDC(desktop, hdc);
        let png = encode_png(&image)?;

        Ok((width, height, png, rgba))
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_current_screen_region_png(
    rect: &ScreenshotSelectionRect,
) -> Result<(u32, u32, Vec<u8>), String> {
    capture_primary_monitor_region_png(rect)
}

#[cfg(not(target_os = "windows"))]
fn capture_current_screen_region_png_with_rgba(
    rect: &ScreenshotSelectionRect,
) -> Result<(u32, u32, Vec<u8>, Vec<u8>), String> {
    let (width, height, png) = capture_primary_monitor_region_png(rect)?;
    Ok((width, height, png, Vec::new()))
}

fn store_last_capture(
    app: &AppHandle,
    state: &ScreenshotRuntimeState,
    result: ScreenshotCaptureResult,
) -> Result<ScreenshotCaptureResult, String> {
    let previous_data_url_len = {
        let last_capture = state
            .last_capture
            .lock()
            .map_err(|_| "截图状态不可用".to_string())?;
        last_capture
            .as_ref()
            .map(|capture| capture.data_url.len())
            .unwrap_or(0)
    };
    log_memory(
        "screenshot-memory",
        format!(
            "store_last_capture size={}x{} data_url_bytes={} previous_data_url_bytes={previous_data_url_len}",
            result.width,
            result.height,
            result.data_url.len()
        ),
    );

    {
        let mut last_capture = state
            .last_capture
            .lock()
            .map_err(|_| "截图状态不可用".to_string())?;
        *last_capture = Some(result.clone());
    }

    app.emit("screenshot:captured", result.clone())
        .map_err(|error| error.to_string())?;
    Ok(result)
}

fn build_capture_result(
    runtime: &StorageRuntimeState,
    width: u32,
    height: u32,
    png: Vec<u8>,
) -> Result<ScreenshotCaptureResult, String> {
    let png_len = png.len();
    let screenshot_dir = default_screenshot_dir(runtime);
    fs::create_dir_all(&screenshot_dir).map_err(|error| error.to_string())?;
    let file_path = screenshot_dir.join(screenshot_file_name());
    fs::write(&file_path, &png).map_err(|error| error.to_string())?;
    log_memory(
        "screenshot-memory",
        format!(
            "build_capture_result size={}x{} png_bytes={png_len}",
            width, height
        ),
    );

    Ok(ScreenshotCaptureResult {
        captured_at: chrono::Utc::now().timestamp_millis(),
        canceled: None,
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&png)),
        file_path: Some(crate::storage::path_to_string(&file_path)),
        height,
        width,
    })
}

fn build_capture_result_from_png(
    runtime: &StorageRuntimeState,
    width: u32,
    height: u32,
    png: Vec<u8>,
) -> Result<ScreenshotCaptureResult, String> {
    build_capture_result(runtime, width, height, png)
}

fn png_from_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let Some((metadata, payload)) = data_url.split_once(',') else {
        return Err("截图数据格式无效".to_string());
    };

    if !metadata.starts_with("data:image/png;base64") {
        return Err("仅支持 PNG 截图数据".to_string());
    }

    BASE64_STANDARD
        .decode(payload)
        .map_err(|_| "截图数据解码失败".to_string())
}

fn data_url_dimensions(png: &[u8]) -> Result<(u32, u32), String> {
    let image = xcap::image::load_from_memory(png).map_err(|error| error.to_string())?;
    Ok((image.width(), image.height()))
}

#[cfg(target_os = "windows")]
fn copy_png_to_clipboard_native_windows(png: &[u8]) -> Result<(), String> {
    let image = xcap::image::load_from_memory(png)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let width = image.width();
    let height = image.height();
    let pixels = image.into_raw();
    let header_size = mem::size_of::<BITMAPINFOHEADER>();
    let pixel_size = pixels.len();
    let total_size = header_size + pixel_size;

    let mut dib = Vec::with_capacity(total_size);
    let header = BITMAPINFOHEADER {
        biSize: header_size as u32,
        biWidth: width as i32,
        biHeight: -(height as i32),
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        biSizeImage: pixel_size as u32,
        biXPelsPerMeter: 0,
        biYPelsPerMeter: 0,
        biClrUsed: 0,
        biClrImportant: 0,
    };
    let header_bytes = unsafe {
        std::slice::from_raw_parts(
            (&header as *const BITMAPINFOHEADER).cast::<u8>(),
            header_size,
        )
    };
    dib.extend_from_slice(header_bytes);

    for rgba in pixels.chunks_exact(4) {
        dib.push(rgba[2]);
        dib.push(rgba[1]);
        dib.push(rgba[0]);
        dib.push(rgba[3]);
    }

    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err("打开剪贴板失败".to_string());
        }

        let result = (|| {
            if EmptyClipboard() == 0 {
                return Err("清空剪贴板失败".to_string());
            }

            let handle = GlobalAlloc(GMEM_MOVEABLE, dib.len());
            if handle.is_null() {
                return Err("分配剪贴板内存失败".to_string());
            }

            let target = GlobalLock(handle);
            if target.is_null() {
                let _ = GlobalFree(handle);
                return Err("锁定剪贴板内存失败".to_string());
            }

            ptr::copy_nonoverlapping(dib.as_ptr(), target.cast::<u8>(), dib.len());
            let _ = GlobalUnlock(handle);

            if SetClipboardData(CF_DIB.into(), handle).is_null() {
                let _ = GlobalFree(handle);
                return Err("写入剪贴板图片失败".to_string());
            }

            Ok(())
        })();

        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(target_os = "windows"))]
fn copy_png_to_clipboard(png: &[u8]) -> Result<(), String> {
    let image = xcap::image::load_from_memory(png)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let width = image.width() as usize;
    let height = image.height() as usize;
    let bytes = image.into_raw();
    let data = arboard::ImageData {
        bytes: Cow::Owned(bytes),
        height,
        width,
    };
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_image(data).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn copy_png_to_clipboard(png: &[u8]) -> Result<(), String> {
    copy_png_to_clipboard_native_windows(png)
}

fn copy_png_to_clipboard_with_retry(png: &[u8]) -> Result<(), String> {
    let mut last_error = None;

    for _ in 0..5 {
        match copy_png_to_clipboard(png) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(60));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "写入剪贴板失败".to_string()))
}

fn copy_png_to_clipboard_in_background(png: Vec<u8>) {
    thread::spawn(move || {
        if let Err(error) = copy_png_to_clipboard(&png) {
            eprintln!("[tauri-screenshot] copy image to clipboard failed: {error}");
        }
    });
}

async fn post_service_gateway(app: &AppHandle, payload: Value) -> Result<Value, String> {
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let config = serde_json::to_value(app_config::resolve_service_gateway_config(app))
        .map_err(|error| error.to_string())?;
    let function_url = config
        .get("functionUrl")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    if function_url.is_empty() {
        return Err("未配置云函数服务地址".to_string());
    }

    let mut body = payload;

    if let Value::Object(object) = &mut body {
        object.insert("schemaVersion".to_string(), Value::from(1));
    }

    let body_text = serde_json::to_string(&body).map_err(|error| error.to_string())?;
    let mut request = reqwest::Client::new()
        .post(&function_url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("x-tooldesk-app-version", env!("CARGO_PKG_VERSION"))
        .body(body_text.clone());
    let api_key = config
        .get("apiKey")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let signed = app_config::sign_service_gateway_body(app, body_text.clone())?;

    log_flow(
        "service-gateway",
        format!(
            "request action={action} function_configured={} api_key_configured={} signed={} body_bytes={}",
            !function_url.is_empty(),
            !api_key.is_empty(),
            signed.is_some(),
            body_text.len()
        ),
    );

    if !api_key.is_empty() {
        request = request
            .header("apikey", api_key.clone())
            .header("Authorization", format!("Bearer {api_key}"));
    }

    if let Some(signature) = signed {
        request = request
            .header("x-tooldesk-body-sha256", signature.body_sha256)
            .header("x-tooldesk-device-id", signature.device_id)
            .header("x-tooldesk-nonce", signature.nonce)
            .header("x-tooldesk-signature", signature.signature)
            .header("x-tooldesk-timestamp", signature.timestamp);
    }

    let response = request.send().await.map_err(|error| {
        log_flow(
            "service-gateway",
            format!("request failed action={action} error={error}"),
        );
        error.to_string()
    })?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
            .unwrap_or_else(|| format!("云函数请求失败 HTTP {}", status.as_u16()));
        log_flow(
            "service-gateway",
            format!(
                "response failed action={action} status={} message={message}",
                status.as_u16()
            ),
        );
        return Err(message);
    }

    log_flow(
        "service-gateway",
        format!(
            "response ok action={action} status={} body_bytes={}",
            status.as_u16(),
            text.len()
        ),
    );

    serde_json::from_str(&text).map_err(|error| {
        log_flow(
            "service-gateway",
            format!("response parse failed action={action} error={error}"),
        );
        error.to_string()
    })
}

fn read_app_settings(runtime: &StorageRuntimeState) -> Value {
    storage::read_app_settings_value(runtime, serde_json::json!({}))
}

fn setting_text<'a>(settings: &'a Value, keys: &[&str]) -> &'a str {
    let mut cursor = settings;

    for key in keys {
        let Some(next) = cursor.get(*key) else {
            return "";
        };
        cursor = next;
    }

    cursor.as_str().unwrap_or_default().trim()
}

fn baidu_ocr_api_path(api_variant: &str, mode: &str) -> &'static str {
    match (api_variant, mode) {
        ("accurate_located", "fast_text") => "/rest/2.0/ocr/v1/accurate_basic",
        ("accurate_located", _) => "/rest/2.0/ocr/v1/accurate",
        (_, "fast_text") => "/rest/2.0/ocr/v1/general_basic",
        _ => "/rest/2.0/ocr/v1/general",
    }
}

fn baidu_language_code(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "auto" => "auto".to_string(),
        "es" => "spa".to_string(),
        "fr" => "fra".to_string(),
        "ja" => "jp".to_string(),
        "ko" => "kor".to_string(),
        "zh-cn" | "zh_cn" | "zh" => "zh".to_string(),
        "zh-tw" | "zh_tw" => "cht".to_string(),
        other => other.to_string(),
    }
}

async fn fetch_baidu_ocr_access_token(api_key: &str, secret_key: &str) -> Result<String, String> {
    let response = reqwest::Client::new()
        .post("https://aip.baidubce.com/oauth/2.0/token")
        .query(&[
            ("client_id", api_key),
            ("client_secret", secret_key),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        return Err(format!("获取百度 OCR Token 失败 HTTP {}", status.as_u16()));
    }

    let data: BaiduOcrTokenResponse =
        serde_json::from_str(&text).map_err(|error| error.to_string())?;

    data.access_token.ok_or_else(|| {
        data.error_description
            .or(data.error)
            .unwrap_or_else(|| "获取百度 OCR Token 失败".to_string())
    })
}

async fn recognize_with_baidu_ocr(
    image_base64: String,
    api_key: &str,
    secret_key: &str,
    api_variant: &str,
    mode: &str,
) -> Result<ServiceGatewayOcrResponse, String> {
    let access_token = fetch_baidu_ocr_access_token(api_key, secret_key).await?;
    let url = format!(
        "https://aip.baidubce.com{}",
        baidu_ocr_api_path(api_variant, mode)
    );
    let response = reqwest::Client::new()
        .post(url)
        .query(&[("access_token", access_token)])
        .form(&[
            ("detect_direction", "true"),
            ("image", image_base64.as_str()),
            ("paragraph", "false"),
            ("probability", "false"),
            ("vertexes_location", "false"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        return Err(format!("百度 OCR 请求失败 HTTP {}", status.as_u16()));
    }

    let value: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;

    if let Some(error_code) = value.get("error_code").and_then(Value::as_i64) {
        let message = value
            .get("error_msg")
            .and_then(Value::as_str)
            .unwrap_or("百度 OCR 识别失败");
        return Err(format!("{message} ({error_code})"));
    }

    serde_json::from_value(value).map_err(|error| error.to_string())
}

async fn translate_with_baidu(
    app_id: &str,
    secret_key: &str,
    text: &str,
    from: &str,
    to: &str,
) -> Result<String, String> {
    let salt = chrono::Utc::now().timestamp_millis().to_string();
    let sign = format!(
        "{:x}",
        md5::compute(format!("{app_id}{text}{salt}{secret_key}"))
    );
    let response = reqwest::Client::new()
        .get("https://fanyi-api.baidu.com/api/trans/vip/translate")
        .query(&[
            ("appid", app_id),
            ("from", baidu_language_code(from).as_str()),
            ("q", text),
            ("salt", salt.as_str()),
            ("sign", sign.as_str()),
            ("to", baidu_language_code(to).as_str()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        return Err(format!("百度翻译请求失败 HTTP {}", status.as_u16()));
    }

    let data: BaiduTranslateResponse =
        serde_json::from_str(&body).map_err(|error| error.to_string())?;

    if let Some(error_code) = data.error_code {
        return Err(data
            .error_msg
            .unwrap_or_else(|| format!("百度翻译错误 {error_code}")));
    }

    let translated = data
        .trans_result
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.dst)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if translated.is_empty() {
        return Err("百度翻译未返回结果".to_string());
    }

    Ok(translated)
}

const PIN_GLOW_PADDING: f64 = 14.0;
const PIN_MENU_OFFSET_X: f64 = 8.0;
const PIN_MENU_OFFSET_Y: f64 = 12.0;
const PIN_MENU_COPY_ID: &str = "screenshot-pin-copy";
const PIN_MENU_SAVE_ID: &str = "screenshot-pin-save";
const PIN_MENU_CLOSE_ID: &str = "screenshot-pin-close";

fn pin_content_size(
    result: &ScreenshotCaptureResult,
    screen_rect: Option<&ScreenshotSelectionRect>,
) -> (f64, f64) {
    if let Some(rect) = screen_rect {
        let scale = display_scale_for_rect(rect);
        return (
            (rect.width / scale).round().max(1.0),
            (rect.height / scale).round().max(1.0),
        );
    }

    (result.width.max(1) as f64, result.height.max(1) as f64)
}

fn pin_window_size(
    result: &ScreenshotCaptureResult,
    screen_rect: Option<&ScreenshotSelectionRect>,
) -> (f64, f64) {
    let (natural_width, natural_height) = pin_content_size(result, screen_rect);
    let width = natural_width.round().max(1.0) + PIN_GLOW_PADDING * 2.0;
    let height = natural_height.round().max(1.0) + PIN_GLOW_PADDING * 2.0;

    (width, height)
}

fn pin_window_bounds(
    result: &ScreenshotCaptureResult,
    screen_rect: Option<&ScreenshotSelectionRect>,
) -> (f64, f64, Option<(f64, f64)>) {
    if let Some(rect) = screen_rect {
        let (width, height) = pin_window_size(result, screen_rect);
        let scale = display_scale_for_rect(rect);
        return (
            width,
            height,
            Some((
                rect.x / scale - PIN_GLOW_PADDING,
                rect.y / scale - PIN_GLOW_PADDING,
            )),
        );
    }

    let (width, height) = pin_window_size(result, screen_rect);
    (width, height, None)
}

fn rects_overlap(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    let (a_left, a_top, a_width, a_height) = a;
    let (b_left, b_top, b_width, b_height) = b;
    let a_right = a_left + a_width;
    let a_bottom = a_top + a_height;
    let b_right = b_left + b_width;
    let b_bottom = b_top + b_height;

    a_left < b_right && a_right > b_left && a_top < b_bottom && a_bottom > b_top
}

fn cascade_pin_window_position(
    app: &AppHandle,
    state: &ScreenshotRuntimeState,
    position: Option<(f64, f64)>,
    width: f64,
    height: f64,
) -> Option<(f64, f64)> {
    let (left, top) = position?;
    let labels = state
        .pin_payloads
        .lock()
        .ok()
        .map(|payloads| payloads.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let occupied_bounds = labels
        .into_iter()
        .filter_map(|label| {
            let window = app.get_webview_window(&label)?;
            let position = window.outer_position().ok()?;
            let size = window.outer_size().ok()?;

            Some((
                position.x as f64,
                position.y as f64,
                size.width as f64,
                size.height as f64,
            ))
        })
        .collect::<Vec<_>>();

    if occupied_bounds.is_empty() {
        return Some((left, top));
    }

    const PIN_CASCADE_OFFSET: f64 = 28.0;
    let mut next_left = left;
    let mut next_top = top;

    for _ in 0..24 {
        let next_bounds = (next_left, next_top, width, height);

        if occupied_bounds
            .iter()
            .all(|bounds| !rects_overlap(next_bounds, *bounds))
        {
            return Some((next_left, next_top));
        }

        next_left += PIN_CASCADE_OFFSET;
        next_top += PIN_CASCADE_OFFSET;
    }

    Some((next_left, next_top))
}

fn next_pin_screenshot_label() -> String {
    let pin_sequence = SCREENSHOT_PIN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "screenshot-pin-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        pin_sequence
    )
}

fn keep_pin_screenshot_windows_visible(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("screenshot-pin-") && !label.starts_with("screenshot-pin-menu-") {
            let _ = window.show();
            force_pin_window_visible_topmost(&window);
        }
    }
}

#[cfg(target_os = "windows")]
fn force_pin_window_visible_topmost(window: &tauri::WebviewWindow) {
    let _ = window.set_always_on_top(true);
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
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn force_pin_window_visible_topmost(window: &tauri::WebviewWindow) {
    let _ = window.set_always_on_top(true);
}

fn schedule_keep_pin_screenshot_windows_visible(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(80));
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            keep_pin_screenshot_windows_visible(&app_handle);
        });
    });
}

fn build_pin_payload(
    result: &ScreenshotCaptureResult,
    screen_rect: Option<ScreenshotSelectionRect>,
    overlay_label: Option<String>,
) -> ScreenshotPinPayload {
    let (display_width, display_height) = pin_content_size(result, screen_rect.as_ref());

    ScreenshotPinPayload {
        captured_at: result.captured_at,
        data_url: result.data_url.clone(),
        file_path: result.file_path.clone(),
        height: display_height.round().max(1.0) as u32,
        overlay_label,
        placement: if screen_rect.is_some() {
            "inPlace"
        } else {
            "floating"
        },
        pixel_height: Some(result.height),
        pixel_width: Some(result.width),
        screen_rect,
        width: display_width.round().max(1.0) as u32,
    }
}

#[tauri::command]
pub(crate) fn pin_screenshot(
    app: AppHandle,
    state: State<'_, ScreenshotRuntimeState>,
    payload: Option<ScreenshotCaptureResult>,
    rect: Option<ScreenshotSelectionRect>,
) -> Result<bool, String> {
    let result = if let Some(value) = payload {
        value
    } else {
        state
            .last_capture
            .lock()
            .map_err(|_| "截图状态不可用".to_string())?
            .clone()
            .ok_or_else(|| "暂无可贴图的截图".to_string())?
    };

    create_pin_screenshot_window(&app, &state, result, rect, None)
}

fn create_pin_screenshot_window(
    app: &AppHandle,
    state: &ScreenshotRuntimeState,
    result: ScreenshotCaptureResult,
    rect: Option<ScreenshotSelectionRect>,
    overlay_label: Option<String>,
) -> Result<bool, String> {
    let (width, height, position) = pin_window_bounds(&result, rect.as_ref());
    let position = cascade_pin_window_position(app, state, position, width, height);
    let label = next_pin_screenshot_label();
    let url = format!("screenshot-pin.html?label={}", urlencoding::encode(&label));
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .always_on_top(true)
        .decorations(false)
        .focused(true)
        .inner_size(width, height)
        .resizable(true)
        .shadow(false)
        .skip_taskbar(true)
        .transparent(true)
        .visible(false)
        .title("tooldesk 贴图");

    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }

    let pin_payload = build_pin_payload(&result, rect, overlay_label);
    {
        let mut pin_payloads = state
            .pin_payloads
            .lock()
            .map_err(|_| "贴图状态不可用".to_string())?;
        pin_payloads.insert(label.clone(), pin_payload);
        log_memory(
            "screenshot-memory",
            format!(
                "pin_payload_insert label={label} payload_count={} data_url_bytes={} window_size={:.0}x{:.0}",
                pin_payloads.len(),
                result.data_url.len(),
                width,
                height
            ),
        );
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    let _ = window.set_always_on_top(true);
    schedule_keep_pin_screenshot_windows_visible(app.clone());
    Ok(true)
}

fn schedule_pin_screenshot_window(
    app: AppHandle,
    result: ScreenshotCaptureResult,
    rect: ScreenshotSelectionRect,
) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(0));
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = app_handle.state::<ScreenshotRuntimeState>();
            if let Err(error) =
                create_pin_screenshot_window(&app_handle, &state, result, Some(rect), None)
            {
                eprintln!("[tauri-screenshot] open pin window failed: {error}");
            }
        });
    });
}

#[tauri::command]
pub(crate) fn get_pin_screenshot_payload(
    state: State<'_, ScreenshotRuntimeState>,
    label: String,
) -> Result<Option<ScreenshotPinPayload>, String> {
    let pin_payloads = state
        .pin_payloads
        .lock()
        .map_err(|_| "贴图状态不可用".to_string())?;

    Ok(pin_payloads.get(&label).cloned())
}

#[tauri::command]
pub(crate) fn move_pin_screenshot_window(
    app: AppHandle,
    label: String,
    dx: f64,
    dy: f64,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    let position = window.outer_position().map_err(|error| error.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(
            position.x + dx.round() as i32,
            position.y + dy.round() as i32,
        ))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn resize_pin_screenshot_window(
    app: AppHandle,
    label: String,
    height: f64,
    width: f64,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };

    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            width.max(80.0),
            height.max(60.0),
        )))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn focus_pin_screenshot_window(app: AppHandle, label: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };

    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn reveal_pin_screenshot_window(app: AppHandle, label: String) -> Result<(), String> {
    let overlay_label = {
        let state = app.state::<ScreenshotRuntimeState>();
        let pin_payloads = state
            .pin_payloads
            .lock()
            .map_err(|_| "贴图状态不可用".to_string())?;
        pin_payloads
            .get(&label)
            .and_then(|payload| payload.overlay_label.clone())
    };

    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };

    let _ = window.set_always_on_top(true);
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    keep_pin_screenshot_windows_visible(&app);

    if let Some(overlay_label) = overlay_label {
        if let Some(overlay) = app.get_webview_window(&overlay_label) {
            let _ = overlay.close();
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn close_pin_screenshot_window(
    app: AppHandle,
    state: State<'_, ScreenshotRuntimeState>,
    label: String,
) -> Result<(), String> {
    if let Ok(mut pin_payloads) = state.pin_payloads.lock() {
        pin_payloads.remove(&label);
        log_memory(
            "screenshot-memory",
            format!(
                "pin_payload_remove label={label} payload_count={}",
                pin_payloads.len()
            ),
        );
    }

    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };

    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn copy_pin_screenshot(payload: ScreenshotCaptureResult) -> Result<bool, String> {
    let png = png_from_data_url(&payload.data_url)?;
    copy_png_to_clipboard_in_background(png);
    Ok(true)
}

#[tauri::command]
pub(crate) fn save_pin_screenshot(
    app: AppHandle,
    payload: ScreenshotCaptureResult,
) -> Result<Option<String>, String> {
    save_pin_screenshot_payload(&app, &payload)
}

fn save_pin_screenshot_payload(
    app: &AppHandle,
    payload: &ScreenshotCaptureResult,
) -> Result<Option<String>, String> {
    let png = png_from_data_url(&payload.data_url)?;
    save_screenshot_png_with_blocking_dialog(app, &png)
}

fn save_screenshot_png_to_path(
    file_path: tauri_plugin_dialog::FilePath,
    png: &[u8],
) -> Result<String, String> {
    let path = file_path.into_path().map_err(|error| error.to_string())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, png).map_err(|error| error.to_string())?;
    Ok(storage::path_to_string(&path))
}

fn save_screenshot_png_with_blocking_dialog(
    app: &AppHandle,
    png: &[u8],
) -> Result<Option<String>, String> {
    let pictures_dir = app
        .path()
        .picture_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let screenshot_dir = pictures_dir.join("tooldesk-screenshots");
    let file_name = user_screenshot_file_name();
    let file_path = app
        .dialog()
        .file()
        .add_filter("PNG 图片", &["png"])
        .set_directory(&screenshot_dir)
        .set_file_name(file_name)
        .blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(None);
    };

    save_screenshot_png_to_path(file_path, png).map(Some)
}

async fn save_screenshot_png_with_dialog(
    app: &AppHandle,
    png: &[u8],
    parent: Option<&tauri::WebviewWindow>,
) -> Result<Option<String>, String> {
    let pictures_dir = app
        .path()
        .picture_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let screenshot_dir = pictures_dir.join("tooldesk-screenshots");
    let file_name = user_screenshot_file_name();
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("PNG 图片", &["png"])
        .set_directory(&screenshot_dir)
        .set_file_name(file_name);

    if let Some(parent) = parent {
        let _ = parent.set_focus();
        dialog = dialog.set_parent(parent);
    }

    let (sender, receiver) = mpsc::channel();
    dialog.save_file(move |file_path| {
        let _ = sender.send(file_path);
    });
    let file_path = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;

    let Some(file_path) = file_path else {
        return Ok(None);
    };
    save_screenshot_png_to_path(file_path, png).map(Some)
}

fn pin_menu_position(payload: &ScreenshotPinMenuPayload) -> tauri::LogicalPosition<f64> {
    tauri::LogicalPosition::new(
        payload.client_x.unwrap_or(0.0) + PIN_MENU_OFFSET_X,
        payload.client_y.unwrap_or(0.0) + PIN_MENU_OFFSET_Y,
    )
}

#[tauri::command]
pub(crate) fn show_pin_screenshot_menu(
    app: AppHandle,
    state: State<'_, ScreenshotRuntimeState>,
    payload: ScreenshotPinMenuPayload,
) -> Result<bool, String> {
    let Some(window) = app.get_webview_window(&payload.label) else {
        return Ok(false);
    };
    {
        let mut pin_menu_payload = state
            .pin_menu_payload
            .lock()
            .map_err(|_| "贴图菜单状态不可用".to_string())?;
        *pin_menu_payload = Some(payload.clone());
    }

    let menu = MenuBuilder::new(&app)
        .text(PIN_MENU_COPY_ID, "复制")
        .text(PIN_MENU_SAVE_ID, "保存")
        .separator()
        .text(PIN_MENU_CLOSE_ID, "关闭贴图")
        .build()
        .map_err(|error| error.to_string())?;
    window
        .popup_menu_at(&menu, pin_menu_position(&payload))
        .map_err(|error| error.to_string())?;

    Ok(true)
}

fn run_pin_screenshot_menu_action(
    app: AppHandle,
    state: &ScreenshotRuntimeState,
    label: String,
    action: String,
) -> Result<(), String> {
    if let Ok(mut pin_menu_payload) = state.pin_menu_payload.lock() {
        *pin_menu_payload = None;
    }

    match action.as_str() {
        "close" => {
            if let Ok(mut pin_payloads) = state.pin_payloads.lock() {
                pin_payloads.remove(&label);
            }

            if let Some(pin) = app.get_webview_window(&label) {
                pin.close().map_err(|error| error.to_string())?;
            }
        }
        "copy" => {
            let payload = state
                .pin_payloads
                .lock()
                .map_err(|_| "贴图状态不可用".to_string())?
                .get(&label)
                .cloned();

            if let Some(payload) = payload {
                let png = png_from_data_url(&payload.data_url)?;
                copy_png_to_clipboard_in_background(png);
            }
        }
        "download" => {
            let payload = state
                .pin_payloads
                .lock()
                .map_err(|_| "贴图状态不可用".to_string())?
                .get(&label)
                .cloned();

            if let Some(payload) = payload {
                let capture = ScreenshotCaptureResult {
                    captured_at: payload.captured_at,
                    canceled: None,
                    data_url: payload.data_url,
                    file_path: payload.file_path,
                    height: payload.height,
                    width: payload.width,
                };
                let _ = save_pin_screenshot_payload(&app, &capture)?;
            }
        }
        _ => {}
    }

    Ok(())
}

pub(crate) fn handle_pin_screenshot_menu_event(app: &AppHandle, menu_id: &str) {
    let action = match menu_id {
        PIN_MENU_COPY_ID => "copy",
        PIN_MENU_SAVE_ID => "download",
        PIN_MENU_CLOSE_ID => "close",
        _ => return,
    };
    let state = app.state::<ScreenshotRuntimeState>();
    let label = state
        .pin_menu_payload
        .lock()
        .ok()
        .and_then(|payload| payload.as_ref().map(|payload| payload.label.clone()));

    let Some(label) = label else {
        return;
    };

    if let Err(error) =
        run_pin_screenshot_menu_action(app.clone(), &state, label, action.to_string())
    {
        eprintln!("[tauri-screenshot pin-menu] action failed error={error}");
    }
}

#[tauri::command]
pub(crate) fn start_screenshot(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    state: State<'_, ScreenshotRuntimeState>,
) -> Result<ScreenshotCaptureResult, String> {
    log_memory("screenshot-memory", "start_screenshot begin");
    let (width, height, png) = capture_primary_monitor_png()?;
    let result = build_capture_result(&runtime, width, height, png)?;

    store_last_capture(&app, &state, result)
}

pub(crate) fn open_screenshot_selection_window(
    app: AppHandle,
    runtime: &StorageRuntimeState,
) -> Result<bool, String> {
    log_memory("screenshot-memory", "open_selection begin");
    clear_screenshot_color_frames(&app);
    open_screenshot_overlay_window(
        app,
        runtime,
        ScreenshotOverlayOptions {
            mode: None,
            warm: false,
        },
    )
}

pub(crate) fn warm_screenshot_overlay(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(900));
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if count_screenshot_overlay_windows(&app_for_main) > 0 {
                log_flow("screenshot", "warm skipped existing_overlay");
                return;
            }

            let runtime = app_for_main.state::<StorageRuntimeState>();
            match open_screenshot_overlay_window(
                app_for_main.clone(),
                &runtime,
                ScreenshotOverlayOptions {
                    mode: None,
                    warm: true,
                },
            ) {
                Ok(value) => log_flow("screenshot", format!("warm done result={value}")),
                Err(error) => log_flow("screenshot", format!("warm failed error={error}")),
            }
        });
    });
}

fn clear_screenshot_color_frames(app: &AppHandle) {
    let state = app.state::<ScreenshotRuntimeState>();
    if let Ok(mut frames) = state.color_frames.lock() {
        let count = frames.len();
        let total_data_url_bytes: usize = frames.iter().map(|frame| frame.data_url.len()).sum();
        frames.clear();
        log_memory(
            "screenshot-memory",
            format!("color_frames_clear count={count} data_url_bytes={total_data_url_bytes}"),
        );
    };
}

#[cfg(target_os = "windows")]
fn force_screenshot_overlay_borderless(window: &tauri::WebviewWindow, show_window: bool) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd.0 as _, GWL_STYLE);
        let next_style = style
            & !((WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)
                as isize);

        if next_style != style {
            SetWindowLongPtrW(hwnd.0 as _, GWL_STYLE, next_style);
        }

        let flags = if show_window {
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_FRAMECHANGED
        } else {
            SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED
        };

        SetWindowPos(hwnd.0 as _, HWND_TOPMOST, 0, 0, 0, 0, flags);
    }
}

#[cfg(not(target_os = "windows"))]
fn force_screenshot_overlay_borderless(window: &tauri::WebviewWindow, show_window: bool) {
    let _ = (window, show_window);
}

fn open_screenshot_overlay_window(
    app: AppHandle,
    runtime: &StorageRuntimeState,
    options: ScreenshotOverlayOptions,
) -> Result<bool, String> {
    if !options.warm && SCREENSHOT_OVERLAY_FINISHING.load(Ordering::Relaxed) {
        SCREENSHOT_OVERLAY_REOPEN_PENDING.store(true, Ordering::Relaxed);
        log_flow("screenshot", "open deferred finishing");
        return Ok(true);
    }

    mark_screenshot_overlay_opening();
    log_flow(
        "screenshot",
        format!(
            "open requested mode={:?} warm={} existing={}",
            options.mode,
            options.warm,
            count_screenshot_overlay_windows(&app)
        ),
    );

    if options.warm {
        if count_screenshot_overlay_windows(&app) > 0 {
            log_flow("screenshot", "warm skipped existing_overlay");
            return Ok(true);
        }
    } else if let Some(window) = find_screenshot_overlay_window(&app) {
        log_flow(
            "screenshot",
            format!("reuse overlay label={}", window.label()),
        );

        if window.is_visible().unwrap_or(false) {
            let monitor = primary_monitor()?;
            let monitor_x = monitor.x().map_err(|error| error.to_string())?;
            let monitor_y = monitor.y().map_err(|error| error.to_string())?;
            let scale_factor = f64::from(monitor.scale_factor().unwrap_or(1.0));
            let mode = options.mode.as_deref().unwrap_or("");
            let config_script = format!(
                "window.tauriScreenshotOverlayLabel={label:?};window.tauriScreenshotOverlayConfig={{mode:{mode:?}||null,ocrEnabled:true,offsetX:{monitor_x},offsetY:{monitor_y},scale:{scale_factor},translateEnabled:true}};if(window.tauriScreenshotOverlayHandleShortcutStart){{window.tauriScreenshotOverlayHandleShortcutStart(window.tauriScreenshotOverlayConfig);}}",
                label = window.label(),
            );
            log_flow(
                "screenshot",
                format!(
                    "reuse visible overlay request_start label={}",
                    window.label()
                ),
            );
            let _ = window.eval(&config_script);
            let _ = window.set_decorations(false);
            let _ = window.set_fullscreen(true);
            let _ = window.set_always_on_top(true);
            force_screenshot_overlay_borderless(&window, true);
            let _ = window.set_focus();
            return Ok(true);
        }

        let monitor = primary_monitor()?;
        let monitor_x = monitor.x().map_err(|error| error.to_string())?;
        let monitor_y = monitor.y().map_err(|error| error.to_string())?;
        let scale_factor = f64::from(monitor.scale_factor().unwrap_or(1.0));
        let mode = options.mode.as_deref().unwrap_or("");
        let config_script = format!(
            "window.tauriScreenshotOverlayLabel={label:?};window.tauriScreenshotOverlayConfig={{mode:{mode:?}||null,ocrEnabled:true,offsetX:{monitor_x},offsetY:{monitor_y},scale:{scale_factor},translateEnabled:true}};if(window.tauriScreenshotOverlayStart){{window.tauriScreenshotOverlayStart(window.tauriScreenshotOverlayConfig);}}else{{window.tauriScreenshotOverlayPendingStartConfig=window.tauriScreenshotOverlayConfig;}}",
            label = window.label(),
        );
        log_flow(
            "screenshot",
            format!("reuse hidden overlay label={}", window.label()),
        );
        let _ = window.eval(&config_script);
        let _ = window.set_decorations(false);
        let _ = window.set_fullscreen(true);
        let _ = window.set_always_on_top(true);
        force_screenshot_overlay_borderless(&window, false);
        return Ok(true);
    }

    let monitor = primary_monitor()?;
    let monitor_width = monitor.width().map_err(|error| error.to_string())?;
    let monitor_height = monitor.height().map_err(|error| error.to_string())?;
    let monitor_x = monitor.x().map_err(|error| error.to_string())?;
    let monitor_y = monitor.y().map_err(|error| error.to_string())?;
    let scale_factor = f64::from(monitor.scale_factor().unwrap_or(1.0));
    let overlay_sequence = SCREENSHOT_OVERLAY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let label = format!(
        "screenshot-select-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        overlay_sequence
    );
    log_flow("screenshot", format!("create overlay label={label}"));
    let mut url = format!(
        "screenshot-overlay.html?label={}&offsetX={}&offsetY={}&scale={}&ocrEnabled=1&translateEnabled=1&warm={}",
        urlencoding::encode(&label),
        monitor_x,
        monitor_y,
        scale_factor,
        if options.warm { 1 } else { 0 }
    );

    if let Some(mode) = options.mode.as_deref() {
        url.push_str("&mode=");
        url.push_str(&urlencoding::encode(mode));
    }

    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .always_on_top(true)
        .decorations(false)
        .focused(true)
        .fullscreen(true)
        .inner_size(monitor_width as f64, monitor_height as f64)
        .position(
            monitor_x as f64 / scale_factor,
            monitor_y as f64 / scale_factor,
        )
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .title("")
        .transparent(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    let _ = window.set_decorations(false);
    let _ = window.set_fullscreen(true);
    let _ = window.set_always_on_top(true);
    force_screenshot_overlay_borderless(&window, false);

    let _ = runtime;
    let _ = window;
    log_flow("screenshot", format!("open ready label={label}"));
    Ok(true)
}

fn mark_screenshot_overlay_opening() {
    SCREENSHOT_OVERLAY_OPENING_UNTIL_MS.store(
        chrono::Utc::now().timestamp_millis() + 2_000,
        Ordering::Relaxed,
    );
}

fn begin_screenshot_overlay_finish() {
    SCREENSHOT_OVERLAY_FINISHING.store(true, Ordering::Relaxed);
    SCREENSHOT_OVERLAY_REOPEN_PENDING.store(false, Ordering::Relaxed);
}

fn end_screenshot_overlay_finish(app: AppHandle, runtime: &StorageRuntimeState) {
    SCREENSHOT_OVERLAY_FINISHING.store(false, Ordering::Relaxed);
    if !SCREENSHOT_OVERLAY_REOPEN_PENDING.swap(false, Ordering::Relaxed) {
        return;
    }

    log_flow("screenshot", "open deferred replay");
    if let Err(error) = open_screenshot_overlay_window(
        app,
        runtime,
        ScreenshotOverlayOptions {
            mode: None,
            warm: false,
        },
    ) {
        log_flow("screenshot", format!("open deferred failed error={error}"));
    }
}

pub(crate) fn is_screenshot_overlay_active(app: &AppHandle) -> bool {
    if chrono::Utc::now().timestamp_millis()
        < SCREENSHOT_OVERLAY_OPENING_UNTIL_MS.load(Ordering::Relaxed)
    {
        return true;
    }

    app.webview_windows().into_iter().any(|(label, window)| {
        label.starts_with("screenshot-select-") && window.is_visible().unwrap_or(false)
    })
}

fn find_screenshot_overlay_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let mut hidden_overlay = None;

    for (label, window) in app.webview_windows() {
        if !label.starts_with("screenshot-select-") {
            continue;
        }

        if window.is_visible().unwrap_or(false) {
            return Some(window);
        }

        if hidden_overlay.is_none() {
            hidden_overlay = Some(window);
        }
    }

    hidden_overlay
}

fn count_screenshot_overlay_windows(app: &AppHandle) -> usize {
    app.webview_windows()
        .keys()
        .filter(|label| label.starts_with("screenshot-select-"))
        .count()
}

fn hide_screenshot_overlay(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        log_flow("screenshot", format!("hide overlay label={label}"));
        let _ = window.hide();
    }
}

fn schedule_close_screenshot_overlay(app: AppHandle, label: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(30));
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = app_handle.get_webview_window(&label) {
                let visible = window.is_visible().unwrap_or(false);
                log_flow(
                    "screenshot",
                    format!("keep overlay label={label} visible={visible}"),
                );
            }
        });
    });
}

fn close_screenshot_overlay_now(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        log_flow("screenshot", format!("close overlay now label={label}"));
        let _ = window.close();
    }
}

#[tauri::command]
pub(crate) fn show_screenshot_overlay(app: AppHandle, label: String) -> Result<bool, String> {
    log_flow("screenshot", format!("show requested label={label}"));
    let Some(window) = app.get_webview_window(&label) else {
        log_flow("screenshot", format!("show skipped missing label={label}"));
        return Ok(false);
    };

    let _ = window.set_decorations(false);
    let _ = window.set_fullscreen(true);
    let _ = window.set_always_on_top(true);
    force_screenshot_overlay_borderless(&window, false);
    window.show().map_err(|error| error.to_string())?;
    force_screenshot_overlay_borderless(&window, true);
    let _ = window.set_focus();
    log_flow("screenshot", format!("show done label={label}"));
    Ok(true)
}

#[tauri::command]
pub(crate) fn open_screenshot_selection(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
) -> Result<bool, String> {
    open_screenshot_selection_window(app, &runtime)
}

#[tauri::command]
pub(crate) fn open_scroll_screenshot_selection(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
) -> Result<bool, String> {
    clear_screenshot_color_frames(&app);
    open_screenshot_overlay_window(
        app,
        &runtime,
        ScreenshotOverlayOptions {
            mode: Some("scroll".to_string()),
            warm: false,
        },
    )
}

#[tauri::command]
pub(crate) fn capture_screenshot_selection_frame(
    rect: ScreenshotSelectionRect,
) -> Result<ScreenshotFrameResult, String> {
    let (width, height, png) = capture_primary_monitor_region_png(&rect)?;

    Ok(ScreenshotFrameResult {
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&png)),
        height,
        rgba: None,
        width,
    })
}

#[tauri::command]
pub(crate) fn start_screenshot_overlay_scroll_capture(
    app: AppHandle,
    rect: ScreenshotSelectionRect,
    label: Option<String>,
) -> Result<ScreenshotActionStatus, String> {
    let _ = rect;

    if let Some(label) = label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_decorations(false);
            let _ = window.set_fullscreen(true);
            let _ = window.set_always_on_top(true);
            force_screenshot_overlay_borderless(&window, true);
        }
    }

    Ok(ScreenshotActionStatus {
        message: "滚动截图准备中，可在选区内滚动目标页面".to_string(),
        ok: true,
    })
}

#[tauri::command]
pub(crate) fn scroll_screenshot_overlay_target(
    delta: i32,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let wheel_delta = delta.clamp(-1200, 1200);
        if wheel_delta == 0 {
            return Ok(());
        }

        if let (Some(x), Some(y)) = (x, y) {
            unsafe {
                SetCursorPos(x, y);
            }
        }

        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: wheel_delta as u32,
                    dwFlags: MOUSEEVENTF_WHEEL,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let sent = unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };
        if sent == 0 {
            return Err("滚动目标窗口失败".to_string());
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = delta;
        let _ = x;
        let _ = y;
        Err("当前系统暂不支持自动滚动".to_string())
    }
}

#[tauri::command]
pub(crate) fn finish_screenshot_selection(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    state: State<'_, ScreenshotRuntimeState>,
    shortcut_content: State<'_, ShortcutContentState>,
    label: String,
    rect: ScreenshotSelectionRect,
) -> Result<ScreenshotCaptureResult, String> {
    log_memory(
        "screenshot-memory",
        format!(
            "finish_selection begin label={label} rect={:.0},{:.0} {:.0}x{:.0}",
            rect.x, rect.y, rect.width, rect.height
        ),
    );
    let (width, height, png) = capture_current_screen_region_png(&rect)?;
    let result = build_capture_result(&runtime, width, height, png)?;

    hide_screenshot_overlay(&app, &label);
    schedule_close_screenshot_overlay(app.clone(), label);

    let _ = shortcut_content;
    store_last_capture(&app, &state, result)
}

#[tauri::command]
pub(crate) fn finish_screenshot_selection_image(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    state: State<'_, ScreenshotRuntimeState>,
    shortcut_content: State<'_, ShortcutContentState>,
    label: String,
    data_url: String,
) -> Result<ScreenshotCaptureResult, String> {
    log_memory(
        "screenshot-memory",
        format!(
            "finish_selection_image begin label={label} data_url_bytes={}",
            data_url.len()
        ),
    );
    let png = png_from_data_url(&data_url)?;
    let image = xcap::image::load_from_memory(&png)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let result = build_capture_result(&runtime, image.width(), image.height(), png)?;

    hide_screenshot_overlay(&app, &label);
    schedule_close_screenshot_overlay(app.clone(), label);

    let _ = shortcut_content;
    store_last_capture(&app, &state, result)
}

#[tauri::command]
pub(crate) async fn finish_screenshot_overlay_image(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    state: State<'_, ScreenshotRuntimeState>,
    label: String,
    rect: ScreenshotSelectionRect,
    action: String,
    data_url: String,
) -> Result<ScreenshotCaptureResult, String> {
    begin_screenshot_overlay_finish();
    let result = finish_screenshot_overlay_image_inner(
        app.clone(),
        &runtime,
        &state,
        label,
        rect,
        action,
        data_url,
    )
    .await;
    end_screenshot_overlay_finish(app, &runtime);
    result
}

async fn finish_screenshot_overlay_image_inner(
    app: AppHandle,
    runtime: &StorageRuntimeState,
    state: &ScreenshotRuntimeState,
    label: String,
    rect: ScreenshotSelectionRect,
    action: String,
    data_url: String,
) -> Result<ScreenshotCaptureResult, String> {
    log_flow(
        "screenshot",
        format!(
            "finish start label={label} action={action} data_len={}",
            data_url.len()
        ),
    );
    log_memory(
        "screenshot-memory",
        format!(
            "finish_overlay_image begin label={label} action={action} data_url_bytes={}",
            data_url.len()
        ),
    );
    let should_hide_before_action = action.as_str() != "save";
    if should_hide_before_action {
        hide_screenshot_overlay(&app, &label);
    }

    let png = png_from_data_url(&data_url)?;
    let (width, height) = data_url_dimensions(&png)?;
    let mut result = build_capture_result_from_png(&runtime, width, height, png.clone())?;
    log_flow(
        "screenshot",
        format!(
            "finish built result label={label} action={action} size={}x{}",
            width, height
        ),
    );

    match action.as_str() {
        "copy" => {
            log_flow(
                "screenshot",
                format!(
                    "copy clipboard start label={label} size={}x{} png_len={}",
                    width,
                    height,
                    png.len()
                ),
            );
            if let Err(error) = copy_png_to_clipboard_with_retry(&png) {
                log_flow(
                    "screenshot",
                    format!("copy clipboard failed label={label} error={error}"),
                );
                return Err(error);
            }
            log_flow("screenshot", format!("copy clipboard done label={label}"));
        }
        "pin" => {
            schedule_pin_screenshot_window(app.clone(), result.clone(), rect.clone());
        }
        "save" => {
            let overlay_window = app.get_webview_window(&label);
            let Some(path) =
                save_screenshot_png_with_dialog(&app, &png, overlay_window.as_ref()).await?
            else {
                result.canceled = Some(true);
                log_flow(
                    "screenshot",
                    format!("finish canceled label={label} action={action}"),
                );
                return Ok(result);
            };
            result.file_path = Some(path);
            hide_screenshot_overlay(&app, &label);
        }
        _ => {}
    }

    let result = store_last_capture(&app, &state, result)?;
    hide_screenshot_overlay(&app, &label);
    schedule_close_screenshot_overlay(app, label.clone());
    log_flow(
        "screenshot",
        format!("finish done label={label} action={action}"),
    );
    log_memory(
        "screenshot-memory",
        format!("finish_overlay_image done label={label} action={action}"),
    );
    Ok(result)
}

#[tauri::command]
pub(crate) fn copy_screenshot_text(app: AppHandle, text: String) -> Result<bool, String> {
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn log_screenshot_debug(area: String, message: String) -> Result<bool, String> {
    let area = if area.trim().is_empty() {
        "screenshot-ui"
    } else {
        area.trim()
    };
    log_flow(area, message);
    Ok(true)
}

#[tauri::command]
pub(crate) fn get_screenshot_color_frames(
    app: AppHandle,
    state: State<'_, ScreenshotRuntimeState>,
) -> Result<Vec<ScreenshotColorFrame>, String> {
    {
        let frames = state
            .color_frames
            .lock()
            .map_err(|_| "截图取色状态不可用".to_string())?;

        if !frames.is_empty() {
            return Ok(frames.clone());
        }
    }

    let _ = app;
    let frames = capture_screenshot_color_frames().unwrap_or_default();
    let total_data_url_bytes: usize = frames.iter().map(|frame| frame.data_url.len()).sum();
    log_memory(
        "screenshot-memory",
        format!(
            "color_frames_capture count={} data_url_bytes={total_data_url_bytes}",
            frames.len()
        ),
    );
    let mut cached_frames = state
        .color_frames
        .lock()
        .map_err(|_| "截图取色状态不可用".to_string())?;
    *cached_frames = frames.clone();
    Ok(frames)
}

#[tauri::command]
pub(crate) fn sample_screenshot_color(x: i32, y: i32) -> Result<ScreenshotSampledColor, String> {
    sample_screen_color(x, y)
}

#[tauri::command]
pub(crate) fn get_screenshot_cursor_position() -> Result<ScreenshotCursorPosition, String> {
    cursor_position().ok_or_else(|| "无法获取鼠标位置".to_string())
}

#[tauri::command]
pub(crate) fn capture_screenshot_magnifier_frame(
    options: ScreenshotMagnifierFrameOptions,
) -> Result<ScreenshotFrameResult, String> {
    capture_screenshot_magnifier_frame_at(options.x, options.y, options.sample_size)
}

#[tauri::command]
pub(crate) fn get_screenshot_picker_snapshot(
    sample_size: Option<u32>,
) -> Result<ScreenshotPickerSnapshot, String> {
    let position = cursor_position().ok_or_else(|| "无法获取鼠标位置".to_string())?;
    let frame = capture_screenshot_magnifier_frame_at(position.x, position.y, sample_size)?;
    let color = sample_screen_color(position.x, position.y).ok();

    Ok(ScreenshotPickerSnapshot {
        color,
        frame,
        x: position.x,
        y: position.y,
    })
}

fn capture_screenshot_magnifier_frame_at(
    x: i32,
    y: i32,
    sample_size: Option<u32>,
) -> Result<ScreenshotFrameResult, String> {
    let sample_size = sample_size.unwrap_or(25).clamp(5, 80) as f64;
    let rect = ScreenshotSelectionRect {
        height: sample_size,
        width: sample_size,
        x: x as f64 - sample_size / 2.0,
        y: y as f64 - sample_size / 2.0,
    };
    let (width, height, png, rgba) = capture_current_screen_region_png_with_rgba(&rect)?;

    Ok(ScreenshotFrameResult {
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&png)),
        height,
        rgba: Some(rgba),
        width,
    })
}

#[cfg(target_os = "windows")]
fn cursor_position() -> Option<ScreenshotCursorPosition> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };

    if ok == 0 {
        return None;
    }

    Some(ScreenshotCursorPosition {
        x: point.x,
        y: point.y,
    })
}

#[cfg(not(target_os = "windows"))]
fn cursor_position() -> Option<ScreenshotCursorPosition> {
    None
}

#[cfg(target_os = "windows")]
fn sample_screen_color(x: i32, y: i32) -> Result<ScreenshotSampledColor, String> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};

    unsafe {
        let desktop: HWND = std::ptr::null_mut();
        let hdc = GetDC(desktop);

        if hdc.is_null() {
            return Err("无法获取屏幕 DC".to_string());
        }

        let color_ref = GetPixel(hdc, x, y);
        let _ = ReleaseDC(desktop, hdc);

        if color_ref == 0xFFFF_FFFF {
            return Err("无法读取屏幕像素颜色".to_string());
        }

        let r = (color_ref & 0xFF) as u8;
        let g = ((color_ref >> 8) & 0xFF) as u8;
        let b = ((color_ref >> 16) & 0xFF) as u8;

        Ok(ScreenshotSampledColor {
            b,
            g,
            hex: format!("#{r:02X}{g:02X}{b:02X}"),
            r,
        })
    }
}

#[cfg(not(target_os = "windows"))]
fn sample_screen_color(_x: i32, _y: i32) -> Result<ScreenshotSampledColor, String> {
    Err("当前系统暂不支持实时取色".to_string())
}

#[tauri::command]
pub(crate) async fn recognize_screenshot_overlay_region(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    rect: ScreenshotSelectionRect,
    options: ScreenshotOverlayOcrOptions,
) -> Result<ScreenshotOverlayOcrResult, String> {
    let (width, height, png) = capture_primary_monitor_region_png(&rect)?;
    let mode = if options.mode.as_deref() == Some("positioned") {
        "positioned"
    } else {
        "fast_text"
    };
    let image_base64 = BASE64_STANDARD.encode(&png);
    let settings = read_app_settings(&runtime);
    let api_key = setting_text(&settings, &["baiduOcr", "apiKey"]);
    let secret_key = setting_text(&settings, &["baiduOcr", "secretKey"]);
    let api_variant = setting_text(&settings, &["baiduOcr", "apiVariant"]);
    let api_variant = if api_variant == "accurate_located" {
        "accurate_located"
    } else {
        "standard_located"
    };
    log_flow(
        "screenshot-ocr",
        format!(
            "start source={} mode={mode} api_variant={api_variant} rect={}x{} image={}x{} png_bytes={}",
            if !api_key.is_empty() && !secret_key.is_empty() {
                "baidu"
            } else {
                "service-gateway"
            },
            rect.width,
            rect.height,
            width,
            height,
            png.len()
        ),
    );
    let response = if !api_key.is_empty() && !secret_key.is_empty() {
        recognize_with_baidu_ocr(image_base64, api_key, secret_key, api_variant, mode)
            .await
            .map_err(|error| {
                log_flow(
                    "screenshot-ocr",
                    format!("failed source=baidu error={error}"),
                );
                error
            })?
    } else {
        let value = post_service_gateway(
            &app,
            serde_json::json!({
                "action": "ocr.baidu",
                "apiVariant": api_variant,
                "imageBase64": image_base64,
                "mode": mode
            }),
        )
        .await
        .map_err(|error| {
            log_flow(
                "screenshot-ocr",
                format!("failed source=service-gateway error={error}"),
            );
            error
        })?;

        serde_json::from_value(value).map_err(|error| {
            log_flow(
                "screenshot-ocr",
                format!("parse failed source=service-gateway error={error}"),
            );
            error.to_string()
        })?
    };
    let items = response.words_result.unwrap_or_default();
    let mut words = Vec::new();
    let mut lines = Vec::new();

    for item in items {
        let text = item.words.unwrap_or_default().trim().to_string();

        if text.is_empty() {
            continue;
        }

        lines.push(text.clone());

        if let Some(location) = item.location {
            words.push(ScreenshotOverlayOcrWord {
                height: location.height.unwrap_or(16).max(1),
                text,
                width: location.width.unwrap_or(24).max(1),
                x: location.left.unwrap_or(0),
                y: location.top.unwrap_or(0),
            });
        } else {
            words.push(ScreenshotOverlayOcrWord {
                height: 16,
                text,
                width: 24,
                x: 0,
                y: (words.len() as u32) * 20,
            });
        }
    }

    log_flow(
        "screenshot-ocr",
        format!("done lines={} words={}", lines.len(), words.len()),
    );

    Ok(ScreenshotOverlayOcrResult {
        error: None,
        image_height: height,
        image_width: width,
        raw_text: lines.join("\n"),
        lines,
        words,
    })
}

#[tauri::command]
pub(crate) async fn translate_screenshot_overlay_text(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    payload: Value,
) -> Result<Value, String> {
    let text = payload
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let from = payload
        .get("from")
        .and_then(Value::as_str)
        .unwrap_or("auto")
        .to_string();
    let to = payload
        .get("to")
        .and_then(Value::as_str)
        .unwrap_or("zh-CN")
        .to_string();

    if text.is_empty() {
        return Err("请输入要翻译的文本".to_string());
    }

    let settings = read_app_settings(&runtime);
    let provider = setting_text(&settings, &["translate", "provider"]);
    let app_id = setting_text(&settings, &["translate", "baidu", "appId"]);
    let secret_key = setting_text(&settings, &["translate", "baidu", "secretKey"]);
    let (provider, translated) = if (provider.is_empty() || provider == "baidu")
        && !app_id.is_empty()
        && !secret_key.is_empty()
    {
        (
            "baidu".to_string(),
            translate_with_baidu(app_id, secret_key, &text, &from, &to).await?,
        )
    } else {
        let value = post_service_gateway(
            &app,
            serde_json::json!({
                "action": "translate",
                "from": from,
                "text": text,
                "to": to
            }),
        )
        .await?;
        let response: ServiceGatewayTranslateResponse =
            serde_json::from_value(value).map_err(|error| error.to_string())?;

        (
            response.provider.unwrap_or_else(|| "baidu".to_string()),
            response.text.unwrap_or_default().trim().to_string(),
        )
    };

    if translated.is_empty() {
        return Err("翻译未返回结果".to_string());
    }

    Ok(serde_json::json!({
        "provider": provider,
        "text": translated
    }))
}

#[tauri::command]
pub(crate) fn cancel_screenshot_selection(app: AppHandle, label: String) -> Result<(), String> {
    log_flow("screenshot", format!("cancel label={label}"));
    hide_screenshot_overlay(&app, &label);
    schedule_close_screenshot_overlay(app.clone(), label);

    app.emit(
        "screenshot:captured",
        Option::<ScreenshotCaptureResult>::None,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn dismiss_stale_screenshot_overlay(app: AppHandle) -> Result<Option<()>, String> {
    close_screenshot_overlay_windows(&app);

    Ok(None)
}

fn close_screenshot_overlay_windows(app: &AppHandle) {
    for label in app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("screenshot-select-"))
        .cloned()
        .collect::<Vec<_>>()
    {
        close_screenshot_overlay_now(app, &label);
    }
}

fn create_region_screen_recorder(
    app: &AppHandle,
    runtime: &StorageRuntimeState,
    region_state: &RegionRecordingState,
    shortcut_content: &ShortcutContentState,
    label: String,
    rect: ScreenshotSelectionRect,
) -> Result<(), String> {
    let (display_x, display_y, display_width, display_height) = display_bounds_for_rect(&rect)?;
    let content = serde_json::json!({
        "autoStart": false,
        "cropRect": {
            "displayHeight": display_height,
            "displayWidth": display_width,
            "height": rect.height,
            "width": rect.width,
            "x": rect.x - display_x,
            "y": rect.y - display_y
        },
        "source": "screenshot-selection",
        "type": "screen-recorder-region"
    })
    .to_string();

    let recorder_label = quick_tool::open_named_quick_tool_with_options(
        app,
        runtime,
        shortcut_content,
        "screen-recorder".to_string(),
        content,
        quick_tool::QuickToolWindowOptions {
            anchor_rect: Some(quick_tool::QuickToolAnchorRect {
                height: rect.height,
                width: rect.width,
                x: rect.x,
                y: rect.y,
            }),
            compact: true,
            force_new: true,
        },
    )?;

    crate::screen_recorder::start_region_recording_session(
        app,
        region_state,
        label.clone(),
        recorder_label.clone(),
        serde_json::json!({
            "height": rect.height,
            "width": rect.width,
            "x": rect.x,
            "y": rect.y
        }),
    );

    if let Some(recorder_window) = app.get_webview_window(&recorder_label) {
        let app_handle = app.clone();
        let destroyed_recorder_label = recorder_label.clone();
        recorder_window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                let region_state = app_handle.state::<RegionRecordingState>();
                let _ = crate::screen_recorder::cleanup_region_recording_session_for_recorder(
                    &app_handle,
                    &region_state,
                    &destroyed_recorder_label,
                );
            }
        });
    }

    Ok(())
}

fn schedule_region_screen_recorder(app: AppHandle, label: String, rect: ScreenshotSelectionRect) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(0));
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let runtime = app_handle.state::<StorageRuntimeState>();
            let region_state = app_handle.state::<RegionRecordingState>();
            let shortcut_content = app_handle.state::<ShortcutContentState>();
            if let Err(error) = create_region_screen_recorder(
                &app_handle,
                &runtime,
                &region_state,
                &shortcut_content,
                label,
                rect,
            ) {
                eprintln!("[tauri-screenshot] open region recorder failed: {error}");
            }
        });
    });
}

#[tauri::command]
pub(crate) fn open_region_screen_recorder(
    app: AppHandle,
    label: String,
    rect: ScreenshotSelectionRect,
) -> Result<(), String> {
    schedule_region_screen_recorder(app, label, rect);
    Ok(())
}

#[tauri::command]
pub(crate) fn open_region_recording_playback(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    region_state: State<'_, RegionRecordingState>,
    payload: RegionRecordingPlaybackPayload,
) -> Result<bool, String> {
    if payload.buffer.is_empty() {
        return Err("录屏内容为空".to_string());
    }

    let recording_dir = default_recording_dir(&runtime);
    fs::create_dir_all(&recording_dir).map_err(|error| error.to_string())?;
    let file_path = recording_dir.join(recording_file_name());
    fs::write(&file_path, &payload.buffer).map_err(|error| error.to_string())?;

    let selection_rect =
        crate::screen_recorder::current_region_recording_selection_rect(&region_state);
    let playback_payload = serde_json::json!({
        "cropRect": payload.crop_rect,
        "durationMs": payload.duration_ms,
        "filePath": crate::storage::path_to_string(&file_path),
        "selectionRect": selection_rect,
        "sourceHeight": payload.source_height,
        "sourceWidth": payload.source_width
    });

    if !crate::screen_recorder::show_region_recording_playback_overlay(&app, &region_state) {
        return Ok(false);
    }

    app.emit("screenshot:recording-playback", playback_payload)
        .map_err(|error| error.to_string())?;

    Ok(true)
}

#[tauri::command]
pub(crate) fn get_last_screenshot(
    state: State<'_, ScreenshotRuntimeState>,
) -> Result<Option<ScreenshotCaptureResult>, String> {
    state
        .last_capture
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "截图状态不可用".to_string())
}
