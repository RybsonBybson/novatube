//! `info` and `search`: pure metadata commands that never download media.

use serde::Serialize;

use super::args::{CliError, InfoArgs, OutputMode, SearchArgs};
use super::output::Emitter;
use super::paths;
use crate::metadata;
use crate::models::MediaEntry;
use crate::util;

/* ---------------------------------- info ---------------------------------- */

#[derive(Debug, Serialize)]
struct EntryOutput {
    index: usize,
    id: String,
    title: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    uploader: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail: Option<String>,
}

impl EntryOutput {
    fn from_entry(entry: &MediaEntry) -> Self {
        Self {
            index: entry.index + 1,
            id: entry.id.clone(),
            title: entry.title.clone(),
            url: entry.url.clone(),
            duration: entry.duration,
            duration_string: entry.duration.map(util::format_duration),
            uploader: entry.channel.clone(),
            thumbnail: entry.thumbnail.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
struct InfoOutput {
    id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    uploader: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    view_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upload_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail: Option<String>,
    webpage_url: String,
    is_playlist: bool,
    is_live: bool,
    entry_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    extractor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    qualities: Vec<u32>,
    entries: Vec<EntryOutput>,
    entries_truncated: bool,
}

pub async fn run_info(args: InfoArgs) -> Result<i32, CliError> {
    if args.text && args.json {
        return Err(CliError::usage("--text and --json cannot be combined."));
    }
    let engines = paths::resolve_engines().map_err(CliError::runtime)?;
    let ytdlp = engines.yt_dlp.to_string_lossy().to_string();
    let info = metadata::fetch_metadata_with_binary(&ytdlp, &args.url)
        .await
        .map_err(CliError::runtime)?;

    let limit = if args.all_entries {
        usize::MAX
    } else {
        args.entries_limit.max(1)
    };
    let selected: Vec<&MediaEntry> = info.entries.iter().take(limit).collect();
    let entries: Vec<EntryOutput> = selected
        .iter()
        .map(|entry| EntryOutput::from_entry(entry))
        .collect();
    let entry_count = info.playlist_count.max(info.entries.len());
    let duration_string = info.duration.map(util::format_duration);
    let upload_date = info.upload_date.clone().map(format_upload_date);

    if args.text && !args.json {
        println!("{}", info.title);
        let mut meta = Vec::new();
        if let Some(uploader) = &info.channel {
            meta.push(uploader.clone());
        }
        if let Some(duration) = &duration_string {
            meta.push(duration.clone());
        }
        if let Some(views) = info.view_count {
            meta.push(format!("{views} views"));
        }
        if let Some(date) = &upload_date {
            meta.push(date.clone());
        }
        if !meta.is_empty() {
            println!("{}", meta.join(" · "));
        }
        println!("{}", info.url);
        if info.is_playlist {
            println!("Playlist · {entry_count} entries");
            for entry in &entries {
                let duration = entry.duration_string.clone().unwrap_or_else(|| "—".into());
                println!("  {:>3}. {} ({duration})", entry.index, entry.title);
            }
        }
        return Ok(0);
    }

    let entries_truncated = info.entries.len() > entries.len();
    let output = InfoOutput {
        id: info.id,
        title: info.title,
        uploader: info.channel.clone(),
        channel: info.channel,
        duration: info.duration,
        duration_string,
        view_count: info.view_count,
        upload_date,
        thumbnail: info.thumbnail,
        webpage_url: info.url,
        is_playlist: info.is_playlist,
        is_live: info.is_live,
        entry_count,
        extractor: info.extractor,
        description: info.description,
        qualities: info.heights,
        entries,
        entries_truncated,
    };
    Emitter::new(OutputMode::Json).json(&output);
    Ok(0)
}

fn format_upload_date(raw: String) -> String {
    if raw.len() == 8 && raw.chars().all(|character| character.is_ascii_digit()) {
        format!("{}-{}-{}", &raw[0..4], &raw[4..6], &raw[6..8])
    } else {
        raw
    }
}

/* --------------------------------- search --------------------------------- */

#[derive(Debug, Serialize)]
struct SearchOutput {
    query: String,
    count: usize,
    entries: Vec<EntryOutput>,
}

pub async fn run_search(args: SearchArgs) -> Result<i32, CliError> {
    let mode = args.mode()?;
    let query = args.query_text();
    if query.trim().is_empty() {
        return Err(CliError::usage("The search query cannot be empty."));
    }
    let limit = args.limit.clamp(1, 50);

    let engines = paths::resolve_engines().map_err(CliError::runtime)?;
    let ytdlp = engines.yt_dlp.to_string_lossy().to_string();
    let found = metadata::search_entries(&ytdlp, &query, limit)
        .await
        .map_err(CliError::runtime)?;
    let entries: Vec<EntryOutput> = found.iter().map(EntryOutput::from_entry).collect();

    match mode {
        OutputMode::Stream => {
            let emitter = Emitter::new(OutputMode::Stream);
            for entry in &entries {
                emitter.raw_json_line(&serde_json::json!({
                    "type": "entry",
                    "index": entry.index,
                    "id": entry.id.clone(),
                    "title": entry.title.clone(),
                    "url": entry.url.clone(),
                    "duration": entry.duration,
                    "duration_string": entry.duration_string.clone(),
                    "uploader": entry.uploader.clone(),
                    "thumbnail": entry.thumbnail.clone(),
                }));
            }
            emitter.raw_json_line(&serde_json::json!({
                "type": "done",
                "count": entries.len(),
            }));
        }
        _ => {
            Emitter::new(OutputMode::Json).json(&SearchOutput {
                query,
                count: entries.len(),
                entries,
            });
        }
    }
    Ok(0)
}
