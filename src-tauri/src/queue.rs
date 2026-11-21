//! Concurrent download queue built on yt-dlp child processes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use regex::Regex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Semaphore;

use crate::binaries::Binaries;
use crate::models::{AddDownloadInput, DownloadItem, DownloadOptions, HistoryEntry, ToastEvent};
use crate::store::AppStore;
use crate::sys;
use crate::util::{
    eta_from_seconds, file_size, format_bytes, friendly_error, kill_pid, now_ms, parse_bytes,
    parse_video_id, sanitize_folder, unique_id,
};

const ACTIVE_STATUSES: [&str; 4] = ["fetching", "downloading", "processing", "compressing"];
const FINISHED_STATUSES: [&str; 3] = ["completed", "cancelled", "error"];
const TITLE_PRINT: &str = "__NOVA_TITLE__";
const FILE_PRINT: &str = "__NOVA_FILE__";
const VCODEC_PRINT: &str = "__NOVA_VCODEC__";
const PROGRESS_PRINT: &str = "__NOVA_PROGRESS__";

/// Only one FFmpeg transcode/compression runs at a time. Downloads are network
/// bound and can overlap, but a second simultaneous re-encode would saturate
/// every core and the NVMe at once — the exact recipe for a thermal reboot.
const ENCODE_SLOTS: usize = 1;
/// Breathing room between one job finishing and the next heavy job starting.
const TASK_COOLDOWN: Duration = Duration::from_millis(700);
/// At most one write per second while only progress is changing.
const PROGRESS_PERSIST_INTERVAL: Duration = Duration::from_secs(6);
/// Structural changes are written promptly but still coalesced.
const STRUCTURAL_PERSIST_INTERVAL: Duration = Duration::from_secs(1);
/// Never flush twice within this window, no matter what changed.
const MIN_PERSIST_INTERVAL: Duration = Duration::from_millis(900);
/// How often the queue re-checks free disk space while paused for space.
const SPACE_RECHECK_INTERVAL: Duration = Duration::from_secs(20);
/// Low-space warnings are throttled to one per this window.
const SPACE_WARN_INTERVAL: Duration = Duration::from_secs(300);

struct RunState {
    pid: Option<u32>,
    cancelled: bool,
    paused: bool,
    final_path: Option<String>,
    destination: Option<String>,
    /// Video codec of the produced file, reported by yt-dlp after the move.
    vcodec: Option<String>,
}

impl RunState {
    fn new() -> Self {
        Self {
            pid: None,
            cancelled: false,
            paused: false,
            final_path: None,
            destination: None,
            vcodec: None,
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
    /// Set by any mutation; the periodic flusher writes the queue snapshot.
    dirty: AtomicBool,
    /// Set when a non-progress change happened, so the next flush is prompt.
    structural: AtomicBool,
    /// Last time the queue snapshot hit the disk.
    last_persist: Mutex<Instant>,
    /// Set once the window is closing; no new jobs may start.
    shutting_down: AtomicBool,
    /// Serializes the heavy FFmpeg passes so they never overlap.
    encode_gate: Semaphore,
    /// Set while the queue is paused because the disk is nearly full.
    space_block: AtomicBool,
    /// Last free-space probe, used to throttle the re-check and the warning.
    last_space_check: Mutex<Instant>,
    last_space_warn: Mutex<Instant>,
    /// When the previous job finished, used to pace consecutive jobs.
    last_finish: Mutex<Instant>,
}

impl DownloadQueue {
    pub fn new(app: AppHandle, store: Arc<AppStore>, binaries: Arc<Binaries>) -> Self {
        let mut items = HashMap::new();
        let mut order = Vec::new();

        // Restore the previous session. Anything that was actively running is
        // put back into the queue with its progress intact; pauses and
        // cancellations are user intent and stay as they were.
        for mut item in store.load_queue() {
            item.speed = None;
            item.speed_bytes = None;
            item.eta = None;
            match item.status.as_str() {
                "fetching" | "downloading" | "processing" => {
                    item.status = "queued".into();
                    item.resume_stage = None;
                    item.stage_detail = Some("Resuming after restart…".into());
                }
                "compressing" => {
                    item.status = "queued".into();
                    item.resume_stage = Some("compress".into());
                    item.stage_detail = Some("Resuming compression…".into());
                }
                "queued" => {
                    item.resume_stage = None;
                    item.stage_detail = Some("Waiting to resume…".into());
                }
                _ => {}
            }
            if items.contains_key(&item.id) {
                continue;
            }
            order.push(item.id.clone());
            items.insert(item.id.clone(), item);
        }

        Self {
            app,
            store,
            binaries,
            inner: Mutex::new(QueueInner {
                items,
                order,
                runs: HashMap::new(),
            }),
            emit_times: Mutex::new(HashMap::new()),
            dirty: AtomicBool::new(false),
            structural: AtomicBool::new(false),
            last_persist: Mutex::new(Instant::now()),
            shutting_down: AtomicBool::new(false),
            encode_gate: Semaphore::new(ENCODE_SLOTS),
            space_block: AtomicBool::new(false),
            last_space_check: Mutex::new(Instant::now()),
            last_space_warn: Mutex::new(
                Instant::now()
                    .checked_sub(SPACE_WARN_INTERVAL)
                    .unwrap_or_else(Instant::now),
            ),
            last_finish: Mutex::new(
                Instant::now()
                    .checked_sub(TASK_COOLDOWN)
                    .unwrap_or_else(Instant::now),
            ),
        }
    }

    pub fn has_pending(&self) -> bool {
        let inner = self.lock();
        inner.order.iter().any(|id| {
            inner
                .items
                .get(id)
                .map(|item| item.status == "queued")
                .unwrap_or(false)
        })
    }

    /// Called on a timer. Writes the queue snapshot no more often than needed
    /// and rechecks the disk so a space-paused queue resumes on its own.
    pub fn maintenance(self: &Arc<Self>) {
        if self.space_block.load(Ordering::SeqCst) {
            self.recheck_space();
        }
        self.persist_if_dirty();
    }

    /// Coalesced snapshot write. Structural changes go out within a second;
    /// progress-only ticks wait longer, and nothing is ever written twice
    /// inside `MIN_PERSIST_INTERVAL`. This is what keeps a 2000-item playlist
    /// from rewriting its JSON every couple of seconds and wearing the SSD.
    pub fn persist_if_dirty(&self) {
        if !self.dirty.load(Ordering::SeqCst) {
            return;
        }
        let structural = self.structural.load(Ordering::SeqCst);
        let interval = if structural {
            STRUCTURAL_PERSIST_INTERVAL
        } else {
            PROGRESS_PERSIST_INTERVAL
        };
        let due = {
            let last = self.last_persist.lock().unwrap_or_else(|error| error.into_inner());
            last.elapsed() >= interval && last.elapsed() >= MIN_PERSIST_INTERVAL
        };
        if !due {
            return;
        }
        // Structural snapshots are fsynced (they must survive a crash); pure
        // progress snapshots skip the flush, which is the actual SSD saving.
        self.flush(structural);
    }

    /// Force a snapshot to disk right now, fsync included. Used for changes
    /// that must survive a crash (adds, removals, shutdown, space pause).
    pub fn persist_now(&self) {
        self.flush(true);
    }

    fn flush(&self, sync: bool) {
        self.dirty.store(false, Ordering::SeqCst);
        self.structural.store(false, Ordering::SeqCst);
        if let Ok(mut last) = self.last_persist.lock() {
            *last = Instant::now();
        }
        self.store.save_queue(&self.list(), sync);
    }

    /// A change worth writing soon: add, remove, status transition.
    fn mark_structural(&self) {
        self.dirty.store(true, Ordering::SeqCst);
        self.structural.store(true, Ordering::SeqCst);
    }

    /// A progress tick: written on the slower cadence only.
    fn mark_progress(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }

    /// Called once the renderer is ready: restored jobs continue where the
    /// previous session left off instead of waiting for a manual click.
    pub fn auto_resume(self: &Arc<Self>) {
        self.schedule();
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
            // A single video is a deliberate, one-off request: it goes ahead of
            // every waiting playlist item so it starts as soon as a slot frees
            // up, instead of queueing behind thousands of videos.
            let position = pending_position(&inner);
            inner.items.insert(item.id.clone(), item.clone());
            inner.order.insert(position, item.id.clone());
        }
        self.mark_structural();
        self.emit_update(item.clone(), true);
        self.emit_snapshot();
        self.schedule();
        Ok(item)
    }

    pub fn add_many(
        self: &Arc<Self>,
        inputs: Vec<AddDownloadInput>,
        prioritize: bool,
    ) -> Result<Vec<DownloadItem>, String> {
        if inputs.is_empty() {
            return Err("No videos selected.".into());
        }
        if inputs.len() > 50_000 {
            return Err("That playlist is too large (limit: 50,000 videos).".into());
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
            let position = if prioritize {
                pending_position(&inner)
            } else {
                inner.order.len()
            };
            let ids: Vec<String> = created.iter().map(|item| item.id.clone()).collect();
            for item in &created {
                inner.items.insert(item.id.clone(), item.clone());
            }
            // Playlist order (1, 2, 3, …) is preserved inside the batch either
            // way; only the starting point changes when it is prioritized.
            inner.order.splice(position..position, ids);
        }
        // One snapshot instead of N individual events keeps huge batches cheap.
        self.mark_structural();
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
            resume_stage: None,
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
            item.resume_stage = None;
            item.stage_detail = Some("Cancelled".into());
        });
        // The user abandoned this job: clear its half-written fragments now
        // instead of leaving them to accumulate on the SSD.
        if let Some(item) = self.get(id) {
            self.cleanup_item_files(&item);
        }
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
            item.resume_stage = None;
        });
        self.schedule();
    }

    pub fn remove(&self, id: &str) {
        let (pid, item) = {
            let mut inner = self.lock();
            let item = inner.items.get(id).cloned();
            let pid = inner.runs.get_mut(id).and_then(|run| {
                run.cancelled = true;
                run.pid
            });
            inner.items.remove(id);
            inner.order.retain(|item_id| item_id != id);
            (pid, item)
        };
        if let Some(pid) = pid {
            kill_pid(pid);
        }
        if let Some(item) = item {
            self.cleanup_item_files(&item);
        }
        self.mark_structural();
        let _ = self.app.emit("downloads:removed", id);
        self.emit_snapshot();
    }

    /// Jump one item in front of every waiting item. Queued jobs keep their
    /// progress; paused/failed/cancelled jobs are requeued so the action is
    /// immediately useful. Running and finished jobs are left alone.
    pub fn move_to_top(self: &Arc<Self>, id: &str) {
        {
            let mut inner = self.lock();
            let Some(status) = inner.items.get(id).map(|item| item.status.clone()) else {
                return;
            };
            if ACTIVE_STATUSES.contains(&status.as_str()) || status == "completed" {
                return;
            }
            if status != "queued" {
                if let Some(item) = inner.items.get_mut(id) {
                    item.status = "queued".into();
                    item.error = None;
                    item.notice = None;
                    item.speed = None;
                    item.speed_bytes = None;
                    item.eta = None;
                    item.stage_detail = None;
                    item.resume_stage = None;
                    if status == "error" || status == "cancelled" {
                        item.progress = 0.0;
                        item.downloaded_bytes = None;
                        item.total_bytes = None;
                    }
                }
            }
            inner.order.retain(|item_id| item_id != id);
            let position = pending_position(&inner);
            inner.order.insert(position, id.to_string());
        }
        // The queue order is meaningful state, so write it out right away.
        self.mark_structural();
        self.persist_now();
        self.emit_snapshot();
        self.schedule();
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
        self.mark_structural();
        self.emit_snapshot();
    }

    /// Realign the running jobs with the configured concurrency limit.
    ///
    /// Raising the limit starts waiting jobs right away. Lowering it stops the
    /// least-advanced extra jobs — their processes are killed and the items go
    /// back to `queued` with their progress intact, so `--continue` picks them
    /// up as soon as a slot frees. This keeps the promise on the slider literal
    /// without ever throwing away downloaded data.
    pub fn apply_concurrency(self: &Arc<Self>) {
        let limit = self.store.settings().concurrency.max(1) as usize;
        let excess: Vec<(String, Option<u32>)> = {
            let mut inner = self.lock();
            let running: Vec<String> = inner
                .order
                .iter()
                .filter(|id| inner.runs.contains_key(*id))
                .cloned()
                .collect();
            if running.len() <= limit {
                Vec::new()
            } else {
                let mut ranked = running;
                // Cancel the jobs that have made the least progress first.
                ranked.sort_by(|a, b| {
                    let pa = inner.items.get(a).map(|item| item.progress).unwrap_or(0.0);
                    let pb = inner.items.get(b).map(|item| item.progress).unwrap_or(0.0);
                    pa.partial_cmp(&pb).unwrap_or(std::cmp::Ordering::Equal)
                });
                let cut = ranked.len() - limit;
                ranked
                    .into_iter()
                    .take(cut)
                    .map(|id| {
                        let pid = inner.runs.get_mut(&id).and_then(|run| {
                            run.cancelled = true;
                            run.pid
                        });
                        if let Some(item) = inner.items.get_mut(&id) {
                            item.status = "queued".into();
                            item.speed = None;
                            item.speed_bytes = None;
                            item.eta = None;
                            item.stage_detail = Some("Waiting for a free download slot…".into());
                        }
                        (id, pid)
                    })
                    .collect()
            }
        };

        if !excess.is_empty() {
            for (_, pid) in &excess {
                if let Some(pid) = pid {
                    kill_pid(*pid);
                }
            }
            for (id, _) in &excess {
                if let Some(item) = self.get(id) {
                    self.emit_update(item, true);
                }
            }
            self.mark_structural();
            self.persist_now();
        }

        self.schedule();
    }

    /// React to a settings change that could unblock the queue — for example
    /// the user pointing downloads at a drive with free space. Rechecks space
    /// immediately instead of waiting for the next scheduled tick.
    pub fn nudge(self: &Arc<Self>) {
        if self.space_block.load(Ordering::SeqCst) {
            if let Ok(mut last) = self.last_space_check.lock() {
                *last = Instant::now()
                    .checked_sub(SPACE_RECHECK_INTERVAL)
                    .unwrap_or_else(Instant::now);
            }
            self.recheck_space();
        } else {
            self.schedule();
        }
    }

    /// Emergency stop: kill every child process, drop the whole queue and make
    /// sure the emptied queue is written to disk immediately, so nothing comes
    /// back on the next launch.
    pub fn clear_all(&self) {
        let (pids, items): (Vec<u32>, Vec<DownloadItem>) = {
            let mut inner = self.lock();
            let mut pids = Vec::new();
            for run in inner.runs.values_mut() {
                run.cancelled = true;
                run.paused = false;
                if let Some(pid) = run.pid {
                    pids.push(pid);
                }
            }
            let items = inner.items.values().cloned().collect();
            inner.items.clear();
            inner.order.clear();
            (pids, items)
        };

        for pid in pids {
            kill_pid(pid);
        }
        // Wipe the half-written fragments of everything that was in flight.
        for item in items {
            self.cleanup_item_files(&item);
        }

        // Spawned tasks exit on their own once `is_stopped` sees the item gone;
        // the run bookkeeping is cleaned up by `finish_run`.
        self.mark_structural();
        self.persist_now();
        let _ = self.app.emit("downloads:cleared", ());
        self.emit_snapshot();
    }

    /// Closing the window must not throw away in-flight work. Stop the child
    /// processes, turn every active item back into a queued item and flush the
    /// snapshot, so the next launch continues exactly where this one stopped.
    pub fn prepare_shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);

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

        {
            let mut inner = self.lock();
            for item in inner.items.values_mut() {
                if ACTIVE_STATUSES.contains(&item.status.as_str()) {
                    item.status = "queued".into();
                    item.speed = None;
                    item.speed_bytes = None;
                    item.eta = None;
                    item.stage_detail =
                        Some("Paused — continues when you reopen NovaTube".into());
                }
            }
        }
        self.persist_now();
    }

    fn schedule(self: &Arc<Self>) {
        if self.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        // While the disk is nearly full nothing new may start; the maintenance
        // loop clears the flag once there is room again.
        if self.space_block.load(Ordering::SeqCst) {
            return;
        }
        let limit = self.store.settings().concurrency.max(1) as usize;
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

        // A crash in the middle of compression leaves the downloaded media on
        // disk. Resume straight into FFmpeg instead of fetching it again.
        let resume_compression = item.resume_stage.as_deref() == Some("compress")
            && item.options.kind == "video"
            && item.options.compression != "none"
            && item
                .output_path
                .as_deref()
                .map(|path| Path::new(path).is_file())
                .unwrap_or(false);

        self.update(&id, true, |item| {
            item.status = "fetching".into();
            if !resume_compression {
                item.progress = 0.0;
            }
            item.stage_detail = Some(if resume_compression {
                "Resuming compression…".into()
            } else {
                "Preparing the media engine…".into()
            });
            item.speed = None;
            item.speed_bytes = None;
            item.eta = None;
            if !resume_compression {
                item.resume_stage = None;
            }
        });

        let ffmpeg = self.binaries.ensure_ffmpeg().await.ok();

        if self.is_stopped(&id) {
            self.finish_run(&id);
            return;
        }

        // Brief cooldown after the previous job, so a long playlist does not
        // run the disk and CPU at 100% back to back without a breath.
        let delay = self.start_delay();
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
            if self.is_stopped(&id) {
                self.finish_run(&id);
                return;
            }
        }

        let settings = self.store.settings();
        let output_dir = resolve_output_dir(&settings.download_dir, &item);
        if tokio::fs::create_dir_all(&output_dir).await.is_err() {
            self.fail(&id, "Could not create the download folder.");
            self.finish_run(&id);
            return;
        }

        // Never start pulling bytes we have nowhere to put: pause the queue
        // cleanly when free space is below the safe floor.
        if !self.has_disk_space(&output_dir, &item) {
            self.update(&id, true, |item| {
                item.status = "queued".into();
                item.speed = None;
                item.speed_bytes = None;
                item.eta = None;
                item.stage_detail = Some("Paused — not enough disk space".into());
            });
            self.persist_now();
            self.finish_run(&id);
            return;
        }

        let mut final_path = if resume_compression {
            item.output_path.clone().unwrap_or_default()
        } else {
            // Only the download stage needs the media engine.
            let ytdlp = match self.binaries.ensure_ytdlp().await {
                Ok(path) => path,
                Err(error) => {
                    self.fail(&id, &error);
                    self.finish_run(&id);
                    return;
                }
            };

            let args = build_args(&item, &output_dir, ffmpeg.as_deref());
            self.update(&id, true, |item| {
                item.status = "downloading".into();
                item.stage_detail = Some("Connecting to the media server…".into());
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

            let candidate = outcome
                .final_path
                .or_else(|| self.run_final_path(&id))
                .or_else(|| self.run_destination(&id))
                .or_else(|| self.locate_output(&output_dir, &item));

            match candidate {
                Some(path) => path,
                None => {
                    self.fail(&id, "The download finished but no file could be found.");
                    self.finish_run(&id);
                    return;
                }
            }
        };

        // MP4/MKV files that yt-dlp could only produce as AV1 are re-encoded to
        // H.264 — unless a compression preset is already going to re-encode them
        // (those presets use H.264/H.265, never AV1).
        let preset = item.options.compression.clone();
        let reencoded_by_preset =
            item.options.kind == "video" && preset != "none" && ffmpeg.is_some();
        let source_is_av1 = self
            .run_vcodec(&id)
            .as_deref()
            .map(is_av1_codec)
            .unwrap_or(false);

        if item.options.kind == "video"
            && !reencoded_by_preset
            && item.options.container != "webm"
            && source_is_av1
        {
            if let Some(ffmpeg) = ffmpeg.as_deref() {
                self.update(&id, true, |item| {
                    item.status = "processing".into();
                    item.progress = 0.0;
                    item.stage_detail = Some("Converting AV1 to H.264…".into());
                    item.notice = Some(
                        "This file was encoded in AV1, which most players cannot open, so NovaTube converted it to H.264."
                            .into(),
                    );
                });

                match self
                    .transcode_to_h264(&id, Path::new(&final_path), item.duration, ffmpeg)
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

        if item.options.kind == "video" && preset != "none" {
            if ffmpeg.is_none() {
                self.update(&id, true, |item| {
                    item.notice = Some("Compression was skipped because it is unavailable.".into());
                    item.resume_stage = None;
                });
            } else if let Some(ffmpeg) = ffmpeg.as_deref() {
                self.update(&id, true, |item| {
                    item.status = "compressing".into();
                    item.progress = 0.0;
                    item.stage_detail = Some(compression_stage(&preset).into());
                    item.output_path = Some(final_path.clone());
                    // Persisted immediately: if the app dies during FFmpeg,
                    // the next launch continues with compression only.
                    item.resume_stage = Some("compress".into());
                });

                match self
                    .compress(&id, Path::new(&final_path), item.duration, &preset, ffmpeg)
                    .await
                {
                    Ok(path) => {
                        final_path = path.to_string_lossy().to_string();
                        let done = final_path.clone();
                        self.update(&id, true, |item| {
                            item.resume_stage = None;
                            item.output_path = Some(done);
                        });
                    }
                    Err(error) => {
                        if self.is_stopped(&id) {
                            self.finish_run(&id);
                            return;
                        }
                        self.update(&id, true, |item| {
                            item.notice = Some(format!("{error} The original file was kept."));
                            item.resume_stage = None;
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
        if let Ok(mut times) = self.emit_times.lock() {
            times.remove(id);
        }
        // Stamp the finish time so the next job can pace itself against it.
        if let Ok(mut last) = self.last_finish.lock() {
            *last = Instant::now();
        }
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
            crate::util::hide_console(&mut command);

            let mut child = command
                .spawn()
                .map_err(|error| format!("Could not start the media engine: {error}"))?;
            {
                let pid = child.id();
                queue.set_pid(&id, pid);
                // Keep the whole yt-dlp tree (it may spawn its own ffmpeg for
                // merges) inside the app's job object.
                if let Some(pid) = pid {
                    sys::assign_child_to_job(pid);
                }
            }

            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "The media engine returned no output.".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "The media engine returned no status stream.".to_string())?;

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

            // A stopped job must never keep running behind our back: kill the
            // tree so nothing keeps writing to disk or downloading.
            if queue.is_stopped(&id) {
                if let Some(pid) = queue.run_pid(&id) {
                    kill_pid(pid);
                }
                let _ = child.start_kill();
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

        if let Some(index) = line.find(VCODEC_PRINT) {
            let codec = line[index + VCODEC_PRINT.len()..].trim();
            if !codec.is_empty() {
                self.set_vcodec(id, codec);
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
        let (video_args, audio_args) = preset_args(preset);
        let video_args: Vec<String> = video_args.into_iter().map(str::to_string).collect();
        let audio_args: Vec<String> = audio_args.into_iter().map(str::to_string).collect();
        self.encode(
            id,
            input,
            duration,
            &video_args,
            &audio_args,
            "Compressing",
            "Compression cancelled.",
            "Compression failed",
            ffmpeg,
        )
        .await
    }

    /// AV1 that reached the disk is re-encoded to H.264 so it opens in ordinary
    /// players. The container is preserved, so the file keeps its name.
    async fn transcode_to_h264(
        &self,
        id: &str,
        input: &Path,
        duration: Option<f64>,
        ffmpeg: &str,
    ) -> Result<PathBuf, String> {
        let video_args = vec![
            "-c:v:0".to_string(),
            "libx264".into(),
            "-preset".into(),
            "medium".into(),
            "-crf".into(),
            "20".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ];
        let audio_args = vec!["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()];
        self.encode(
            id,
            input,
            duration,
            &video_args,
            &audio_args,
            "Converting to H.264",
            "Conversion cancelled.",
            "Conversion failed",
            ffmpeg,
        )
        .await
    }

    /// Shared FFmpeg pass: encode into a temporary file beside the input and
    /// swap it in only when the whole encode succeeded, so a crash, cancel or
    /// failure can never damage the already-downloaded media.
    #[allow(clippy::too_many_arguments)]
    async fn encode(
        &self,
        id: &str,
        input: &Path,
        duration: Option<f64>,
        video_args: &[String],
        audio_args: &[String],
        stage: &str,
        cancel_reason: &str,
        failure_label: &str,
        ffmpeg: &str,
    ) -> Result<PathBuf, String> {
        // Serialize every heavy encode. Only one FFmpeg pass runs at a time, so
        // a finished download waits its turn instead of stacking a second
        // transcode on top of the first and pinning every core.
        if self.encode_gate.available_permits() == 0 {
            self.update(id, true, |item| {
                item.stage_detail = Some(format!("{stage} · waiting for the converter…"));
            });
        }
        let _permit = self
            .encode_gate
            .acquire()
            .await
            .map_err(|_| "The converter gate was closed.".to_string())?;
        if self.is_stopped(id) {
            return Err(cancel_reason.into());
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
        let _ = std::fs::remove_file(&temp);

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
        ]);
        // Cap the encoder's threads instead of letting it grab every core:
        // full saturation is what turns a long playlist into a thermal event.
        args.extend(["-threads".into(), sys::encode_threads().to_string()]);
        // `-movflags` only exists on the mp4/mov muxers.
        if matches!(extension.as_str(), "mp4" | "m4v" | "mov") {
            args.extend(["-movflags".into(), "+faststart".into()]);
        }
        args.extend([
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
        crate::util::hide_console(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start the converter: {error}"))?;
        {
            let pid = child.id();
            self.set_pid(id, pid);
            // Tie this encoder to the app's job object so it can never outlive
            // NovaTube as an orphan.
            if let Some(pid) = pid {
                sys::assign_child_to_job(pid);
            }
        }

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "The converter returned no status stream.".to_string())?;
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
                                item.stage_detail = Some(format!("{stage} · {percent}%"));
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
            return Err(cancel_reason.into());
        }
        if !status.success() {
            let _ = std::fs::remove_file(&temp);
            let line = stderr
                .lines()
                .filter(|line| !line.trim().is_empty())
                .last()
                .unwrap_or("The conversion failed.");
            return Err(format!(
                "{failure_label}: {}",
                line.trim().chars().take(300).collect::<String>()
            ));
        }

        // Windows has no atomic replace-on-rename, so the original is parked
        // beside the output first. If the swap fails, it is put back and the
        // download is never lost.
        let backup = input.with_file_name(format!("{stem}.nova-original.tmp"));
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(input, &backup)
            .map_err(|error| format!("Could not replace the original: {error}"))?;
        if let Err(error) = std::fs::rename(&temp, input) {
            let _ = std::fs::rename(&backup, input);
            let _ = std::fs::remove_file(&temp);
            return Err(format!("Could not finalize the compressed file: {error}"));
        }
        let _ = std::fs::remove_file(&backup);
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
        // A failed job leaves nothing useful behind: clear its fragments so a
        // long series of failures cannot slowly fill the SSD.
        self.cleanup_item_files(&item);
        self.toast("error", "Download failed", Some(format!("{} — {error}", item.title)));
    }

    /// Delete any leftover partial/temporary files belonging to this item.
    /// Finished media is never touched — only `.part`, `.ytdl`, fragment and
    /// encode-temp files are matched, and only for this item's video id.
    fn cleanup_item_files(&self, item: &DownloadItem) {
        let dir = resolve_output_dir(&self.store.settings().download_dir, item);
        let video_id = parse_video_id(&item.url);
        cleanup_partials(&dir, video_id.as_deref());
    }

    /// Free-space probe for a directory, throttled for repeated checks.
    fn has_disk_space(&self, dir: &Path, item: &DownloadItem) -> bool {
        let Some(free) = sys::free_space(dir) else {
            return true; // unknown platform: never block on a guess
        };
        // Keep a healthy reserve on top of this item's own estimated size.
        let needed = item
            .total_bytes
            .map(|bytes| (bytes as u64).saturating_mul(12) / 10)
            .unwrap_or(0)
            .max(sys::MIN_FREE_BYTES);
        if free >= needed {
            return true;
        }

        self.space_block.store(true, Ordering::SeqCst);
        if let Ok(mut last) = self.last_space_check.lock() {
            *last = Instant::now();
        }
        self.warn_low_space(free);
        false
    }

    fn warn_low_space(&self, free: u64) {
        let should_warn = {
            let mut last = self.last_space_warn.lock().unwrap_or_else(|error| error.into_inner());
            if last.elapsed() >= SPACE_WARN_INTERVAL {
                *last = Instant::now();
                true
            } else {
                false
            }
        };
        if should_warn {
            let text = format_bytes(Some(free)).unwrap_or_else(|| "very little".into());
            self.toast(
                "error",
                "Low disk space",
                Some(format!(
                    "Only {text} left. Downloads are paused until you free up space."
                )),
            );
        }
    }

    /// Clear the space pause once the disk has room again.
    fn recheck_space(self: &Arc<Self>) {
        let due = {
            let mut last = self.last_space_check.lock().unwrap_or_else(|error| error.into_inner());
            if last.elapsed() >= SPACE_RECHECK_INTERVAL {
                *last = Instant::now();
                true
            } else {
                false
            }
        };
        if !due {
            return;
        }

        let dir = PathBuf::from(self.store.settings().download_dir);
        match sys::free_space(&dir) {
            Some(free) if free >= sys::MIN_FREE_BYTES => {
                self.space_block.store(false, Ordering::SeqCst);
                self.toast("success", "Disk space available again", Some("Downloads resumed.".into()));
                self.schedule();
            }
            _ => {}
        }
    }

    /// Time left before the next job may start, so consecutive tasks breathe.
    fn start_delay(&self) -> Duration {
        let last = *self.last_finish.lock().unwrap_or_else(|error| error.into_inner());
        TASK_COOLDOWN.saturating_sub(last.elapsed())
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
        // Progress ticks are persisted by the background flusher, so a crash
        // resumes from the last snapshot instead of starting over. A forced
        // change (status, path, error) is structural and written sooner.
        if force {
            self.mark_structural();
        } else {
            self.mark_progress();
        }

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

    /// A run is "stopped" only when it was explicitly cancelled/paused, or its
    /// item was removed. A missing run entry alone must never abort a live
    /// download — that would silently orphan the child process.
    fn is_stopped(&self, id: &str) -> bool {
        let inner = self.lock();
        match inner.runs.get(id) {
            Some(run) => run.cancelled || run.paused,
            None => !inner.items.contains_key(id),
        }
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

    fn set_vcodec(&self, id: &str, codec: &str) {
        if let Some(run) = self.lock().runs.get_mut(id) {
            run.vcodec = Some(codec.to_string());
        }
    }

    fn run_vcodec(&self, id: &str) -> Option<String> {
        self.lock().runs.get(id).and_then(|run| run.vcodec.clone())
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
    // AV1 (`av01`) plays back badly or not at all in a lot of desktop software,
    // which is what made playlist items look "unsupported". Every preferred
    // candidate therefore excludes it and favours the container's natural codec
    // (H.264 in MP4, VP9 in WebM). The last candidate is unfiltered so a video
    // that only exists in AV1 still downloads — it is then transcoded to H.264
    // after the fact (see `transcode_to_h264`).
    let no_av1 = "[vcodec!*=av01]";
    let selector = match options.container.as_str() {
        "webm" => format!(
            "bv*[ext=webm][vcodec^=vp9]{cap}+ba[ext=webm]/bv*[ext=webm]{no_av1}{cap}+ba[ext=webm]/bv*{no_av1}{cap}+ba/b{cap}/bv*{cap}+ba/b{cap}"
        ),
        "mp4" => format!(
            "bv*[ext=mp4][vcodec^=avc1]{cap}+ba[ext=m4a]/bv*[ext=mp4]{no_av1}{cap}+ba[ext=m4a]/bv*{no_av1}{cap}+ba/b{cap}/bv*{cap}+ba/b{cap}"
        ),
        _ => format!(
            "bv*{no_av1}{cap}+ba/b{no_av1}{cap}/bv*{no_av1}+ba/b{no_av1}/bv*{cap}+ba/b{cap}"
        ),
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
        "--print".into(),
        format!("after_move:{VCODEC_PRINT}%(vcodec)s"),
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
        "4".into(),
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

/// `%(vcodec)s` looks like `av01.0.08M.08`, `avc1.640028` or `vp9`.
fn is_av1_codec(codec: &str) -> bool {
    let codec = codec.trim().to_ascii_lowercase();
    codec.starts_with("av01") || codec.starts_with("av1.") || codec == "av1"
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
/// Index of the first waiting item, i.e. the front of the pending queue.
/// Finished items may sit at the top of a restored queue, so appending at the
/// end is not the same as "next to run".
fn pending_position(inner: &QueueInner) -> usize {
    inner
        .order
        .iter()
        .position(|id| {
            inner
                .items
                .get(id)
                .map(|item| item.status == "queued")
                .unwrap_or(false)
        })
        .unwrap_or(inner.order.len())
}

/// Remove leftover intermediate files for one video from a folder: yt-dlp's
/// `.part`/`.ytdl`/fragment files and our own encode temporaries. When a video
/// id is known, only files carrying it are touched, so parallel or unrelated
/// work in the same folder is never disturbed.
fn cleanup_partials(dir: &Path, video_id: Option<&str>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        let is_intermediate = lower.ends_with(".part")
            || lower.ends_with(".ytdl")
            || lower.contains(".nova-encode.tmp")
            || lower.contains(".nova-original.tmp")
            || is_fragment_file(&lower);
        if !is_intermediate {
            continue;
        }
        if let Some(id) = video_id {
            if !name.contains(id) {
                continue;
            }
        }
        let _ = std::fs::remove_file(entry.path());
    }
}

/// yt-dlp fragment files look like `<base>.f<digits>.<ext>`. The check is strict
/// on purpose: a loose match could delete a legitimate file named `My.Film.mp4`.
fn is_fragment_file(lower_name: &str) -> bool {
    let Some((stem, ext)) = lower_name.rsplit_once('.') else {
        return false;
    };
    if !matches!(ext, "mp4" | "webm" | "m4a" | "mp3" | "mkv") {
        return false;
    }
    let Some((_, fragment)) = stem.rsplit_once(".f") else {
        return false;
    };
    !fragment.is_empty() && fragment.chars().all(|c| c.is_ascii_digit())
}
