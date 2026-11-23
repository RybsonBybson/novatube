//! Locating the shared engines and persisted settings without a Tauri handle.
//!
//! The GUI resolves `yt-dlp`/`ffmpeg` through `Binaries`, which needs an
//! `AppHandle`. Headless mode has no app, so the same locations are checked
//! directly: environment overrides, the portable folder next to the executable,
//! Tauri's resource folder, the per-user data folder and `PATH`.

use std::path::{Path, PathBuf};

use crate::models::AppSettings;

/// Tauri stores per-app data under `<data dir>/<bundle identifier>`.
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("com.novatube.app"))
}

/// Settings as the GUI left them. Falls back to the built-in defaults, so a
/// first-run CLI call still works before the window has ever been opened.
pub fn load_settings() -> AppSettings {
    let Some(dir) = app_data_dir() else {
        return AppSettings::default();
    };
    let Ok(bytes) = std::fs::read(dir.join("settings.json")) else {
        return AppSettings::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub struct Engines {
    pub yt_dlp: PathBuf,
    pub ffmpeg: Option<PathBuf>,
}

fn binary_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn exe_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.parent().map(Path::to_path_buf)
}

fn push_unique(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.contains(&path) {
        candidates.push(path);
    }
}

fn candidates(base: &str, env_keys: &[&str]) -> Vec<PathBuf> {
    let name = binary_name(base);
    let mut found = Vec::new();

    for key in env_keys {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                push_unique(&mut found, PathBuf::from(value));
            }
        }
    }

    if let Some(dir) = exe_dir() {
        // Portable layouts: binary is copied next to a `bin/` or `resources/`
        // folder, or the resources sit one level above (NSIS/MSI installs).
        push_unique(&mut found, dir.join(&name));
        push_unique(&mut found, dir.join("bin").join(&name));
        push_unique(&mut found, dir.join("resources").join(&name));
        push_unique(&mut found, dir.join("resources").join("bin").join(&name));
        if let Some(parent) = dir.parent() {
            push_unique(&mut found, parent.join(&name));
            push_unique(&mut found, parent.join("bin").join(&name));
            push_unique(&mut found, parent.join("resources").join("bin").join(&name));
        }
    }

    if let Some(data) = app_data_dir() {
        push_unique(&mut found, data.join("bin").join(&name));
    }

    // `cargo run` / `tauri dev`: resources live in the crate source tree.
    push_unique(
        &mut found,
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("bin")
            .join(&name),
    );

    if let Some(path) = crate::binaries::find_on_path(&name) {
        push_unique(&mut found, path);
    }

    found
}

fn first_existing(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|candidate| candidate.is_file())
}

pub fn resolve_engines() -> Result<Engines, String> {
    let yt_dlp = first_existing(candidates("yt-dlp", &["NOVATUBE_YTDLP", "YTDLP_PATH"]))
        .ok_or_else(|| {
            "The media engine (yt-dlp) was not found. Launch NovaTube once so it can install \
             it, or point NOVATUBE_YTDLP / YTDLP_PATH at an existing yt-dlp executable."
                .to_string()
        })?;

    let ffmpeg = first_existing(candidates("ffmpeg", &["NOVATUBE_FFMPEG", "FFMPEG_PATH"]));

    Ok(Engines { yt_dlp, ffmpeg })
}

/// `canonicalize` on Windows returns an extended-length path (`\\?\C:\...`).
/// That form leaks into JSON output and confuses consumers, so it is stripped.
pub fn normalize_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        let rest = rest
            .strip_prefix("UNC\\")
            .map(|unc| format!(r"\\{unc}"))
            .unwrap_or_else(|| rest.to_string());
        PathBuf::from(rest)
    } else {
        path
    }
}

/// ffmpeg is optional for pure single-file downloads but required to merge
/// separate video/audio streams, embed thumbnails and compress.
pub fn require_ffmpeg(engines: &Engines) -> Result<&Path, String> {
    engines.ffmpeg.as_deref().ok_or_else(|| {
        "ffmpeg was not found. Reinstall NovaTube to restore the bundled converter, or set \
         NOVATUBE_FFMPEG / FFMPEG_PATH."
            .to_string()
    })
}
