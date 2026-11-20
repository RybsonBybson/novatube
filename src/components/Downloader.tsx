import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, ArrowUpRight, ClipboardPaste, Link2, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, BinariesStatus, DownloadOptions, MediaInfo } from "@shared/types";
import type { DownloadsApi } from "../hooks/useDownloads";
import { api } from "../lib/api";
import { optionsFromSettings, optionsSummary } from "../lib/options";
import { cn, pluralize } from "../lib/utils";
import { extractUrl, isSupportedUrl, normalizeInput } from "../lib/url";
import { useIncremental } from "../hooks/useIncremental";
import { DownloadCard, MetadataSkeleton, QueueEmpty } from "./DownloadCard";
import { MediaPreview } from "./MediaPreview";
import { PlaylistModal } from "./PlaylistModal";
import { useToast } from "./Toasts";
import { Spinner } from "./icons/Animated";

const FALLBACK_OPTIONS: DownloadOptions = {
  kind: "video",
  container: "mp4",
  audioFormat: "mp3",
  audioQuality: "320",
  quality: "1080",
  compression: "none",
  embedThumbnail: true,
  subtitles: "off",
  sponsorBlock: false,
};

type Mode = "quick" | "advanced";
type QueueFilter = "all" | "active" | "done";

interface DownloaderProps {
  active: boolean;
  downloads: DownloadsApi;
  settings: AppSettings | null;
  binaries: BinariesStatus | null;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

export function Downloader({ downloads, settings, binaries, onOpenSettings, onOpenHistory }: DownloaderProps) {
  const [mode, setMode] = useState<Mode>("quick");
  const [url, setUrl] = useState("");
  const [focused, setFocused] = useState(false);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [options, setOptions] = useState<DownloadOptions>(FALLBACK_OPTIONS);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pasteLoading, setPasteLoading] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [dragging, setDragging] = useState(false);
  const toast = useToast();
  const hydrated = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (settings && !hydrated.current) {
      setOptions(optionsFromSettings(settings));
      hydrated.current = true;
    }
  }, [settings]);

  /** Preset used by one-click downloads — straight from Settings. */
  const quickOptions = useMemo<DownloadOptions>(
    () => (settings ? optionsFromSettings(settings) : FALLBACK_OPTIONS),
    [settings],
  );

  const process = useCallback(
    async (input: string, quick: boolean) => {
      const normalized = normalizeInput(input);
      if (!isSupportedUrl(normalized)) {
        toast.push({
          type: "error",
          title: "Unsupported link",
          message: "Paste a valid http(s) media URL — YouTube, Shorts, live or playlist.",
        });
        return;
      }

      setError(null);
      setLoadingMeta(true);
      try {
        const info = await api.metadata.fetch(normalized);

        if (info.isPlaylist) {
          setMedia(info);
          setPlaylistOpen(true);
          return;
        }

        if (quick) {
          const item = await downloads.add({
            url: info.url,
            title: info.title,
            thumbnail: info.thumbnail,
            channel: info.channel,
            duration: info.duration,
            options: quickOptions,
          });
          if (item) {
            setUrl("");
            toast.push({ type: "success", title: "Queued", message: `${info.title} · ${item.formatLabel}` });
          }
          return;
        }

        setMedia(info);
        setOptions((current) => {
          if (!info.heights.length) return current;
          const available = current.quality === "best" || info.heights.some((height) => height >= Number(current.quality));
          return available ? current : { ...current, quality: "best" };
        });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        toast.push({ type: "error", title: "Could not read that link", message });
      } finally {
        setLoadingMeta(false);
      }
    },
    [downloads, quickOptions, toast],
  );

  const handlePaste = useCallback(async () => {
    setPasteLoading(true);
    try {
      const text = await api.clipboard.readText();
      const found = extractUrl(text);
      if (!found) {
        toast.push({ type: "error", title: "Clipboard is empty", message: "Copy a video or playlist link and try again." });
        return;
      }
      setUrl(found);
      await process(found, mode === "quick");
    } catch (reason) {
      toast.push({ type: "error", title: "Clipboard unavailable", message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setPasteLoading(false);
    }
  }, [mode, process, toast]);

  const changeMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      setMode(next);
      setError(null);
      if (next === "quick") {
        setMedia(null);
      } else if (url.trim() && isSupportedUrl(url)) {
        void process(url, false);
      }
      window.setTimeout(() => inputRef.current?.focus(), 30);
    },
    [mode, process, url],
  );

  const handleDownload = useCallback(async () => {
    if (!media) return;
    setAdding(true);
    const item = await downloads.add({
      url: media.url,
      title: media.title,
      thumbnail: media.thumbnail,
      channel: media.channel,
      duration: media.duration,
      options,
    });
    setAdding(false);
    if (item) {
      toast.push({ type: "success", title: "Queued", message: `${media.title} · ${item.formatLabel}` });
    }
  }, [downloads, media, options, toast]);

  const handleQueuePlaylist = useCallback(
    async (inputs: Parameters<DownloadsApi["addMany"]>[0]) => {
      setAdding(true);
      const queued = await downloads.addMany(inputs);
      setAdding(false);
      if (queued?.length) {
        setPlaylistOpen(false);
        setUrl("");
        toast.push({ type: "success", title: `${queued.length} videos queued`, message: "They will download in parallel." });
      }
    },
    [downloads, toast],
  );

  const patchOptions = useCallback((patch: Partial<DownloadOptions>) => {
    setOptions((current) => ({ ...current, ...patch }));
  }, []);

  const quick = mode === "quick";
  const queue = downloads.items;
  const activeStatuses = useMemo(
    () => new Set(["queued", "fetching", "downloading", "processing", "compressing", "paused"]),
    [],
  );
  const activeCount = queue.filter((item) => activeStatuses.has(item.status)).length;
  const runningCount = queue.filter((item) => ["fetching", "downloading", "processing", "compressing"].includes(item.status)).length;
  const doneCount = queue.length - activeCount;

  const filtered = useMemo(() => {
    if (filter === "active") return queue.filter((item) => activeStatuses.has(item.status));
    if (filter === "done") return queue.filter((item) => !activeStatuses.has(item.status));
    return queue;
  }, [filter, queue, activeStatuses]);

  /* Only mount a slice of the queue; the rest loads as the user scrolls. */
  const { visible: visibleQueue, hasMore: queueHasMore, sentinelRef: queueSentinel } = useIncremental(filtered, 40, filter);

  const engine = binaries?.ytDlp;
  const engineWarning = engine?.state === "error" || engine?.state === "missing";
  const enginePreparing = engine?.state === "downloading" || engine?.state === "updating";

  /* Bring the fetched details into view when Advanced mode resolves. */
  useEffect(() => {
    if (!quick && media) {
      window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
  }, [quick, media]);

  return (
    <div
      className="relative min-h-full"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const raw = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
        const found = extractUrl(raw);
        if (!found) {
          toast.push({ type: "error", title: "Not a link", message: "Drop a video, Shorts, live or playlist URL." });
          return;
        }
        setUrl(found);
        void process(found, mode === "quick");
      }}
    >
      <AnimatePresence>
        {dragging ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-4 z-40 grid place-items-center rounded-[24px] border border-dashed border-sky/40 bg-ink-950/94 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <Link2 className="size-6 text-sky-ink" />
              <p className="font-display text-[14px] font-semibold text-mist">{quick ? "Drop to download" : "Drop to fetch"}</p>
              <p className="text-[10.5px] text-mute/55">Video, Shorts, live or playlist</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16 lg:py-14">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-mute/60">Media downloader</p>
          <h1 className="mt-5 font-display text-[50px] font-bold leading-[1.02] tracking-[-0.045em] text-mist sm:text-[58px]">
            Paste it.
            <br />
            <span className="text-sky-ink">Keep it.</span>
          </h1>
          <p className="mt-6 max-w-[360px] text-[12.5px] leading-relaxed text-mute/65">
            Drop a YouTube link and NovaTube saves the video or audio straight to your folder — no ads, no clutter.
          </p>
          <p className="mt-5 flex items-center gap-2 text-[10px] text-mute/45">
            <span className="size-1.5 rounded-full bg-sky" />
            {quick ? `Quick preset · ${optionsSummary(quickOptions)}` : "Advanced · pick the format before downloading"}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: "easeOut" }}
          className="space-y-2.5"
        >
          <div
            className={cn(
              "rounded-[22px] bg-sky p-2 text-on-sky transition-shadow duration-300",
              focused && "shadow-[0_0_0_3px_rgba(158,189,255,0.22),0_28px_80px_-50px_rgba(158,189,255,0.8)]",
            )}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (isSupportedUrl(url) && !loadingMeta) void process(url, quick);
              }}
            >
              <div className="flex items-center gap-2">
                <Link2 className="ml-3 size-4 shrink-0 opacity-45" />
                <input
                  id="nova-url-input"
                  ref={inputRef}
                  spellCheck={false}
                  autoComplete="off"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    if (error) setError(null);
                  }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="Paste a link"
                  aria-label="Media URL"
                  className="h-12 min-w-0 flex-1 border-0 bg-transparent text-[14px] font-medium tracking-[-0.01em] text-on-sky outline-none placeholder:text-on-sky/45"
                />

                {url ? (
                  <button
                    type="button"
                    onClick={() => {
                      setUrl("");
                      inputRef.current?.focus();
                    }}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-on-sky/50 outline-none transition-colors hover:bg-on-sky/10 hover:text-on-sky"
                    aria-label="Clear URL"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handlePaste()}
                  disabled={pasteLoading}
                  title="Paste from clipboard"
                  aria-label="Paste from clipboard"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-on-sky/55 outline-none transition-colors hover:bg-on-sky/10 hover:text-on-sky"
                >
                  {pasteLoading ? <Spinner className="size-4" /> : <ClipboardPaste className="size-[16px]" />}
                </button>

                <button
                  type="submit"
                  disabled={!isSupportedUrl(url) || loadingMeta}
                  aria-label={quick ? "Download" : "Fetch details"}
                  className="grid size-11 shrink-0 place-items-center rounded-[15px] bg-on-sky text-sky outline-none transition-opacity hover:opacity-90 disabled:opacity-35"
                >
                  {loadingMeta ? <Spinner className="size-4" /> : <ArrowRight className="size-4" />}
                </button>
              </div>
            </form>

            <div className="flex items-center justify-between px-3 pb-0.5 pt-0.5 text-[9.5px] text-on-sky/55">
              <span>{quick ? "One click · no extra choices" : "Fetches details first"}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => changeMode("quick")}
                  className={cn("rounded-full px-2 py-0.5 outline-none transition-colors", quick ? "font-semibold text-on-sky" : "hover:text-on-sky/80")}
                >
                  Quick
                </button>
                <span className="opacity-30">/</span>
                <button
                  type="button"
                  onClick={() => changeMode("advanced")}
                  className={cn("rounded-full px-2 py-0.5 outline-none transition-colors", !quick ? "font-semibold text-on-sky" : "hover:text-on-sky/80")}
                >
                  Advanced
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => changeMode(quick ? "advanced" : "quick")}
            className="group flex w-full items-center gap-4 rounded-[22px] border border-fog/[0.1] px-5 py-3.5 text-left outline-none transition-colors hover:border-fog/[0.16] hover:bg-fog/[0.02] focus-visible:ring-2 focus-visible:ring-sky/45"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-fog/[0.1] text-mute/70">
              <Settings2 className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-mist/90">{quick ? "Advanced download" : "Back to quick"}</span>
              <span className="mt-0.5 block text-[10px] text-mute/50">
                {quick ? "Pick format, quality and extras" : "Use your saved one-click preset"}
              </span>
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-mute/45 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </button>

          {error ? (
            <div className="flex items-start justify-between gap-3 rounded-[16px] border border-danger/20 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <p className="text-[10.5px] leading-relaxed text-danger/80">{error}</p>
              </div>
              <button type="button" onClick={() => void process(url, quick)} className="shrink-0 text-[10px] font-semibold text-danger outline-none hover:underline">
                Retry
              </button>
            </div>
          ) : null}

          {engineWarning ? (
            <div className="flex items-center justify-between gap-3 rounded-[16px] border border-warn/20 px-4 py-3">
              <div className="flex items-center gap-2 text-[10.5px] text-warn/85">
                <AlertCircle className="size-3.5 shrink-0 text-warn" />
                <span>{engine?.message ?? "yt-dlp is not ready yet."}</span>
              </div>
              <button type="button" onClick={onOpenSettings} className="shrink-0 text-[10px] font-semibold text-warn outline-none hover:underline">
                Settings
              </button>
            </div>
          ) : null}

          {enginePreparing ? (
            <div className="flex items-center gap-3 rounded-[16px] border border-fog/[0.08] px-4 py-3">
              <Spinner className="size-3.5 shrink-0 text-sky-ink" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-mute/65">
                  {engine?.state === "updating" ? "Updating yt-dlp" : "Preparing yt-dlp"} · {engine?.progress ?? 0}%
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-fog/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-sky"
                    animate={{ width: `${engine?.progress ?? 0}%` }}
                    transition={{ type: "spring", stiffness: 100, damping: 24 }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </motion.div>
      </div>

      {!quick && (media || loadingMeta) ? (
        <div ref={previewRef} className="pb-10">
          <AnimatePresence mode="wait">
            {loadingMeta ? (
              <div key="skeleton">
                <MetadataSkeleton />
              </div>
            ) : media ? (
              <div key={`media-${media.id}`}>
                <MediaPreview
                  media={media}
                  options={options}
                  onChange={patchOptions}
                  onDownload={() => void handleDownload()}
                  onOpenPlaylist={() => setPlaylistOpen(true)}
                  adding={adding}
                />
              </div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      <section className="border-t border-fog/[0.07] py-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[9.5px] font-semibold uppercase tracking-[0.24em] text-mute/60">Downloads</h2>
            <p className="text-[10px] text-mute/40">
              {runningCount > 0
                ? `${runningCount} running · ${queue.length} total`
                : queue.length
                  ? `${pluralize(queue.length, "item")}`
                  : "Ready"}
            </p>
          </div>

          <div className="flex items-center gap-3 text-[10px]">
            {(
              [
                ["all", "All", queue.length],
                ["active", "Active", activeCount],
                ["done", "Done", doneCount],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn("outline-none transition-colors", filter === id ? "font-semibold text-mist" : "text-mute/45 hover:text-mist/75")}
              >
                {label} <span className="opacity-50">{count}</span>
              </button>
            ))}
            {doneCount > 0 ? (
              <button
                type="button"
                onClick={downloads.clearFinished}
                className="ml-1 text-mute/45 outline-none transition-colors hover:text-mist/80"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-2">
          <AnimatePresence initial={false}>
            {visibleQueue.map((item) => (
              <DownloadCard
                key={item.id}
                item={item}
                onPause={downloads.pause}
                onResume={downloads.resume}
                onCancel={downloads.cancel}
                onRetry={downloads.retry}
                onRemove={downloads.remove}
                onOpenFile={downloads.openFile}
                onOpenFolder={downloads.openFolder}
              />
            ))}
          </AnimatePresence>
          {queueHasMore ? <div ref={queueSentinel} className="h-8" aria-hidden /> : null}
          {!filtered.length && downloads.loaded ? (
            filter === "all" ? (
              <QueueEmpty onBrowse={onOpenHistory} />
            ) : (
              <p className="py-10 text-center text-[10.5px] text-mute/35">Nothing in this filter.</p>
            )
          ) : null}
        </div>
      </section>

      {media ? (
        <PlaylistModal
          open={playlistOpen}
          media={media}
          options={quick ? quickOptions : options}
          adding={adding}
          onOptionsChange={quick ? undefined : patchOptions}
          onClose={() => setPlaylistOpen(false)}
          onQueue={handleQueuePlaylist}
        />
      ) : null}
    </div>
  );
}
