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
