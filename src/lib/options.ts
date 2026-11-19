import type {
  AppSettings,
  AudioFormat,
  AudioQuality,
  CompressionPreset,
  DownloadOptions,
  QualityId,
  SubtitleMode,
  VideoContainer,
} from "@shared/types";

export interface QualityOption {
  id: QualityId;
  label: string;
  short: string;
  height?: number;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  { id: "best", label: "Best available", short: "Best" },
  { id: "2160", label: "2160p · 4K", short: "4K", height: 2160 },
  { id: "1440", label: "1440p · QHD", short: "1440p", height: 1440 },
  { id: "1080", label: "1080p · Full HD", short: "1080p", height: 1080 },
  { id: "720", label: "720p · HD", short: "720p", height: 720 },
  { id: "480", label: "480p", short: "480p", height: 480 },
  { id: "360", label: "360p", short: "360p", height: 360 },
];

export const CONTAINERS: { id: VideoContainer; label: string; hint: string }[] = [
  { id: "mp4", label: "MP4", hint: "Universal" },
  { id: "mkv", label: "MKV", hint: "All streams" },
  { id: "webm", label: "WEBM", hint: "Open codecs" },
];

export const AUDIO_FORMATS: { id: AudioFormat; label: string; hint: string }[] = [
  { id: "mp3", label: "MP3", hint: "Universal" },
  { id: "m4a", label: "M4A", hint: "AAC" },
  { id: "wav", label: "WAV", hint: "Uncompressed" },
  { id: "flac", label: "FLAC", hint: "Lossless" },
];

export const AUDIO_QUALITIES: { id: AudioQuality; label: string }[] = [
  { id: "320", label: "320 kbps" },
  { id: "192", label: "192 kbps" },
  { id: "128", label: "128 kbps" },
];

export const COMPRESSION_OPTIONS: {
  id: CompressionPreset;
  label: string;
  short: string;
  description: string;
}[] = [
  { id: "none", label: "Original", short: "None", description: "No re-encode · fastest" },
  { id: "balanced", label: "Balanced", short: "Balanced", description: "H.264 · CRF 23" },
  { id: "high", label: "High compression", short: "High", description: "HEVC · CRF 28" },
  { id: "social", label: "Social ready", short: "Social", description: "Compact 720p" },
];

export const SUBTITLE_MODES: { id: SubtitleMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
];

export function maxQualityLabel(heights: number[]): string {
  const max = heights[0];
  if (!max) return "Best";
  if (max >= 4320) return "8K";
  if (max >= 2160) return "4K";
  if (max >= 1440) return "1440p";
  if (max >= 1080) return "1080p";
  if (max >= 720) return "720p";
  return `${max}p`;
}

export function isQualityAvailable(id: QualityId, heights: number[]): boolean {
  if (id === "best") return true;
  if (!heights.length) return true;
  const height = Number(id);
  return heights.some((available) => available >= height);
}

export function hasHighFrameRate(heights: number[], formatFps: number[] = [], id: QualityId): boolean {
  if (id === "best") return formatFps.some((fps) => fps >= 50);
  const height = Number(id);
  return heights.includes(height) && formatFps.some((fps) => fps >= 50);
}

export function optionsFromSettings(settings: AppSettings): DownloadOptions {
  return {
    kind: settings.defaultKind,
    container: settings.defaultContainer,
    audioFormat: settings.defaultAudioFormat,
    audioQuality: settings.defaultAudioQuality,
    quality: settings.defaultQuality,
    compression: settings.defaultCompression,
    embedThumbnail: settings.embedThumbnail,
    subtitles: settings.subtitles,
    sponsorBlock: settings.sponsorBlock,
  };
}

export function optionsSummary(options: DownloadOptions): string {
  if (options.kind === "audio") {
    return `${options.audioFormat.toUpperCase()} ${options.audioFormat === "mp3" ? `${options.audioQuality}kbps` : options.audioFormat === "m4a" ? "AAC" : "Lossless"}`;
  }
  const quality = QUALITY_OPTIONS.find((option) => option.id === options.quality)?.short ?? options.quality;
  const compression = options.compression === "none" ? "" : " · Compressed";
  return `${quality} ${options.container.toUpperCase()}${compression}`;
}
