import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpToLine, CheckCheck, ListVideo, Search } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { AddDownloadInput, DownloadOptions, MediaEntry, MediaInfo } from "@shared/types";
import { useI18n } from "../lib/i18n/LanguageContext";
import { cn, formatDuration, parseRange } from "../lib/utils";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  COMPRESSION_OPTIONS,
  CONTAINERS,
  QUALITY_OPTIONS,
  compressionLabel,
  optionsSummary,
} from "../lib/options";
import { AnimatedDownload } from "./icons/Animated";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Segmented } from "./ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

interface PlaylistModalProps {
  open: boolean;
  media: MediaInfo;
  options: DownloadOptions;
  adding: boolean;
  /** Omitted in Quick mode, where the batch preset comes straight from Settings. */
  onOptionsChange?: (patch: Partial<DownloadOptions>) => void;
  onClose: () => void;
  onQueue: (inputs: AddDownloadInput[], prioritize: boolean) => Promise<void>;
}

export function PlaylistModal({ open, media, options, adding, onOptionsChange, onClose, onQueue }: PlaylistModalProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("");
  const [rangeError, setRangeError] = useState(false);
  const [prioritize, setPrioritize] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set(media.entries.map((entry) => entry.id)));
      setQuery("");
      setRange("");
      setRangeError(false);
      setPrioritize(false);
    }
  }, [open, media]);

  const deferredQuery = useDeferredValue(query);

  const entries = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return media.entries;
    return media.entries.filter(
      (entry) => entry.title.toLowerCase().includes(needle) || (entry.channel ?? "").toLowerCase().includes(needle),
    );
  }, [media.entries, deferredQuery]);

  /* Fixed-height rows → exact virtualisation, even for huge playlists. */
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  const selectedEntries = useMemo(() => media.entries.filter((entry) => selected.has(entry.id)), [media.entries, selected]);

  const toggle = useCallback(
    (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const applyRange = () => {
    const indexes = parseRange(range, media.entries.length);
    if (!indexes.length) {
      setRangeError(true);
      return;
    }
    setRangeError(false);
    setSelected(new Set(indexes.map((index) => media.entries[index].id)));
  };

  const queue = async () => {
    if (!selectedEntries.length || adding) return;
    const inputs: AddDownloadInput[] = selectedEntries.map((entry: MediaEntry) => ({
      url: entry.url,
      title: entry.title,
      thumbnail: entry.thumbnail,
      channel: entry.channel ?? media.channel,
      duration: entry.duration,
      options,
      playlistTitle: media.title,
    }));
    await onQueue(inputs, prioritize);
  };

  const patch = onOptionsChange;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex max-h-[86vh] w-full max-w-[820px] flex-col gap-0 p-0" showClose>
        <header className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-sky-ink/80">
              {t("playlist.eyebrow", { count: media.entries.length })}
            </p>
            <DialogTitle className="mt-1.5 line-clamp-1 font-display text-[19px] font-bold tracking-[-0.02em] text-mist">
              {media.title}
            </DialogTitle>
            <DialogDescription className="sr-only">{t("playlist.choose")}</DialogDescription>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-mute/50" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("playlist.search")}
              aria-label={t("playlist.search")}
              className="h-9 w-full rounded-full bg-fog/[0.05] pl-9 pr-3 text-[11.5px] text-mist/85 outline-none placeholder:text-mute/50 focus:bg-fog/[0.08] focus:ring-1 focus:ring-sky/45"
            />
          </div>
          <div className="flex items-center gap-0.5">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(media.entries.map((entry) => entry.id)))}>
              <CheckCheck className="size-3.5" /> {t("common.all")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("common.none")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set(media.entries.filter((entry) => !selected.has(entry.id)).map((entry) => entry.id)))}
            >
              {t("playlist.invert")}
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={range}
              onChange={(event) => {
                setRange(event.target.value);
                setRangeError(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyRange();
                }
              }}
              placeholder="1-10, 15"
              aria-label={t("playlist.rangeTitle")}
              className={cn(
                "h-9 w-[96px] rounded-full bg-fog/[0.05] px-3 text-[11px] text-mist/85 outline-none placeholder:text-mute/50 focus:bg-fog/[0.08]",
                rangeError ? "ring-1 ring-danger/60" : "focus:ring-1 focus:ring-sky/45",
              )}
              title={t("playlist.rangeTitle")}
            />
            <Button size="sm" variant="secondary" onClick={applyRange}>
              {t("playlist.range")}
            </Button>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3">
          {entries.length === 0 ? (
            <div className="grid place-items-center py-16 text-center text-[12px] text-mute">
              <Search className="mb-2 size-6 text-mute/30" />
              {t("playlist.noMatch", { query })}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const entry = entries[row.index];
                return (
                  <div
                    key={row.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: row.size,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <PlaylistRow
                      entry={entry}
                      checked={selected.has(entry.id)}
                      onToggle={toggle}
                      fallbackChannel={media.channel}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="bg-ink-850 px-6 py-4">
          {patch ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Segmented
                layoutId="batch-kind"
                size="sm"
                value={options.kind}
                options={[
                  { id: "video", label: t("common.video") },
                  { id: "audio", label: t("common.audio") },
                ]}
                onChange={(kind) => patch({ kind })}
              />

              {options.kind === "video" ? (
                <>
                  <Select value={options.quality} onValueChange={(quality) => patch({ quality: quality as DownloadOptions["quality"] })}>
                    <SelectTrigger className="h-9 rounded-xl" aria-label={t("options.resolution")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITY_OPTIONS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.id === "best" ? t("options.best") : item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={options.container} onValueChange={(container) => patch({ container: container as DownloadOptions["container"] })}>
                    <SelectTrigger className="h-9 rounded-xl" aria-label={t("options.container")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTAINERS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={options.compression} onValueChange={(compression) => patch({ compression: compression as DownloadOptions["compression"] })}>
                    <SelectTrigger className="h-9 rounded-xl" aria-label={t("options.compression")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPRESSION_OPTIONS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {compressionLabel(item.id, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <>
                  <Select value={options.audioFormat} onValueChange={(audioFormat) => patch({ audioFormat: audioFormat as DownloadOptions["audioFormat"] })}>
                    <SelectTrigger className="h-9 rounded-xl" aria-label={t("options.audioFormat")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIO_FORMATS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={options.audioQuality} onValueChange={(audioQuality) => patch({ audioQuality: audioQuality as DownloadOptions["audioQuality"] })}>
                    <SelectTrigger className="h-9 rounded-xl" aria-label={t("options.bitrate")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIO_QUALITIES.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          ) : (
            <p className="mb-3 text-[10.5px] text-mute/60">
              {t("playlist.quickPreset", { summary: optionsSummary(options, t) })}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10.5px] text-mute">
              <span className="font-semibold text-mist/85">{selectedEntries.length}</span> / {media.entries.length}
            </p>

            <label className="flex cursor-pointer items-center gap-2" title={t("playlist.prioritizeHint")}>
              <ArrowUpToLine className="size-3.5 text-mute/55" />
              <span className="text-[10px] text-mute/70">{t("playlist.prioritize")}</span>
              <Switch checked={prioritize} onCheckedChange={setPrioritize} aria-label={t("playlist.prioritizeHint")} />
            </label>

            <div className="ml-auto flex items-center gap-2">
              <Button size="md" variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button size="md" loading={adding} disabled={!selectedEntries.length} onClick={() => void queue()}>
                {adding ? null : <AnimatedDownload className="size-4" />}
                {t("playlist.queue")}
              </Button>
            </div>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

const PlaylistRow = memo(function PlaylistRow({
  entry,
  checked,
  onToggle,
  fallbackChannel,
}: {
  entry: MediaEntry;
  checked: boolean;
  onToggle: (id: string) => void;
  fallbackChannel?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onToggle(entry.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(entry.id);
        }
      }}
      className={cn(
        "flex h-full w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky/40",
        checked ? "bg-fog/[0.05]" : "hover:bg-fog/[0.03]",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={() => onToggle(entry.id)} aria-label={entry.title} />
      <span className="w-6 shrink-0 text-right font-mono text-[9.5px] text-mute/40">{entry.index + 1}</span>
      <span className="relative shrink-0 overflow-hidden rounded-xl bg-ink-900">
        {entry.thumbnail ? (
          <img src={entry.thumbnail} alt="" draggable={false} loading="lazy" className="h-[40px] w-[70px] object-cover" />
        ) : (
          <span className="grid h-[40px] w-[70px] place-items-center">
            <ListVideo className="size-4 text-mute/30" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[11.5px] font-medium", checked ? "text-mist/90" : "text-mute")}>{entry.title}</span>
        <span className="mt-0.5 block truncate text-[9.5px] text-mute/50">
          {entry.channel ?? fallbackChannel ?? t("common.unknown")} {entry.duration ? `· ${formatDuration(entry.duration)}` : ""}
        </span>
      </span>
    </div>
  );
});
