//! Tiny JSON store for settings, history and the last window rectangle.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::models::{AppSettings, HistoryEntry};

const HISTORY_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: 1360,
            height: 900,
            maximized: false,
        }
    }
}

pub struct AppStore {
    dir: PathBuf,
    settings: Mutex<AppSettings>,
    history: Mutex<Vec<HistoryEntry>>,
    window: Mutex<WindowState>,
}

impl AppStore {
    pub fn new(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&dir);

        let mut settings = read_json(&dir.join("settings.json")).unwrap_or_default();
        normalize(&mut settings);
        let history = read_history(&dir.join("history.json"));
        let window = read_json(&dir.join("window.json")).unwrap_or_default();
        let _ = fs::create_dir_all(&settings.download_dir);

        Self {
            dir,
            settings: Mutex::new(settings),
            history: Mutex::new(history),
            window: Mutex::new(window),
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.lock().map(|value| value.clone()).unwrap_or_default()
    }

    pub fn update_settings(&self, patch: Value) -> AppSettings {
        let mut current = match serde_json::to_value(self.settings()) {
            Ok(value) => value,
            Err(_) => return self.settings(),
        };

        if let (Some(base), Value::Object(patch)) = (current.as_object_mut(), patch) {
            for (key, value) in patch {
                if base.contains_key(&key) {
                    base.insert(key, value);
                }
            }
        }

        let mut next: AppSettings = serde_json::from_value(current).unwrap_or_default();
        normalize(&mut next);
        let _ = fs::create_dir_all(&next.download_dir);
        write_json(&self.dir.join("settings.json"), &next);
        if let Ok(mut guard) = self.settings.lock() {
            *guard = next.clone();
        }
        next
    }

    pub fn history(&self) -> Vec<HistoryEntry> {
        let mut entries = self.history.lock().map(|value| value.clone()).unwrap_or_default();
        entries.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
        entries
    }

    pub fn add_history(&self, entry: HistoryEntry) -> Vec<HistoryEntry> {
        {
            let mut guard = self.history.lock().unwrap_or_else(|error| error.into_inner());
            guard.retain(|item| item.file_path != entry.file_path || item.url != entry.url);
            guard.insert(0, entry);
            guard.truncate(HISTORY_LIMIT);
        }
        self.persist_history();
        self.history()
    }

    pub fn remove_history(&self, id: &str) -> Vec<HistoryEntry> {
        {
            let mut guard = self.history.lock().unwrap_or_else(|error| error.into_inner());
            guard.retain(|entry| entry.id != id);
        }
        self.persist_history();
        self.history()
    }

    pub fn clear_history(&self) -> Vec<HistoryEntry> {
        if let Ok(mut guard) = self.history.lock() {
            guard.clear();
        }
        self.persist_history();
        Vec::new()
    }

    pub fn window_state(&self) -> WindowState {
        self.window.lock().map(|value| value.clone()).unwrap_or_default()
    }

    pub fn save_window_state(&self, state: WindowState) {
        let clean = WindowState {
            x: state.x,
            y: state.y,
            width: state.width.clamp(1040, 10000),
            height: state.height.clamp(680, 10000),
            maximized: state.maximized,
        };
        write_json(&self.dir.join("window.json"), &clean);
        if let Ok(mut guard) = self.window.lock() {
            *guard = clean;
        }
    }

    fn persist_history(&self) {
        let entries = self.history.lock().map(|value| value.clone()).unwrap_or_default();
        write_json(&self.dir.join("history.json"), &entries);
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn read_history(path: &Path) -> Vec<HistoryEntry> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    let value: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let Value::Array(items) = value else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|item| serde_json::from_value(item).ok())
        .collect()
}

fn write_json<T: Serialize>(path: &Path, value: &T) {
    let Ok(contents) = serde_json::to_string_pretty(value) else {
        return;
    };
    let temp = path.with_extension("tmp");
    if fs::write(&temp, contents).is_err() {
        return;
    }
    let _ = fs::remove_file(path);
    let _ = fs::rename(temp, path);
}

fn normalize(settings: &mut AppSettings) {
    if settings.download_dir.trim().is_empty() {
        settings.download_dir = AppSettings::default().download_dir;
    }
    settings.concurrency = settings.concurrency.clamp(1, 5);
    settings.default_kind = pick(&settings.default_kind, &["video", "audio"], "video");
    settings.default_quality = pick(
        &settings.default_quality,
        &["best", "2160", "1440", "1080", "720", "480", "360"],
        "1080",
    );
    settings.default_container = pick(&settings.default_container, &["mp4", "mkv", "webm"], "mp4");
    settings.default_audio_format =
        pick(&settings.default_audio_format, &["mp3", "m4a", "wav", "flac"], "mp3");
    settings.default_audio_quality = pick(&settings.default_audio_quality, &["320", "192", "128"], "320");
    settings.default_compression =
        pick(&settings.default_compression, &["none", "balanced", "high", "social"], "none");
    settings.subtitles = pick(&settings.subtitles, &["off", "auto", "manual"], "off");
    settings.theme = pick(&settings.theme, &["system", "dark", "light"], "system");
    settings.last_view = pick(&settings.last_view, &["downloader", "history", "settings"], "downloader");
}

fn pick(value: &str, allowed: &[&str], fallback: &str) -> String {
    if allowed.contains(&value) {
        value.to_string()
    } else {
        fallback.to_string()
    }
}
