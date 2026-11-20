import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowDownToLine, ExternalLink, Film, FolderOpen, Music2, Search, Trash2, X } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { HistoryEntry } from "@shared/types";
import type { DownloadsApi } from "../hooks/useDownloads";
import { useIncremental } from "../hooks/useIncremental";
import { api } from "../lib/api";
import { formatBytes, formatDate, pluralize, timeAgo } from "../lib/utils";
import { useToast } from "./Toasts";
import { Spinner } from "./icons/Animated";
import { Button, IconButton } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Segmented } from "./ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface HistoryViewProps {
  entries: HistoryEntry[];
  loaded: boolean;
  onAdd: DownloadsApi["add"];
  onRemove: (id: string) => Promise<unknown>;
  onClear: () => Promise<unknown>;
}

type Filter = "all" | "video" | "audio";
type Sort = "newest" | "oldest" | "largest";

const SORT_LABELS: { id: Sort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "largest", label: "Largest" },
];

function parentDir(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]+$/, "") || filePath;
}

export const HistoryView = memo(function HistoryView({ entries, loaded, onAdd, onRemove, onClear }: HistoryViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = entries.filter((entry) => {
      if (filter !== "all" && entry.options.kind !== filter) return false;
      if (!needle) return true;
      return (
        entry.title.toLowerCase().includes(needle) ||
        (entry.channel ?? "").toLowerCase().includes(needle) ||
        (entry.playlistTitle ?? "").toLowerCase().includes(needle)
      );
    });
    return [...list].sort((a, b) => {
      if (sort === "oldest") return a.completedAt - b.completedAt;
      if (sort === "largest") return (b.fileSize ?? 0) - (a.fileSize ?? 0);
      return b.completedAt - a.completedAt;
    });
  }, [entries, filter, query, sort]);

  /* Mount a slice at a time so a large library never blocks the UI. */
  const { visible, hasMore, sentinelRef } = useIncremental(filtered, 40, `${filter}|${sort}|${query}`);

  const totalSize = entries.reduce((sum, entry) => sum + (entry.fileSize ?? 0), 0);
  const videoCount = entries.filter((entry) => entry.options.kind === "video").length;
  const audioCount = entries.length - videoCount;

  const openFolder = async (entry: HistoryEntry) => {
    try {
      await api.app.openPath(parentDir(entry.filePath));
    } catch (error) {
      toast.push({ type: "error", title: "Could not open folder", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const openFile = async (entry: HistoryEntry) => {
    try {
      await api.app.openPath(entry.filePath);
    } catch (error) {
      toast.push({ type: "error", title: "Could not open file", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const redownload = async (entry: HistoryEntry) => {
    const item = await onAdd({
      url: entry.url,
      title: entry.title,
      thumbnail: entry.thumbnail,
      channel: entry.channel,
      duration: entry.duration,
      options: entry.options,
      playlistTitle: entry.playlistTitle,
    });
    if (item) toast.push({ type: "success", title: "Queued again", message: `${entry.title} · ${entry.formatLabel}` });
  };

  const removeEntry = async (entry: HistoryEntry) => {
    try {
      await onRemove(entry.id);
      toast.push({ type: "info", title: "Removed from library", message: "The file on disk was not deleted." });
    } catch (error) {
      toast.push({ type: "error", title: "Could not remove entry", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const clearAll = async () => {
    try {
      await onClear();
      setConfirmClear(false);
      toast.push({ type: "info", title: "Library cleared", message: "Files stay on disk." });
    } catch (error) {
      toast.push({ type: "error", title: "Could not clear library", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="relative min-h-full">
      <div className="relative pb-12 pt-10">
        <div>
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-mute/60">Collection</p>
          <h1 className="mt-3 font-display text-[40px] font-bold leading-[1.05] tracking-[-0.04em] text-mist">Library</h1>
          <p className="mt-2 text-[10.5px] text-mute/45">
            {pluralize(entries.length, "item")} · {videoCount} video · {audioCount} audio · {formatBytes(totalSize)}
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
            icon={<Search className="size-3.5" />}
            className="h-10 min-w-[220px] flex-1"
          />

          <Segmented
            layoutId="history-filter"
            size="sm"
            value={filter}
            options={[
              { id: "all", label: "All" },
              { id: "video", label: "Video" },
              { id: "audio", label: "Audio" },
            ]}
            onChange={setFilter}
          />

          <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
            <SelectTrigger className="h-9" aria-label="Sort library">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_LABELS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {entries.length > 0 ? (
            <IconButton label="Clear library" tone="danger" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          ) : null}
        </div>

        <div className="mt-5 border-t border-fog/[0.07]">
          <AnimatePresence initial={false}>
            {visible.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} onOpenFile={openFile} onOpenFolder={openFolder} onRedownload={redownload} onRemove={removeEntry} />
            ))}
          </AnimatePresence>
          {hasMore ? <div ref={sentinelRef} className="h-8" aria-hidden /> : null}

          {!filtered.length && loaded ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center rounded-[24px] bg-ink-850/50 px-6 py-16 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-fog/[0.04]">
                <Film className="size-5 text-mute/30" strokeWidth={1.6} />
              </div>
              <p className="mt-4 font-display text-[13px] font-semibold text-mist/60">{entries.length ? "No matches" : "Nothing saved yet"}</p>
              <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-mute/45">
                {entries.length ? "Try a different search or filter." : "Finished downloads show up here automatically."}
              </p>
            </motion.div>
          ) : null}

          {!loaded ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[11px] text-mute/40">
              <Spinner className="size-3.5 text-sky-ink" />
              Loading library
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="max-w-sm p-6" showClose={false}>
          <div className="grid size-10 place-items-center rounded-2xl bg-danger/12">
            <AlertCircle className="size-4.5 text-danger" />
          </div>
          <DialogTitle className="mt-4 font-display text-[16px] font-bold tracking-[-0.02em] text-mist">Clear the library?</DialogTitle>
          <DialogDescription className="mt-1.5 text-[11px] leading-relaxed text-mute/55">
            History entries are removed. Files on disk are untouched.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={() => void clearAll()}>
              Clear
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});

function HistoryRow({
  entry,
  onOpenFile,
  onOpenFolder,
  onRedownload,
  onRemove,
}: {
  entry: HistoryEntry;
  onOpenFile: (entry: HistoryEntry) => void;
  onOpenFolder: (entry: HistoryEntry) => void;
  onRedownload: (entry: HistoryEntry) => void;
  onRemove: (entry: HistoryEntry) => void;
}) {
  const isAudio = entry.options.kind === "audio";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      className="group flex items-center gap-3 border-b border-fog/[0.06] px-2 py-3 transition-colors duration-200 hover:bg-fog/[0.015]"
    >
      <div className="relative h-[46px] w-[82px] shrink-0 overflow-hidden rounded-[9px] bg-ink-850">
        {entry.thumbnail ? (
          <img src={entry.thumbnail} alt="" draggable={false} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center">
            {isAudio ? <Music2 className="size-4 text-mute/25" /> : <Film className="size-4 text-mute/25" />}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[11.5px] font-semibold text-mist/85">{entry.title}</p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-mute/45">
          {entry.channel ? <span className="max-w-[150px] truncate">{entry.channel}</span> : null}
          {entry.channel ? <span className="text-mute/20">·</span> : null}
          <span>{entry.formatLabel}</span>
          <span className="text-mute/20">·</span>
          <span className="tabular-nums">{formatBytes(entry.fileSize)}</span>
          <span className="text-mute/20">·</span>
          <span title={formatDate(entry.completedAt)}>{timeAgo(entry.completedAt)}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
        <IconButton label="Open file" tone="accent" onClick={() => onOpenFile(entry)}>
          <ExternalLink className="size-3.5" />
        </IconButton>
        <IconButton label="Show in folder" onClick={() => onOpenFolder(entry)}>
          <FolderOpen className="size-3.5" />
        </IconButton>
        <IconButton label="Download again" tone="sky" onClick={() => onRedownload(entry)}>
          <ArrowDownToLine className="size-3.5" />
        </IconButton>
        <IconButton label="Remove from library" tone="danger" onClick={() => onRemove(entry)}>
          <X className="size-3.5" />
        </IconButton>
      </div>
    </motion.div>
  );
}
