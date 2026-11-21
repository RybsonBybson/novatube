import type { DownloadItem } from "@shared/types";

/**
 * Whole-queue remaining-time model.
 *
 * The queue mixes three kinds of work: items that already know their size,
 * items still waiting for a slot, and items being re-encoded by FFmpeg. The
 * estimate is deliberately conservative — a slightly long ETA is far less
 * annoying than one that promises two minutes and takes an hour.
 *
 *  - Throughput is measured in aggregate and smoothed by `useQueueEta`.
 *  - Missing sizes are reconstructed from the stream duration and a bitrate
 *    table based on the chosen quality. Playlist entries fetched with
 *    `--flat-playlist` often have neither, so conservative defaults kick in.
 *  - Concurrency earns a damped speed-up: extra slots usually add throughput,
 *    but they also share the same connection, so the gain is capped.
 *  - Compression adds real encode time on top of the download leg.
 */

/** Conservative average video bitrates (bits/s) by quality bucket. */
const VIDEO_BITRATE: Record<string, number> = {
  best: 6_000_000,
  "2160": 14_000_000,
  "1440": 8_000_000,
  "1080": 4_500_000,
  "720": 2_500_000,
  "480": 1_200_000,
  "360": 700_000,
};

/** MP3-style audio bitrates (bits/s); lossless formats are estimated higher. */
function audioBitrate(item: DownloadItem): number {
  if (item.options.audioFormat === "mp3") return Number(item.options.audioQuality) * 1000;
  if (item.options.audioFormat === "m4a") return 128_000;
  return 900_000; // wav / flac: close to the source PCM stream
}

/** Assumed clip length when the metadata never told us how long it is. */
const FALLBACK_VIDEO_SECONDS = 600;
const FALLBACK_AUDIO_SECONDS = 240;

/** Encode time as a fraction of the clip length (FFmpeg, typical desktop CPU). */
const COMPRESSION_COST: Record<string, number> = {
  none: 0,
  balanced: 0.55,
  high: 0.85,
  social: 0.4,
};

const TRANSFERRING = new Set(["fetching", "downloading"]);
const ENCODING = new Set(["processing", "compressing"]);
const COUNTED = new Set(["queued", ...TRANSFERRING, ...ENCODING]);

export interface QueueEta {
  /** Remaining wall-clock seconds for the whole queue, or null while unknown. */
  seconds: number | null;
  /** True when part of the estimate came from averages rather than real sizes. */
  approximate: boolean;
  /** True when work is queued but no reliable throughput has been measured yet. */
  warmingUp: boolean;
}

export interface EtaContext {
  /** Smoothed aggregate bytes per second of all active transfers. */
  throughput: number | null;
  /** Download slots configured in Settings (1–5). */
  concurrency: number;
}

/** Bytes this item still has to pull, using progress to fill in the blanks. */
function remainingBytes(item: DownloadItem): { bytes: number; estimated: boolean } {
  const total = item.totalBytes && item.totalBytes > 0 ? item.totalBytes : null;
  if (total) {
    return { bytes: Math.max(0, total * (1 - item.progress / 100)), estimated: false };
  }
  if (item.downloadedBytes && item.downloadedBytes > 0 && item.progress > 1) {
    const full = item.downloadedBytes / (item.progress / 100);
    return { bytes: Math.max(0, full * (1 - item.progress / 100)), estimated: false };
  }
  const duration = item.duration && item.duration > 0 ? item.duration : null;
  const assumedDuration = duration ?? (item.options.kind === "audio" ? FALLBACK_AUDIO_SECONDS : FALLBACK_VIDEO_SECONDS);
  const bitrate = item.options.kind === "audio" ? audioBitrate(item) : (VIDEO_BITRATE[item.options.quality] ?? VIDEO_BITRATE.best);
  return { bytes: (bitrate / 8) * assumedDuration * (1 - item.progress / 100), estimated: true };
}

/** Extra seconds spent re-encoding, which is CPU work rather than download work. */
function encodeSeconds(item: DownloadItem, estimatedDuration: number): number {
  const cost = COMPRESSION_COST[item.options.compression] ?? 0;
  if (!cost) return 0;
  const duration = item.duration && item.duration > 0 ? item.duration : estimatedDuration;
  return duration * (1 - item.progress / 100) * cost;
}

export function estimateQueueEta(items: DownloadItem[], context: EtaContext): QueueEta {
  const active = items.filter((item) => COUNTED.has(item.status));
  if (!active.length) {
    return { seconds: 0, approximate: false, warmingUp: false };
  }

  const transferring = active.filter((item) => TRANSFERRING.has(item.status));
  const pending = active.filter((item) => item.status === "queued");
  const encoding = active.filter((item) => ENCODING.has(item.status));

  if (!transferring.length && !encoding.length && !pending.length) {
    return { seconds: 0, approximate: false, warmingUp: false };
  }

  const slots = Math.max(1, Math.min(5, Math.round(context.concurrency) || 1));
  const measured = context.throughput && context.throughput > 0 ? context.throughput : transferSpeed(transferring);

  if (measured <= 0) {
    if (!pending.length && !encoding.length) {
      return { seconds: 0, approximate: false, warmingUp: false };
    }
    // Nothing has reported a rate yet: a countdown here would be a lie.
    return { seconds: null, approximate: true, warmingUp: true };
  }

  // Extra slots are likely to help, but the same pipe is shared. 45% of the
  // linear gain keeps the estimate honest for both fast and slow connections.
  const effectiveSlots = Math.min(slots, Math.max(1, active.length));
  const perSlot = measured / Math.max(1, transferring.length);
  const throughput = Math.max(measured, perSlot * (1 + 0.45 * (effectiveSlots - 1)));

  let bytes = 0;
  let encode = 0;
  let approximate = false;

  for (const item of active) {
    const { bytes: remaining, estimated } = remainingBytes(item);
    bytes += remaining;
    if (estimated) approximate = true;
    encode += encodeSeconds(item, FALLBACK_VIDEO_SECONDS);
  }

  const downloadSeconds = bytes / throughput;
  // Encodes overlap with downloads, but not completely: count most of it.
  const total = downloadSeconds + encode * 0.6;

  return { seconds: total, approximate, warmingUp: false };
}

function transferSpeed(items: DownloadItem[]): number {
  return items.reduce((sum, item) => sum + (item.speedBytes ?? 0), 0);
}

/** "1h 24m" / "3m 12s" — unit letters are the same in every locale. */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
