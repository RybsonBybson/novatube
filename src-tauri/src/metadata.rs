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
    let parsed = url::Url::parse(url).map_err(|_| "That doesn't look like a valid URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) links are supported.".into());
    }

    let binary = binaries.ensure_ytdlp().await?;
    let args = [
        "--ignore-config",
        "--no-warnings",
        "--no-color",
        "--encoding",
        "utf-8",
        "--dump-single-json",
        "--flat-playlist",
        "--socket-timeout",
        "20",
        url,
    ];

    let mut command = tokio::process::Command::new(binary);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    crate::util::hide_console(&mut command);

    let output = tokio::time::timeout(Duration::from_secs(180), command.output())
        .await
    .map_err(|_| "Metadata request timed out. Check your connection and try again.".to_string())?
    .map_err(|error| format!("Could not start yt-dlp: {error}"))?;

    if !output.status.success() {
        return Err(crate::util::friendly_error(&String::from_utf8_lossy(&output.stderr)));
    }

    let info: RawInfo = serde_json::from_slice(&output.stdout)
        .map_err(|_| "yt-dlp returned no readable metadata.".to_string())?;

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
        info.entries
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter(|entry| entry.id.is_some() || entry.url.is_some())
            .enumerate()
            .filter_map(|(index, entry)| {
                let id = entry.id.clone().unwrap_or_else(|| (index + 1).to_string());
                let entry_url = entry_url(&entry, is_youtube);
                if entry_url.is_empty() {
                    return None;
                }
                Some(MediaEntry {
                    id,
                    url: entry_url,
                    title: entry
                        .title
                        .clone()
                        .or_else(|| entry.fulltitle.clone())
                        .unwrap_or_else(|| format!("Video {}", index + 1)),
                    channel: entry.channel.clone().or_else(|| entry.uploader.clone()),
                    duration: entry.duration.filter(|value| value.is_finite()),
                    thumbnail: thumbnail_of(&entry, is_youtube),
                    index,
                })
            })
            .collect()
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
