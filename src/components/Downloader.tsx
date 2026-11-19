import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Gauge, Link2, Settings2, Wand2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, BinariesStatus, DownloadOptions, MediaInfo } from "@shared/types";
import type { DownloadsApi } from "../hooks/useDownloads";
import { api } from "../lib/api";
import { optionsFromSettings, optionsSummary } from "../lib/options";
import { pluralize } from "../lib/utils";
import { extractUrl, isSupportedUrl, normalizeInput } from "../lib/url";
import { useIncremental } from "../hooks/useIncremental";
import { Aurora } from "./Aurora";
import { DownloadCard, MetadataSkeleton, QueueEmpty } from "./DownloadCard";
import { MediaPreview } from "./MediaPreview";
import { PlaylistModal } from "./PlaylistModal";
import { SearchBar } from "./SearchBar";
import { useToast } from "./Toasts";
import { Chip } from "./ui/button";
import { Segmented } from "./ui/segmented";
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

export function Downloader({ active, downloads, settings, binaries, onOpenSettings, onOpenHistory }: DownloaderProps) {
  const [mode, setMode] = useState<Mode>("quick");
  const [url, setUrl] = useState("");
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
      setMedia(null);
      if (next === "advanced" && url.trim() && isSupportedUrl(url)) void process(url, false);
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
  const activeStatuses = new Set(["queued", "fetching", "downloading", "processing", "compressing", "paused"]);
  const activeCount = queue.filter((item) => activeStatuses.has(item.status)).length;
  const runningCount = queue.filter((item) => ["fetching", "downloading", "processing", "compressing"].includes(item.status)).length;
  const doneCount = queue.length - activeCount;

  const filtered = useMemo(() => {
    if (filter === "active") return queue.filter((item) => activeStatuses.has(item.status));
    if (filter === "done") return queue.filter((item) => !activeStatuses.has(item.status));
    return queue;
  }, [filter, queue]);

  /* Only mount a slice of the queue; the rest loads as the user scrolls. */
  const { visible: visibleQueue, hasMore: queueHasMore, sentinelRef: queueSentinel } = useIncremental(filtered, 40, filter);

  const engine = binaries?.ytDlp;
  const engineWarning = engine?.state === "error" || engine?.state === "missing";
  const enginePreparing = engine?.state === "downloading" || engine?.state === "updating";

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
      <Aurora active={active} />

      <AnimatePresence>
        {dragging ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-4 z-40 grid place-items-center rounded-[32px] bg-ink-900/95 backdrop-blur-md"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="nova-gradient grid size-12 place-items-center rounded-[18px] text-on-accent">
                <Link2 className="size-5" />
              </span>
              <p className="font-display text-[15px] font-semibold text-mist">{quick ? "Drop to download" : "Drop to fetch"}</p>
              <p className="text-[11px] text-mute">Video, Shorts, live stream or playlist</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="relative mx-auto w-full max-w-[1020px] px-8 pb-24 pt-14 lg:px-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-ink/80">
              <Zap className="size-3" />
              Media studio
            </p>
            <h1 className="mt-3 font-display text-[40px] font-bold leading-[1.04] tracking-[-0.045em] text-mist sm:text-[46px]">
              Paste it. <span className="nova-text">Keep it.</span>
            </h1>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.06 }}>
            <Segmented
              layoutId="download-mode"
              value={mode}
              options={[
                { id: "quick", label: "Quick" },
                { id: "advanced", label: "Advanced" },
              ]}
              onChange={changeMode}
            />
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08 }} className="mt-9">
          <SearchBar
            value={url}
            onChange={(value) => {
              setUrl(value);
              if (error) setError(null);
            }}
            onSubmit={() => void process(url, quick)}
            onPaste={() => void handlePaste()}
            loading={loadingMeta}
            pasteLoading={pasteLoading}
            actionLabel={quick ? "Download" : "Fetch"}
            idleHint={
              quick ? (
                <span className="inline-flex items-center gap-1.5">
                  <Wand2 className="size-3 text-saffron-ink/70" />
                  One click uses your preset · {optionsSummary(quickOptions)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Settings2 className="size-3 text-mute/50" />
                  Pick the format before downloading
                </span>
              )
            }
          />
        </motion.div>

        {error ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 flex items-start justify-between gap-4 rounded-2xl bg-danger/[0.08] px-4 py-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
              <p className="text-[11px] leading-relaxed text-danger/80">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void process(url, quick)}
              className="shrink-0 text-[10.5px] font-semibold text-danger outline-none hover:underline"
            >
              Retry
            </button>
          </motion.div>
        ) : null}

        {engineWarning ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-warn/10 px-4 py-3"
          >
            <div className="flex items-center gap-2.5 text-[11px] text-warn/85">
              <AlertCircle className="size-4 shrink-0 text-warn" />
              <span>{engine?.message ?? "yt-dlp is not ready yet."}</span>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="shrink-0 text-[10.5px] font-semibold text-warn outline-none hover:underline"
            >
              Settings
            </button>
          </motion.div>
        ) : null}

        {enginePreparing ? (
          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-fog/[0.03] px-4 py-3">
            <Spinner className="size-4 shrink-0 text-saffron-ink" />
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] text-mute/70">
                {engine?.state === "updating" ? "Updating yt-dlp" : "Preparing yt-dlp"} · {engine?.progress ?? 0}%
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-fog/[0.06]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-saffron to-orange"
                  animate={{ width: `${engine?.progress ?? 0}%` }}
                  transition={{ type: "spring", stiffness: 100, damping: 24 }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {!quick ? (
          <div className="mt-7">
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
              ) : (
                <div key="spacer" />
              )}
            </AnimatePresence>
          </div>
        ) : null}

        <section className="mt-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-[16px] font-semibold tracking-[-0.02em] text-mist/90">Queue</h2>
              <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-mute/50">
                <Gauge className="size-3 text-saffron-ink/60" />
                {runningCount > 0
                  ? `${runningCount} downloading · ${queue.length} total`
                  : queue.length
                    ? `${pluralize(queue.length, "item")} · idle`
                    : "Ready when you are"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>
                All <span className="opacity-45">{queue.length}</span>
              </Chip>
              <Chip active={filter === "active"} onClick={() => setFilter("active")}>
                Active <span className="opacity-45">{activeCount}</span>
              </Chip>
              <Chip active={filter === "done"} onClick={() => setFilter("done")}>
                Done <span className="opacity-45">{doneCount}</span>
              </Chip>
              {doneCount > 0 ? (
                <button
                  type="button"
                  onClick={downloads.clearFinished}
                  className="ml-1 rounded-full px-3 py-1.5 text-[10.5px] font-medium text-mute outline-none transition-colors hover:bg-fog/[0.06] hover:text-mist focus-visible:ring-2 focus-visible:ring-saffron/45"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
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
                <div className="rounded-[20px] bg-ink-850/40 px-6 py-10 text-center text-[11px] text-mute/40">Nothing in this filter.</div>
              )
            ) : null}
          </div>
        </section>
      </div>

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
