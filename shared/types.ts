/**
 * Types shared between the Rust backend and the React renderer. Keeping these
 * in one place makes every Tauri command and event fully typed on both sides.
 */

export type ViewId = "downloader" | "history" | "settings";
export type ThemeMode = "system" | "dark" | "light";

export type DownloadKind = "video" | "audio";
export type VideoContainer = "mp4" | "mkv" | "webm";
export type AudioFormat = "mp3" | "m4a" | "wav" | "flac";
export type AudioQuality = "320" | "192" | "128";
export type CompressionPreset = "none" | "balanced" | "high" | "social";
export type SubtitleMode = "off" | "auto" | "manual";
export type QualityId = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";

export type DownloadStatus =
  | "queued"
  | "fetching"
  | "downloading"
  | "processing"
  | "compressing"
  | "completed"
  | "paused"
  | "cancelled"
  | "error";

export interface DownloadOptions {
  kind: DownloadKind;
  container: VideoContainer;
  audioFormat: AudioFormat;
  audioQuality: AudioQuality;
  quality: QualityId;
  compression: CompressionPreset;
  embedThumbnail: boolean;
  subtitles: SubtitleMode;
  sponsorBlock: boolean;
}

export interface MediaEntry {
  id: string;
  url: string;
  title: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  index: number;
}

export interface VideoFormatOption {
  height: number;
  fps?: number;
  ext?: string;
  vcodec?: string;
  filesize?: number;
}

export interface MediaInfo {
  id: string;
  url: string;
  title: string;
  channel?: string;
  channelUrl?: string;
  duration?: number;
  thumbnail?: string;
  description?: string;
  isLive: boolean;
  isPlaylist: boolean;
  playlistCount: number;
  entries: MediaEntry[];
  formats: VideoFormatOption[];
  heights: number[];
  extractor?: string;
  viewCount?: number;
  uploadDate?: string;
}

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  thumbnail?: string;
  channel?: string;
  duration?: number;
  status: DownloadStatus;
  progress: number;
  speed?: string;
  speedBytes?: number;
  eta?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  options: DownloadOptions;
  formatLabel: string;
  outputPath?: string;
  fileSize?: number;
  error?: string;
  notice?: string;
  playlistTitle?: string;
  stageDetail?: string;
  createdAt: number;
  completedAt?: number;
}

export interface AddDownloadInput {
  url: string;
  title?: string;
  thumbnail?: string;
  channel?: string;
  duration?: number;
  options: DownloadOptions;
  playlistTitle?: string;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  thumbnail?: string;
  channel?: string;
  duration?: number;
  options: DownloadOptions;
  formatLabel: string;
  filePath: string;
  fileSize?: number;
  completedAt: number;
  playlistTitle?: string;
}

export interface AppSettings {
  downloadDir: string;
  concurrency: number;
  defaultQuality: QualityId;
  defaultContainer: VideoContainer;
  defaultAudioFormat: AudioFormat;
  defaultAudioQuality: AudioQuality;
  defaultCompression: CompressionPreset;
  defaultKind: DownloadKind;
  sponsorBlock: boolean;
  embedThumbnail: boolean;
  subtitles: SubtitleMode;
  autoUpdateYtDlp: boolean;
  autoUpdate: boolean;
  theme: ThemeMode;
  rememberView: boolean;
  lastView: ViewId;
}

export type BinaryState = "checking" | "missing" | "downloading" | "updating" | "ready" | "error";

export interface BinaryInfo {
  name: "yt-dlp" | "ffmpeg";
  path: string;
  version: string;
  state: BinaryState;
  progress: number;
  message?: string;
}

export interface BinariesStatus {
  ytDlp: BinaryInfo;
  ffmpeg: BinaryInfo;
}

export interface AppInfo {
  version: string;
  platform: string;
  tauri: string;
  downloadDir: string;
}

export type ToastType = "success" | "error" | "info";

export interface ToastEvent {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

export interface NovaApi {
  platform: string;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    onMaximizeChange(cb: (maximized: boolean) => void): () => void;
  };
  metadata: {
    fetch(url: string): Promise<MediaInfo>;
  };
  downloads: {
    list(): Promise<DownloadItem[]>;
    add(input: AddDownloadInput): Promise<DownloadItem>;
    addMany(inputs: AddDownloadInput[]): Promise<DownloadItem[]>;
    pause(id: string): Promise<void>;
    resume(id: string): Promise<void>;
    cancel(id: string): Promise<void>;
    retry(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    clearFinished(): Promise<void>;
    clearAll(): Promise<void>;
    openFile(id: string): Promise<void>;
    openFolder(id: string): Promise<void>;
    onUpdate(cb: (item: DownloadItem) => void): () => void;
    onRemove(cb: (id: string) => void): () => void;
    onSnapshot(cb: (items: DownloadItem[]) => void): () => void;
  };
  history: {
    list(): Promise<HistoryEntry[]>;
    remove(id: string): Promise<HistoryEntry[]>;
    clear(): Promise<HistoryEntry[]>;
    onChange(cb: (entries: HistoryEntry[]) => void): () => void;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    pickFolder(): Promise<string | null>;
  };
  binaries: {
    status(): Promise<BinariesStatus>;
    updateYtDlp(): Promise<BinariesStatus>;
    refresh(): Promise<BinariesStatus>;
    onStatus(cb: (status: BinariesStatus) => void): () => void;
  };
  app: {
    info(): Promise<AppInfo>;
    openPath(path: string): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
  };
  onToast(cb: (toast: ToastEvent) => void): () => void;
}
