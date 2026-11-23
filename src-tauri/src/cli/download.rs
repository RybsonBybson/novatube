//! Headless download pipeline.
//!
//! The CLI resolves every URL into concrete items up front (expanding
//! playlists), assigns names, then downloads with a bounded number of parallel
//! yt-dlp processes. Heavy FFmpeg work — compression and the AV1 fallback — is
//! serialized behind one permit, exactly like the GUI queue, so a batch cannot
//! stack encoders on every core.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Semaphore;

use super::args::{CliError, DownloadArgs, OutputMode};
use super::output::{DownloadReport, Emitter, Event, ResultItem};
use super::paths::{self, Engines};
use crate::metadata;
use crate::models::{AppSettings, DownloadOptions};
use crate::queue;
use crate::sys;
use crate::util;

const PROGRESS_PRINT: &str = "__NOVA_PROGRESS__";
const FILE_PRINT: &str = "__NOVA_FILE__";
const VCODEC_PRINT: &str = "__NOVA_VCODEC__";
const TITLE_PRINT: &str = "__NOVA_TITLE__";

const DEFAULT_TEMPLATE: &str = "{title} [{id}]";
const MAX_CONCURRENCY: usize = 16;
const EVENT_INTERVAL: Duration = Duration::from_millis(220);

pub async fn run(args: DownloadArgs) -> Result<i32, CliError> {
    let mode = OutputMode::resolve(args.json, args.stream)?;
    let settings = paths::load_settings();
    let engines = paths::resolve_engines().map_err(CliError::runtime)?;
    sys::init_child_job();

    let emitter = Emitter::new(mode);
    let plan = build_plan(&args, &settings, &engines, &emitter).await?;

    if args.dry_run {
        print_plan(&plan, &emitter)?;
        return Ok(0);
    }

    // Audio extraction, subtitles, thumbnails and our own compression all need
    // ffmpeg, so those runs fail early with a clear message when it is absent.
    // Plain video is driven entirely by yt-dlp: the engine is handed over when
    // it exists and yt-dlp falls back to PATH otherwise.
    let needs_ffmpeg = plan.options.kind == "audio"
        || plan.options.compression != "none"
        || plan.options.subtitles != "off"
        || plan.options.embed_thumbnail;
    let ffmpeg = if needs_ffmpeg {
        Some(
            paths::require_ffmpeg(&engines)
                .map_err(CliError::runtime)?
                .to_path_buf(),
        )
    } else {
        engines.ffmpeg.clone()
    };

    if let Some(free) = sys::free_space(&plan.output_dir) {
        if free < sys::MIN_FREE_BYTES {
            return Err(CliError::runtime(format!(
                "Only {} is free in {}. Free up space and try again.",
                util::format_bytes(Some(free)).unwrap_or_else(|| "very little".into()),
                plan.output_dir.display()
            )));
        }
    }

    let summary = format!(
        "NovaTube CLI · {} item(s) · {} · {}",
        plan.items.len(),
        describe_format(&plan.options),
        plan.output_dir.display()
    );
    emitter.note(summary);

    let total = plan.items.len();
    let shared = Arc::new(Shared {
        output_dir: plan.output_dir.clone(),
        yt_dlp: engines.yt_dlp.clone(),
        options: plan.options.clone(),
        resume: plan.resume,
        ffmpeg,
        encode_gate: Arc::new(Semaphore::new(1)),
        emitter: Arc::new(emitter),
        total,
    });

    let mut results: Vec<ResultItem> = Vec::with_capacity(total);
    let mut queue = std::collections::VecDeque::from(plan.items);
    let mut set = tokio::task::JoinSet::new();
    let concurrency = plan.concurrency.max(1);

    loop {
        while set.len() < concurrency {
            let Some(item) = queue.pop_front() else {
                break;
            };
            let shared = Arc::clone(&shared);
            set.spawn(async move { process_item(item, shared).await });
        }
        if set.is_empty() {
            break;
        }
        match set.join_next().await {
            Some(Ok(result)) => results.push(result),
            Some(Err(error)) => results.push(ResultItem {
                id: "unknown".into(),
                index: 0,
                title: "Item".into(),
                status: "failed".into(),
                output_path: None,
                error: Some(format!("A download task stopped unexpectedly: {error}")),
                file_size: None,
            }),
            None => break,
        }
    }

    results.sort_by_key(|result| result.index);
    let failed = results.iter().filter(|result| !result.ok()).count();
    let skipped = results
        .iter()
        .filter(|result| result.status == "skipped")
        .count();
    let succeeded = results
        .iter()
        .filter(|result| result.status == "completed")
        .count();

    shared.emitter.finish_downloads(&DownloadReport {
        ok: failed == 0,
        total,
        succeeded,
        failed,
        skipped,
        output_dir: shared.output_dir.to_string_lossy().to_string(),
        results,
    });

    Ok(if failed > 0 { 1 } else { 0 })
}

/* -------------------------------- planning -------------------------------- */

#[derive(Debug, Clone)]
struct PlannedItem {
    index: usize,
    url: String,
    id: String,
    title: String,
    uploader: Option<String>,
    duration: Option<f64>,
    stem: String,
    extension: String,
    folder: Option<String>,
}

impl PlannedItem {
    fn directory(&self, output_dir: &Path) -> PathBuf {
        match &self.folder {
            Some(folder) => output_dir.join(folder),
            None => output_dir.to_path_buf(),
        }
    }

    fn target(&self, output_dir: &Path) -> PathBuf {
        self.directory(output_dir)
            .join(format!("{}.{}", self.stem, self.extension))
    }
}

#[derive(Debug, Clone)]
struct Plan {
    output_dir: PathBuf,
    options: DownloadOptions,
    concurrency: usize,
    resume: bool,
    items: Vec<PlannedItem>,
}

#[derive(Debug, Clone)]
struct RawItem {
    url: String,
    id: String,
    title: String,
    uploader: Option<String>,
    duration: Option<f64>,
    playlist_title: Option<String>,
    playlist_index: Option<usize>,
}

async fn build_plan(
    args: &DownloadArgs,
    settings: &AppSettings,
    engines: &Engines,
    emitter: &Emitter,
) -> Result<Plan, CliError> {
    let options = resolve_options(args, settings)?;
    let output_dir = args
        .output_dir
        .clone()
        .unwrap_or_else(|| PathBuf::from(settings.download_dir.clone()));
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        CliError::runtime(format!(
            "Cannot create the output folder {}: {error}",
            output_dir.display()
        ))
    })?;
    let output_dir = std::fs::canonicalize(&output_dir).unwrap_or(output_dir);
    let output_dir = paths::normalize_path(output_dir);

    let urls = collect_urls(args)?;
    emitter.note(format!("Reading {} URL(s)…", urls.len()));

    let mut raw_items: Vec<RawItem> = Vec::new();
    let ytdlp = engines.yt_dlp.to_string_lossy().to_string();
    for url in urls {
        metadata::validate_url(&url).map_err(CliError::usage)?;
        let info = metadata::fetch_metadata_with_binary(&ytdlp, &url)
            .await
            .map_err(CliError::runtime)?;

        if info.is_playlist && !info.entries.is_empty() {
            let playlist_title = util::sanitize_folder(&info.title);
            for entry in info.entries {
                if entry.url.trim().is_empty() {
                    continue;
                }
                raw_items.push(RawItem {
                    url: entry.url,
                    id: entry.id,
                    title: entry.title,
                    uploader: entry.channel,
                    duration: entry.duration,
                    playlist_title: Some(playlist_title.clone()),
                    playlist_index: Some(entry.index + 1),
                });
            }
        } else {
            raw_items.push(RawItem {
                url: info.url,
                id: info.id,
                title: info.title,
                uploader: info.channel,
                duration: info.duration,
                playlist_title: None,
                playlist_index: None,
            });
        }
    }

    if raw_items.is_empty() {
        return Err(CliError::runtime("No downloadable items were found."));
    }

    if args.name.is_some() && raw_items.len() > 1 {
        return Err(CliError::usage(format!(
            "--name is for a single item, but this command resolved to {} items. Use --names or \
             --name-template instead.",
            raw_items.len()
        )));
    }
    if args.name.is_some() && (!args.names.is_empty() || args.name_template.is_some()) {
        return Err(CliError::usage(
            "--name cannot be combined with --names or --name-template.",
        ));
    }

    let names = parse_names(&args.names)?;
    let template = args
        .name_template
        .clone()
        .unwrap_or_else(|| DEFAULT_TEMPLATE.to_string());
    let mut used: HashSet<String> = HashSet::new();
    let mut items = Vec::with_capacity(raw_items.len());

    for (position, raw) in raw_items.into_iter().enumerate() {
        let index = position + 1;
        let raw_name = if let Some(name) = &args.name {
            name.clone()
        } else if let Some(name) = names.get(position) {
            name.clone()
        } else {
            render_template(&template, &raw, index, &options)
        };

        let without_extension = util::strip_media_extension(raw_name.trim()).to_string();
        let mut stem = util::sanitize_filename(&without_extension);
        if stem.trim().is_empty() {
            stem = format!("item-{index}");
        }
        // Two items must never fight over one file: a playlist can contain two
        // videos with the same title, and --names can legitimately repeat.
        let base = stem.clone();
        let mut suffix = 2;
        while !used.insert(stem.to_ascii_lowercase()) {
            stem = format!("{base} ({suffix})");
            suffix += 1;
        }

        let extension = if options.kind == "audio" {
            options.audio_format.clone()
        } else {
            options.container.clone()
        };

        items.push(PlannedItem {
            index,
            url: raw.url,
            id: raw.id,
            title: raw.title,
            uploader: raw.uploader,
            duration: raw.duration,
            folder: raw.playlist_title,
            stem,
            extension,
        });
    }

    let concurrency = match args.concurrency {
        Some(0) => return Err(CliError::usage("--concurrency must be at least 1.")),
        Some(value) => value.min(MAX_CONCURRENCY),
        None => (settings.concurrency as usize).clamp(1, MAX_CONCURRENCY),
    };

    Ok(Plan {
        output_dir,
        options,
        concurrency,
        resume: args.resume,
        items,
    })
}

fn collect_urls(args: &DownloadArgs) -> Result<Vec<String>, CliError> {
    let mut urls = Vec::new();
    for url in args.urls.iter().chain(args.extra_urls.iter()) {
        let url = url.trim();
        if !url.is_empty() {
            urls.push(url.to_string());
        }
    }

    if let Some(path) = &args.urls_file {
        let text = std::fs::read_to_string(path).map_err(|error| {
            CliError::runtime(format!("Cannot read {}: {error}", path.display()))
        })?;
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            urls.push(line.to_string());
        }
    }

    if urls.is_empty() {
        return Err(CliError::usage(
            "No URLs given. Pass URLs as arguments, with --url, or with --file.",
        ));
    }
    Ok(urls)
}

fn resolve_options(
    args: &DownloadArgs,
    settings: &AppSettings,
) -> Result<DownloadOptions, CliError> {
    let default_format = if settings.default_kind == "audio" {
        settings.default_audio_format.clone()
    } else {
        settings.default_container.clone()
    };
    let format = args
        .format
        .as_deref()
        .unwrap_or(&default_format)
        .trim()
        .to_ascii_lowercase();

    let (mut kind, container, audio_format) = match format.as_str() {
        "mp4" | "mkv" | "webm" => (
            "video",
            format.clone(),
            settings.default_audio_format.clone(),
        ),
        "mp3" | "m4a" | "wav" | "flac" => (
            ("audio"),
            settings.default_container.clone(),
            format.clone(),
        ),
        other => {
            return Err(CliError::usage(format!(
                "Unknown --format \"{other}\". Use mp4, mkv, webm, mp3, m4a, wav or flac."
            )))
        }
    };

    let quality = match args.quality.as_deref() {
        Some(raw) => normalize_quality(raw)?,
        None if kind == "audio" => "best".into(),
        None => normalize_quality(&settings.default_quality)?,
    };
    if quality == "bestaudio" {
        kind = "audio";
    }
    if kind == "audio"
        && !matches!(format.as_str(), "mp3" | "m4a" | "wav" | "flac")
        && args.format.is_some()
    {
        return Err(CliError::usage(
            "--quality bestaudio needs an audio --format (mp3, m4a, wav or flac).",
        ));
    }

    let compression = args
        .compress
        .as_deref()
        .unwrap_or(&settings.default_compression)
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        compression.as_str(),
        "none" | "balanced" | "high" | "social"
    ) {
        return Err(CliError::usage(format!(
            "Unknown --compress \"{compression}\". Use none, balanced, high or social."
        )));
    }
    // The presets encode H.264/H.265, which WebM cannot contain. An explicit
    // request is rejected; a preset inherited from settings is dropped so a
    // WebM download still succeeds.
    let compression = if kind == "video" && container == "webm" && compression != "none" {
        if args.compress.is_some() {
            return Err(CliError::usage(
                "Compression presets target MP4/MKV. Use --format mp4 (or mkv), or pass \
                 --compress none for WebM.",
            ));
        }
        "none".to_string()
    } else {
        compression
    };

    let subtitles = match args.subtitles {
        Some(value) => value.as_setting().to_string(),
        None => match settings.subtitles.as_str() {
            "auto" | "manual" | "off" => settings.subtitles.clone(),
            _ => "off".into(),
        },
    };

    Ok(DownloadOptions {
        kind: kind.to_string(),
        container: if kind == "audio" {
            settings.default_container.clone()
        } else {
            container
        },
        audio_format,
        audio_quality: settings.default_audio_quality.clone(),
        quality: if kind == "audio" {
            "best".into()
        } else {
            quality
        },
        compression: if kind == "audio" {
            "none".into()
        } else {
            compression
        },
        embed_thumbnail: settings.embed_thumbnail,
        subtitles,
        sponsor_block: args.sponsorblock || settings.sponsor_block,
    })
}

fn normalize_quality(raw: &str) -> Result<String, CliError> {
    let value = raw.trim().to_ascii_lowercase();
    let value = value.strip_suffix('p').unwrap_or(&value).to_string();
    if matches!(value.as_str(), "best" | "bestaudio") {
        return Ok(value);
    }
    if value.chars().all(|character| character.is_ascii_digit()) {
        if let Ok(height) = value.parse::<u32>() {
            if (144..=4320).contains(&height) {
                return Ok(height.to_string());
            }
        }
    }
    Err(CliError::usage(format!(
        "Unknown --quality \"{raw}\". Use best, 2160p, 1440p, 1080p, 720p, 480p, 360p or bestaudio."
    )))
}

fn parse_names(raw: &[String]) -> Result<Vec<String>, CliError> {
    let mut names = Vec::new();
    for entry in raw {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('[') {
            let parsed: Vec<String> = serde_json::from_str(trimmed).map_err(|_| {
                CliError::usage("--names started with '[' but is not a valid JSON string array.")
            })?;
            names.extend(parsed.into_iter().filter(|name| !name.trim().is_empty()));
            continue;
        }
        names.extend(
            trimmed
                .split([',', ';', '\n', '\r'])
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string),
        );
    }
    Ok(names)
}

fn render_template(
    template: &str,
    item: &RawItem,
    index: usize,
    options: &DownloadOptions,
) -> String {
    let extension = if options.kind == "audio" {
        options.audio_format.clone()
    } else {
        options.container.clone()
    };
    let mut text = template.to_string();
    text = replace_index_placeholder(&text, index);
    let playlist_index = item
        .playlist_index
        .map(|value| value.to_string())
        .unwrap_or_else(|| index.to_string());
    for (placeholder, value) in [
        ("{index}", index.to_string()),
        ("{title}", item.title.clone()),
        ("{uploader}", item.uploader.clone().unwrap_or_default()),
        ("{channel}", item.uploader.clone().unwrap_or_default()),
        ("{id}", item.id.clone()),
        ("{ext}", extension),
        ("{playlist_index}", playlist_index),
    ] {
        text = text.replace(placeholder, &value);
    }
    if text.trim().is_empty() {
        format!("item-{index}")
    } else {
        text
    }
}

/// Supports `{index}` plus zero-padded widths such as `{index:02}` or
/// `{index:003}` so playlists keep a readable sort order.
fn replace_index_placeholder(template: &str, index: usize) -> String {
    let mut text = template.to_string();
    let mut search_from = 0;
    while let Some(offset) = text[search_from..].find("{index") {
        let start = search_from + offset;
        let rest = &text[start + "{index".len()..];
        let (width, consumed) = if let Some(spec) = rest.strip_prefix(':') {
            let digits: String = spec
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect();
            let after = &spec[digits.len()..];
            if digits.is_empty() || !after.starts_with('}') {
                search_from = start + "{index".len();
                continue;
            }
            (
                digits.parse::<usize>().ok(),
                "{index:".len() + digits.len() + 1,
            )
        } else if rest.starts_with('}') {
            (None, "{index".len() + 1)
        } else {
            search_from = start + "{index".len();
            continue;
        };
        let replacement = match width {
            Some(width) if width > 0 => format!("{index:0width$}"),
            _ => index.to_string(),
        };
        text.replace_range(start..start + consumed, &replacement);
        search_from = start + replacement.len();
    }
    text
}

fn describe_format(options: &DownloadOptions) -> String {
    if options.kind == "audio" {
        return format!(
            "{} {}kbps",
            options.audio_format.to_uppercase(),
            options.audio_quality
        );
    }
    let quality = if options.quality == "best" {
        "best".to_string()
    } else {
        format!("{}p", options.quality)
    };
    let compression = if options.compression == "none" {
        String::new()
    } else {
        format!(" · {} compression", options.compression)
    };
    format!(
        "{quality} {}{compression}",
        options.container.to_uppercase()
    )
}

/* -------------------------------- dry run --------------------------------- */

#[derive(Debug, Serialize)]
struct PlanOutput {
    ok: bool,
    dry_run: bool,
    total: usize,
    output_dir: String,
    concurrency: usize,
    resume: bool,
    format: PlanFormat,
    items: Vec<PlanItemOutput>,
}

#[derive(Debug, Serialize)]
struct PlanFormat {
    kind: String,
    container: String,
    audio_format: String,
    quality: String,
    compression: String,
    subtitles: String,
    sponsor_block: bool,
}

#[derive(Debug, Serialize)]
struct PlanItemOutput {
    index: usize,
    id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    uploader: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<f64>,
    url: String,
    output_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    playlist_title: Option<String>,
}

fn print_plan(plan: &Plan, emitter: &Emitter) -> Result<(), CliError> {
    let items: Vec<PlanItemOutput> = plan
        .items
        .iter()
        .map(|item| PlanItemOutput {
            index: item.index,
            id: item.id.clone(),
            title: item.title.clone(),
            uploader: item.uploader.clone(),
            duration: item.duration,
            url: item.url.clone(),
            output_path: item.target(&plan.output_dir).to_string_lossy().to_string(),
            playlist_title: item.folder.clone(),
        })
        .collect();

    if emitter.mode() == OutputMode::Stream {
        for item in &plan.items {
            emitter.event(&Event::Start {
                total: plan.items.len(),
                index: item.index,
                id: item.id.clone(),
                title: item.title.clone(),
            });
        }
        let results: Vec<ResultItem> = plan
            .items
            .iter()
            .map(|item| ResultItem {
                id: item.id.clone(),
                index: item.index,
                title: item.title.clone(),
                status: "planned".into(),
                output_path: Some(item.target(&plan.output_dir).to_string_lossy().to_string()),
                error: None,
                file_size: None,
            })
            .collect();
        emitter.event(&Event::Done { results });
        return Ok(());
    }

    emitter.json(&PlanOutput {
        ok: true,
        dry_run: true,
        total: plan.items.len(),
        output_dir: plan.output_dir.to_string_lossy().to_string(),
        concurrency: plan.concurrency,
        resume: plan.resume,
        format: PlanFormat {
            kind: plan.options.kind.clone(),
            container: plan.options.container.clone(),
            audio_format: plan.options.audio_format.clone(),
            quality: plan.options.quality.clone(),
            compression: plan.options.compression.clone(),
            subtitles: plan.options.subtitles.clone(),
            sponsor_block: plan.options.sponsor_block,
        },
        items,
    });
    Ok(())
}

/* -------------------------------- execution -------------------------------- */

struct Shared {
    output_dir: PathBuf,
    yt_dlp: PathBuf,
    options: DownloadOptions,
    resume: bool,
    ffmpeg: Option<PathBuf>,
    encode_gate: Arc<Semaphore>,
    emitter: Arc<Emitter>,
    total: usize,
}

struct DoneInfo {
    path: PathBuf,
}

async fn process_item(item: PlannedItem, shared: Arc<Shared>) -> ResultItem {
    let directory = item.directory(&shared.output_dir);

    shared.emitter.event(&Event::Start {
        total: shared.total,
        index: item.index,
        id: item.id.clone(),
        title: item.title.clone(),
    });

    if shared.resume {
        if let Some(existing) = find_existing(&directory, &item.stem) {
            let size = util::file_size(&existing);
            shared.emitter.note(format!(
                "  [{}/{}] {} — already downloaded, skipped",
                item.index, shared.total, item.title
            ));
            shared.emitter.event(&Event::ItemDone {
                id: item.id.clone(),
                index: item.index,
                output_path: existing.to_string_lossy().to_string(),
                title: item.title.clone(),
                file_size: size,
                skipped: true,
            });
            return ResultItem {
                id: item.id,
                index: item.index,
                title: item.title,
                status: "skipped".into(),
                output_path: Some(existing.to_string_lossy().to_string()),
                error: None,
                file_size: size,
            };
        }
    }

    shared.emitter.note(format!(
        "  [{}/{}] {}",
        item.index, shared.total, item.title
    ));

    match download_one(&item, &shared).await {
        Ok(done) => {
            let size = util::file_size(&done.path);
            shared.emitter.note(format!(
                "  [{}/{}] done → {}",
                item.index,
                shared.total,
                done.path.display()
            ));
            shared.emitter.event(&Event::ItemDone {
                id: item.id.clone(),
                index: item.index,
                output_path: done.path.to_string_lossy().to_string(),
                title: item.title.clone(),
                file_size: size,
                skipped: false,
            });
            ResultItem {
                id: item.id,
                index: item.index,
                title: item.title,
                status: "completed".into(),
                output_path: Some(done.path.to_string_lossy().to_string()),
                error: None,
                file_size: size,
            }
        }
        Err(message) => {
            shared.emitter.error(format!("[{}] {message}", item.title));
            shared.emitter.event(&Event::Error {
                id: item.id.clone(),
                index: item.index,
                message: message.clone(),
            });
            ResultItem {
                id: item.id,
                index: item.index,
                title: item.title,
                status: "failed".into(),
                output_path: None,
                error: Some(message),
                file_size: None,
            }
        }
    }
}

async fn download_one(item: &PlannedItem, shared: &Shared) -> Result<DoneInfo, String> {
    let directory = item.directory(&shared.output_dir);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create {}: {error}", directory.display()))?;

    let args = yt_dlp_args(item, &directory, &shared.options, shared.ffmpeg.as_deref());
    let mut command = tokio::process::Command::new(&shared.yt_dlp);
    command
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    util::hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the media engine: {error}"))?;
    if let Some(pid) = child.id() {
        sys::assign_child_to_job(pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The media engine returned no output.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "The media engine returned no status stream.".to_string())?;

    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            text.push_str(&line);
            text.push('\n');
            if text.len() > 60_000 {
                text = text[text.len() - 40_000..].to_string();
            }
        }
        text
    });

    let mut final_path: Option<String> = None;
    let mut vcodec: Option<String> = None;
    let mut stage = "downloading";
    let mut percent = 0.0_f64;
    let mut speed: Option<String> = None;
    let mut eta: Option<String> = None;
    let mut last_event = Instant::now() - EVENT_INTERVAL;
    let mut last_bucket = u32::MAX;
    let mut last_stage = "";

    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.contains("[Merger] Merging") || line.contains("[ExtractAudio] Destination") {
            stage = "merging";
        }

        if let Some(index) = line.find(PROGRESS_PRINT) {
            let (next_percent, next_speed, next_eta) =
                parse_progress(&line[index + PROGRESS_PRINT.len()..]);
            if let Some(value) = next_percent {
                percent = value;
            }
            if next_speed.is_some() {
                speed = next_speed;
            }
            if next_eta.is_some() {
                eta = next_eta;
            }

            let bucket = (percent / 10.0).floor() as u32;
            let stage_changed = stage != last_stage;
            let now = Instant::now();
            if stage_changed
                || bucket > last_bucket
                || now.duration_since(last_event) >= EVENT_INTERVAL
            {
                emit_progress(
                    &shared.emitter,
                    item,
                    stage,
                    percent,
                    speed.as_deref(),
                    eta.as_deref(),
                );
                if stage_changed || bucket > last_bucket {
                    shared.emitter.note(progress_line(
                        stage,
                        percent,
                        speed.as_deref(),
                        eta.as_deref(),
                    ));
                }
                last_event = now;
                last_bucket = bucket;
                last_stage = stage;
            }
        }

        if let Some(index) = line.find(FILE_PRINT) {
            let value = line[index + FILE_PRINT.len()..].trim();
            if !value.is_empty() {
                final_path = Some(value.to_string());
            }
        }
        if let Some(index) = line.find(VCODEC_PRINT) {
            let value = line[index + VCODEC_PRINT.len()..].trim();
            if !value.is_empty() && value != "NA" {
                vcodec = Some(value.to_string());
            }
        }
    }

    let stderr = stderr_task.await.unwrap_or_default();
    let status = child
        .wait()
        .await
        .map_err(|error| format!("The media engine could not be waited on: {error}"))?;
    if !status.success() {
        return Err(util::friendly_error(&stderr));
    }

    let path = final_path
        .map(PathBuf::from)
        .filter(|candidate| candidate.is_file())
        .or_else(|| find_existing(&directory, &item.stem))
        .ok_or_else(|| {
            "The media engine finished, but no media file was found in the destination folder."
                .to_string()
        })?;

    emit_progress(&shared.emitter, item, "downloading", 100.0, None, None);

    if shared.options.kind == "video" {
        if shared.options.compression != "none" {
            let ffmpeg = shared.ffmpeg.as_deref().ok_or_else(|| {
                "ffmpeg is required for compression but was not found.".to_string()
            })?;
            let (video, audio) = queue::preset_args(&shared.options.compression);
            let video: Vec<String> = video.into_iter().map(str::to_string).collect();
            let audio: Vec<String> = audio.into_iter().map(str::to_string).collect();
            encode(
                item,
                shared,
                &path,
                item.duration,
                &video,
                &audio,
                "compressing",
                ffmpeg,
            )
            .await?;
        } else if vcodec.as_deref().map(queue::is_av1_codec).unwrap_or(false) {
            let ffmpeg = shared.ffmpeg.as_deref().ok_or_else(|| {
                "ffmpeg is required to convert AV1 but was not found.".to_string()
            })?;
            let video = vec![
                "-c:v:0".to_string(),
                "libx264".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "20".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ];
            let audio = vec!["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()];
            encode(
                item,
                shared,
                &path,
                item.duration,
                &video,
                &audio,
                "compressing",
                ffmpeg,
            )
            .await?;
        }
    }

    if !path.is_file() {
        return Err("The output file disappeared before it could be reported.".into());
    }
    Ok(DoneInfo { path })
}

fn yt_dlp_args(
    item: &PlannedItem,
    directory: &Path,
    options: &DownloadOptions,
    ffmpeg: Option<&Path>,
) -> Vec<String> {
    let output = directory
        .join(format!("{}.%(ext)s", item.stem))
        .to_string_lossy()
        .to_string();
    let ffmpeg_text = ffmpeg.map(|path| path.to_string_lossy().to_string());

    let mut args: Vec<String> = [
        "--ignore-config",
        "--no-warnings",
        "--no-color",
        "--encoding",
        "utf-8",
        "--no-playlist",
        "--continue",
        "--no-overwrites",
        "--windows-filenames",
        "--trim-filenames",
        "180",
        "--concurrent-fragments",
        "4",
        "--retries",
        "10",
        "--fragment-retries",
        "10",
        "--socket-timeout",
        "20",
        "--newline",
        "--progress",
        "--progress-template",
    ]
    .iter()
    .map(|value| value.to_string())
    .collect();

    args.push(format!(
        "download:{PROGRESS_PRINT}%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress._speed_str)s|%(progress._eta_str)s"
    ));
    args.extend([
        "--print".to_string(),
        format!("before_dl:{TITLE_PRINT}%(title)s"),
        "--print".to_string(),
        format!("after_move:{FILE_PRINT}%(filepath)s"),
        "--print".to_string(),
        format!("after_move:{VCODEC_PRINT}%(vcodec)s"),
        "--no-simulate".to_string(),
        "--output".to_string(),
        output,
    ]);
    args.extend(queue::build_format_args(options));
    args.extend(queue::build_extra_args(options, ffmpeg_text.as_deref()));
    args.push(item.url.clone());
    args
}

fn parse_progress(text: &str) -> (Option<f64>, Option<String>, Option<String>) {
    let parts: Vec<&str> = text.split('|').collect();
    let get = |position: usize| parts.get(position).map(|value| value.trim()).unwrap_or("");

    let percent = get(0)
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()
        .map(|value| value.clamp(0.0, 100.0));

    let speed_text = get(6);
    let speed = if speed_text.is_empty() || speed_text == "NA" || speed_text == "N/A" {
        None
    } else {
        Some(speed_text.to_string())
    };

    let eta_text = get(7);
    let eta = if eta_text.is_empty() || eta_text == "NA" || eta_text == "N/A" {
        get(5).parse::<f64>().ok().and_then(util::eta_from_seconds)
    } else {
        Some(eta_text.to_string())
    };

    (percent, speed, eta)
}

fn emit_progress(
    emitter: &Emitter,
    item: &PlannedItem,
    stage: &str,
    percent: f64,
    speed: Option<&str>,
    eta: Option<&str>,
) {
    emitter.event(&Event::Progress {
        id: item.id.clone(),
        index: item.index,
        percent: (percent.clamp(0.0, 100.0) * 10.0).round() / 10.0,
        speed: speed.map(str::to_string),
        eta: eta.map(str::to_string),
        stage: stage.to_string(),
    });
}

fn progress_line(stage: &str, percent: f64, speed: Option<&str>, eta: Option<&str>) -> String {
    if stage == "downloading" {
        format!(
            "    {:>5.1}% · {} · ETA {}",
            percent,
            speed.unwrap_or("—"),
            eta.unwrap_or("—")
        )
    } else {
        format!("    {stage} {:>5.1}%", percent)
    }
}

/// One FFmpeg pass, serialized with every other encode in this run. The file on
/// disk is only replaced after ffmpeg reported success, so a failure leaves the
/// original download untouched.
#[allow(clippy::too_many_arguments)]
async fn encode(
    item: &PlannedItem,
    shared: &Shared,
    input: &Path,
    duration: Option<f64>,
    video_args: &[String],
    audio_args: &[String],
    stage: &str,
    ffmpeg: &Path,
) -> Result<(), String> {
    if shared.encode_gate.available_permits() == 0 {
        emit_progress(&shared.emitter, item, stage, 0.0, None, None);
        shared
            .emitter
            .note(format!("    {stage}: waiting for the converter…"));
    }
    let _permit = shared
        .encode_gate
        .acquire()
        .await
        .map_err(|_| "The converter gate was closed.".to_string())?;

    if !input.is_file() {
        return Err("The downloaded file disappeared before conversion started.".into());
    }

    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "video".into());
    let extension = input
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_else(|| "mp4".into());
    let temp = input.with_file_name(format!("{stem}.nova-encode.tmp.{extension}"));
    let backup = input.with_file_name(format!("{stem}.nova-original.tmp.{extension}"));
    let _ = std::fs::remove_file(&temp);

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        input.to_string_lossy().to_string(),
        "-map".into(),
        "0".into(),
    ];
    args.extend(video_args.iter().cloned());
    args.extend(["-c:v:1".into(), "copy".into()]);
    args.extend(audio_args.iter().cloned());
    args.extend([
        "-c:s".into(),
        "copy".into(),
        "-c:t".into(),
        "copy".into(),
        "-map_metadata".into(),
        "0".into(),
        "-threads".into(),
        sys::encode_threads().to_string(),
    ]);
    if matches!(extension.as_str(), "mp4" | "m4v" | "mov") {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        temp.to_string_lossy().to_string(),
    ]);

    emit_progress(&shared.emitter, item, stage, 0.0, None, None);

    let mut command = tokio::process::Command::new(ffmpeg);
    command
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    util::hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the converter: {error}"))?;
    if let Some(pid) = child.id() {
        sys::assign_child_to_job(pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The converter returned no progress stream.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "The converter returned no status stream.".to_string())?;

    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            text.push_str(&line);
            text.push('\n');
            if text.len() > 40_000 {
                text = text[text.len() - 20_000..].to_string();
            }
        }
        text
    });

    let mut last_emit = Instant::now() - Duration::from_secs(2);
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let value = line
            .strip_prefix("out_time_us=")
            .or_else(|| line.strip_prefix("out_time_ms="));
        let (Some(value), Some(duration)) = (value, duration) else {
            continue;
        };
        if duration <= 0.0 {
            continue;
        }
        if last_emit.elapsed() < Duration::from_secs(1) {
            continue;
        }
        let Ok(microseconds) = value.trim().parse::<f64>() else {
            continue;
        };
        let percent = (microseconds / 1_000_000.0 / duration * 100.0).clamp(0.0, 99.0);
        emit_progress(&shared.emitter, item, stage, percent, None, None);
        shared
            .emitter
            .note(progress_line(stage, percent, None, None));
        last_emit = Instant::now();
    }

    let stderr = stderr_task.await.unwrap_or_default();
    let status = child
        .wait()
        .await
        .map_err(|error| format!("The converter could not be waited on: {error}"))?;

    if !status.success() {
        let _ = std::fs::remove_file(&temp);
        return Err(util::friendly_error(&stderr));
    }

    let _ = std::fs::remove_file(&backup);
    std::fs::rename(input, &backup).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("Could not replace the original file: {error}")
    })?;
    if let Err(error) = std::fs::rename(&temp, input) {
        // Put the untouched original back before reporting the failure.
        let _ = std::fs::rename(&backup, input);
        return Err(format!("Could not install the converted file: {error}"));
    }
    let _ = std::fs::remove_file(&backup);

    emit_progress(&shared.emitter, item, stage, 100.0, None, None);
    shared.emitter.note(format!("    {stage} complete"));
    Ok(())
}

fn find_existing(directory: &Path, stem: &str) -> Option<PathBuf> {
    for extension in util::MEDIA_EXTENSIONS {
        let candidate = directory.join(format!("{stem}.{extension}"));
        if candidate.is_file() && util::file_size(&candidate).unwrap_or(0) > 0 {
            return Some(candidate);
        }
    }
    let entries = std::fs::read_dir(directory).ok()?;
    entries.flatten().map(|entry| entry.path()).find(|path| {
        path.is_file()
            && path
                .file_stem()
                .map(|value| value.to_string_lossy().eq_ignore_ascii_case(stem))
                .unwrap_or(false)
    })
}
