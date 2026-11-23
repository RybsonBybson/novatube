//! Command line surface for headless mode.
//!
//! Parsing happens before Tauri is initialized, so `novatube` with no
//! arguments still opens the normal window while every subcommand runs without
//! ever creating a webview.

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

/// How a command reports its result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    /// Human-readable lines. Progress goes to stderr, results to stdout.
    Human,
    /// One JSON document on stdout when the command finishes.
    Json,
    /// NDJSON events, each written and flushed as it happens.
    Stream,
}

impl OutputMode {
    pub fn resolve(json: bool, stream: bool) -> Result<Self, CliError> {
        match (json, stream) {
            (true, true) => Err(CliError::usage("--json and --stream cannot be combined.")),
            (false, true) => Ok(Self::Stream),
            (true, false) => Ok(Self::Json),
            (false, false) => Ok(Self::Human),
        }
    }
}

/// Failure with a process exit code attached: usage mistakes are `2`, runtime
/// failures are `1`, and completed runs return `0` (or `1` when items failed).
#[derive(Debug, Clone)]
pub struct CliError {
    pub message: String,
    pub code: i32,
}

impl CliError {
    pub fn usage(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: 2,
        }
    }

    pub fn runtime(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: 1,
        }
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "novatube",
    version = env!("NOVATUBE_VERSION"),
    about = "NovaTube — headless media downloader",
    long_about = "Run NovaTube from a terminal or from Python. With no arguments the normal \
                  desktop window opens; every subcommand below runs headless and writes to \
                  stdout, so it can be spawned with subprocess.Popen.",
    propagate_version = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Download one or more videos or playlists.
    // Boxed so the whole command enum stays small; clap parses `Box<T>` directly.
    Download(Box<DownloadArgs>),
    /// Inspect video or playlist metadata without downloading.
    Info(InfoArgs),
    /// Search YouTube and return matching entries.
    Search(SearchArgs),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum SubtitlesArg {
    /// Include creator-uploaded subtitles only.
    Manual,
    /// Include automatic captions as well.
    Auto,
}

impl SubtitlesArg {
    pub fn as_setting(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Auto => "auto",
        }
    }
}

#[derive(Debug, Args)]
pub struct DownloadArgs {
    /// URLs to download. Pass several to batch them.
    #[arg(value_name = "URL")]
    pub urls: Vec<String>,

    /// Add one more URL (repeatable).
    #[arg(long = "url", value_name = "URL")]
    pub extra_urls: Vec<String>,

    /// Read URLs from a text file, one per line (alias: --file).
    #[arg(long, alias = "file", value_name = "PATH")]
    pub urls_file: Option<PathBuf>,

    /// File name for a single item; the real extension is appended.
    #[arg(long, value_name = "NAME")]
    pub name: Option<String>,

    /// Names mapped by index. Repeat the flag or separate with commas,
    /// semicolons or newlines. A JSON array is accepted too.
    #[arg(long, value_name = "LIST")]
    pub names: Vec<String>,

    /// Naming template with {index}, {title}, {uploader}, {id}, {ext}.
    #[arg(long, value_name = "TEMPLATE")]
    pub name_template: Option<String>,

    /// Output container or audio format: mp4, mkv, webm, mp3, m4a, wav, flac.
    #[arg(long, value_name = "FORMAT")]
    pub format: Option<String>,

    /// Video quality: best, 2160p, 1440p, 1080p, 720p, 480p, 360p, bestaudio.
    #[arg(long, value_name = "QUALITY")]
    pub quality: Option<String>,

    /// Compression preset: none, balanced, high, social.
    #[arg(long, value_name = "PRESET")]
    pub compress: Option<String>,

    /// Destination folder (defaults to the folder chosen in NovaTube).
    #[arg(long, value_name = "DIR")]
    pub output_dir: Option<PathBuf>,

    /// Download and embed subtitles. Use "auto" to include auto-captions.
    #[arg(
        long,
        value_name = "MODE",
        num_args = 0..=1,
        default_missing_value = "manual",
        value_enum
    )]
    pub subtitles: Option<SubtitlesArg>,

    /// Remove sponsor segments from the downloaded media.
    #[arg(long)]
    pub sponsorblock: bool,

    /// Maximum number of parallel downloads (1–16).
    #[arg(long, value_name = "N")]
    pub concurrency: Option<usize>,

    /// Skip items whose target file already exists.
    #[arg(long)]
    pub resume: bool,

    /// Resolve everything and print the plan without downloading.
    #[arg(long)]
    pub dry_run: bool,

    /// Print one JSON document when the run finishes.
    #[arg(long)]
    pub json: bool,

    /// Stream NDJSON events line by line (alias: --ndjson).
    #[arg(long, alias = "ndjson")]
    pub stream: bool,
}

#[derive(Debug, Args)]
pub struct InfoArgs {
    /// Video or playlist URL.
    #[arg(value_name = "URL")]
    pub url: String,

    /// Accepted for consistency; info is JSON by default.
    #[arg(long)]
    pub json: bool,

    /// Print a short human summary instead of JSON.
    #[arg(long)]
    pub text: bool,

    /// Include every entry of a playlist instead of the first 100.
    #[arg(long)]
    pub all_entries: bool,

    /// Maximum entries included for a playlist (default 100).
    #[arg(long, default_value_t = 100, value_name = "N")]
    pub entries_limit: usize,
}

#[derive(Debug, Args)]
pub struct SearchArgs {
    /// Search terms. Quote them when they contain spaces.
    #[arg(value_name = "QUERY", required = true, num_args = 1..)]
    pub query: Vec<String>,

    /// Maximum number of results (1–50).
    #[arg(long, default_value_t = 5, value_name = "N")]
    pub limit: usize,

    /// Print one JSON document with all entries.
    #[arg(long)]
    pub json: bool,

    /// Stream each entry as its own NDJSON line.
    #[arg(long)]
    pub stream: bool,
}

impl SearchArgs {
    pub fn query_text(&self) -> String {
        self.query.join(" ")
    }

    pub fn mode(&self) -> Result<OutputMode, CliError> {
        if self.json && self.stream {
            return Err(CliError::usage("--json and --stream cannot be combined."));
        }
        Ok(if self.stream {
            OutputMode::Stream
        } else {
            // Search is data-oriented: JSON is the default, --text style output
            // is not exposed because every consumer wants the entries.
            OutputMode::Json
        })
    }
}
