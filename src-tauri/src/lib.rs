mod app_config;
mod browser_bookmarks;
mod clipboard_ops;
mod diagnostics;
mod docker_ops;
mod file_ops;
mod global_shortcuts;
mod http_client;
mod keepass_ops;
mod local_library;
mod mail_ops;
mod music;
mod native_tools;
mod plugins;
mod quick_tool;
mod screen_recorder;
mod screenshot;
mod ssh_ops;
mod static_server;
mod storage;
mod super_clipboard;
mod taskbar_calendar;
mod tray;
mod update_ops;
mod window;

use tauri::{Manager, RunEvent};

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg(target_os = "windows")]
fn configure_display_media_capture() {
    const DISPLAY_MEDIA_ARGS: &str = concat!(
        "--enable-features=AllowWgcDesktopCapturer,AllowWgcScreenCapturer ",
        "--use-fake-ui-for-media-stream ",
        "--auto-select-desktop-capture-source=Screen"
    );

    let next_args = match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        Ok(current) if !current.trim().is_empty() => format!("{current} {DISPLAY_MEDIA_ARGS}"),
        _ => DISPLAY_MEDIA_ARGS.to_string(),
    };

    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", next_args);
}

#[cfg(not(target_os = "windows"))]
fn configure_display_media_capture() {}

fn should_warm_screenshot_overlay(os: &str) -> bool {
    os != "macos"
}

pub fn run() {
    diagnostics::install_panic_hook();
    diagnostics::log_flow("app", format!("process start pid={}", std::process::id()));
    configure_display_media_capture();

    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            diagnostics::log_flow("app", "second instance blocked, focusing main window");
            window::show_main_window(app);
        }));
    }

    let app = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .on_menu_event(|app, event| {
            screenshot::handle_pin_screenshot_menu_event(app, event.id().as_ref());
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            let runtime =
                storage::effective_storage_paths(&app_handle).map_err(std::io::Error::other)?;
            diagnostics::configure_log_dir(&runtime.cache_dir);
            diagnostics::log_flow("app", "setup start");
            diagnostics::start_heartbeat();
            diagnostics::start_memory_watchdog(app_handle.clone());
            app.manage(file_ops::TextExportState::default());
            app.manage(global_shortcuts::GlobalShortcutRuntimeState::default());
            app.manage(keepass_ops::KeePassSessionState::default());
            app.manage(quick_tool::ShortcutContentState::default());
            app.manage(screen_recorder::RegionRecordingState::default());
            app.manage(screenshot::ScreenshotRuntimeState::default());
            app.manage(static_server::StaticServerRuntimeState::default());
            app.manage(runtime.clone());
            app.manage(update_ops::UpdateRuntimeState::default());
            window::create_main_window(app, &runtime)?;
            diagnostics::log_flow("app", "main window created");
            tray::create_tray(app)?;
            diagnostics::log_flow("app", "tray created");
            taskbar_calendar::start_hotzone(app);
            clipboard_ops::start_clipboard_change_watcher(app_handle.clone());
            if should_warm_screenshot_overlay(std::env::consts::OS) {
                screenshot::warm_screenshot_overlay(app_handle.clone());
            } else {
                diagnostics::log_flow("screenshot", "warm skipped platform=macos");
            }
            quick_tool::warm_quick_launcher(app_handle.clone());
            quick_tool::warm_taskbar_calendar_popup(app_handle.clone());
            diagnostics::log_flow("app", "setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            diagnostics::log_app_debug,
            ping,
            app_config::get_service_gateway_config,
            app_config::sign_service_gateway_request,
            browser_bookmarks::list_browser_bookmarks,
            clipboard_ops::clipboard_watcher_supports_sequence,
            clipboard_ops::configure_super_clipboard_watcher,
            clipboard_ops::get_clipboard_change_count,
            clipboard_ops::read_clipboard_html,
            docker_ops::check_docker_available,
            docker_ops::docker_image_exists,
            docker_ops::docker_pull_image,
            docker_ops::docker_tag_image,
            docker_ops::run_docker_compose,
            file_ops::append_text_export,
            file_ops::create_text_export,
            file_ops::finish_text_export,
            file_ops::get_hosts_folder,
            file_ops::open_path,
            file_ops::read_binary_file,
            file_ops::get_sync_manifest,
            file_ops::read_hosts_file,
            file_ops::read_text_file,
            file_ops::remove_file,
            file_ops::update_hosts_entry,
            file_ops::write_binary_file,
            file_ops::write_hosts_file,
            file_ops::write_text_file,
            http_client::send_http_request,
            global_shortcuts::resume_global_shortcuts,
            global_shortcuts::suspend_global_shortcuts,
            global_shortcuts::sync_global_shortcuts,
            keepass_ops::get_keepass_session,
            keepass_ops::lock_keepass_database,
            keepass_ops::unlock_keepass_database,
            local_library::get_local_libraries,
            local_library::open_local_library_file,
            local_library::search_local_library,
            mail_ops::fetch_mail_messages,
            mail_ops::download_mail_attachment,
            mail_ops::delete_mail_message,
            mail_ops::list_mail_folders,
            mail_ops::send_mail_message,
            mail_ops::set_mail_message_seen,
            music::aliyun_check_qrcode,
            music::aliyun_generate_qrcode,
            music::aliyun_get_download_url,
            music::aliyun_list_files,
            music::aliyun_refresh_token,
            music::aliyun_scan_all_music,
            music::clear_music_cache,
            music::clear_music_recent,
            music::download_cloud_music,
            music::download_music_cloud_storage_file,
            music::get_music_cache_stats,
            music::get_music_downloads,
            music::get_music_favorites,
            music::get_music_player_settings,
            music::get_music_playlists,
            music::get_music_recent,
            music::invalidate_cloud_cache,
            music::download_online_music,
            music::probe_tracks_metadata,
            music::resolve_music_cloud_storage_play_url,
            music::resolve_cloud_play_url,
            music::resolve_track_lyrics,
            music::resolve_online_play_url,
            music::save_music_downloads,
            music::save_music_favorites,
            music::save_music_player_settings,
            music::save_music_playlists,
            music::save_music_recent,
            music::scan_music_files,
            music::search_online_music,
            music::upload_music_cloud_storage_file,
            music::validate_music_cloud_storage,
            native_tools::run_plugin_tool,
            storage::get_app_settings,
            screenshot::cancel_screenshot_selection,
            screenshot::capture_screenshot_magnifier_frame,
            screenshot::capture_screenshot_selection_frame,
            screenshot::close_pin_screenshot_window,
            screenshot::copy_pin_screenshot,
            screenshot::copy_screenshot_text,
            screenshot::dismiss_stale_screenshot_overlay,
            screenshot::focus_pin_screenshot_window,
            screenshot::finish_screenshot_overlay_image,
            screenshot::finish_screenshot_selection,
            screenshot::finish_screenshot_selection_image,
            screenshot::get_pin_screenshot_payload,
            screenshot::get_screenshot_picker_snapshot,
            screenshot::get_screenshot_cursor_position,
            screenshot::get_screenshot_color_frames,
            screenshot::get_last_screenshot,
            screenshot::log_screenshot_debug,
            screenshot::move_pin_screenshot_window,
            screenshot::open_region_recording_playback,
            screenshot::open_region_screen_recorder,
            screenshot::open_scroll_screenshot_selection,
            screenshot::open_screenshot_selection,
            screenshot::pin_screenshot,
            screenshot::recognize_screenshot_overlay_region,
            screenshot::reveal_pin_screenshot_window,
            screenshot::resize_pin_screenshot_window,
            screenshot::sample_screenshot_color,
            screenshot::scroll_screenshot_overlay_target,
            screenshot::save_pin_screenshot,
            screenshot::show_pin_screenshot_menu,
            screenshot::show_screenshot_overlay,
            screenshot::start_screenshot,
            screenshot::start_screenshot_overlay_scroll_capture,
            screenshot::translate_screenshot_overlay_text,
            screen_recorder::close_screen_recording_region_frame,
            screen_recorder::notify_region_recording_capture_started,
            screen_recorder::save_screen_recording,
            storage::set_app_settings,
            storage::get_plugin_storage_item,
            storage::set_plugin_storage_item,
            storage::remove_plugin_storage_item,
            plugins::list_installed_plugin_tools,
            plugins::list_plugin_market,
            plugins::install_local_plugin,
            plugins::install_market_plugin,
            plugins::uninstall_plugin,
            storage::get_storage_directories,
            storage::set_storage_directory,
            storage::reset_storage_directory,
            storage::clear_app_cache,
            update_ops::check_for_updates,
            update_ops::download_update,
            update_ops::install_downloaded_update,
            taskbar_calendar::open_taskbar_calendar_hotzone,
            taskbar_calendar::refresh_taskbar_calendar_hotzone,
            tray::get_tray_menu_shortcuts,
            tray::resize_tray_menu,
            tray::run_tray_menu_action,
            super_clipboard::capture_super_clipboard,
            super_clipboard::capture_super_clipboard_text,
            super_clipboard::clear_super_clipboard,
            super_clipboard::delete_super_clipboard_item,
            super_clipboard::get_super_clipboard_detail,
            super_clipboard::get_super_clipboard_payload,
            super_clipboard::get_super_clipboard_stats,
            super_clipboard::query_super_clipboard,
            quick_tool::open_quick_tool,
            quick_tool::get_last_content,
            ssh_ops::ssh_exec,
            ssh_ops::ssh_exec_stream,
            ssh_ops::test_ssh_connection,
            static_server::get_static_server_status,
            static_server::start_static_server,
            static_server::stop_static_server,
            window::show_main_window_ready
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tooldesk app");

    app.run(|app_handle, event| match event {
        RunEvent::Ready => diagnostics::log_flow("app", "run ready"),
        RunEvent::ExitRequested { .. } => diagnostics::log_flow("app", "exit requested"),
        RunEvent::Exit => {
            diagnostics::log_flow("app", "exit");
            tauri::async_runtime::block_on(static_server::stop_on_app_exit(app_handle));
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::should_warm_screenshot_overlay;

    #[test]
    fn macos_skips_screenshot_overlay_warmup() {
        assert!(!should_warm_screenshot_overlay("macos"));
    }
}
