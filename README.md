# NovaTube

A minimal desktop media downloader built with **Tauri 2**, React, TypeScript and Tailwind CSS. Downloads are handled by `yt-dlp` and merged/transcoded by `ffmpeg`.

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

## Engines

- `ffmpeg` ships in `src-tauri/resources/bin` and is bundled as a Tauri resource.
- `yt-dlp` is downloaded to the per-user data directory on first launch and can be updated from Settings.

## Releases & auto-update

Every push builds the Windows installers and publishes a GitHub Release (see `.github/workflows/release.yml`). The app version is stamped as `1.0.<run_number>` so installed copies always see a newer build.

Installed copies check for updates on launch and install them automatically (unless a download is running). Updates are verified with a Tauri signing key.

To enable signed updates, add these repository secrets:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | password for the key (empty if none) |

Without the key the release still builds, but it contains no updater artifacts (`latest.json`), so auto-update stays disabled. The matching public key lives in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
