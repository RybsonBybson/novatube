//! Small shared helpers for the download pipeline.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub fn unique_id(prefix: &str) -> String {
    let stamp = now_ms();
    let tick = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}_{stamp:x}_{tick:x}")
}

pub fn format_bytes(bytes: Option<u64>) -> Option<String> {
    let bytes = bytes?;
    if bytes == 0 {
        return None;
    }
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < units.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    let text = if value >= 100.0 || unit == 0 {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    };
    Some(format!("{text} {}", units[unit]))
}

/// Parse yt-dlp style sizes: `12.34MiB`, `1.2G`, `850KiB`, `12345`.
pub fn parse_bytes(value: &str) -> Option<f64> {
    let trimmed = value.trim().replace(',', "");
    if trimmed.is_empty() {
        return None;
    }
    let split = trimmed
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(trimmed.len());
    let amount: f64 = trimmed[..split].trim().parse().ok()?;
    let unit = trimmed[split..].trim().to_ascii_lowercase();
    let exponent = match unit.as_str() {
        "k" | "kb" | "kib" => 1,
        "m" | "mb" | "mib" => 2,
        "g" | "gb" | "gib" => 3,
        "t" | "tb" | "tib" => 4,
        _ => 0,
    };
    Some(amount * 1024f64.powi(exponent))
}

pub fn eta_from_seconds(seconds: f64) -> Option<String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let total = seconds.round() as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let secs = total % 60;
    if hours > 0 {
        Some(format!("{hours}:{minutes:02}:{secs:02}"))
    } else {
        Some(format!("{minutes:02}:{secs:02}"))
    }
}

/// Windows: spawn without a console window. Every child process (yt-dlp,
/// ffmpeg, taskkill) must use this, otherwise a console flashes on screen for
/// a fraction of a second even in a GUI build.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply the hidden-console flag to a tokio child process command.
pub fn hide_console(command: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Apply the hidden-console flag to a blocking child process command.
pub fn hide_console_std(command: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let mut command = std::process::Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        hide_console_std(&mut command);
        let _ = command.status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// Turn yt-dlp/ffmpeg noise into one actionable sentence.
pub fn friendly_error(raw: &str) -> String {
    let cleaned = raw.replace('\u{1b}', "");
    let lines: Vec<&str> = cleaned
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let joined = lines.join(" ").to_ascii_lowercase();
    let pick = |needle: &str| {
        lines
            .iter()
            .find(|line| line.to_ascii_lowercase().contains(needle))
            .copied()
    };

    let message = if joined.contains("private video") {
        "This video is private and cannot be downloaded."
    } else if joined.contains("sign in to confirm your age") || joined.contains("age-restricted") {
        "This video is age-restricted. Sign-in is required."
    } else if joined.contains("video unavailable")
        || joined.contains("video is unavailable")
        || joined.contains("has been removed")
        || joined.contains("removed by the uploader")
        || joined.contains("account associated with this video has been terminated")
    {
        "This video is unavailable — it may have been removed, made private, or blocked in your region."
    } else if joined.contains("blocked it in your country") || joined.contains("not available in your country") {
        "This video is blocked in your region."
    } else if joined.contains("members-only") || joined.contains("join this channel") {
        "This video is members-only and requires a channel membership."
    } else if joined.contains("no space left") || joined.contains("enospc") {
        "Not enough disk space. Free up space or choose another folder."
    } else if joined.contains("cannot create a file when that file already exists") || joined.contains("already exists") {
        "A file with this name already exists in the destination folder."
    } else if joined.contains("permission denied") || joined.contains("os error 5") {
        "Permission denied. Choose a different download folder."
    } else if joined.contains("http error 403") {
        "Access denied by the server. Try refreshing the media engine."
    } else if joined.contains("http error 429") {
        "YouTube is rate-limiting requests. Wait a minute and retry."
    } else if joined.contains("unable to download webpage")
        || joined.contains("getaddrinfo")
        || joined.contains("timed out")
        || joined.contains("connection reset")
    {
        "Network error. Check your connection and try again."
    } else if joined.contains("http error 404") {
        "The media could not be found (HTTP 404)."
    } else if joined.contains("requested format is not available") || joined.contains("no video formats found") {
        "The requested format is not available for this video."
    } else if joined.contains("unsupported url") {
        "That link is not supported."
    } else if joined.contains("ffmpeg") && joined.contains("not found") {
        "The media converter is missing. Restart NovaTube to restore it."
    } else if joined.contains("cancelled") || joined.contains("interrupted by user") {
        "Download cancelled."
    } else {
        let line = pick("error:")
            .or_else(|| pick("error"))
            .or_else(|| lines.last().copied())
            .unwrap_or("Download failed.");
        return line
            .trim_start_matches("ERROR:")
            .trim()
            .chars()
            .take(400)
            .collect();
    };
    message.to_string()
}

pub fn parse_video_id(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.host_str()?.contains("youtu.be") {
        return parsed
            .path_segments()
            .and_then(|mut segments| segments.next())
            .map(str::to_string);
    }
    if let Some((_, value)) = parsed.query_pairs().find(|(key, _)| key == "v") {
        return Some(value.to_string());
    }
    let path = parsed.path();
    for marker in ["/shorts/", "/live/", "/embed/"] {
        if let Some(rest) = path.split(marker).nth(1) {
            return rest.split('/').next().map(str::to_string);
        }
    }
    None
}

pub fn file_size(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|meta| meta.len())
}

pub fn sanitize_folder(name: &str) -> String {
    let mut cleaned = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            cleaned.push(' ');
        } else {
            cleaned.push(character);
        }
    }
    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

/// Media containers NovaTube can write. Used for naming, resume checks and for
/// stripping a user-supplied extension before yt-dlp appends the real one.
pub const MEDIA_EXTENSIONS: [&str; 7] = ["mp4", "mkv", "webm", "mp3", "m4a", "wav", "flac"];

pub fn is_media_extension(extension: &str) -> bool {
    MEDIA_EXTENSIONS
        .iter()
        .any(|known| known.eq_ignore_ascii_case(extension))
}

/// Strip one trailing media extension (`Song.mp4` → `Song`). Any other
/// extension is kept, because it is part of the title rather than a container.
pub fn strip_media_extension(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((stem, extension)) if is_media_extension(extension) && !stem.is_empty() => stem,
        _ => name,
    }
}

/// Turn arbitrary user input into a safe file name on every platform.
///
/// `yt-dlp` normally does this itself, but custom `--name`/`--names` values are
/// used verbatim in the output template, so they have to be cleaned here:
/// reserved characters become spaces, trailing dots/spaces are removed (Windows
/// cannot create them), reserved device names are suffixed, and the result is
/// capped so a long title cannot exceed path limits.
pub fn sanitize_filename(name: &str) -> String {
    let mut cleaned = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            cleaned.push(' ');
        } else {
            cleaned.push(character);
        }
    }
    let cleaned = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|character: char| character == '.' || character == ' ')
        .to_string();

    let mut cleaned: String = cleaned.chars().take(150).collect();
    if cleaned.is_empty() {
        cleaned = "Untitled".into();
    }

    if is_reserved_windows_name(&cleaned) {
        cleaned.push_str(" (file)");
    }
    cleaned
}

fn is_reserved_windows_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem[3..].chars().all(|character| character.is_ascii_digit()))
}

/// `3661.0` → `1:01:01`, `42.5` → `00:42`. Always at least `m:ss`.
pub fn format_duration(seconds: f64) -> String {
    eta_from_seconds(seconds).unwrap_or_else(|| "0:00".into())
}
