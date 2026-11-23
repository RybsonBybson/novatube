//! Metadata extraction through `yt-dlp --dump-single-json`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;

use crate::binaries::Binaries;
use crate::models::{MediaEntry, MediaInfo, VideoFormatOption};

#[derive(Debug, Clone, Deserialize, Default)]
struct RawThumbnail {
    url: Option<String>,
    preference: Option<f64>,
}

#[derive(Debug, Deserialize, Default)]
struct RawFormat {
    height: Option<u32>,
    fps: Option<f64>,
    ext: Option<String>,
    vcodec: Option<String>,
    filesize: Option<f64>,
    filesize_approx: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawEntry {
    id: Option<String>,
    url: Option<String>,
    webpage_url: Option<String>,
    title: Option<String>,
    fulltitle: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    thumbnails: Option<Vec<RawThumbnail>>,
}

#[derive(Debug, Deserialize, Default)]
struct RawInfo {
    #[serde(flatten)]
    entry: RawEntry,
    #[serde(rename = "_type")]
    kind: Option<String>,
    extractor: Option<String>,
    extractor_key: Option<String>,
    entries: Option<Vec<RawEntry>>,
    playlist_count: Option<usize>,
    n_entries: Option<usize>,
    formats: Option<Vec<RawFormat>>,
    is_live: Option<bool>,
    live_status: Option<String>,
    channel_url: Option<String>,
    uploader_url: Option<String>,
    description: Option<String>,
    view_count: Option<i64>,
    upload_date: Option<String>,
}

pub async fn fetch_metadata(url: &str, binaries: &Arc<Binaries>) -> Result<MediaInfo, String> {
    let binary = binaries.ensure_ytdlp().await?;
    fetch_metadata_with_binary(&binary, url).await
}

/// Shared headless extraction: identical to the GUI path, but the already
/// resolved engine path is passed in so the CLI can run without a Tauri app.
pub(crate) async fn fetch_metadata_with_binary(binary: &str, url: &str) -> Result<MediaInfo, String> {
    validate_url(url)?;
    let info = run_json(
        binary,
        &["--flat-playlist".to_string(), url.to_string()],
        Duration::from_secs(180),
    )
    .await?;

    let is_playlist = info.kind.as_deref() == Some("playlist")
        || (info
            .entries
            .as_ref()
            .map(|entries| !entries.is_empty())
            .unwrap_or(false)
            && info.kind.as_deref() != Some("video"));

    let extractor = info
        .extractor
        .clone()
        .or_else(|| info.extractor_key.clone())
        .unwrap_or_default();
    let source_url = info
        .entry
        .webpage_url
        .clone()
        .or_else(|| info.entry.url.clone())
        .unwrap_or_else(|| url.to_string());
    let is_youtube = extractor.to_ascii_lowercase().contains("youtube")
        || source_url.to_ascii_lowercase().contains("youtube.com")
        || source_url.to_ascii_lowercase().contains("youtu.be");

    let (formats, heights) = build_formats(info.formats.as_deref());

    let entries: Vec<MediaEntry> = if is_playlist {
        collect_entries(info.entries.clone().unwrap_or_default(), is_youtube, None)
    } else {
        Vec::new()
    };

    let playlist_count = entries
        .len()
        .max(info.playlist_count.unwrap_or(0))
        .max(info.n_entries.unwrap_or(0));

    Ok(MediaInfo {
        id: info.entry.id.clone().unwrap_or_else(|| "unknown".into()),
        url: source_url,
        title: info
            .entry
            .title
            .clone()
            .or_else(|| info.entry.fulltitle.clone())
            .unwrap_or_else(|| "Untitled media".into()),
        channel: info
            .entry
            .channel
            .clone()
            .or_else(|| info.entry.uploader.clone()),
        channel_url: info.channel_url.clone().or_else(|| info.uploader_url.clone()),
        duration: info.entry.duration.filter(|value| value.is_finite()),
        thumbnail: thumbnail_of(&info.entry, is_youtube),
        description: info.description.map(|text| text.chars().take(800).collect()),
        is_live: info.is_live.unwrap_or(false)
            || matches!(info.live_status.as_deref(), Some("is_live") | Some("is_upcoming")),
        is_playlist,
        playlist_count,
        entries,
        formats,
        heights,
        extractor: if extractor.is_empty() {
            None
        } else {
            Some(extractor)
        },
        view_count: info.view_count,
        upload_date: info.upload_date,
    })
}

pub(crate) fn validate_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "That doesn't look like a valid URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) links are supported.".into());
    }
    Ok(())
}

async fn run_json(binary: &str, extra: &[String], timeout: Duration) -> Result<RawInfo, String> {
    let mut args: Vec<String> = vec![
        "--ignore-config".into(),
        "--no-warnings".into(),
        "--no-color".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--dump-single-json".into(),
        "--socket-timeout".into(),
        "20".into(),
    ];
    args.extend(extra.iter().cloned());

    let mut command = tokio::process::Command::new(binary);
    command
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    crate::util::hide_console(&mut command);

    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| "Metadata request timed out. Check your connection and try again.".to_string())?
        .map_err(|error| format!("Could not start the media engine: {error}"))?;

    if !output.status.success() {
        return Err(crate::util::friendly_error(&String::from_utf8_lossy(&output.stderr)));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|_| "The link returned no readable details.".to_string())
}

fn media_entry(entry: &RawEntry, is_youtube: bool, position: usize) -> Option<MediaEntry> {
    let id = entry.id.clone();
    let url = entry_url(entry, is_youtube);
    if id.is_none() && url.is_empty() {
        return None;
    }
    let title = entry
        .title
        .clone()
        .or_else(|| entry.fulltitle.clone())
        .unwrap_or_else(|| format!("Video {}", position + 1));
    Some(MediaEntry {
        id: id.unwrap_or_else(|| (position + 1).to_string()),
        url,
        title,
        channel: entry.channel.clone().or_else(|| entry.uploader.clone()),
        duration: entry.duration.filter(|value| value.is_finite()),
        thumbnail: thumbnail_of(entry, is_youtube),
        index: position,
    })
}

/// Turns flat playlist/search entries into usable items.
///
/// Unusable rows (no id and no URL, or a missing/`NA` title) are dropped, and
/// the surviving items are renumbered from zero so the UI and the CLI always
/// see a contiguous list. `limit` stops early, which keeps searches cheap.
fn collect_entries(raw: Vec<RawEntry>, is_youtube: bool, limit: Option<usize>) -> Vec<MediaEntry> {
    let mut entries: Vec<MediaEntry> = Vec::new();
    for (position, entry) in raw.into_iter().enumerate() {
        if limit.is_some_and(|limit| entries.len() >= limit) {
            break;
        }
        let Some(mut item) = media_entry(&entry, is_youtube, position) else {
            continue;
        };
        if item.title.trim().is_empty() || item.title == "NA" {
            continue;
        }
        item.index = entries.len();
        entries.push(item);
    }
    entries
}

/// YouTube search through yt-dlp's flat extractor: no media is touched and the
/// result is a plain list that the CLI can print or hand to Python.
pub(crate) async fn search_entries(
    binary: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<MediaEntry>, String> {
    let limit = limit.clamp(1, 50);
    let target = format!("ytsearch{limit}:{query}");
    let info = run_json(
        binary,
        &["--flat-playlist".to_string(), target],
        Duration::from_secs(120),
    )
    .await?;

    let extractor = info
        .extractor
        .clone()
        .or_else(|| info.extractor_key.clone())
        .unwrap_or_default();
    let is_youtube = extractor.to_ascii_lowercase().contains("youtube");

    Ok(collect_entries(
        info.entries.unwrap_or_default(),
        is_youtube,
        Some(limit),
    ))
}

fn thumbnail_of(entry: &RawEntry, is_youtube: bool) -> Option<String> {
    if let Some(thumbnail) = entry.thumbnail.clone().filter(|value| !value.is_empty()) {
        return Some(thumbnail);
    }
    if let Some(thumbnails) = &entry.thumbnails {
        let best = thumbnails
            .iter()
            .filter_map(|thumb| thumb.url.clone().map(|url| (thumb.preference.unwrap_or(0.0), url)))
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        if let Some((_, url)) = best {
            return Some(url);
        }
    }
    if is_youtube {
        if let Some(id) = &entry.id {
            if id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
                return Some(format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"));
            }
        }
    }
    None
}

fn entry_url(entry: &RawEntry, is_youtube: bool) -> String {
    if let Some(url) = entry.webpage_url.clone().filter(|value| value.starts_with("http")) {
        return url;
    }
    if let Some(url) = entry.url.clone().filter(|value| value.starts_with("http")) {
        return url;
    }
    if is_youtube {
        if let Some(id) = &entry.id {
            return format!("https://www.youtube.com/watch?v={id}");
        }
    }
    entry.url.clone().unwrap_or_default()
}

fn build_formats(formats: Option<&[RawFormat]>) -> (Vec<VideoFormatOption>, Vec<u32>) {
    let mut by_key: HashMap<String, VideoFormatOption> = HashMap::new();

    for format in formats.unwrap_or(&[]) {
        if format.vcodec.as_deref() == Some("none") {
            continue;
        }
        let Some(height) = format.height.filter(|value| *value > 0) else {
            continue;
        };
        let fps = format.fps.filter(|value| value.is_finite());
        let key = format!(
            "{height}:{}:{}",
            fps.unwrap_or(0.0).round() as u32,
            format.ext.clone().unwrap_or_default()
        );
        let filesize = format.filesize.or(format.filesize_approx).map(|value| value as u64);
        let option = VideoFormatOption {
            height,
            fps,
            ext: format.ext.clone(),
            vcodec: format.vcodec.clone(),
            filesize,
        };
        let replace = by_key
            .get(&key)
            .map(|current| option.filesize.unwrap_or(0) > current.filesize.unwrap_or(0))
            .unwrap_or(true);
        if replace {
            by_key.insert(key, option);
        }
    }

    let mut all: Vec<VideoFormatOption> = by_key.into_values().collect();
    all.sort_by(|a, b| {
        b.height
            .cmp(&a.height)
            .then_with(|| b.fps.unwrap_or(0.0).partial_cmp(&a.fps.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut heights: Vec<u32> = all.iter().map(|format| format.height).collect();
    heights.sort_unstable_by(|a, b| b.cmp(a));
    heights.dedup();

    (all, heights)
}
