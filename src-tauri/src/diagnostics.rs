use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::{backtrace::Backtrace, panic, thread, time::Duration};
use tauri::{AppHandle, Manager};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::GetLastError;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::GetCurrentProcess;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();
static HEARTBEAT_STARTED: OnceLock<()> = OnceLock::new();
static MEMORY_WATCHDOG_STARTED: OnceLock<()> = OnceLock::new();

const MEMORY_WATCHDOG_INTERVAL_SECS: u64 = 5;
const MEMORY_WATCHDOG_HIGH_WATER_MB: f64 = 1024.0;
const MEMORY_WATCHDOG_DELTA_MB: f64 = 384.0;
const MEMORY_WATCHDOG_SOFT_DELTA_MB: f64 = 12.0;

pub(crate) fn configure_log_dir(cache_dir: &Path) {
    let _ = LOG_DIR.set(cache_dir.join("logs"));
}

pub(crate) fn log_flow(area: &str, message: impl AsRef<str>) {
    let line = format!(
        "{} [{area}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        message.as_ref()
    );

    let path = LOG_DIR
        .get()
        .cloned()
        .unwrap_or_else(std::env::temp_dir)
        .join("tooldesk-flow.log");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
        let _ = file.flush();
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ProcessMemorySnapshot {
    pagefile_mb: f64,
    peak_working_set_mb: f64,
    working_set_mb: f64,
}

#[cfg(target_os = "windows")]
pub(crate) fn current_process_memory_snapshot() -> Option<ProcessMemorySnapshot> {
    unsafe {
        let mut counters = std::mem::zeroed::<PROCESS_MEMORY_COUNTERS>();
        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;

        if GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ) == 0
        {
            let _ = GetLastError();
            return None;
        }

        Some(ProcessMemorySnapshot {
            pagefile_mb: counters.PagefileUsage as f64 / 1024.0 / 1024.0,
            peak_working_set_mb: counters.PeakWorkingSetSize as f64 / 1024.0 / 1024.0,
            working_set_mb: counters.WorkingSetSize as f64 / 1024.0 / 1024.0,
        })
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn current_process_memory_snapshot() -> Option<ProcessMemorySnapshot> {
    None
}

pub(crate) fn current_process_memory_line() -> String {
    match current_process_memory_snapshot() {
        Some(snapshot) => format!(
            "pid={} working_set_mb={:.1} peak_working_set_mb={:.1} private_bytes_mb={:.1} pagefile_mb={:.1}",
            std::process::id(),
            snapshot.working_set_mb,
            snapshot.peak_working_set_mb,
            snapshot.pagefile_mb,
            snapshot.pagefile_mb
        ),
        None => format!("pid={} mem_unavailable", std::process::id()),
    }
}

pub(crate) fn log_memory(area: &str, event: impl AsRef<str>) {
    log_flow(
        area,
        format!("{} {}", event.as_ref(), current_process_memory_line()),
    );
}

#[tauri::command]
pub(crate) fn log_app_debug(area: String, message: String) -> Result<bool, String> {
    let area = area.trim();
    let area = if area.is_empty() { "app-debug" } else { area };
    log_flow(area, message);
    Ok(true)
}

pub(crate) fn install_panic_hook() {
    let _ = PANIC_HOOK_INSTALLED.get_or_init(|| {
        let default_hook = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            let location = info
                .location()
                .map(|item| format!("{}:{}:{}", item.file(), item.line(), item.column()))
                .unwrap_or_else(|| "unknown".to_string());
            let payload = info
                .payload()
                .downcast_ref::<&str>()
                .map(|value| (*value).to_string())
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "non-string panic payload".to_string());
            log_flow(
                "panic",
                format!(
                    "panic location={location} payload={payload}\nbacktrace:\n{}",
                    Backtrace::force_capture()
                ),
            );
            default_hook(info);
        }));
    });
}

pub(crate) fn start_heartbeat() {
    let _ = HEARTBEAT_STARTED.get_or_init(|| {
        thread::spawn(|| loop {
            log_memory("heartbeat", "alive");
            thread::sleep(Duration::from_secs(15));
        });
    });
}

fn describe_webview_windows(app: &AppHandle) -> String {
    let mut labels = app.webview_windows().keys().cloned().collect::<Vec<_>>();
    labels.sort();
    format!("count={} labels={}", labels.len(), labels.join("|"))
}

pub(crate) fn start_memory_watchdog(app: AppHandle) {
    let _ = MEMORY_WATCHDOG_STARTED.get_or_init(|| {
        thread::spawn(move || {
            let mut last_working_set_mb = current_process_memory_snapshot()
                .map(|snapshot| snapshot.working_set_mb)
                .unwrap_or(0.0);

            loop {
                thread::sleep(Duration::from_secs(MEMORY_WATCHDOG_INTERVAL_SECS));

                let Some(snapshot) = current_process_memory_snapshot() else {
                    continue;
                };

                let delta_mb = snapshot.working_set_mb - last_working_set_mb;
                let high_water = snapshot.working_set_mb >= MEMORY_WATCHDOG_HIGH_WATER_MB;
                let rapid_growth = delta_mb >= MEMORY_WATCHDOG_DELTA_MB;
                let soft_growth = delta_mb >= MEMORY_WATCHDOG_SOFT_DELTA_MB;

                if high_water || rapid_growth || soft_growth {
                    let reason = match (high_water, rapid_growth, soft_growth) {
                        (true, true, _) => "high_water rapid_growth",
                        (true, false, _) => "high_water",
                        (false, true, _) => "rapid_growth",
                        (false, false, true) => "soft_growth",
                        (false, false, false) => "unknown",
                    };
                    log_flow(
                        "memory-watchdog",
                        format!(
                            "reason={reason} working_set_mb={:.1} peak_working_set_mb={:.1} delta_mb={:.1} pagefile_mb={:.1} {}",
                            snapshot.working_set_mb,
                            snapshot.peak_working_set_mb,
                            delta_mb,
                            snapshot.pagefile_mb,
                            describe_webview_windows(&app)
                        ),
                    );
                }

                last_working_set_mb = snapshot.working_set_mb;
            }
        });
    });
}
