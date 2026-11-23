//! Output protocol shared by every CLI command.
//!
//! `--stream` emits one compact JSON object per line and flushes immediately;
//! `--json` emits a single document at the end; the default mode keeps stdout
//! for results and sends live progress to stderr. Errors always go to stderr,
//! so a consumer can rely on stdout alone.

use std::io::Write;
use std::sync::Mutex;

use serde::Serialize;

use super::args::OutputMode;

#[derive(Debug, Serialize, Clone)]
pub struct ResultItem {
    pub id: String,
    pub index: usize,
    pub title: String,
    /// `completed`, `skipped` or `failed`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
}

impl ResultItem {
    pub fn ok(&self) -> bool {
        self.status == "completed" || self.status == "skipped"
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Emitted when one item starts. `total` is the size of the whole run.
    Start {
        total: usize,
        index: usize,
        id: String,
        title: String,
    },
    Progress {
        id: String,
        index: usize,
        percent: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        speed: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        eta: Option<String>,
        /// `downloading`, `merging` or `compressing`.
        stage: String,
    },
    ItemDone {
        id: String,
        index: usize,
        #[serde(rename = "output_path")]
        output_path: String,
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        file_size: Option<u64>,
        skipped: bool,
    },
    Error {
        id: String,
        index: usize,
        message: String,
    },
    Done {
        results: Vec<ResultItem>,
    },
}

#[derive(Debug, Serialize)]
pub struct DownloadReport {
    pub ok: bool,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub skipped: usize,
    pub output_dir: String,
    pub results: Vec<ResultItem>,
}

pub struct Emitter {
    mode: OutputMode,
    guard: Mutex<()>,
}

impl Emitter {
    pub fn new(mode: OutputMode) -> Self {
        Self {
            mode,
            guard: Mutex::new(()),
        }
    }

    pub fn mode(&self) -> OutputMode {
        self.mode
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.guard.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// A streaming event, written exactly as the protocol describes.
    pub fn event(&self, event: &Event) {
        if self.mode != OutputMode::Stream {
            return;
        }
        self.raw_json_line(event);
    }

    /// Any serializable value as a single NDJSON line. Used by search, where
    /// each entry is its own line rather than a download event.
    pub fn raw_json_line<T: Serialize>(&self, value: &T) {
        let _guard = self.lock();
        let mut stdout = std::io::stdout().lock();
        if serde_json::to_writer(&mut stdout, value).is_ok() {
            let _ = stdout.write_all(b"\n");
            // Python needs every event immediately, not when the process exits.
            let _ = stdout.flush();
        }
    }

    /// Human progress line. Goes to stderr so stdout stays script-friendly.
    pub fn note(&self, line: impl AsRef<str>) {
        if self.mode != OutputMode::Human {
            return;
        }
        let _guard = self.lock();
        let mut stderr = std::io::stderr().lock();
        let _ = writeln!(stderr, "{}", line.as_ref());
        let _ = stderr.flush();
    }

    pub fn error(&self, message: impl AsRef<str>) {
        let _guard = self.lock();
        let mut stderr = std::io::stderr().lock();
        let _ = writeln!(stderr, "error: {}", message.as_ref());
        let _ = stderr.flush();
    }

    /// Single JSON document (also used for `--dry-run`).
    pub fn json<T: Serialize>(&self, value: &T) {
        let _guard = self.lock();
        let mut stdout = std::io::stdout().lock();
        if serde_json::to_writer_pretty(&mut stdout, value).is_ok() {
            let _ = stdout.write_all(b"\n");
            let _ = stdout.flush();
        }
    }

    /// Final summary: a JSON document in `--json` mode, plain text otherwise.
    pub fn finish_downloads(&self, report: &DownloadReport) {
        match self.mode {
            OutputMode::Json => self.json(report),
            OutputMode::Human => {
                let _guard = self.lock();
                let mut stdout = std::io::stdout().lock();
                let _ = writeln!(
                    stdout,
                    "Downloaded {} of {} item(s) — {} skipped, {} failed",
                    report.succeeded + report.skipped,
                    report.total,
                    report.skipped,
                    report.failed
                );
                for result in &report.results {
                    if result.ok() {
                        if let Some(path) = &result.output_path {
                            let _ = writeln!(stdout, "{path}");
                        }
                    }
                }
                let _ = stdout.flush();
            }
            OutputMode::Stream => {
                self.event(&Event::Done {
                    results: report.results.clone(),
                });
            }
        }
    }
}
