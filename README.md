# NovaTube

A minimal desktop media downloader built with **Tauri 2**, React, TypeScript and Tailwind CSS. Downloads are handled by `yt-dlp` and merged/transcoded by `ffmpeg`. The same executable also runs headless from a terminal or Python — see [Headless CLI](#headless-cli).

## Features

- Two modes: one-click **Quick** downloads and **Advanced** format picking
- Wide, minimal interface based on the NovaTube palette (Baby Blue Ice accent)
- Video presets (best → 360p) in MP4/MKV/WEBM, audio in MP3/M4A/WAV/FLAC
- Playlist picker with select all/none/invert, range selection and virtualization
- Live queue with speed, ETA, progress, pause/resume/cancel/retry
- Optional compression presets, thumbnail embedding, subtitles and SponsorBlock
- Persistent history and settings
- Dark, light and system themes; window size and position are restored
- Signed automatic updates, applied on launch between downloads
- Headless CLI plus a dependency-free Python wrapper for scripting and servers

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and the Tauri window. Use `npm run dev:web` for the browser-only frontend.

## Build

```bash
npm run dist
```

Installers are written to `src-tauri/target/release/bundle`.

## Headless CLI

The NovaTube executable doubles as a command line tool, so scripts and servers
can download without the window. **Launching it with no arguments opens the
normal desktop app**; any command runs headless, writes results to stdout and
errors to stderr, and exits with a status code.

```bash
novatube download "https://youtu.be/dQw4w9WgXcQ" --name "Never Gonna Give You Up"
novatube info "https://youtu.be/dQw4w9WgXcQ" --json
novatube search "lofi hip hop" --limit 5 --json
```

Progress and human-readable status lines go to **stderr**, so stdout only ever
contains the requested JSON or file paths. That makes the tool safe to pipe.

The command line needs the same engines as the window. Launch NovaTube once so
it can download `yt-dlp`, or point the CLI at existing binaries with the
`NOVATUBE_YTDLP` / `YTDLP_PATH` and `NOVATUBE_FFMPEG` / `FFMPEG_PATH`
environment variables.

### Getting `novatube` on the PATH

The Windows installer asks **“Add NovaTube to the PATH?”** once the files are in
place. Answering *Yes* adds the install folder to your per-user `PATH`, so
`novatube` works in any terminal without a full path. The answer is remembered,
and an automatic update re-applies it silently — the updater runs the installer
with `/P /UPDATE`, where no prompt can be shown, and a fresh install that was
never asked about is left alone.

Uninstalling removes the entry again, while an in-place update keeps it. To do
it by hand, add the install folder (for example
`%LOCALAPPDATA%\NovaTube`) to your user `PATH`, or skip the PATH entirely and
point the Python wrapper at the executable with `NOVATUBE_BIN`.

Settings from the desktop app (`%APPDATA%\com.novatube.app\settings.json` on
Windows) are used as defaults—download folder, quality, compression, subtitles,
SponsorBlock and concurrency—and every CLI flag overrides them.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (all items completed or skipped) |
| `1` | Runtime failure, or a batch where at least one item failed |
| `2` | Usage error (unknown flag, bad value, invalid URL) |

### `download`

```bash
novatube download [URL]... [OPTIONS]
```

| Flag | Description |
| --- | --- |
| `[URL]...`, `--url <URL>` | URLs to download. Repeat `--url` or pass several positionals to batch. |
| `--urls-file <PATH>`, `--file <PATH>` | Read one URL per line (`#` comments and blank lines are ignored). |
| `--name <NAME>` | File name for a single item. The real extension is appended. |
| `--names <LIST>` | Names for several items, mapped by index. Give one name per `--names`, or separate several with commas/semicolons/newlines, or pass a JSON array. Missing entries fall back to the template. |
| `--name-template <TPL>` | Naming template with `{index}`, `{title}`, `{uploader}`, `{id}`, `{ext}`. `{index:03}` zero-pads. Defaults to `{title} [{id}]`. |
| `--format <FORMAT>` | `mp4`, `mkv`, `webm`, `mp3`, `m4a`, `wav`, `flac`. |
| `--quality <Q>` | `best`, `2160p`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `bestaudio`. |
| `--compress <PRESET>` | `none`, `balanced`, `high`, `social` (same presets as the app; MP4/MKV only). |
| `--output-dir <DIR>` | Destination folder. Defaults to the app setting. |
| `--subtitles [manual\|auto]` | Download and embed subtitles; `auto` includes auto-captions. |
| `--sponsorblock` | Remove sponsor segments. |
| `--concurrency <N>` | Parallel downloads, `1`–`16` (default from settings). |
| `--resume` | Skip items whose target file already exists. |
| `--dry-run` | Resolve URLs and print the plan as JSON without downloading. |
| `--json` / `--stream` (`--ndjson`) | Output mode; see below. Cannot be combined. |

Custom names are cleaned for every platform: reserved characters
(`<>:"/\|?*`) become spaces, trailing dots/spaces are removed, Windows device
names such as `CON` are made safe, and the extension is appended to match
`--format`. Duplicate stems get ` (2)`, ` (3)`, … so a playlist can never
overwrite itself.

Playlists download into a subfolder named after the playlist. AV1 downloads
are converted to H.264 automatically, and compression/AV1 conversion is
serialized so a batch never runs several encoders at once.

```bash
# Batch with per-item names (repeat --names, one name each)
novatube download \
  "https://youtu.be/jNQXAC9IVRw" "https://youtu.be/dQw4w9WgXcQ" \
  --names "Zoo Clip" --names "Never Gonna Give You Up" \
  --format mp3 --quality bestaudio --output-dir ./music

# Playlist, numbered files, skip finished items
novatube download "https://www.youtube.com/playlist?list=..." \
  --name-template "{index:03} - {title}" --resume --concurrency 3

# See exactly what would happen
novatube download "https://youtu.be/dQw4w9WgXcQ" --dry-run --quality 720p
```

### `info`

Prints metadata without downloading anything. JSON is the default; `--text`
switches to a short human summary.

```bash
novatube info "https://youtu.be/dQw4w9WgXcQ" --json
novatube info "https://youtu.be/dQw4w9WgXcQ" --text
```

JSON fields: `id`, `title`, `uploader`, `channel`, `duration` (seconds),
`duration_string`, `view_count`, `upload_date`, `thumbnail`, `webpage_url`,
`is_playlist`, `is_live`, `entry_count`, `extractor`, `description`,
`qualities`, `entries` and `entries_truncated`. Playlist entries include
`index`, `id`, `title`, `url`, `duration`, `duration_string`, `uploader` and
`thumbnail`. Use `--all-entries` or `--entries-limit <N>` (default 100).

### `search`

Flat YouTube search through yt-dlp — fast, and no media is touched.

```bash
novatube search "lofi hip hop" --limit 5 --json
```

JSON shape: `{"query": ..., "count": 5, "entries": [...]}`. Each entry is
already filtered to real videos with a usable URL and includes
`duration_string`, `uploader` and `thumbnail`.

### Output modes and the NDJSON protocol

`--json` prints one pretty JSON document when the command finishes.

`--stream` (alias `--ndjson`) prints one compact JSON object per line and
flushes every line immediately — ideal for `subprocess.Popen` or a pipe. For
`download` the events are:

| `type` | Fields |
| --- | --- |
| `start` | `total`, `index`, `id`, `title` |
| `progress` | `id`, `index`, `percent` (0–100), `speed`, `eta`, `stage` (`downloading`, `merging`, `compressing`) |
| `item_done` | `id`, `index`, `output_path`, `title`, `file_size`, `skipped` |
| `error` | `id`, `index`, `message` |
| `done` | `results` (each with `id`, `index`, `title`, `status`, `output_path`, `file_size`) |

Progress events are throttled to about 4 per second. A `done` event is always
the last line, even when some items failed. `search --stream` emits one
`{"type":"entry", ...}` line per result followed by `{"type":"done","count":N}`.

## Python wrapper

`python/novatube_cli.py` is a dependency-free wrapper around the CLI. It uses
`subprocess.run` for `info`/`search` and `subprocess.Popen` to read download
events live.

```python
from novatube_cli import NovatubeCLI

cli = NovatubeCLI()  # honours NOVATUBE_BIN, PATH and local build folders

# Search
for entry in cli.search("lofi hip hop", limit=5):
    print(entry["id"], entry["title"])

# Metadata
info = cli.info("https://youtu.be/dQw4w9WgXcQ")
print(info["title"], info["duration_string"], info["view_count"])

# One download with live progress
report = cli.download(
    "https://youtu.be/jNQXAC9IVRw",
    name="Zoo Clip",
    fmt="mp4",
    quality="720p",
    output_dir="downloads",
    on_event=lambda event: print(event["type"], event.get("percent", "")),
)

# Batch with names mapped by index
report = cli.download(
    ["https://youtu.be/jNQXAC9IVRw", "https://youtu.be/dQw4w9WgXcQ"],
    names=["Zoo Clip", "Never Gonna Give You Up"],
    fmt="mp3",
    quality="bestaudio",
    concurrency=2,
    resume=True,
)
```

`stream_events(...)` returns a generator if you prefer `for event in ...`.
`report` looks like `{"ok": bool, "returncode": int, "results": [...]}`.

Ready-to-run examples:

```bash
python python/example.py search
python python/example.py info
python python/example.py download
python python/example.py batch
```

If the executable is not on `PATH`, point the wrapper at it:

```powershell
$env:NOVATUBE_BIN = "C:\Program Files\NovaTube\novatube.exe"
```

### Notes for cmd.exe and PowerShell

NovaTube is a GUI-subsystem executable, so Windows shells do not always wait
for it the way they wait for `git` or `ffmpeg`. Output is never lost when the
shell gives the process a real handle, which is the case for:

- the Python wrapper (`subprocess.PIPE`) — always synchronous, with exit codes;
- piping in either shell, e.g. `novatube info URL | Out-Host`;
- `cmd.exe` redirection, e.g. `novatube info URL > info.json`.

PowerShell's own `>` operator is the exception: it captures output through an
explicit pipe that it stops reading as soon as the GUI process is launched, so
`novatube info URL > info.json` can produce an empty file. Use `| Out-File
info.json` (which makes PowerShell wait) or run the command through Python
instead. Running interactively without redirection prints to the terminal
normally.

## Engines

- `ffmpeg` ships in `src-tauri/resources/bin` and is bundled as a Tauri resource.
- `yt-dlp` is downloaded to the per-user data directory on first launch and can be updated from Settings.

## Releases & auto-update

Every push builds the Windows installers and publishes a GitHub Release (see `.github/workflows/release.yml`). The app version is stamped as `1.0.<run_number>` so installed copies always see a newer build.

Installed copies check for updates on launch and install them automatically (unless a download is running). Updates are verified with a Tauri signing key.

### Launch check and splash

The window opens on a small branded splash while the first update check runs, so
an update that installs on startup never flashes the interface:

- the splash stays for a moment even when the check returns instantly, so it
  never blinks;
- an available update with **automatic updates** enabled installs behind the
  splash, with the download percentage in the progress bar, and the app
  relaunches into the new version;
- if nothing is found — or the update server cannot be reached — the interface
  appears. The check gets a short ceiling (8 s) and an in-progress install a
  long one (3 min), so neither can ever leave the app hidden;
- the check never interrupts active downloads: if the previous session's queue
  resumed, the app shows up and the update waits, exactly as before.

To enable signed updates, add these repository secrets:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | password for the key (empty if none) |

Without the key the release still builds, but it contains no updater artifacts (`latest.json`), so auto-update stays disabled. The matching public key lives in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
