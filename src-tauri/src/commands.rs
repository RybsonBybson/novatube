//! All commands exposed to the React renderer.

use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::models::{
    AddDownloadInput, AppInfo, AppSettings, BinariesStatus, DownloadItem, HistoryEntry, MediaInfo,
};
use crate::state::AppState;

/* ------------------------------- metadata ------------------------------- */

#[tauri::command]
pub async fn metadata_fetch(url: String, state: State<'_, AppState>) -> Result<MediaInfo, String> {
    if url.trim().is_empty() {
        return Err("Invalid URL.".into());
    }
    crate::metadata::fetch_metadata(&url, &state.binaries).await
}

/* ------------------------------ downloads ------------------------------- */

#[tauri::command]
pub fn downloads_list(state: State<'_, AppState>) -> Vec<DownloadItem> {
    state.queue.list()
}

#[tauri::command]
pub async fn downloads_add(input: AddDownloadInput, state: State<'_, AppState>) -> Result<DownloadItem, String> {
    state.queue.add(input)
}

#[tauri::command]
pub async fn downloads_add_many(
    inputs: Vec<AddDownloadInput>,
    prioritize: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<DownloadItem>, String> {
    state.queue.add_many(inputs, prioritize.unwrap_or(false))
}

#[tauri::command]
pub fn downloads_pause(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require(&id)?;
    state.queue.pause(&id);
    Ok(())
}

#[tauri::command]
pub fn downloads_resume(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require(&id)?;
    state.queue.resume(&id);
    Ok(())
}

#[tauri::command]
pub fn downloads_cancel(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require(&id)?;
    state.queue.cancel(&id);
    Ok(())
}

#[tauri::command]
pub fn downloads_retry(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require(&id)?;
    state.queue.retry(&id);
    Ok(())
}

#[tauri::command]
pub fn downloads_move_to_top(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require(&id)?;
    state.queue.move_to_top(&id);
    Ok(())
}

#[tauri::command]
pub async fn downloads_remove(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require(&id)?;
    state.queue.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn downloads_clear_finished(state: State<'_, AppState>) -> Result<(), String> {
    state.queue.clear_finished();
    Ok(())
}

#[tauri::command]
pub async fn downloads_clear_all(state: State<'_, AppState>) -> Result<(), String> {
    state.queue.clear_all();
    Ok(())
}

#[tauri::command]
pub fn downloads_open_file(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let item = state.queue.get(&id).ok_or("The file is not available yet.")?;
    let path = item.output_path.ok_or("The file is not available yet.")?;
    if !Path::new(&path).exists() {
        return Err("The file was moved or deleted.".into());
    }
    opener::open(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn downloads_open_folder(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let item = state.queue.get(&id).ok_or("The file is not available yet.")?;
    let path = item.output_path.ok_or("The file is not available yet.")?;
    if !Path::new(&path).exists() {
        return Err("The file was moved or deleted.".into());
    }
    opener::reveal(&path).map_err(|error| error.to_string())
}

/* ------------------------------- history -------------------------------- */

#[tauri::command]
pub fn history_list(state: State<'_, AppState>) -> Vec<HistoryEntry> {
    state.store.history()
}

#[tauri::command]
pub fn history_remove(id: String, state: State<'_, AppState>) -> Result<Vec<HistoryEntry>, String> {
    require(&id)?;
    Ok(state.store.remove_history(&id))
}

#[tauri::command]
pub fn history_clear(state: State<'_, AppState>) -> Result<Vec<HistoryEntry>, String> {
    Ok(state.store.clear_history())
}

/* ------------------------------- settings ------------------------------- */

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AppSettings {
    state.store.settings()
}

#[tauri::command]
pub async fn settings_update(patch: Value, state: State<'_, AppState>) -> Result<AppSettings, String> {
    if !patch.is_object() {
        return Err("Invalid settings payload.".into());
    }
    let previous = state.store.settings();
    let settings = state.store.update_settings(patch);
    if previous.concurrency != settings.concurrency {
        state.queue.apply_concurrency();
    }
    Ok(settings)
}

#[tauri::command]
pub async fn settings_pick_folder(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let start = state.store.settings().download_dir;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("Choose where NovaTube saves downloads")
            .set_directory(start)
            .pick_folder()
    })
    .await
    .map_err(|error| error.to_string())?;

    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

/* ------------------------------- binaries ------------------------------- */

#[tauri::command]
pub fn binaries_status(state: State<'_, AppState>) -> BinariesStatus {
    state.binaries.status()
}

#[tauri::command]
pub async fn binaries_update_ytdlp(state: State<'_, AppState>) -> Result<BinariesStatus, String> {
    state.binaries.clone().update_ytdlp().await
}

#[tauri::command]
pub async fn binaries_refresh(state: State<'_, AppState>) -> Result<BinariesStatus, String> {
    Ok(state.binaries.clone().refresh().await)
}

/* --------------------------------- app ---------------------------------- */

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        tauri: tauri::VERSION.to_string(),
        download_dir: state.store.settings().download_dir,
    }
}

#[tauri::command]
pub fn app_open_path(path: String, _state: State<'_, AppState>) -> Result<(), String> {
    require(&path)?;
    opener::open(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn app_open_external(url: String, _state: State<'_, AppState>) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http(s) links can be opened.".into());
    }
    opener::open(&url).map_err(|error| error.to_string())
}

/* ------------------------------- clipboard ------------------------------ */

#[tauri::command]
pub fn clipboard_read(_state: State<'_, AppState>) -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.get_text().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clipboard_write(text: String, _state: State<'_, AppState>) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}

fn require(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err("Missing identifier.".into())
    } else {
        Ok(())
    }
}
