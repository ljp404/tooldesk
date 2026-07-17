use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::Cursor;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use objc2_app_kit::NSWorkspace;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSFileManager, NSString};

#[cfg(target_os = "windows")]
use windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Foundation::SIZE,
        Graphics::Gdi::HBITMAP,
        Storage::FileSystem::WIN32_FIND_DATAW,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
        },
        UI::Shell::{
            BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem,
            IShellItemImageFactory, IShellLinkW, SHCreateItemFromParsingName, SHGetKnownFolderItem,
            ShellLink, KF_FLAG_DEFAULT, SIGDN, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_NORMALDISPLAY,
            SIIGBF_ICONONLY, SLGP_RAWPATH,
        },
    },
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
    SelectObject, BITMAPINFO, BI_RGB, DIB_RGB_COLORS,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, PrivateExtractIconsW, DI_NORMAL,
};

static APPLICATION_ICON_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
static APPLICATION_ENTRY_CACHE: OnceLock<Mutex<InstalledApplicationCache>> = OnceLock::new();
const APPLICATION_ICON_SIZE: u32 = 64;
const APPLICATION_LIST_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
struct InstalledApplicationCache {
    entries: Vec<InstalledApplicationEntry>,
    refreshed_at: Option<Instant>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledApplication {
    id: String,
    keywords: Vec<String>,
    name: String,
}

#[derive(Clone, Debug)]
struct InstalledApplicationEntry {
    application: InstalledApplication,
    target: InstalledApplicationTarget,
}

#[derive(Clone, Debug)]
enum InstalledApplicationTarget {
    Path(PathBuf),
    #[cfg(target_os = "windows")]
    ShellItem(String),
}

fn should_include_application_name(name: &str) -> bool {
    let normalized = name.trim().to_lowercase();

    if normalized.is_empty() {
        return false;
    }

    ![
        "uninstall",
        "release notes",
        "getting started",
        "user guide",
        "documentation",
        "readme",
        "卸载",
        "帮助",
        "使用手册",
        "最新版本",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

#[cfg(not(target_os = "macos"))]
fn application_name(path: &Path) -> Option<String> {
    let name = path.file_stem()?.to_string_lossy().trim().to_string();
    should_include_application_name(&name).then_some(name)
}

#[cfg(target_os = "macos")]
fn application_name(path: &Path) -> Option<String> {
    let path_value = path.to_string_lossy();
    let display_name = NSFileManager::defaultManager()
        .displayNameAtPath(&NSString::from_str(&path_value))
        .to_string();
    let name = display_name
        .strip_suffix(".app")
        .unwrap_or(&display_name)
        .trim()
        .to_string();

    should_include_application_name(&name).then_some(name)
}

fn application_keywords(root: &Path, path: &Path, name: &str) -> Vec<String> {
    let mut keywords = vec![name.to_string()];

    if let Some(file_stem) = path.file_stem() {
        let value = file_stem.to_string_lossy().trim().to_string();
        if !value.is_empty() && !keywords.iter().any(|item| item == &value) {
            keywords.push(value);
        }
    }

    if let Ok(relative) = path.strip_prefix(root) {
        for component in relative.parent().into_iter().flat_map(Path::components) {
            let value = component.as_os_str().to_string_lossy().trim().to_string();
            if !value.is_empty() && !keywords.iter().any(|item| item == &value) {
                keywords.push(value);
            }
        }
    }

    keywords
}

fn push_application(entries: &mut Vec<InstalledApplicationEntry>, root: &Path, path: PathBuf) {
    let Some(name) = application_name(&path) else {
        return;
    };
    let id = path.to_string_lossy().to_string();

    entries.push(InstalledApplicationEntry {
        application: InstalledApplication {
            id,
            keywords: application_keywords(root, &path, &name),
            name,
        },
        target: InstalledApplicationTarget::Path(path),
    });
}

#[cfg(target_os = "windows")]
fn collect_windows_shortcuts(
    root: &Path,
    directory: &Path,
    depth: usize,
    entries: &mut Vec<InstalledApplicationEntry>,
) {
    if depth > 8 {
        return;
    }

    let Ok(items) = fs::read_dir(directory) else {
        return;
    };

    for item in items.flatten() {
        let path = item.path();
        let Ok(file_type) = item.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            collect_windows_shortcuts(root, &path, depth + 1, entries);
            continue;
        }

        let is_shortcut = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("lnk"));

        if file_type.is_file() && is_shortcut {
            push_application(entries, root, path);
        }
    }
}

#[cfg(target_os = "windows")]
fn shell_item_display_name(item: &IShellItem, name_type: SIGDN) -> Option<String> {
    let value = unsafe { item.GetDisplayName(name_type) }.ok()?;
    let result = unsafe { value.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(value.0.cast())) };
    result
}

#[cfg(target_os = "windows")]
fn apps_folder_target(parsing_name: &str) -> String {
    if parsing_name.starts_with("shell:") || parsing_name.starts_with("::{") {
        parsing_name.to_string()
    } else {
        format!(r"shell:AppsFolder\{parsing_name}")
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_shell_applications(entries: &mut Vec<InstalledApplicationEntry>) {
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.0 >= 0;
    let applications = (|| {
        let apps_folder: IShellItem =
            unsafe { SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) }.ok()?;
        let enumerator: IEnumShellItems = unsafe {
            apps_folder.BindToHandler(
                None::<&windows::Win32::System::Com::IBindCtx>,
                &BHID_EnumItems,
            )
        }
        .ok()?;
        let mut applications = Vec::new();

        loop {
            let mut items = [None];
            let mut fetched = 0;
            if unsafe { enumerator.Next(&mut items, Some(&mut fetched)) }.is_err() || fetched == 0 {
                break;
            }

            let Some(item) = items[0].take() else {
                continue;
            };
            let Some(name) = shell_item_display_name(&item, SIGDN_NORMALDISPLAY) else {
                continue;
            };
            let Some(parsing_name) = shell_item_display_name(&item, SIGDN_DESKTOPABSOLUTEPARSING)
            else {
                continue;
            };

            if !should_include_application_name(&name) || Path::new(&parsing_name).is_absolute() {
                continue;
            }

            applications.push(InstalledApplicationEntry {
                application: InstalledApplication {
                    id: format!("windows-shell:{parsing_name}"),
                    keywords: vec![name.clone(), parsing_name.clone()],
                    name,
                },
                target: InstalledApplicationTarget::ShellItem(apps_folder_target(&parsing_name)),
            });
        }

        Some(applications)
    })()
    .unwrap_or_default();

    if initialized {
        unsafe { CoUninitialize() };
    }

    entries.extend(applications);
}

#[cfg(target_os = "windows")]
fn collect_platform_applications(entries: &mut Vec<InstalledApplicationEntry>) {
    let roots = [
        env::var_os("APPDATA").map(PathBuf::from).map(|path| {
            path.join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
        }),
        env::var_os("PROGRAMDATA").map(PathBuf::from).map(|path| {
            path.join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
        }),
    ];

    for root in roots.into_iter().flatten().filter(|path| path.is_dir()) {
        collect_windows_shortcuts(&root, &root, 0, entries);
    }

    collect_windows_shell_applications(entries);
}

#[cfg(target_os = "macos")]
fn collect_macos_applications(
    root: &Path,
    directory: &Path,
    depth: usize,
    entries: &mut Vec<InstalledApplicationEntry>,
) {
    if depth > 4 {
        return;
    }

    let Ok(items) = fs::read_dir(directory) else {
        return;
    };

    for item in items.flatten() {
        let path = item.path();
        let Ok(file_type) = item.file_type() else {
            continue;
        };

        if !file_type.is_dir() {
            continue;
        }

        let is_application = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("app"));

        if is_application {
            push_application(entries, root, path);
        } else {
            collect_macos_applications(root, &path, depth + 1, entries);
        }
    }
}

#[cfg(target_os = "macos")]
fn collect_platform_applications(entries: &mut Vec<InstalledApplicationEntry>) {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];

    if let Some(home) = env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }

    for root in roots.into_iter().filter(|path| path.is_dir()) {
        collect_macos_applications(&root, &root, 0, entries);
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn parse_desktop_application(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let mut in_desktop_entry = false;
    let mut fallback_name = None;
    let mut localized_name = None;

    for line in content.lines().map(str::trim) {
        if line.starts_with('[') {
            in_desktop_entry = line == "[Desktop Entry]";
            continue;
        }

        if !in_desktop_entry || line.starts_with('#') {
            continue;
        }

        if matches!(line, "Hidden=true" | "NoDisplay=true") || line == "Type=Link" {
            return None;
        }

        if let Some(value) = line
            .strip_prefix("Name[zh_CN]=")
            .or_else(|| line.strip_prefix("Name[zh]="))
            .map(str::trim)
        {
            localized_name = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("Name=").map(str::trim) {
            fallback_name = Some(value.to_string());
        }
    }

    localized_name
        .or(fallback_name)
        .filter(|name| should_include_application_name(name))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn collect_platform_applications(entries: &mut Vec<InstalledApplicationEntry>) {
    let mut roots = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];

    if let Some(home) = env::var_os("HOME") {
        roots.push(PathBuf::from(home).join(".local/share/applications"));
    }

    for root in roots.into_iter().filter(|path| path.is_dir()) {
        let Ok(items) = fs::read_dir(&root) else {
            continue;
        };

        for item in items.flatten() {
            let path = item.path();
            let is_desktop_file = path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("desktop"));

            if !is_desktop_file {
                continue;
            }

            let Some(name) = parse_desktop_application(&path) else {
                continue;
            };
            let id = path.to_string_lossy().to_string();
            entries.push(InstalledApplicationEntry {
                application: InstalledApplication {
                    id,
                    keywords: vec![name.clone()],
                    name,
                },
                target: InstalledApplicationTarget::Path(path),
            });
        }
    }
}

fn installed_application_entries() -> Vec<InstalledApplicationEntry> {
    let mut entries = Vec::new();
    collect_platform_applications(&mut entries);

    entries.sort_by(|current, next| {
        current
            .application
            .name
            .to_lowercase()
            .cmp(&next.application.name.to_lowercase())
    });

    let mut names = HashSet::new();
    entries.retain(|entry| names.insert(entry.application.name.to_lowercase()));
    entries
}

fn application_entry_cache() -> &'static Mutex<InstalledApplicationCache> {
    APPLICATION_ENTRY_CACHE.get_or_init(|| Mutex::new(InstalledApplicationCache::default()))
}

fn refresh_installed_application_entries() -> Vec<InstalledApplicationEntry> {
    let entries = installed_application_entries();

    if let Ok(mut cache) = application_entry_cache().lock() {
        cache.entries = entries.clone();
        cache.refreshed_at = Some(Instant::now());
    }

    entries
}

fn cached_installed_application_entries() -> Vec<InstalledApplicationEntry> {
    if let Some(entries) = application_entry_cache().lock().ok().and_then(|cache| {
        cache
            .refreshed_at
            .filter(|refreshed_at| refreshed_at.elapsed() < APPLICATION_LIST_CACHE_TTL)
            .map(|_| cache.entries.clone())
    }) {
        return entries;
    }

    refresh_installed_application_entries()
}

fn find_installed_application_entry(application_id: &str) -> Option<InstalledApplicationEntry> {
    if let Some(entry) = application_entry_cache().lock().ok().and_then(|cache| {
        cache
            .entries
            .iter()
            .find(|entry| entry.application.id == application_id)
            .cloned()
    }) {
        return Some(entry);
    }

    refresh_installed_application_entries()
        .into_iter()
        .find(|entry| entry.application.id == application_id)
}

fn application_icon_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    APPLICATION_ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn png_data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", BASE64_STANDARD.encode(png))
}

fn encode_png(rgba: Vec<u8>) -> Result<Vec<u8>, String> {
    let image =
        xcap::image::RgbaImage::from_raw(APPLICATION_ICON_SIZE, APPLICATION_ICON_SIZE, rgba)
            .ok_or_else(|| "程序图标数据无效".to_string())?;
    let mut png = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png), xcap::image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(png)
}

#[cfg(target_os = "windows")]
fn path_from_wide_buffer(buffer: &[u16]) -> Option<PathBuf> {
    let length = buffer.iter().position(|value| *value == 0)?;
    let value = String::from_utf16_lossy(&buffer[..length]);
    (!value.trim().is_empty()).then(|| PathBuf::from(value))
}

#[cfg(target_os = "windows")]
fn shortcut_icon_sources(path: &Path) -> Vec<(PathBuf, i32)> {
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.0 >= 0;
    let sources = (|| {
        let shell_link: IShellLinkW =
            unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }.ok()?;
        let persist_file: IPersistFile = shell_link.cast().ok()?;
        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        unsafe { persist_file.Load(PCWSTR(wide_path.as_ptr()), STGM_READ) }.ok()?;

        let mut sources = Vec::new();
        let mut icon_path = vec![0; 32_768];
        let mut icon_index = 0;
        if unsafe { shell_link.GetIconLocation(&mut icon_path, &mut icon_index) }.is_ok() {
            if let Some(icon_path) = path_from_wide_buffer(&icon_path) {
                if icon_path.is_file() {
                    sources.push((icon_path, icon_index));
                }
            }
        }

        let mut target_path = vec![0; 32_768];
        let mut find_data = unsafe { std::mem::zeroed::<WIN32_FIND_DATAW>() };
        if unsafe { shell_link.GetPath(&mut target_path, &mut find_data, SLGP_RAWPATH.0 as u32) }
            .is_ok()
        {
            if let Some(target_path) = path_from_wide_buffer(&target_path) {
                if target_path.is_file()
                    && !sources.iter().any(|(source, _)| source == &target_path)
                {
                    sources.push((target_path, 0));
                }
            }
        }

        Some(sources)
    })()
    .unwrap_or_default();

    if initialized {
        unsafe { CoUninitialize() };
    }

    sources
}

#[cfg(target_os = "windows")]
fn extract_icon_handle(
    path: &Path,
    icon_index: i32,
) -> Option<windows_sys::Win32::UI::WindowsAndMessaging::HICON> {
    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut icon = std::ptr::null_mut();
    let mut icon_id = 0;
    let extracted = unsafe {
        PrivateExtractIconsW(
            wide_path.as_ptr(),
            icon_index,
            APPLICATION_ICON_SIZE as i32,
            APPLICATION_ICON_SIZE as i32,
            &mut icon,
            &mut icon_id,
            1,
            0,
        )
    };

    (extracted > 0 && !icon.is_null()).then_some(icon)
}

#[cfg(target_os = "windows")]
fn get_shell_file_icon(path: &Path) -> Option<windows_sys::Win32::UI::WindowsAndMessaging::HICON> {
    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut file_info = unsafe { std::mem::zeroed::<SHFILEINFOW>() };
    let result = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut file_info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 || file_info.hIcon.is_null() {
        None
    } else {
        Some(file_info.hIcon)
    }
}

#[cfg(target_os = "windows")]
fn icon_data_url(
    icon: windows_sys::Win32::UI::WindowsAndMessaging::HICON,
) -> Result<Option<String>, String> {
    let icon_size = APPLICATION_ICON_SIZE as i32;
    let mut bitmap_info = unsafe { std::mem::zeroed::<BITMAPINFO>() };
    bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
    bitmap_info.bmiHeader.biWidth = icon_size;
    bitmap_info.bmiHeader.biHeight = -icon_size;
    bitmap_info.bmiHeader.biPlanes = 1;
    bitmap_info.bmiHeader.biBitCount = 32;
    bitmap_info.bmiHeader.biCompression = BI_RGB;

    let desktop: HWND = std::ptr::null_mut();
    let screen_dc = unsafe { GetDC(desktop) };
    let memory_dc = unsafe { CreateCompatibleDC(screen_dc) };
    let mut bits = std::ptr::null_mut();
    let bitmap = unsafe {
        CreateDIBSection(
            memory_dc,
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        )
    };

    if screen_dc.is_null() || memory_dc.is_null() || bitmap.is_null() || bits.is_null() {
        unsafe {
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            if !memory_dc.is_null() {
                DeleteDC(memory_dc);
            }
            if !screen_dc.is_null() {
                ReleaseDC(desktop, screen_dc);
            }
            DestroyIcon(icon);
        }
        return Ok(None);
    }

    let previous = unsafe { SelectObject(memory_dc, bitmap) };
    let drawn = unsafe {
        DrawIconEx(
            memory_dc,
            0,
            0,
            icon,
            icon_size,
            icon_size,
            0,
            std::ptr::null_mut(),
            DI_NORMAL,
        )
    };
    let byte_count = (APPLICATION_ICON_SIZE * APPLICATION_ICON_SIZE * 4) as usize;
    let rgba = if drawn != 0 {
        unsafe { std::slice::from_raw_parts(bits.cast::<u8>(), byte_count) }.to_vec()
    } else {
        Vec::new()
    };

    unsafe {
        if !previous.is_null() {
            SelectObject(memory_dc, previous);
        }
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(desktop, screen_dc);
        DestroyIcon(icon);
    }

    if rgba.is_empty() {
        return Ok(None);
    }

    rgba_data_url(rgba)
}

#[cfg(target_os = "windows")]
fn rgba_data_url(mut rgba: Vec<u8>) -> Result<Option<String>, String> {
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    if rgba.chunks_exact(4).all(|pixel| pixel[3] == 0) {
        for pixel in rgba.chunks_exact_mut(4) {
            if pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0 {
                pixel[3] = 255;
            }
        }
    }

    encode_png(rgba).map(|png| Some(png_data_url(&png)))
}

#[cfg(target_os = "windows")]
fn bitmap_data_url(bitmap: HBITMAP) -> Result<Option<String>, String> {
    let desktop: HWND = std::ptr::null_mut();
    let screen_dc = unsafe { GetDC(desktop) };

    if screen_dc.is_null() {
        unsafe { DeleteObject(bitmap.0) };
        return Ok(None);
    }

    let mut bitmap_info = unsafe { std::mem::zeroed::<BITMAPINFO>() };
    bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
    bitmap_info.bmiHeader.biWidth = APPLICATION_ICON_SIZE as i32;
    bitmap_info.bmiHeader.biHeight = -(APPLICATION_ICON_SIZE as i32);
    bitmap_info.bmiHeader.biPlanes = 1;
    bitmap_info.bmiHeader.biBitCount = 32;
    bitmap_info.bmiHeader.biCompression = BI_RGB;
    let mut rgba = vec![0; (APPLICATION_ICON_SIZE * APPLICATION_ICON_SIZE * 4) as usize];
    let copied = unsafe {
        GetDIBits(
            screen_dc,
            bitmap.0,
            0,
            APPLICATION_ICON_SIZE,
            rgba.as_mut_ptr().cast(),
            &mut bitmap_info,
            DIB_RGB_COLORS,
        )
    };

    unsafe {
        ReleaseDC(desktop, screen_dc);
        DeleteObject(bitmap.0);
    }

    if copied == 0 {
        return Ok(None);
    }

    rgba_data_url(rgba)
}

#[cfg(target_os = "windows")]
fn extract_shell_item_icon(target: &str) -> Result<Option<String>, String> {
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.0 >= 0;
    let bitmap = (|| {
        let wide_target = target
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let item: IShellItem = unsafe {
            SHCreateItemFromParsingName(
                PCWSTR(wide_target.as_ptr()),
                None::<&windows::Win32::System::Com::IBindCtx>,
            )
        }
        .ok()?;
        let factory: IShellItemImageFactory = item.cast().ok()?;
        unsafe {
            factory.GetImage(
                SIZE {
                    cx: APPLICATION_ICON_SIZE as i32,
                    cy: APPLICATION_ICON_SIZE as i32,
                },
                SIIGBF_ICONONLY,
            )
        }
        .ok()
    })();
    let result = match bitmap {
        Some(bitmap) => bitmap_data_url(bitmap),
        None => Ok(None),
    };

    if initialized {
        unsafe { CoUninitialize() };
    }

    result
}

#[cfg(target_os = "windows")]
fn extract_application_icon(path: &Path) -> Result<Option<String>, String> {
    for (source, icon_index) in shortcut_icon_sources(path) {
        if let Some(icon) = extract_icon_handle(&source, icon_index) {
            return icon_data_url(icon);
        }

        if let Some(icon) = get_shell_file_icon(&source) {
            return icon_data_url(icon);
        }
    }

    Ok(None)
}

#[cfg(target_os = "macos")]
fn extract_application_icon(path: &Path) -> Result<Option<String>, String> {
    let path_value = path.to_string_lossy();
    let icon = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(&path_value));
    let Some(tiff) = icon.TIFFRepresentation() else {
        return Ok(None);
    };
    let image = xcap::image::load_from_memory(&tiff.to_vec())
        .map_err(|error| format!("读取程序图标失败：{error}"))?;
    let rgba = image
        .resize_exact(
            APPLICATION_ICON_SIZE,
            APPLICATION_ICON_SIZE,
            xcap::image::imageops::FilterType::Lanczos3,
        )
        .to_rgba8()
        .into_raw();
    let png = encode_png(rgba)?;

    Ok(Some(png_data_url(&png)))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn extract_application_icon(_path: &Path) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub(crate) async fn list_installed_applications() -> Result<Vec<InstalledApplication>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        cached_installed_application_entries()
            .into_iter()
            .map(|entry| entry.application)
            .collect()
    })
    .await
    .map_err(|error| format!("枚举本机程序失败：{error}"))
}

fn get_installed_application_icon_inner(application_id: String) -> Result<Option<String>, String> {
    let application_id = application_id.trim();

    if let Some(icon) = application_icon_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(application_id).cloned())
    {
        return Ok(icon);
    }

    let entry = find_installed_application_entry(application_id)
        .ok_or_else(|| "未找到本机程序".to_string())?;
    let icon = match &entry.target {
        InstalledApplicationTarget::Path(path) => extract_application_icon(path)?,
        #[cfg(target_os = "windows")]
        InstalledApplicationTarget::ShellItem(target) => extract_shell_item_icon(target)?,
    };

    if let Ok(mut cache) = application_icon_cache().lock() {
        cache.insert(application_id.to_string(), icon.clone());
    }

    Ok(icon)
}

#[tauri::command]
pub(crate) async fn get_installed_application_icon(
    application_id: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_installed_application_icon_inner(application_id)
    })
    .await
    .map_err(|error| format!("读取程序图标失败：{error}"))?
}

fn launch_installed_application_inner(application_id: String) -> Result<(), String> {
    let application_id = application_id.trim();
    let entry = find_installed_application_entry(application_id)
        .ok_or_else(|| "未找到本机程序".to_string())?;

    #[cfg(target_os = "windows")]
    match &entry.target {
        InstalledApplicationTarget::Path(path) => Command::new("explorer").arg(path).spawn(),
        InstalledApplicationTarget::ShellItem(target) => {
            Command::new("explorer").arg(target).spawn()
        }
    }
    .map_err(|error| format!("启动程序失败：{error}"))?;

    #[cfg(target_os = "macos")]
    match &entry.target {
        InstalledApplicationTarget::Path(path) => Command::new("open").arg(path).spawn(),
    }
    .map_err(|error| format!("启动程序失败：{error}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    match &entry.target {
        InstalledApplicationTarget::Path(path) => {
            Command::new("gio").arg("launch").arg(path).spawn()
        }
    }
    .map_err(|error| format!("启动程序失败：{error}"))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn launch_installed_application(application_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || launch_installed_application_inner(application_id))
        .await
        .map_err(|error| format!("启动程序失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::should_include_application_name;

    #[cfg(target_os = "windows")]
    use super::{
        apps_folder_target, extract_application_icon, extract_shell_item_icon,
        installed_application_entries, shortcut_icon_sources, InstalledApplicationTarget,
        APPLICATION_ICON_SIZE, BASE64_STANDARD,
    };
    #[cfg(target_os = "windows")]
    use base64::Engine as _;

    #[test]
    fn keeps_application_shortcuts() {
        assert!(should_include_application_name("企业微信"));
        assert!(should_include_application_name("Visual Studio Code"));
    }

    #[test]
    fn filters_maintenance_shortcuts() {
        assert!(!should_include_application_name("卸载企业微信"));
        assert!(!should_include_application_name("WinRAR 中文帮助"));
        assert!(!should_include_application_name("Uninstall Example"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn extracts_start_menu_shortcut_icon() {
        let Some(path) = installed_application_entries()
            .into_iter()
            .find_map(|entry| match entry.target {
                InstalledApplicationTarget::Path(path) => Some(path),
                InstalledApplicationTarget::ShellItem(_) => None,
            })
        else {
            return;
        };
        let sources = shortcut_icon_sources(&path);
        assert!(sources.iter().all(|(path, _)| {
            !path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("lnk"))
        }));
        let icon = extract_application_icon(&path)
            .expect("shortcut icon extraction should not fail")
            .expect("shortcut should have an associated icon");

        assert_png_data_url(&icon);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn builds_apps_folder_launch_target() {
        assert_eq!(
            apps_folder_target("Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"),
            r"shell:AppsFolder\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn extracts_packaged_application_icon() {
        let entries = installed_application_entries();
        let shell_applications = entries
            .iter()
            .filter_map(|entry| match &entry.target {
                InstalledApplicationTarget::ShellItem(target) => {
                    Some((entry.application.name.as_str(), target.as_str()))
                }
                InstalledApplicationTarget::Path(_) => None,
            })
            .collect::<Vec<_>>();
        assert!(!shell_applications.is_empty());
        let (_, target) = shell_applications
            .iter()
            .find(|(name, target)| *name == "记事本" || target.contains("WindowsNotepad"))
            .copied()
            .unwrap_or(shell_applications[0]);
        let icon = extract_shell_item_icon(target)
            .expect("packaged application icon extraction should not fail")
            .expect("packaged application should have an associated icon");

        assert_png_data_url(&icon);
    }

    #[cfg(target_os = "windows")]
    fn assert_png_data_url(icon: &str) {
        let encoded = icon
            .strip_prefix("data:image/png;base64,")
            .expect("application icon should be a PNG data URL");
        let png = BASE64_STANDARD
            .decode(encoded)
            .expect("application icon should contain valid base64");
        let image =
            xcap::image::load_from_memory(&png).expect("application icon should be valid PNG");
        assert_eq!(image.width(), APPLICATION_ICON_SIZE);
        assert_eq!(image.height(), APPLICATION_ICON_SIZE);
        assert!(image.to_rgba8().pixels().any(|pixel| pixel[3] > 0));
    }
}
