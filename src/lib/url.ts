export function extractUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[)\],.]+$/, "") : null;
}

export function isSupportedUrl(value: string): boolean {
  const url = extractUrl(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

export function looksLikePlaylist(value: string): boolean {
  const url = extractUrl(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("list")) return true;
    return /\/playlist\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function detectSource(value: string): "youtube" | "short" | "live" | "playlist" | "media" {
  const url = extractUrl(value);
  if (!url) return "media";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be" || host.endsWith("youtube.com")) {
      if (parsed.searchParams.has("list") || parsed.pathname.startsWith("/playlist")) return "playlist";
      if (parsed.pathname.startsWith("/shorts")) return "short";
      if (parsed.pathname.startsWith("/live")) return "live";
      return "youtube";
    }
  } catch {
    /* not a URL */
  }
  return "media";
}

export function normalizeInput(value: string): string {
  return extractUrl(value) ?? value.trim();
}
