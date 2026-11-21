import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond?: number, fallback?: string): string {
  if (fallback) return fallback;
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond)) return "—";
  if (bytesPerSecond > 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

/** Relative time in the active language, falling back to compact English. */
export function timeAgo(timestamp?: number, locale?: string): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (!locale) {
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(timestamp);
  }
  let relative: Intl.RelativeTimeFormat;
  try {
    relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    return timeAgo(timestamp);
  }
  if (minutes < 1) return relative.format(0, "minute");
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return relative.format(-days, "day");
  return formatDate(timestamp);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function startCase(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function truncateMiddle(value: string, max = 46): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function parseRange(input: string, max: number): number[] {
  const indexes = new Set<number>();
  for (const part of input.split(/[,;\s]+/)) {
    if (!part) continue;
    const match = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (match) {
      const start = Math.max(1, Math.min(max, Number(match[1])));
      const end = Math.max(1, Math.min(max, Number(match[2])));
      for (let i = Math.min(start, end); i <= Math.max(start, end); i += 1) indexes.add(i - 1);
      continue;
    }
    const single = Number(part);
    if (Number.isInteger(single) && single >= 1 && single <= max) indexes.add(single - 1);
  }
  return [...indexes].sort((a, b) => a - b);
}
