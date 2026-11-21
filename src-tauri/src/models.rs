//! Data exchanged between the Rust backend and the React renderer.
//! Field names use camelCase so they line up with `shared/types.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub kind: String,
    pub container: String,
    pub audio_format: String,
    pub audio_quality: String,
    pub quality: String,
    pub compression: String,
    pub embed_thumbnail: bool,
    pub subtitles: String,
    pub sponsor_block: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    pub index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFormatOption {
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vcodec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filesize: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub id: String,
    pub url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub is_live: bool,
    pub is_playlist: bool,
    pub playlist_count: usize,
    pub entries: Vec<MediaEntry>,
    pub formats: Vec<VideoFormatOption>,
    pub heights: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extractor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    pub status: String,
    pub progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_bytes: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded_bytes: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<f64>,
    pub options: DownloadOptions,
    pub format_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_detail: Option<String>,
    /// Set when the media file already exists and only the compression pass
    /// has to run again after a restart ("compress").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume_stage: Option<String>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDownloadInput {
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    pub options: DownloadOptions,
    #[serde(default)]
    pub playlist_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    pub options: DownloadOptions,
    pub format_label: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    pub completed_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub download_dir: String,
    pub concurrency: u32,
    pub default_quality: String,
    pub default_container: String,
    pub default_audio_format: String,
    pub default_audio_quality: String,
    pub default_compression: String,
    pub default_kind: String,
    pub sponsor_block: bool,
    pub embed_thumbnail: bool,
    pub subtitles: String,
    pub auto_update_yt_dlp: bool,
    pub auto_update: bool,
    pub theme: String,
    pub remember_view: bool,
    pub last_view: String,
    /// UI language code (BCP-47-ish, e.g. "en", "pl", "zh"). Persisted so the
    /// chosen language survives restarts.
    pub language: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        // First run always starts in the user's real Downloads folder.
        let download_dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| std::path::PathBuf::from("."));

        Self {
            download_dir: download_dir.to_string_lossy().to_string(),
            concurrency: 3,
            default_quality: "1080".into(),
            default_container: "mp4".into(),
            default_audio_format: "mp3".into(),
            default_audio_quality: "320".into(),
            default_compression: "none".into(),
            default_kind: "video".into(),
            sponsor_block: false,
            embed_thumbnail: true,
            subtitles: "off".into(),
            auto_update_yt_dlp: false,
            auto_update: true,
            theme: "system".into(),
            remember_view: true,
            last_view: "downloader".into(),
            language: "en".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryInfo {
    pub name: String,
    pub path: String,
    pub version: String,
    pub state: String,
    pub progress: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl BinaryInfo {
    pub fn checking(name: &str) -> Self {
        Self {
            name: name.into(),
            path: String::new(),
            version: String::new(),
            state: "checking".into(),
            progress: 0,
            message: Some("Getting things ready…".into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinariesStatus {
    pub yt_dlp: BinaryInfo,
    pub ffmpeg: BinaryInfo,
}

impl Default for BinariesStatus {
    fn default() -> Self {
        Self {
            yt_dlp: BinaryInfo::checking("yt-dlp"),
            ffmpeg: BinaryInfo::checking("ffmpeg"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub tauri: String,
    pub download_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToastEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
