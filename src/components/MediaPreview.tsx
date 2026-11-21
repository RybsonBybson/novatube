import { motion } from "framer-motion";
import { Gauge, ListChecks, ListVideo } from "lucide-react";
import type { DownloadOptions, MediaInfo } from "@shared/types";
import { useI18n } from "../lib/i18n/LanguageContext";
import { formatDuration } from "../lib/utils";
import { maxQualityLabel, optionsSummary } from "../lib/options";
import { AdvancedOptions } from "./AdvancedOptions";
import { AnimatedDownload } from "./icons/Animated";
import { Button } from "./ui/button";

interface MediaPreviewProps {
  media: MediaInfo;
  options: DownloadOptions;
  onChange: (patch: Partial<DownloadOptions>) => void;
  onDownload: () => void;
  onOpenPlaylist: () => void;
  adding: boolean;
}

function MediaHeader({ media }: { media: MediaInfo }) {
  const { t } = useI18n();
  const isPlaylist = media.isPlaylist;
  const thumbnail = media.thumbnail ?? media.entries[0]?.thumbnail;
  const quality = media.heights.length ? maxQualityLabel(media.heights, t) : null;
  const meta = [
    media.channel ?? (isPlaylist ? t("media.playlist") : null),
    isPlaylist
      ? t("media.videos", { count: media.playlistCount })
      : media.isLive
        ? t("media.live")
        : media.duration
          ? formatDuration(media.duration)
          : null,
    !isPlaylist && quality ? t("media.max", { quality }) : null,
  ].filter(Boolean) as string[];

  return (
    <div className="grid gap-5 md:grid-cols-[248px_minmax(0,1fr)]">
      <div className="relative overflow-hidden rounded-[20px] bg-ink-900">
        {thumbnail ? (
          <img src={thumbnail} alt="" draggable={false} className="aspect-video h-full w-full object-cover" />
        ) : (
          <div className="grid aspect-video w-full place-items-center">
            <ListVideo className="size-9 text-mute/30" />
          </div>
        )}
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          {media.isLive ? (
            <span className="rounded-full bg-danger px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
              {t("media.live")}
            </span>
          ) : null}
          {isPlaylist ? (
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9.5px] font-semibold text-white/90 backdrop-blur">
              {t("media.videos", { count: media.playlistCount })}
            </span>
          ) : null}
        </div>
        {!media.isLive && media.duration ? (
          <span className="absolute bottom-2.5 right-2.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white/85 backdrop-blur">
            {formatDuration(media.duration)}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col justify-center py-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-mute">
          {meta.map((part, index) => (
            <span key={part} className="flex items-center gap-2">
              {index > 0 ? <span className="size-[3px] rounded-full bg-mute/30" /> : null}
              {part}
            </span>
          ))}
        </p>
        <h2 className="mt-2 line-clamp-2 font-display text-[21px] font-bold leading-snug tracking-[-0.02em] text-mist">{media.title}</h2>
        {media.description ? <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-mute/60">{media.description}</p> : null}
      </div>
    </div>
  );
}

export function MediaPreview({ media, options, onChange, onDownload, onOpenPlaylist, adding }: MediaPreviewProps) {
  const { t } = useI18n();
  const isPlaylist = media.isPlaylist;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="rounded-[22px] border border-fog/[0.08] p-5"
    >
      <MediaHeader media={media} />

      {isPlaylist ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="md" onClick={onOpenPlaylist} className="min-w-[180px]">
            <ListChecks className="size-4" />
            {t("media.choose")}
          </Button>
          <span className="text-[10.5px] text-mute/60">{t("media.batchHint")}</span>
        </div>
      ) : (
        <>
          <div className="mt-6 border-t border-fog/[0.06] pt-6">
            <AdvancedOptions options={options} onChange={onChange} media={media} />
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-[10.5px] text-mute/70">
              <Gauge className="size-3.5 text-sky-ink/70" />
              {optionsSummary(options, t)}
            </div>
            <Button size="md" onClick={onDownload} loading={adding} className="min-w-[168px]">
              {adding ? (
                t("media.adding")
              ) : (
                <>
                  <AnimatedDownload className="size-4" />
                  {t("studio.download")}
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </motion.section>
  );
}
