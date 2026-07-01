use crate::storage::{path_to_string, StorageRuntimeState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, HWND_TOPMOST, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WS_CAPTION, WS_THICKFRAME,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenRecordingCropRect {
    height: f64,
    width: f64,
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenRecordingSavePayload {
    buffer: Vec<u8>,
    crop_rect: Option<ScreenRecordingCropRect>,
    duration_ms: u64,
    format: String,
    file_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenRecordingSaveResult {
    canceled: bool,
    file_path: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct RegionRecordingSession {
    overlay_label: String,
    recorder_label: String,
    selection_rect: Value,
}

#[derive(Default)]
pub(crate) struct RegionRecordingState {
    session: Mutex<Option<RegionRecordingSession>>,
}

#[cfg(target_os = "windows")]
fn promote_window_to_top(window: &tauri::WebviewWindow) {
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
    }
}

#[cfg(not(target_os = "windows"))]
fn promote_window_to_top(window: &tauri::WebviewWindow) {
    let _ = window;
}

#[cfg(target_os = "windows")]
fn force_borderless_overlay_window(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd.0 as _, GWL_STYLE);
        let next_style = style & !((WS_CAPTION | WS_THICKFRAME) as isize);

        if next_style != style {
            SetWindowLongPtrW(hwnd.0 as _, GWL_STYLE, next_style);
        }

        SetWindowPos(
            hwnd.0 as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn force_borderless_overlay_window(window: &tauri::WebviewWindow) {
    let _ = window;
}

fn keep_region_window_on_top(window: &tauri::WebviewWindow, passthrough: bool) {
    let _ = window.set_ignore_cursor_events(passthrough);
    let _ = window.set_always_on_top(true);

    if passthrough {
        let _ = window.set_decorations(false);
        force_borderless_overlay_window(window);
    }

    let _ = window.show();

    if passthrough {
        let _ = window.set_decorations(false);
        force_borderless_overlay_window(window);
    }

    promote_window_to_top(window);
}

fn current_region_session(state: &RegionRecordingState) -> Option<RegionRecordingSession> {
    state.session.lock().ok()?.clone()
}

fn set_region_session(state: &RegionRecordingState, session: Option<RegionRecordingSession>) {
    if let Ok(mut current) = state.session.lock() {
        *current = session;
    }
}

pub(crate) fn start_region_recording_session(
    app: &AppHandle,
    state: &RegionRecordingState,
    overlay_label: String,
    recorder_label: String,
    selection_rect: Value,
) {
    set_region_session(
        state,
        Some(RegionRecordingSession {
            overlay_label,
            recorder_label,
            selection_rect,
        }),
    );
    keep_region_recording_windows_on_top(app, state);
}

pub(crate) fn current_region_recording_selection_rect(
    state: &RegionRecordingState,
) -> Option<Value> {
    current_region_session(state).map(|session| session.selection_rect)
}

pub(crate) fn keep_region_recording_windows_on_top(app: &AppHandle, state: &RegionRecordingState) {
    let Some(session) = current_region_session(state) else {
        return;
    };

    if let Some(overlay) = app.get_webview_window(&session.overlay_label) {
        keep_region_window_on_top(&overlay, true);
    }

    if let Some(recorder) = app.get_webview_window(&session.recorder_label) {
        keep_region_window_on_top(&recorder, false);
        let _ = recorder.set_focus();
    }
}

pub(crate) fn show_region_recording_playback_overlay(
    app: &AppHandle,
    state: &RegionRecordingState,
) -> bool {
    let Some(session) = current_region_session(state) else {
        return false;
    };

    let Some(overlay) = app.get_webview_window(&session.overlay_label) else {
        return false;
    };

    let _ = overlay.set_ignore_cursor_events(false);
    let _ = overlay.set_always_on_top(true);
    let _ = overlay.show();
    force_borderless_overlay_window(&overlay);
    promote_window_to_top(&overlay);

    if let Some(recorder) = app.get_webview_window(&session.recorder_label) {
        keep_region_window_on_top(&recorder, false);
    }

    true
}

pub(crate) fn cleanup_region_recording_session(
    app: &AppHandle,
    state: &RegionRecordingState,
) -> usize {
    let session = current_region_session(state);
    set_region_session(state, None);
    close_region_helper_windows(app, session.as_ref())
}

pub(crate) fn cleanup_region_recording_session_for_recorder(
    app: &AppHandle,
    state: &RegionRecordingState,
    recorder_label: &str,
) -> usize {
    let session = current_region_session(state);
    if !matches!(session.as_ref(), Some(item) if item.recorder_label == recorder_label) {
        return 0;
    }

    set_region_session(state, None);
    close_region_helper_windows(app, session.as_ref())
}

fn teardown_region_recording_after_successful_save(
    app: &AppHandle,
    state: &RegionRecordingState,
    recorder_label: &str,
) -> bool {
    let session = current_region_session(state);
    let is_region_recorder =
        matches!(session.as_ref(), Some(item) if item.recorder_label == recorder_label);
    let is_compact_recorder = recorder_label.starts_with("quick-compact-screen-recorder");

    if !is_region_recorder && !is_compact_recorder {
        return false;
    }

    if is_region_recorder {
        set_region_session(state, None);
        let _ = close_region_helper_windows(app, session.as_ref());
    } else {
        let _ = close_recording_region_border_windows(app);
    }

    if let Some(recorder) = app.get_webview_window(recorder_label) {
        let _ = recorder.close();
    }

    true
}

fn normalize_format(format: &str) -> Result<&'static str, String> {
    match format {
        "webm" => Ok("webm"),
        "mp4" => Ok("mp4"),
        "gif" => Ok("gif"),
        _ => Err("录屏格式无效".to_string()),
    }
}

fn packaged_ffmpeg_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(exe_path) = env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            candidates.push(dir.join("ffmpeg"));
            candidates.push(dir.join("ffmpeg.exe"));
            candidates.push(dir.join("resources").join("ffmpeg"));
            candidates.push(dir.join("resources").join("ffmpeg.exe"));
            candidates.push(dir.join("resources").join("bin").join("ffmpeg"));
            candidates.push(dir.join("resources").join("bin").join("ffmpeg.exe"));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("ffmpeg"));
        candidates.push(resource_dir.join("ffmpeg.exe"));
        candidates.push(resource_dir.join("bin").join("ffmpeg"));
        candidates.push(resource_dir.join("bin").join("ffmpeg.exe"));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(
            cwd.join("node_modules")
                .join("@ffmpeg-installer")
                .join("ffmpeg")
                .join("ffmpeg"),
        );
        candidates.push(
            cwd.join("node_modules")
                .join("@ffmpeg-installer")
                .join("win32-x64")
                .join("ffmpeg.exe"),
        );
        candidates.push(
            cwd.join("node_modules")
                .join("@ffmpeg-installer")
                .join("ffmpeg")
                .join("node_modules")
                .join("@ffmpeg-installer")
                .join("win32-x64")
                .join("ffmpeg.exe"),
        );
        candidates.push(
            cwd.join("node_modules")
                .join("@ffmpeg-installer")
                .join("ffmpeg")
                .join("node_modules")
                .join("@ffmpeg-installer")
                .join("darwin-arm64")
                .join("ffmpeg"),
        );
        candidates.push(
            cwd.join("node_modules")
                .join("@ffmpeg-installer")
                .join("ffmpeg")
                .join("node_modules")
                .join("@ffmpeg-installer")
                .join("darwin-x64")
                .join("ffmpeg"),
        );
        candidates.push(
            cwd.join("node_modules")
                .join("@ffmpeg-installer")
                .join("ffmpeg")
                .join("node_modules")
                .join("@ffmpeg-installer")
                .join("linux-x64")
                .join("ffmpeg"),
        );
    }

    candidates
}

fn find_ffmpeg(app: &AppHandle) -> String {
    packaged_ffmpeg_candidates(app)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| path_to_string(&candidate))
        .unwrap_or_else(|| "ffmpeg".to_string())
}

fn even_dimension(value: f64) -> i64 {
    let rounded = value.round().max(2.0) as i64;

    if rounded % 2 == 0 {
        rounded
    } else {
        rounded - 1
    }
}

fn crop_filter(rect: Option<&ScreenRecordingCropRect>) -> Option<String> {
    let rect = rect?;

    if rect.width < 10.0 || rect.height < 10.0 {
        return None;
    }

    let x = rect.x.round().max(0.0) as i64;
    let y = rect.y.round().max(0.0) as i64;
    let width = even_dimension(rect.width);
    let height = even_dimension(rect.height);

    Some(format!("crop={width}:{height}:{x}:{y}"))
}

fn video_export_filters(rect: Option<&ScreenRecordingCropRect>) -> String {
    let mut filters = Vec::new();

    if let Some(crop) = crop_filter(rect) {
        filters.push(crop);
    }

    filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string());
    filters.join(",")
}

fn ffmpeg_args(
    input_path: &Path,
    output_path: &Path,
    payload: &ScreenRecordingSavePayload,
) -> Vec<String> {
    let crop = crop_filter(payload.crop_rect.as_ref());
    let input = path_to_string(input_path);
    let output = path_to_string(output_path);

    if payload.format == "gif" {
        let filter = [
            Some("fps=12".to_string()),
            crop,
            Some("scale='min(960,iw)':-1:flags=lanczos".to_string()),
            Some("split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse".to_string()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(",");

        return vec![
            "-y".to_string(),
            "-i".to_string(),
            input,
            "-an".to_string(),
            "-vf".to_string(),
            filter,
            "-loop".to_string(),
            "0".to_string(),
            output,
        ];
    }

    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input,
        "-vf".to_string(),
        video_export_filters(payload.crop_rect.as_ref()),
    ];

    args.extend([
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "128k".to_string(),
        output,
    ]);

    args
}

fn recording_temp_file(runtime: &StorageRuntimeState) -> PathBuf {
    runtime.cache_dir.join("recordings").join(format!(
        "recording-export-{}.webm",
        chrono::Utc::now().timestamp_millis()
    ))
}

fn recording_output_temp_file(output_path: &Path, format: &str) -> PathBuf {
    let mut temp_path = output_path.to_path_buf();
    let file_name = output_path
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("recording");
    temp_path.set_file_name(format!("{file_name}.tmp.{format}"));
    temp_path
}

fn close_region_helper_windows(app: &AppHandle, session: Option<&RegionRecordingSession>) -> usize {
    let mut closed = 0;
    let overlay_label = session.map(|item| item.overlay_label.as_str());

    for (label, window) in app.webview_windows() {
        if label.starts_with("recording-region-border-") || Some(label.as_str()) == overlay_label {
            let _ = window.close();
            closed += 1;
        }
    }

    closed
}

fn close_recording_region_border_windows(app: &AppHandle) -> usize {
    let mut closed = 0;

    for (label, window) in app.webview_windows() {
        if label.starts_with("recording-region-border-") {
            let _ = window.close();
            closed += 1;
        }
    }

    closed
}

#[tauri::command]
pub(crate) fn close_screen_recording_region_frame(
    app: AppHandle,
    state: State<'_, RegionRecordingState>,
) -> Result<usize, String> {
    Ok(cleanup_region_recording_session(&app, &state))
}

#[tauri::command]
pub(crate) fn notify_region_recording_capture_started(
    app: AppHandle,
    state: State<'_, RegionRecordingState>,
) -> Result<usize, String> {
    keep_region_recording_windows_on_top(&app, &state);
    Ok(close_recording_region_border_windows(&app))
}

#[tauri::command]
pub(crate) fn save_screen_recording(
    app: AppHandle,
    runtime: State<'_, StorageRuntimeState>,
    region_state: State<'_, RegionRecordingState>,
    window: WebviewWindow,
    payload: ScreenRecordingSavePayload,
) -> Result<ScreenRecordingSaveResult, String> {
    let format = normalize_format(&payload.format)?;

    if payload.buffer.is_empty() {
        return Err("录屏内容为空".to_string());
    }

    let output_path = PathBuf::from(payload.file_path.trim());

    if output_path.as_os_str().is_empty() {
        return Ok(ScreenRecordingSaveResult {
            canceled: true,
            file_path: None,
        });
    }

    if output_path.extension().and_then(|item| item.to_str()) != Some(format) {
        return Err(format!("请选择 .{format} 文件"));
    }

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let temp_path = recording_temp_file(&runtime);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&temp_path, &payload.buffer).map_err(|error| error.to_string())?;

    let export_path = if format == "webm" {
        output_path.clone()
    } else {
        recording_output_temp_file(&output_path, format)
    };
    let _ = fs::remove_file(&export_path);

    let result = if format == "webm" {
        fs::copy(&temp_path, &export_path)
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else {
        let ffmpeg_path = find_ffmpeg(&app);
        let output = Command::new(&ffmpeg_path)
            .args(ffmpeg_args(&temp_path, &export_path, &payload))
            .output()
            .map_err(|error| format!("启动 ffmpeg 失败：{error}"))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() {
                "ffmpeg 转码失败".to_string()
            } else {
                stderr
            })
        }
    };

    let _ = fs::remove_file(&temp_path);
    if let Err(error) = result {
        let _ = fs::remove_file(&export_path);
        return Err(error);
    }

    if !export_path.is_file() {
        return Err("导出完成但未找到输出文件，请重试".to_string());
    }

    let metadata = fs::metadata(&export_path).map_err(|error| error.to_string())?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&export_path);
        return Err("导出失败，输出文件为空".to_string());
    }

    if export_path != output_path {
        if output_path.exists() {
            let _ = fs::remove_file(&output_path);
        }

        if let Err(error) = fs::rename(&export_path, &output_path) {
            fs::copy(&export_path, &output_path).map_err(|copy_error| {
                format!("保存导出文件失败：{error}; 复制临时文件失败：{copy_error}")
            })?;
            let _ = fs::remove_file(&export_path);
        }
    }

    let _ = teardown_region_recording_after_successful_save(&app, &region_state, window.label());

    Ok(ScreenRecordingSaveResult {
        canceled: false,
        file_path: Some(path_to_string(&output_path)),
    })
}
