# NovaTube

A minimal desktop media downloader built with **Tauri 2**, React, TypeScript and Tailwind CSS. Downloads are handled by `yt-dlp` and merged/transcoded by `ffmpeg`.

## Features

- Video presets (best → 360p) in MP4/MKV/WEBM, audio in MP3/M4A/WAV/FLAC
- Playlist picker with select all/none/invert and range selection
- Live queue with speed, ETA, progress, pause/resume/cancel/retry
- Optional compression presets, thumbnail embedding, subtitles and SponsorBlock
- Persistent history and settings
- Dark, light and system themes; window size and position are restored

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
