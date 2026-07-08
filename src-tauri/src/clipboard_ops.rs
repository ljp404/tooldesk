use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::diagnostics::log_flow;

static CLIPBOARD_WATCHER_STARTED: AtomicBool = AtomicBool::new(false);
static CLIPBOARD_POLL_INTERVAL_MS: AtomicU32 = AtomicU32::new(800);

fn clipboard_sequence_number() -> u32 {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;

        return unsafe { GetClipboardSequenceNumber() };
    }

    #[cfg(not(target_os = "windows"))]
    {
        0
    }
}

pub(crate) fn configure_clipboard_change_watcher(poll_interval_ms: u32) {
    let next_interval = poll_interval_ms.max(400);
    CLIPBOARD_POLL_INTERVAL_MS.store(next_interval, Ordering::Relaxed);
    log_flow(
        "super-clipboard",
        format!("watcher interval_ms={next_interval}"),
    );
}

pub(crate) fn start_clipboard_change_watcher(app: AppHandle) {
    if CLIPBOARD_WATCHER_STARTED.swap(true, Ordering::Relaxed) {
        log_flow("super-clipboard", "watcher already started");
        return;
    }

    let initial_sequence = clipboard_sequence_number();
    log_flow(
        "super-clipboard",
        format!("watcher started initial_sequence={initial_sequence}"),
    );

    thread::spawn(move || {
        #[cfg(target_os = "windows")]
        {
            let mut last_sequence = initial_sequence;

            loop {
                thread::sleep(Duration::from_millis(
                    CLIPBOARD_POLL_INTERVAL_MS.load(Ordering::Relaxed) as u64,
                ));

                let next_sequence = clipboard_sequence_number();
                if next_sequence == last_sequence {
                    continue;
                }

                log_flow(
                    "super-clipboard",
                    format!("sequence_changed from={last_sequence} to={next_sequence}"),
                );
                last_sequence = next_sequence;
                let _ = app.emit(
                    "super-clipboard:clipboard-changed",
                    serde_json::json!({ "sequence": next_sequence }),
                );
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = app;
            log_flow(
                "super-clipboard",
                "watcher thread skipped platform=non_windows",
            );
        }
    });
}

#[tauri::command]
pub(crate) fn get_clipboard_change_count() -> Result<u32, String> {
    Ok(clipboard_sequence_number())
}

#[tauri::command]
pub(crate) fn clipboard_watcher_supports_sequence() -> bool {
    cfg!(target_os = "windows")
}

#[tauri::command]
pub(crate) fn configure_super_clipboard_watcher(poll_interval_ms: u32) -> Result<bool, String> {
    configure_clipboard_change_watcher(poll_interval_ms);
    Ok(true)
}

#[tauri::command]
pub(crate) fn read_clipboard_html() -> Result<Option<String>, String> {
    let Ok(mut clipboard) = arboard::Clipboard::new() else {
        return Ok(None);
    };

    match clipboard.get().html() {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(_) => Ok(None),
    }
}
