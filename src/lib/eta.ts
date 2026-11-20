import type { DownloadItem } from "@shared/types";

/**
 * Best-effort remaining-time estimate for the whole queue.
 *
 * The queue is a mixed bag: items waiting for a slot, items actively pulling
 * bytes and items being re-encoded by FFmpeg. There is no single true value, so
 * the model is deliberately simple and optimistic where it has to be:
 *
 *  - throughput is the sum of the measured download speeds of active items;
 *  - remaining work is expressed in bytes, derived from the item's own size or,
 *    failing that, from a bitrate typical of the queue;
 *  - encoding items are discounted because FFmpeg runs faster than the network.
 */

/** Throughput assumed for an item that has not reported a size yet (~2.4 Mbps). */
const FALLBACK_BYTES_PER_SECOND = 300 * 1024;
/** Length assumed for an item whose duration is unknown. */
const FALLBACK_DURATION_SECONDS = 300;
/** How much of an encode leg counts against the download throughput. */
const ENCODE_SHARE = 0.35;

const TRANSFERRING = new Set(["fetching", "downloading"]);
const ENCODING = new Set(["processing", "compressing"]);
const RUNNING = new Set([...TRANSFERRING, ...ENCODING]);

export interface QueueEta {
  /** Remaining wall-clock seconds for the whole queue, or null while unknown. */
  seconds: number | null;
  /** True when part of the estimate came from averages rather than real sizes. */
  approximate: boolean;
  /** True when work is queued but no throughput has been measured yet. */
  warmingUp: boolean;
}

/** Total size of an item, using progress to fill in a mid-download estimate. */
function totalBytesOf(item: DownloadItem): number | null {
  if (item.totalBytes && item.totalBytes > 0) return item.totalBytes;
  if (item.fileSize && item.fileSize > 0) return item.fileSize;
  if (item.downloadedBytes && item.downloadedBytes > 0 && item.progress > 1) {
    return item.downloadedBytes / (item.progress / 100);
  }
  return null;
}

/** Median bytes-per-second of the items that know both size and duration. */
function medianBitrate(items: DownloadItem[]): number {
  const rates: number[] = [];
  for (const item of items) {
    const total = totalBytesOf(item);
    if (total && item.duration && item.duration > 0) rates.push(total / item.duration);
  }
  if (!rates.length) return FALLBACK_BYTES_PER_SECOND;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

/** Remaining media seconds of items that are already past the download leg. */
function encodingSeconds(items: DownloadItem[]): number {
  return items
    .filter((item) => ENCODING.has(item.status))
    .reduce((total, item) => total + (item.duration ?? 0) * (1 - item.progress / 100) * ENCODE_SHARE, 0);
}

export function estimateQueueEta(items: DownloadItem[]): QueueEta {
  const running = items.filter((item) => RUNNING.has(item.status));
  const pending = items.filter((item) => item.status === "queued");

  if (!running.length && !pending.length) {
    return { seconds: 0, approximate: false, warmingUp: false };
  }

  const speed = running.reduce((total, item) => total + (item.speedBytes ?? 0), 0);
  const transferring = running.some((item) => TRANSFERRING.has(item.status));
  if (transferring && speed <= 0) {
    // Bytes are moving but the first rate sample has not landed yet.
    return { seconds: null, approximate: true, warmingUp: true };
  }

  if (speed <= 0) {
    // Nothing is transferring. Only compressions can report progress, and
    // anything still queued has no measurable rate yet.
    if (pending.length > 0) return { seconds: null, approximate: true, warmingUp: true };
    const seconds = encodingSeconds(running);
    return { seconds: seconds > 0 ? seconds : null, approximate: true, warmingUp: seconds <= 0 };
  }

  const bitrate = medianBitrate(items);
  let remaining = 0;
  let approximate = false;

  for (const item of running) {
    const total = totalBytesOf(item);
    const share = ENCODING.has(item.status) ? ENCODE_SHARE : 1;
    if (total === null) {
      approximate = true;
      remaining += (item.duration ?? FALLBACK_DURATION_SECONDS) * (1 - item.progress / 100) * bitrate * share;
    } else {
      remaining += total * (1 - item.progress / 100) * share;
    }
  }

  for (const item of pending) {
    const total = totalBytesOf(item);
    if (total === null) {
      approximate = true;
      remaining += (item.duration ?? FALLBACK_DURATION_SECONDS) * bitrate * (1 - item.progress / 100);
    } else {
      remaining += total * (1 - item.progress / 100);
    }
  }

  return { seconds: remaining / speed, approximate, warmingUp: false };
}

/** Compact "1h 24m" / "3m 12s" label. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "Estimating…";
  const total = Math.round(seconds);
  if (total < 5) return "almost done";
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
