//! Provisioning for the two external engines.
//!
//! - ffmpeg ships inside the Tauri resources and is found at startup.
//! - yt-dlp is downloaded into the per-user data folder on first launch and
//!   can be refreshed in place from Settings.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use crate::models::{BinaryInfo, BinariesStatus};
use crate::store::AppStore;

const YTDLP_RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

pub struct Binaries {
    app: AppHandle,
    store: Arc<AppStore>,
    dir: PathBuf,
    inner: Mutex<BinariesStatus>,
    init_guard: tokio::sync::Mutex<()>,
    download_guard: tokio::sync::Mutex<()>,
    initialized: AtomicBool,
}

impl Binaries {
    pub fn new(app: AppHandle, store: Arc<AppStore>) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("bin");

        Self {
            app,
            store,
            dir,
            inner: Mutex::new(BinariesStatus::default()),
            init_guard: tokio::sync::Mutex::new(()),
            download_guard: tokio::sync::Mutex::new(()),
            initialized: AtomicBool::new(false),
        }
    }

    pub fn status(&self) -> BinariesStatus {
        self.inner
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    fn emit(&self) {
        let _ = self.app.emit("binaries:status", self.status());
    }

    fn mutate(&self, change: impl FnOnce(&mut BinariesStatus)) {
        if let Ok(mut guard) = self.inner.lock() {
            change(&mut guard);
        }
        self.emit();
    }

    pub async fn init(self: &Arc<Self>) -> Result<(), String> {
        let _guard = self.init_guard.lock().await;
        if self.initialized.load(Ordering::SeqCst) {
            return Ok(());
        }

        let _ = tokio::fs::create_dir_all(&self.dir).await;

        // Startup must stay silent and cheap: locate the bundled ffmpeg by path
        // only. Running `ffmpeg -version` here would spawn a second process (and
        // on Windows can flash a console) before the window is even visible.
        let ffmpeg = self.locate_ffmpeg();
        self.mutate(|status| {
            status.ffmpeg = BinaryInfo {
                name: "ffmpeg".into(),
                path: ffmpeg
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_default(),
                version: if ffmpeg.is_some() { "bundled".into() } else { String::new() },
                state: if ffmpeg.is_some() { "ready" } else { "error" }.into(),
                progress: if ffmpeg.is_some() { 100 } else { 0 },
                message: if ffmpeg.is_some() {
                    None
                } else {
                    Some("FFmpeg was not found in the app resources.".into())
                },
            };
        });

        // Same for yt-dlp: presence is enough at startup, no `--version` probe.
        if let Some(path) = self.locate_ytdlp() {
            self.mutate(|status| {
                status.yt_dlp = BinaryInfo {
                    name: "yt-dlp".into(),
                    path: path.to_string_lossy().to_string(),
                    version: String::new(),
                    state: "ready".into(),
                    progress: 100,
                    message: None,
                };
            });
            self.initialized.store(true, Ordering::SeqCst);
            return Ok(());
        }

        match self.download_ytdlp(false).await {
            Ok(()) => {
                self.initialized.store(true, Ordering::SeqCst);
                Ok(())
            }
            Err(error) => {
                self.mutate(|status| {
                    status.yt_dlp.state = "error".into();
                    status.yt_dlp.progress = 0;
                    status.yt_dlp.message = Some(error.clone());
                });
                Err(error)
            }
        }
    }

    pub async fn maybe_auto_update(self: &Arc<Self>) {
        if !self.store.settings().auto_update_yt_dlp {
            return;
        }
        let _ = self.update_ytdlp().await;
    }

    pub async fn refresh(self: &Arc<Self>) -> BinariesStatus {
        self.mutate(|status| {
            status.yt_dlp.state = "checking".into();
            status.yt_dlp.message = Some("Checking yt-dlp…".into());
            status.ffmpeg.state = "checking".into();
            status.ffmpeg.message = Some("Checking ffmpeg…".into());
        });

        let ffmpeg = self.resolve_ffmpeg().await;
        let ytdlp = self.resolve_ytdlp().await;

        self.mutate(|status| {
            status.ffmpeg = BinaryInfo {
                name: "ffmpeg".into(),
                path: ffmpeg.as_ref().map(|info| info.0.clone()).unwrap_or_default(),
                version: ffmpeg.as_ref().map(|info| info.1.clone()).unwrap_or_default(),
                state: if ffmpeg.is_some() { "ready" } else { "error" }.into(),
                progress: if ffmpeg.is_some() { 100 } else { 0 },
                message: if ffmpeg.is_some() {
                    None
                } else {
                    Some("FFmpeg was not found in the app resources.".into())
                },
            };

            status.yt_dlp = match ytdlp {
                Some((path, version)) => BinaryInfo {
                    name: "yt-dlp".into(),
                    path,
                    version,
                    state: "ready".into(),
                    progress: 100,
                    message: None,
                },
                None => BinaryInfo {
                    name: "yt-dlp".into(),
                    path: String::new(),
                    version: String::new(),
                    state: "missing".into(),
                    progress: 0,
                    message: Some("yt-dlp is not installed.".into()),
                },
            };
        });

        self.initialized.store(true, Ordering::SeqCst);
        self.status()
    }

    pub async fn update_ytdlp(self: &Arc<Self>) -> Result<BinariesStatus, String> {
        self.download_ytdlp(true).await?;
        Ok(self.status())
    }

    pub async fn ensure_ytdlp(self: &Arc<Self>) -> Result<String, String> {
        let current = self.status().yt_dlp;
        if current.state == "ready" && !current.path.is_empty() && Path::new(&current.path).exists() {
            return Ok(current.path);
        }

        self.init().await?;
        let current = self.status().yt_dlp;
        if !current.path.is_empty() && Path::new(&current.path).exists() {
            Ok(current.path)
        } else {
            Err(current
                .message
                .unwrap_or_else(|| "yt-dlp is not available. Update it in Settings and retry.".into()))
        }
    }

    pub async fn ensure_ffmpeg(self: &Arc<Self>) -> Result<String, String> {
        let current = self.status().ffmpeg;
        if !current.path.is_empty() && Path::new(&current.path).exists() {
            return Ok(current.path);
        }

        if let Some((path, version)) = self.resolve_ffmpeg().await {
            self.mutate(|status| {
                status.ffmpeg = BinaryInfo {
                    name: "ffmpeg".into(),
                    path: path.clone(),
                    version,
                    state: "ready".into(),
                    progress: 100,
                    message: None,
                };
            });
            return Ok(path);
        }
        Err("FFmpeg is not available.".into())
    }

    fn bin_dir(&self) -> &Path {
        &self.dir
    }

    fn resource_candidates(&self, name: &str) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        if let Ok(dir) = self.app.path().resource_dir() {
            candidates.push(dir.join("bin").join(name));
        }
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("bin")
                .join(name),
        );
        candidates
    }

    fn ytdlp_candidates(&self) -> Vec<PathBuf> {
        let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
        let mut candidates = Vec::new();
        if let Ok(value) = std::env::var("YTDLP_PATH") {
            candidates.push(PathBuf::from(value));
        }
        candidates.push(self.bin_dir().join(name));
        candidates.extend(self.resource_candidates(name));
        if let Some(path) = find_on_path(if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" }) {
            candidates.push(path);
        }
        candidates
    }

    fn ffmpeg_candidates(&self) -> Vec<PathBuf> {
        let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
        let mut candidates = Vec::new();
        if let Ok(value) = std::env::var("FFMPEG_PATH") {
            candidates.push(PathBuf::from(value));
        }
        candidates.push(self.bin_dir().join(name));
        candidates.extend(self.resource_candidates(name));
        if let Some(path) = find_on_path(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }) {
            candidates.push(path);
        }
        candidates
    }

    /// Path-only lookup — never executes the binary.
    fn locate_ytdlp(&self) -> Option<PathBuf> {
        self.ytdlp_candidates()
            .into_iter()
            .find(|candidate| candidate.is_file())
    }

    /// Path-only lookup — never executes the binary.
    fn locate_ffmpeg(&self) -> Option<PathBuf> {
        self.ffmpeg_candidates()
            .into_iter()
            .find(|candidate| candidate.is_file())
    }

    async fn resolve_ytdlp(&self) -> Option<(String, String)> {
        for candidate in self.ytdlp_candidates() {
            if !candidate.is_file() {
                continue;
            }
            if let Some(version) = version_of(&candidate, "--version").await {
                return Some((candidate.to_string_lossy().to_string(), version));
            }
        }
        None
    }

    async fn resolve_ffmpeg(&self) -> Option<(String, String)> {
        for candidate in self.ffmpeg_candidates() {
            if !candidate.is_file() {
                continue;
            }
            if let Some(version) = version_of(&candidate, "-version").await {
                let clean = version
                    .trim_start_matches("ffmpeg version ")
                    .split_whitespace()
                    .next()
                    .unwrap_or(&version)
                    .to_string();
                return Some((candidate.to_string_lossy().to_string(), clean));
            }
        }
        None
    }

    async fn download_ytdlp(self: &Arc<Self>, is_update: bool) -> Result<(), String> {
        let _guard = self.download_guard.lock().await;
        let target = self.bin_dir().join(if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" });
        let temp = self.bin_dir().join(if cfg!(windows) {
            "yt-dlp.exe.download"
        } else {
            "yt-dlp.download"
        });

        let _ = tokio::fs::create_dir_all(self.bin_dir()).await;

        self.mutate(|status| {
            status.yt_dlp.state = if is_update { "updating" } else { "downloading" }.into();
            status.yt_dlp.progress = 0;
            status.yt_dlp.message = Some(if is_update {
                "Updating yt-dlp…".into()
            } else {
                "Downloading yt-dlp (first launch)…".into()
            });
        });

        let url = format!("{YTDLP_RELEASE}/{}", ytdlp_asset_name());
        let response = reqwest::Client::new()
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Could not download yt-dlp: {error}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "yt-dlp download failed (HTTP {}). Check your internet connection.",
                response.status()
            ));
        }

        let total = response.content_length().unwrap_or(0);
        let mut received: u64 = 0;
        let mut file = tokio::fs::File::create(&temp)
            .await
            .map_err(|error| format!("Could not create the yt-dlp file: {error}"))?;

        let mut response = response;
        let mut last_emit = Instant::now();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("yt-dlp download interrupted: {error}"))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("Could not write yt-dlp: {error}"))?;
            received += chunk.len() as u64;
            if last_emit.elapsed() >= Duration::from_millis(160) {
                last_emit = Instant::now();
                let progress = if total > 0 {
                    ((received as f64 / total as f64) * 99.0).min(99.0) as u8
                } else {
                    0
                };
                self.mutate(|status| status.yt_dlp.progress = progress);
            }
        }

        file.flush()
            .await
            .map_err(|error| format!("Could not finish writing yt-dlp: {error}"))?;
        drop(file);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o755));
        }

        let _ = std::fs::remove_file(&target);
        tokio::fs::rename(&temp, &target)
            .await
            .map_err(|error| format!("Could not install yt-dlp: {error}"))?;

        let version = version_of(&target, "--version")
            .await
            .ok_or_else(|| "The downloaded yt-dlp binary could not be executed.".to_string())?;

        self.mutate(|status| {
            status.yt_dlp = BinaryInfo {
                name: "yt-dlp".into(),
                path: target.to_string_lossy().to_string(),
                version,
                state: "ready".into(),
                progress: 100,
                message: None,
            };
        });

        Ok(())
    }
}

fn ytdlp_asset_name() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp"
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

async fn version_of(binary: &Path, flag: &str) -> Option<String> {
    let mut command = tokio::process::Command::new(binary);
    command.arg(flag).stdin(std::process::Stdio::null());
    crate::util::hide_console(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(15), command.output())
        .await
        .ok()?
        .ok()?;

    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}
