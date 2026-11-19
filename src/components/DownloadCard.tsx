import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FolderOpen,
  Info,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { DownloadItem, DownloadStatus } from "@shared/types";
import { cn, formatBytes, formatSpeed } from "../lib/utils";
import { Spinner } from "./icons/Animated";

interface DownloadCardProps {
  item: DownloadItem;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFile: (id: string) => void;
  onOpenFolder: (id: string) => void;
}

const STATUS: Record<DownloadStatus, { label: string; icon: typeof Clock3; text: string; bar: string }> = {
  queued: { label: "Queued", icon: Clock3, text: "text-mute/60", bar: "bg-fog/20" },
  fetching: { label: "Preparing", icon: ArrowDownToLine, text: "text-lime-ink", bar: "bg-gradient-to-r from-lime to-aqua" },
  downloading: { label: "Downloading", icon: ArrowDownToLine, text: "text-lime-ink", bar: "bg-gradient-to-r from-lime to-aqua" },
  processing: { label: "Processing", icon: Layers, text: "text-aqua-ink", bar: "bg-gradient-to-r from-aqua to-peach" },
  compressing: { label: "Compressing", icon: Layers, text: "text-aqua-ink", bar: "bg-gradient-to-r from-aqua to-peach" },
  completed: { label: "Done", icon: CheckCircle2, text: "text-lime-ink/80", bar: "bg-lime/60" },
  paused: { label: "Paused", icon: Pause, text: "text-peach-ink", bar: "bg-peach/60" },
  cancelled: { label: "Cancelled", icon: Ban, text: "text-mute/50", bar: "bg-fog/15" },
  error: { label: "Failed", icon: XCircle, text: "text-danger", bar: "bg-danger/80" },
};

export function DownloadCard({ item, onPause, onResume, onCancel, onRetry, onRemove, onOpenFile, onOpenFolder }: DownloadCardProps) {
  const status = STATUS[item.status];
  const StatusIcon = status.icon;
  const active = ["fetching", "downloading", "processing", "compressing"].includes(item.status);
  const working = ["fetching", "processing", "compressing"].includes(item.status);
  const percent = Math.max(0, Math.min(100, item.progress));
  const showBar =
    ["fetching", "downloading", "processing", "compressing", "paused"].includes(item.status) ||
    (item.status === "queued" && item.progress > 0);
  const sizeText =
    item.status === "completed" && item.fileSize
      ? formatBytes(item.fileSize)
      : item.totalBytes
        ? `${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}`
        : item.downloadedBytes
          ? formatBytes(item.downloadedBytes)
          : null;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -14 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="group relative rounded-[22px] bg-ink-850 px-4 py-3.5 transition-colors hover:bg-ink-800"
    >
      <div className="flex items-start gap-3.5">
        <div className="relative shrink-0 overflow-hidden rounded-xl bg-ink-900">
          {item.thumbnail ? (
            <img src={item.thumbnail} alt="" draggable={false} className="h-[54px] w-[96px] object-cover" />
          ) : (
            <div className="grid h-[54px] w-[96px] place-items-center">
              <StatusIcon className="size-4 text-mute/30" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-1 text-[12.5px] font-semibold tracking-[-0.01em] text-mist/90">{item.title}</h3>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9.5px] text-mute/60">
                {item.channel ? <span className="max-w-[200px] truncate">{item.channel}</span> : null}
                {item.playlistTitle ? (
                  <>
                    <span className="size-[3px] rounded-full bg-mute/30" />
                    <span className="max-w-[180px] truncate">{item.playlistTitle}</span>
                  </>
                ) : null}
                <span className="size-[3px] rounded-full bg-mute/30" />
                <span className="shrink-0">{item.formatLabel}</span>
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {item.status === "downloading" ? (
                <CardAction label="Pause" onClick={() => onPause(item.id)}>
                  <Pause className="size-3.5" />
                </CardAction>
              ) : null}
              {item.status === "paused" ? (
                <CardAction label="Resume" onClick={() => onResume(item.id)}>
                  <Play className="size-3.5" />
                </CardAction>
              ) : null}
              {active || item.status === "paused" ? (
                <CardAction label="Cancel" onClick={() => onCancel(item.id)} tone="danger">
                  <X className="size-3.5" />
                </CardAction>
              ) : null}
              {item.status === "completed" ? (
                <>
                  <CardAction label="Open file" onClick={() => onOpenFile(item.id)} tone="accent">
                    <ExternalLink className="size-3.5" />
                  </CardAction>
                  <CardAction label="Show in folder" onClick={() => onOpenFolder(item.id)}>
                    <FolderOpen className="size-3.5" />
                  </CardAction>
                </>
              ) : null}
              {item.status === "error" || item.status === "cancelled" ? (
                <CardAction label="Retry" onClick={() => onRetry(item.id)} tone="accent">
                  <RotateCcw className="size-3.5" />
                </CardAction>
              ) : null}
              {!active ? (
                <CardAction label="Remove" onClick={() => onRemove(item.id)} tone="danger">
                  <Trash2 className="size-3.5" />
                </CardAction>
              ) : null}
            </div>
          </div>

          {showBar ? (
            <div className="mt-2.5">
              <div className="relative h-[3px] overflow-hidden rounded-full bg-fog/[0.055]">
                <motion.div
                  className={cn("h-full rounded-full", status.bar, active && "shimmer-track")}
                  initial={false}
                  animate={{ width: `${percent}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 24 }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[9.5px]">
                <div className="flex min-w-0 items-center gap-2 text-mute/60">
                  <span className={cn("inline-flex items-center gap-1", status.text)}>
                    {working ? <Spinner className="size-2.5" /> : null}
                    {item.stageDetail ?? (item.status === "completed" ? status.label : status.label)}
                  </span>
                  {item.speed ? (
                    <>
                      <span className="size-[3px] rounded-full bg-mute/25" />
                      <span className="tabular-nums">{formatSpeed(item.speedBytes, item.speed)}</span>
                    </>
                  ) : null}
                  {item.eta && active ? (
                    <>
                      <span className="size-[3px] rounded-full bg-mute/25" />
                      <span className="tabular-nums">{item.eta}</span>
                    </>
                  ) : null}
                  {sizeText ? (
                    <>
                      <span className="size-[3px] rounded-full bg-mute/25" />
                      <span className="tabular-nums">{sizeText}</span>
                    </>
                  ) : null}
                </div>
                <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-mute/50">{Math.round(percent)}%</span>
              </div>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-[9.5px] text-mute/50">
              <span className={status.text}>{item.stageDetail ?? status.label}</span>
              {item.status === "completed" && sizeText ? <span className="tabular-nums text-mute/50">· {sizeText}</span> : null}
            </p>
          )}

          {item.error ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-danger/[0.08] px-2.5 py-2 text-[9.5px] leading-relaxed text-danger/75">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{item.error}</span>
            </div>
          ) : null}
          {item.notice ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-peach/[0.07] px-2.5 py-2 text-[9.5px] leading-relaxed text-peach-ink/70">
              <Info className="mt-0.5 size-3 shrink-0" />
              <span>{item.notice}</span>
            </div>
          ) : null}
        </div>
      </div>
    </motion.article>
  );
}

function CardAction({
  label,
  onClick,
  children,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "default" | "danger" | "accent";
}) {
  return (
    <motion.button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.06 }}
      className={cn(
        "grid size-7 place-items-center rounded-full text-mute/70 transition-colors hover:bg-fog/[0.06] hover:text-mist",
        tone === "danger" && "hover:bg-danger/12 hover:text-danger",
        tone === "accent" && "hover:bg-lime/12 hover:text-lime-ink",
      )}
    >
      {children}
    </motion.button>
  );
}

export function QueueEmpty({ onBrowse }: { onBrowse?: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center rounded-[22px] bg-ink-850 px-6 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-fog/[0.04]">
        <ArrowDownToLine className="size-4 text-mute/50" />
      </div>
      <p className="mt-3 text-[12px] font-medium text-mute">Queue is empty</p>
      <p className="mt-1 max-w-xs text-[10.5px] leading-relaxed text-mute/50">Paste a link above to start. Downloads keep running while you browse.</p>
      {onBrowse ? (
        <button type="button" onClick={onBrowse} className="mt-3 text-[10.5px] font-medium text-lime-ink/80 hover:text-lime-ink">
          Open library
        </button>
      ) : null}
    </motion.div>
  );
}

export function MetadataSkeleton() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="surface overflow-hidden rounded-[32px] p-4 sm:p-6">
      <div className="flex gap-5">
        <div className="shimmer-track aspect-video w-[260px] shrink-0 rounded-[22px] bg-fog/[0.04]" />
        <div className="flex-1 space-y-3 py-2">
          <div className="h-2.5 w-24 rounded-full bg-fog/[0.05]" />
          <div className="h-5 w-4/5 rounded-full bg-fog/[0.07]" />
          <div className="h-5 w-3/5 rounded-full bg-fog/[0.05]" />
          <div className="flex items-center gap-2 pt-2 text-[10.5px] text-mute/60">
            <Spinner className="size-3.5 text-lime-ink" />
            Reading metadata…
          </div>
        </div>
      </div>
    </motion.div>
  );
}
