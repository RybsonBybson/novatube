//! Concurrent download queue built on yt-dlp child processes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use regex::Regex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::binaries::Binaries;
use crate::models::{AddDownloadInput, DownloadItem, DownloadOptions, HistoryEntry, ToastEvent};
use crate::store::AppStore;
use crate::util::{
    eta_from_seconds, file_size, format_bytes, friendly_error, kill_pid, now_ms, parse_bytes,
    parse_video_id, sanitize_folder, unique_id,
};

const ACTIVE_STATUSES: [&str; 4] = ["fetching", "downloading", "processing", "compressing"];
const FINISHED_STATUSES: [&str; 3] = ["completed", "cancelled", "error"];
const TITLE_PRINT: &str = "__NOVA_TITLE__";
const FILE_PRINT: &str = "__NOVA_FILE__";
const PROGRESS_PRINT: &str = "__NOVA_PROGRESS__";

struct RunState {
    pid: Option<u32>,
    cancelled: bool,
    paused: bool,
    final_path: Option<String>,
    destination: Option<String>,
}

impl RunState {
    fn new() -> Self {
        Self {
            pid: None,
            cancelled: false,
            paused: false,
            final_path: None,
            destination: None,
        }
    }
}

struct QueueInner {
    items: HashMap<String, DownloadItem>,
    order: Vec<String>,
    runs: HashMap<String, RunState>,
}

struct SpawnOutcome {
    code: Option<i32>,
    stderr: String,
    final_path: Option<String>,
}

pub struct DownloadQueue {
    app: AppHandle,
    store: Arc<AppStore>,
    binaries: Arc<Binaries>,
    inner: Mutex<QueueInner>,
    emit_times: Mutex<HashMap<String, Instant>>,
}

impl DownloadQueue {
    pub fn new(app: AppHandle, store: Arc<AppStore>, binaries: Arc<Binaries>) -> Self {
        Self {
            app,
            store,
            binaries,
            inner: Mutex::new(QueueInner {
                items: HashMap::new(),
                order: Vec::new(),
                runs: HashMap::new(),
            }),
            emit_times: Mutex::new(HashMap::new()),
        }
    }

    pub fn list(&self) -> Vec<DownloadItem> {
        let inner = self.lock();
        inner
            .order
            .iter()
            .filter_map(|id| inner.items.get(id).cloned())
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<DownloadItem> {
        self.lock().items.get(id).cloned()
    }

    pub fn add(self: &Arc<Self>, input: AddDownloadInput) -> Result<DownloadItem, String> {
        if !input.url.starts_with("http://") && !input.url.starts_with("https://") {
            return Err("Invalid media URL.".into());
        }

        let item = self.create_item(input);
        {
            let mut inner = self.lock();
            inner.items.insert(item.id.clone(), item.clone());
            inner.order.push(item.id.clone());
        }
        self.emit_update(item.clone(), true);
        self.emit_snapshot();
        self.schedule();
        Ok(item)
    }

    pub fn add_many(self: &Arc<Self>, inputs: Vec<AddDownloadInput>) -> Result<Vec<DownloadItem>, String> {
        if inputs.is_empty() {
            return Err("No videos selected.".into());
        }
        if inputs.len() > 500 {
            return Err("Please select fewer than 500 videos at once.".into());
        }

        let mut created = Vec::with_capacity(inputs.len());
        for input in inputs {
            if !input.url.starts_with("http://") && !input.url.starts_with("https://") {
                return Err("Invalid media URL.".into());
            }
            created.push(self.create_item(input));
        }

        {
            let mut inner = self.lock();
            for item in &created {
                inner.items.insert(item.id.clone(), item.clone());
                inner.order.push(item.id.clone());
            }
        }
        for item in &created {
            self.emit_update(item.clone(), true);
        }
        self.emit_snapshot();
        self.schedule();
        Ok(created)
    }

    fn create_item(&self, input: AddDownloadInput) -> DownloadItem {
        let title = input
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Preparing download…")
            .to_string();

        DownloadItem {
            id: unique_id("dl"),
            url: input.url,
            title,
            thumbnail: input.thumbnail,
            channel: input.channel,
            duration: input.duration,
            status: "queued".into(),
            progress: 0.0,
            speed: None,
            speed_bytes: None,
            eta: None,
            downloaded_bytes: None,
            total_bytes: None,
            format_label: format_label(&input.options),
            options: input.options,
            output_path: None,
            file_size: None,
            error: None,
            notice: None,
            playlist_title: input.playlist_title,
            stage_detail: None,
            created_at: now_ms(),
            completed_at: None,
        }
    }

    pub fn pause(&self, id: &str) {
        let mut should_kill = false;
        {
            let mut inner = self.lock();
            if let Some(run) = inner.runs.get_mut(id) {
                run.paused = true;
                should_kill = run.pid.is_some();
            }
        }
        if should_kill {
            if let Some(pid) = self.run_pid(id) {
                kill_pid(pid);
            }
        }
        self.update(id, true, |item| {
            item.status = "paused".into();
            item.speed = None;
            item.eta = None;
            item.stage_detail = Some("Paused — progress is kept".into());
        });
    }

    pub fn resume(self: &Arc<Self>, id: &str) {
        let paused = self
            .get(id)
            .map(|item| item.status == "paused" || item.status == "error")
            .unwrap_or(false);
        if !paused {
            return;
        }
        self.update(id, true, |item| {
            item.status = "queued".into();
            item.error = None;
            item.notice = None;
            item.stage_detail = None;
        });
        self.schedule();
    }

    pub fn cancel(&self, id: &str) {
        let pid = {
            let mut inner = self.lock();
            inner.runs.get_mut(id).and_then(|run| {
                run.cancelled = true;
                run.pid
            })
        };
        if let Some(pid) = pid {
            kill_pid(pid);
        }
        self.update(id, true, |item| {
            item.status = "cancelled".into();
            item.speed = None;
            item.speed_bytes = None;
            item.eta = None;
            item.stage_detail = Some("Cancelled".into());
        });
    }

    pub fn retry(self: &Arc<Self>, id: &str) {
        let running = self.lock().runs.contains_key(id);
        if running {
            return;
        }
        self.update(id, true, |item| {
            item.status = "queued".into();
            item.progress = 0.0;
            item.error = None;
            item.notice = None;
            item.speed = None;
            item.speed_bytes = None;
            item.eta = None;
            item.downloaded_bytes = None;
            item.total_bytes = None;
            item.output_path = None;
            item.file_size = None;
            item.completed_at = None;
            item.stage_detail = None;
        });
        self.schedule();
    }

    pub fn remove(&self, id: &str) {
        let pid = {
            let mut inner = self.lock();
            let pid = inner.runs.get_mut(id).and_then(|run| {
                run.cancelled = true;
                run.pid
            });
            inner.items.remove(id);
            inner.order.retain(|item_id| item_id != id);
            pid
        };
        if let Some(pid) = pid {
            kill_pid(pid);
        }
        let _ = self.app.emit("downloads:removed", id);
        self.emit_snapshot();
    }

    pub fn clear_finished(&self) {
        let removed: Vec<String> = {
            let mut inner = self.lock();
            let ids: Vec<String> = inner
                .order
                .iter()
                .filter(|id| {
                    inner
                        .items
                        .get(*id)
                        .map(|item| FINISHED_STATUSES.contains(&item.status.as_str()))
                        .unwrap_or(false)
                })
                .cloned()
                .collect();
            let QueueInner { items, order, .. } = &mut *inner;
            for id in &ids {
                items.remove(id);
            }
            order.retain(|id| items.contains_key(id));
            ids
        };
        for id in removed {
            let _ = self.app.emit("downloads:removed", id);
        }
        self.emit_snapshot();
    }

    pub fn apply_concurrency(self: &Arc<Self>) {
        self.schedule();
    }

    pub fn shutdown(&self) {
        let pids: Vec<u32> = {
            let mut inner = self.lock();
            let mut pids = Vec::new();
            for run in inner.runs.values_mut() {
                run.cancelled = true;
                if let Some(pid) = run.pid {
                    pids.push(pid);
                }
            }
            pids
        };
        for pid in pids {
            kill_pid(pid);
        }
    }

    fn schedule(self: &Arc<Self>) {
        let limit = self.store.settings().concurrency as usize;
        let mut started = Vec::new();

        {
            let mut inner = self.lock();
            if inner.runs.len() >= limit {
                return;
            }
            let slots = limit - inner.runs.len();
            let queued: Vec<String> = inner
                .order
                .iter()
                .filter(|id| {
                    !inner.runs.contains_key(*id)
                        && inner
                            .items
                            .get(*id)
                            .map(|item| item.status == "queued")
                            .unwrap_or(false)
                })
                .take(slots)
                .cloned()
                .collect();

            for id in queued {
                inner.runs.insert(id.clone(), RunState::new());
                started.push(id);
            }
        }

        for id in started {
            let queue = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                queue.run(id).await;
            });
        }
    }

    async fn run(self: Arc<Self>, id: String) {
        let Some(item) = self.get(&id) else {
            self.finish_run(&id);
            return;
        };

        self.update(&id, true, |item| {
            item.status = "fetching".into();
            item.progress = 0.0;
            item.stage_detail = Some("Preparing yt-dlp…".into());
            item.speed = None;
            item.eta = None;
        });

        let ytdlp = match self.binaries.ensure_ytdlp().await {
            Ok(path) => path,
            Err(error) => {
                self.fail(&id, &error);
                self.finish_run(&id);
                return;
            }
        };
        let ffmpeg = self.binaries.ensure_ffmpeg().await.ok();

        if self.is_stopped(&id) {
            self.finish_run(&id);
            return;
        }

        let settings = self.store.settings();
        let output_dir = resolve_output_dir(&settings.download_dir, &item);
        if tokio::fs::create_dir_all(&output_dir).await.is_err() {
            self.fail(&id, "Could not create the download folder.");
            self.finish_run(&id);
            return;
        }

        let args = build_args(&item, &output_dir, ffmpeg.as_deref());
        self.update(&id, true, |item| {
            item.status = "downloading".into();
            item.stage_detail = Some("Connecting to media server…".into());
        });

        let outcome = match self.spawn_download(&id, &ytdlp, &args).await {
            Ok(outcome) => outcome,
            Err(error) => {
                if !self.is_stopped(&id) {
                    self.fail(&id, &error);
                }
                self.finish_run(&id);
                return;
            }
        };

        if self.is_stopped(&id) {
            self.finish_run(&id);
            return;
        }
        if outcome.code != Some(0) {
            self.fail(&id, &friendly_error(&outcome.stderr));
            self.finish_run(&id);
            return;
        }

        let mut final_path = outcome
            .final_path
            .or_else(|| self.run_final_path(&id))
            .or_else(|| self.run_destination(&id));

        if final_path.is_none() {
            final_path = self.locate_output(&output_dir, &item);
        }
        let Some(mut final_path) = final_path else {
            self.fail(&id, "Download finished but the output file could not be located.");
            self.finish_run(&id);
            return;
        };

        let preset = item.options.compression.clone();
        if item.options.kind == "video" && preset != "none" {
            if ffmpeg.is_none() {
                self.update(&id, true, |item| {
                    item.notice =
                        Some("Compression skipped because FFmpeg is unavailable.".into());
                });
            } else if let Some(ffmpeg) = ffmpeg.as_deref() {
                self.update(&id, true, |item| {
                    item.status = "compressing".into();
                    item.progress = 0.0;
                    item.stage_detail = Some(compression_stage(&preset).into());
                    item.output_path = Some(final_path.clone());
                });

                match self
                    .compress(&id, Path::new(&final_path), item.duration, &preset, ffmpeg)
                    .await
                {
                    Ok(path) => final_path = path.to_string_lossy().to_string(),
                    Err(error) => {
                        if self.is_stopped(&id) {
                            self.finish_run(&id);
                            return;
                        }
                        self.update(&id, true, |item| {
                            item.notice = Some(format!("{error} The original file was kept."));
                        });
                    }
                }
            }
        }

        if self.is_stopped(&id) {
            self.finish_run(&id);
            return;
        }

        let size = file_size(Path::new(&final_path));
        let completed_at = now_ms();
        let completed = self.update(&id, true, |item| {
            item.status = "completed".into();
            item.progress = 100.0;
            item.speed = None;
            item.speed_bytes = None;
            item.eta = None;
            item.output_path = Some(final_path.clone());
            item.file_size = size;
            item.completed_at = Some(completed_at);
            item.stage_detail = None;
        });

        if let Some(completed) = completed {
            let entry = HistoryEntry {
                id: unique_id("hist"),
                url: completed.url.clone(),
                title: completed.title.clone(),
                thumbnail: completed.thumbnail.clone(),
                channel: completed.channel.clone(),
                duration: completed.duration,
                options: completed.options.clone(),
                format_label: completed.format_label.clone(),
                file_path: final_path.clone(),
                file_size: size,
                completed_at,
                playlist_title: completed.playlist_title.clone(),
            };
            let history = self.store.add_history(entry);
            let _ = self.app.emit("history:changed", history);
            let suffix = format_bytes(size)
                .map(|size| format!(" · {size}"))
                .unwrap_or_default();
            self.toast(
                "success",
                "Download complete",
                Some(format!("{}{suffix}", completed.title)),
            );
        }

        self.finish_run(&id);
    }

    fn finish_run(self: &Arc<Self>, id: &str) {
        self.lock().runs.remove(id);
        self.schedule();
    }

    fn spawn_download(
        self: &Arc<Self>,
        id: &str,
        binary: &str,
        args: &[String],
    ) -> impl std::future::Future<Output = Result<SpawnOutcome, String>> + Send {
        let id = id.to_string();
        let binary = binary.to_string();
        let args = args.to_vec();
        let queue = Arc::clone(self);
        async move {
            let mut command = tokio::process::Command::new(&binary);
            command
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            #[cfg(windows)]
            {
                command.creation_flags(0x0800_0000);
            }

            let mut child = command
                .spawn()
                .map_err(|error| format!("Could not start yt-dlp: {error}"))?;
            queue.set_pid(&id, child.id());

            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "yt-dlp produced no output stream.".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "yt-dlp produced no error stream.".to_string())?;

            let stderr_task = tauri::async_runtime::spawn(async move {
                let mut text = String::new();
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    text.push_str(&line);
                    text.push('\n');
                    if text.len() > 120_000 {
                        text = text[text.len() - 60_000..].to_string();
                    }
                }
                text
            });

            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                queue.handle_line(&id, &line);
                if queue.is_stopped(&id) {
                    break;
                }
            }

            let stderr = stderr_task.await.unwrap_or_default();
            let status = child.wait().await.ok();
            queue.clear_pid(&id);

            Ok(SpawnOutcome {
                code: status.and_then(|status| status.code()),
                stderr,
                final_path: queue.run_final_path(&id),
            })
        }
    }

    fn handle_line(&self, id: &str, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        let Some(item) = self.get(id) else {
            return;
        };

        if let Some(index) = line.find(TITLE_PRINT) {
            let title = line[index + TITLE_PRINT.len()..].trim();
            if !title.is_empty() {
                self.update(id, true, |item| item.title = title.to_string());
            }
            return;
        }

        if let Some(index) = line.find(FILE_PRINT) {
            let path = line[index + FILE_PRINT.len()..].trim().trim_matches('"').trim();
            if !path.is_empty() {
                self.set_final_path(id, path);
                self.update(id, true, |item| item.output_path = Some(path.to_string()));
            }
            return;
        }

        if let Some(patch) = parse_progress(line) {
            let progress = item.progress.max(patch.progress.unwrap_or(0.0));
            self.update(id, false, |item| {
                if patch.progress.is_some() {
                    item.progress = progress.min(100.0);
                }
                if let Some(value) = patch.downloaded {
                    item.downloaded_bytes = Some(value);
                }
                if let Some(value) = patch.total {
                    item.total_bytes = Some(value);
                }
                if let Some(value) = patch.speed_bytes {
                    item.speed_bytes = Some(value);
                }
                item.speed = patch.speed;
                item.eta = patch.eta;
                item.status = "downloading".into();
                item.stage_detail = None;
            });
            return;
        }

        if let Some(caps) = classic_regex().captures(line) {
            let percent = caps
                .get(1)
                .and_then(|value| value.as_str().parse::<f64>().ok())
                .unwrap_or(0.0);
            let total = caps.get(2).and_then(|value| parse_bytes(value.as_str()));
            let speed = caps.get(3).map(|value| value.as_str().to_string());
            let speed_bytes = caps.get(3).and_then(|value| parse_bytes(value.as_str()));
            let eta = caps.get(4).map(|value| value.as_str().to_string());
            let downloaded = total.map(|total| (percent / 100.0) * total);
            let progress = item.progress.max(percent);
            self.update(id, false, |item| {
                item.status = "downloading".into();
                item.progress = progress.min(100.0);
                item.downloaded_bytes = downloaded;
                item.total_bytes = total;
                item.speed = speed;
                item.speed_bytes = speed_bytes;
                item.eta = eta;
                item.stage_detail = None;
            });
            return;
        }

        if let Some(caps) = destination_regex().captures(line) {
            if let Some(path) = caps.get(1) {
                self.set_destination(id, path.as_str().trim());
                if item.status == "downloading" {
                    self.update(id, false, |item| {
                        item.stage_detail = Some("Downloading media streams…".into());
                    });
                }
            }
            return;
        }

        if let Some(caps) = merger_regex().captures(line) {
            if let Some(path) = caps.get(1) {
                self.set_final_path(id, path.as_str().trim());
            }
            self.processing(id, "Merging audio & video…");
            return;
        }

        if let Some(caps) = extract_regex().captures(line) {
            if let Some(path) = caps.get(1) {
                self.set_final_path(id, path.as_str().trim());
            }
            self.processing(id, "Extracting audio…");
            return;
        }

        if line.contains("[SponsorBlock]") {
            self.processing(id, "Removing sponsor segments…");
            return;
        }
        if line.contains("[VideoConvertor]") || line.contains("[VideoRemuxer]") {
            self.processing(id, "Converting container…");
            return;
        }
        if line.contains("[EmbedThumbnail]")
            || line.contains("[EmbedSubtitle]")
            || line.contains("[Metadata]")
        {
            self.processing(id, "Embedding metadata…");
        }
    }

    fn processing(&self, id: &str, detail: &str) {
        let detail = detail.to_string();
        self.update(id, true, |item| {
            item.status = "processing".into();
            item.progress = 100.0;
            item.stage_detail = Some(detail);
            item.speed = None;
            item.eta = None;
        });
    }

    async fn compress(
        &self,
        id: &str,
        input: &Path,
        duration: Option<f64>,
        preset: &str,
        ffmpeg: &str,
    ) -> Result<PathBuf, String> {
        let stem = input
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "video".into());
        let temp = input.with_file_name(format!("{stem}.nova-compressed.tmp.mp4"));
        let _ = std::fs::remove_file(&temp);

        let (video_args, audio_args) = preset_args(preset);
        let mut args: Vec<String> = vec![
            "-hide_banner".into(),
            "-y".into(),
            "-i".into(),
            input.to_string_lossy().to_string(),
            "-map".into(),
            "0".into(),
        ];
        args.extend(video_args.iter().map(|value| value.to_string()));
        args.extend(["-c:v:1".into(), "copy".into()]);
        args.extend(audio_args.iter().map(|value| value.to_string()));
        args.extend([
            "-c:s".into(),
            "copy".into(),
            "-c:t".into(),
            "copy".into(),
            "-map_metadata".into(),
            "0".into(),
            "-movflags".into(),
            "+faststart".into(),
            "-progress".into(),
            "pipe:1".into(),
            "-nostats".into(),
            temp.to_string_lossy().to_string(),
        ]);

        let mut command = tokio::process::Command::new(ffmpeg);
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            command.creation_flags(0x0800_0000);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start ffmpeg: {error}"))?;
        self.set_pid(id, child.id());

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "ffmpeg produced no error stream.".to_string())?;
        let stderr_task = tauri::async_runtime::spawn(async move {
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

        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(micros) = line.strip_prefix("out_time_us=") {
                    if let (Ok(micros), Some(duration)) = (micros.trim().parse::<f64>(), duration) {
                        if duration > 0.0 {
                            let percent = ((micros / 1_000_000.0 / duration) * 100.0)
                                .clamp(0.0, 99.0)
                                .round() as u8;
                            self.update(id, false, |item| {
                                item.progress = percent as f64;
                                item.stage_detail = Some(format!("Compressing · {percent}%"));
                            });
                        }
                    }
                }
                if line.starts_with("progress=") && self.is_stopped(id) {
                    if let Some(pid) = self.run_pid(id) {
                        kill_pid(pid);
                    }
                    break;
                }
            }
        }

        let stderr = stderr_task.await.unwrap_or_default();
        let status = child.wait().await.map_err(|error| error.to_string())?;
        self.clear_pid(id);

        if self.is_stopped(id) {
            let _ = std::fs::remove_file(&temp);
            return Err("Compression cancelled.".into());
        }
        if !status.success() {
            let _ = std::fs::remove_file(&temp);
            let line = stderr
                .lines()
                .filter(|line| !line.trim().is_empty())
                .last()
                .unwrap_or("FFmpeg failed.");
            return Err(format!(
                "Compression failed: {}",
                line.trim().chars().take(300).collect::<String>()
            ));
        }

        std::fs::remove_file(input).map_err(|error| format!("Could not replace the original: {error}"))?;
        std::fs::rename(&temp, input)
            .map_err(|error| format!("Could not finalize the compressed file: {error}"))?;
        self.update(id, false, |item| item.progress = 100.0);
        Ok(input.to_path_buf())
    }

    fn locate_output(&self, dir: &Path, item: &DownloadItem) -> Option<String> {
        let entries = std::fs::read_dir(dir).ok()?;
        let cutoff = SystemTime::now()
            .checked_sub(Duration::from_secs(3600))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let video_id = parse_video_id(&item.url);

        let mut candidates: Vec<(SystemTime, PathBuf)> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                !name.ends_with(".part") && !name.ends_with(".ytdl")
            })
            .filter_map(|entry| {
                let meta = entry.metadata().ok()?;
                let modified = meta.modified().ok()?;
                if modified < cutoff {
                    return None;
                }
                Some((modified, entry.path()))
            })
            .collect();

        if let Some(video_id) = video_id {
            let matching: Vec<(SystemTime, PathBuf)> = candidates
                .iter()
                .filter(|(_, path)| {
                    path.file_name()
                        .map(|name| name.to_string_lossy().contains(&video_id))
                        .unwrap_or(false)
                })
                .cloned()
                .collect();
            if !matching.is_empty() {
                candidates = matching;
            }
        }

        candidates.sort_by(|a, b| b.0.cmp(&a.0));
        candidates
            .first()
            .map(|(_, path)| path.to_string_lossy().to_string())
    }

    fn fail(&self, id: &str, error: &str) {
        let Some(item) = self.get(id) else {
            return;
        };
        self.update(id, true, |item| {
            item.status = "error".into();
            item.error = Some(error.to_string());
            item.speed = None;
            item.speed_bytes = None;
            item.eta = None;
            item.stage_detail = None;
        });
        self.toast("error", "Download failed", Some(format!("{} — {error}", item.title)));
    }

    fn toast(&self, kind: &str, title: &str, message: Option<String>) {
        let _ = self.app.emit(
            "toast",
            ToastEvent {
                id: unique_id("toast"),
                kind: kind.into(),
                title: title.into(),
                message,
            },
        );
    }

    fn update(
        &self,
        id: &str,
        force: bool,
        change: impl FnOnce(&mut DownloadItem),
    ) -> Option<DownloadItem> {
        let next = {
            let mut inner = self.lock();
            let item = inner.items.get_mut(id)?;
            change(item);
            item.clone()
        };

        let should_emit = {
            let now = Instant::now();
            let mut times = self
                .emit_times
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if force
                || times
                    .get(id)
                    .map(|last| now.duration_since(*last) > Duration::from_millis(140))
                    .unwrap_or(true)
            {
                times.insert(id.to_string(), now);
                true
            } else {
                false
            }
        };

        if should_emit {
            self.emit_update(next.clone(), force);
        }
        Some(next)
    }

    fn emit_update(&self, item: DownloadItem, _force: bool) {
        let _ = self.app.emit("downloads:update", item);
    }

    fn emit_snapshot(&self) {
        let _ = self.app.emit("downloads:snapshot", self.list());
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, QueueInner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn set_pid(&self, id: &str, pid: Option<u32>) {
        if let Some(run) = self.lock().runs.get_mut(id) {
            run.pid = pid;
        }
    }

    fn clear_pid(&self, id: &str) {
        if let Some(run) = self.lock().runs.get_mut(id) {
            run.pid = None;
        }
    }

    fn run_pid(&self, id: &str) -> Option<u32> {
        self.lock().runs.get(id).and_then(|run| run.pid)
    }

    fn is_stopped(&self, id: &str) -> bool {
        self.lock()
            .runs
            .get(id)
            .map(|run| run.cancelled || run.paused)
            .unwrap_or(true)
    }

    fn set_final_path(&self, id: &str, path: &str) {
        if let Some(run) = self.lock().runs.get_mut(id) {
            run.final_path = Some(path.to_string());
        }
    }

    fn set_destination(&self, id: &str, path: &str) {
        if let Some(run) = self.lock().runs.get_mut(id) {
            run.destination = Some(path.to_string());
        }
    }

    pub fn run_final_path(&self, id: &str) -> Option<String> {
        self.lock()
            .runs
            .get(id)
            .and_then(|run| run.final_path.clone())
    }

    fn run_destination(&self, id: &str) -> Option<String> {
        self.lock()
            .runs
            .get(id)
            .and_then(|run| run.destination.clone())
    }
}

/* ----------------------------- helpers ----------------------------- */

struct ProgressPatch {
    progress: Option<f64>,
    downloaded: Option<f64>,
    total: Option<f64>,
    speed_bytes: Option<f64>,
    speed: Option<String>,
    eta: Option<String>,
}

fn parse_progress(line: &str) -> Option<ProgressPatch> {
    let index = line.find(PROGRESS_PRINT)?;
    let parts: Vec<&str> = line[index + PROGRESS_PRINT.len()..].split('|').collect();
    let get = |position: usize| parts.get(position).map(|value| value.trim()).unwrap_or("");
    let number = |position: usize| get(position).parse::<f64>().ok();

    let percent = get(0).trim_end_matches('%').trim().parse::<f64>().ok();
    let downloaded = number(1);
    let total = number(2).or_else(|| number(3));
    let speed_bytes = number(4);
    let eta_seconds = number(5);
    let speed_text = get(6);
    let eta_text = get(7);

    Some(ProgressPatch {
        progress: percent.map(|value| value.clamp(0.0, 100.0)),
        downloaded,
        total,
        speed_bytes,
        speed: if speed_text.is_empty() || speed_text == "NA" || speed_text == "N/A" {
            None
        } else {
            Some(speed_text.to_string())
        },
        eta: if eta_text.is_empty() || eta_text == "NA" || eta_text == "N/A" {
            eta_seconds.and_then(eta_from_seconds)
        } else {
            Some(eta_text.to_string())
        },
    })
}

fn classic_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*\w+)(?:\s+at\s+([\d.]+\s*\w+/s))?(?:\s+ETA\s+([\d:]+))?",
        )
        .expect("valid progress regex")
    })
}

fn destination_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"\[download\]\s+Destination:\s+(.+)$"#).expect("valid regex"))
}

fn merger_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"\[Merger\]\s+Merging formats into\s+"(.+)"$"#).expect("valid regex")
    })
}

fn extract_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\[ExtractAudio\]\s+Destination:\s+(.+)$").expect("valid regex")
    })
}

fn quality_height(quality: &str) -> Option<u32> {
    if quality == "best" {
        return None;
    }
    quality.parse::<u32>().ok().filter(|value| *value > 0)
}

fn quality_label(quality: &str) -> &str {
    match quality {
        "2160" => "4K",
        "1440" => "1440p",
        "1080" => "1080p",
        "720" => "720p",
        "480" => "480p",
        "360" => "360p",
        "best" => "Best available",
        other => other,
    }
}

fn format_label(options: &DownloadOptions) -> String {
    if options.kind == "audio" {
        let suffix = match options.audio_format.as_str() {
            "mp3" => format!("{}kbps", options.audio_quality),
            "m4a" => "AAC".into(),
            _ => "Lossless".into(),
        };
        return format!("{} · {suffix}", options.audio_format.to_uppercase());
    }
    let compression = if options.compression == "none" {
        ""
    } else {
        " · Compressed"
    };
    format!(
        "{} {}{compression}",
        quality_label(&options.quality),
        options.container.to_uppercase()
    )
}

fn build_format_args(options: &DownloadOptions) -> Vec<String> {
    if options.kind == "audio" {
        let quality = if options.audio_format == "mp3" {
            format!("{}K", options.audio_quality)
        } else {
            "0".into()
        };
        return vec![
            "-f".into(),
            "ba/b".into(),
            "-x".into(),
            "--audio-format".into(),
            options.audio_format.clone(),
            "--audio-quality".into(),
            quality,
        ];
    }

    let cap = quality_height(&options.quality)
        .map(|height| format!("[height<={height}]"))
        .unwrap_or_default();
    let selector = match options.container.as_str() {
        "webm" => format!(
            "bv*[ext=webm]{cap}+ba[ext=webm]/b[ext=webm]{cap}/bv*{cap}+ba/b{cap}"
        ),
        "mp4" => format!("bv*[ext=mp4]{cap}+ba[ext=m4a]/b[ext=mp4]{cap}/bv*{cap}+ba/b{cap}"),
        _ => format!("bv*{cap}+ba/b{cap}/bv*+ba/b"),
    };

    let mut args = vec![
        "-f".into(),
        selector,
        "--merge-output-format".into(),
        options.container.clone(),
    ];
    if options.container == "mp4" && options.compression != "none" {
        args.extend(["--recode-video".into(), "mp4".into()]);
    } else if options.container == "mkv" {
        args.extend(["--remux-video".into(), "mkv".into()]);
    }
    args
}

fn build_extra_args(options: &DownloadOptions, ffmpeg: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(ffmpeg) = ffmpeg {
        args.extend(["--ffmpeg-location".into(), ffmpeg.to_string()]);
    }
    if options.embed_thumbnail {
        args.extend([
            "--embed-thumbnail".into(),
            "--convert-thumbnails".into(),
            "jpg".into(),
        ]);
    }
    if options.subtitles != "off" {
        args.extend([
            "--embed-subs".into(),
            "--convert-subs".into(),
            "srt".into(),
            "--sub-langs".into(),
            "en.*,pl.*,en,pl".into(),
        ]);
        if options.subtitles == "auto" {
            args.extend(["--write-auto-subs".into(), "--write-subs".into()]);
        } else {
            args.push("--write-subs".into());
        }
    }
    if options.sponsor_block {
        args.extend(["--sponsorblock-remove".into(), "all".into()]);
    }
    args
}

fn progress_args() -> Vec<String> {
    vec![
        "--newline".into(),
        "--progress".into(),
        "--progress-template".into(),
        format!(
            "download:{PROGRESS_PRINT}%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress._speed_str)s|%(progress._eta_str)s"
        ),
        "--print".into(),
        format!("before_dl:{TITLE_PRINT}%(title)s"),
        "--print".into(),
        format!("after_move:{FILE_PRINT}%(filepath)s"),
        "--no-simulate".into(),
    ]
}

fn build_args(item: &DownloadItem, output_dir: &Path, ffmpeg: Option<&str>) -> Vec<String> {
    let template = output_dir
        .join("%(title).150B [%(id)s].%(ext)s")
        .to_string_lossy()
        .to_string();

    let mut args = vec![
        "--ignore-config".into(),
        "--no-warnings".into(),
        "--no-color".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--no-playlist".into(),
        "--continue".into(),
        "--windows-filenames".into(),
        "--trim-filenames".into(),
        "180".into(),
        "--concurrent-fragments".into(),
        "8".into(),
        "--retries".into(),
        "10".into(),
        "--fragment-retries".into(),
        "10".into(),
        "--socket-timeout".into(),
        "20".into(),
        "--output".into(),
        template,
    ];
    args.extend(progress_args());
    args.extend(build_format_args(&item.options));
    args.extend(build_extra_args(&item.options, ffmpeg));
    args.push(item.url.clone());
    args
}

fn resolve_output_dir(download_dir: &str, item: &DownloadItem) -> PathBuf {
    let base = PathBuf::from(download_dir);
    match item.playlist_title.as_deref().map(sanitize_folder) {
        Some(folder) if !folder.is_empty() => base.join(folder),
        _ => base,
    }
}

fn compression_stage(preset: &str) -> &'static str {
    match preset {
        "high" => "Compressing · HEVC CRF 28",
        "social" => "Compressing · 720p social",
        _ => "Compressing · H.264 CRF 23",
    }
}

fn preset_args(preset: &str) -> (Vec<&'static str>, Vec<&'static str>) {
    match preset {
        "high" => (
            vec![
                "-c:v:0",
                "libx265",
                "-preset",
                "medium",
                "-crf",
                "28",
                "-pix_fmt",
                "yuv420p",
                "-tag:v",
                "hvc1",
            ],
            vec!["-c:a", "aac", "-b:a", "160k"],
        ),
        "social" => (
            vec![
                "-filter:v:0",
                "scale=-2:720",
                "-c:v:0",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "26",
                "-pix_fmt",
                "yuv420p",
            ],
            vec!["-c:a", "aac", "-b:a", "128k"],
        ),
        _ => (
            vec![
                "-c:v:0",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
            ],
            vec!["-c:a", "aac", "-b:a", "192k"],
        ),
    }
}

#[allow(dead_code)]
fn active_status(status: &str) -> bool {
    ACTIVE_STATUSES.contains(&status)
}
