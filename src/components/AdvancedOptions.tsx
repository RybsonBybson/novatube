import { AnimatePresence, motion } from "framer-motion";
import { Captions, ImageIcon, ShieldCheck } from "lucide-react";
import type { DownloadOptions, MediaInfo } from "@shared/types";
import { cn } from "../lib/utils";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  COMPRESSION_OPTIONS,
  CONTAINERS,
  QUALITY_OPTIONS,
  SUBTITLE_MODES,
  hasHighFrameRate,
  isQualityAvailable,
  maxQualityLabel,
} from "../lib/options";
import { Check } from "lucide-react";
import { Chip } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { Switch } from "./ui/switch";

interface AdvancedOptionsProps {
  options: DownloadOptions;
  onChange: (patch: Partial<DownloadOptions>) => void;
  media?: MediaInfo | null;
  className?: string;
}

export function AdvancedOptions({ options, onChange, media, className }: AdvancedOptionsProps) {
  const heights = media?.heights ?? [];
  const fpsValues = (media?.formats ?? []).map((format) => format.fps ?? 0);

  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>Format</Label>
        <Segmented
          layoutId="kind-toggle"
          size="sm"
          value={options.kind}
          options={[
            { id: "video", label: "Video" },
            { id: "audio", label: "Audio" },
          ]}
          onChange={(kind) => onChange({ kind })}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {options.kind === "video" ? (
          <motion.div
            key="video"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="space-y-5"
          >
            <div>
              <Label>Resolution</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUALITY_OPTIONS.map((option) => {
                  const available = isQualityAvailable(option.id, heights);
                  const highFps = hasHighFrameRate(heights, fpsValues, option.id);
                  return (
                    <Chip
                      key={option.id}
                      active={options.quality === option.id}
                      disabled={!available}
                      onClick={() => onChange({ quality: option.id })}
                      title={available ? option.label : `Not available (max ${maxQualityLabel(heights)})`}
                    >
                      {option.id === "best" ? "Best" : option.short}
                      {highFps ? (
                        <span className={cn("text-[8.5px]", options.quality === option.id ? "text-on-sky/60" : "text-mute/50")}>60</span>
                      ) : null}
                    </Chip>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>Container</Label>
              <Segmented
                layoutId="container-toggle"
                size="sm"
                value={options.container}
                options={CONTAINERS}
                onChange={(container) => onChange({ container })}
              />
            </div>

            <div>
              <Label>Compression</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {COMPRESSION_OPTIONS.map((preset) => {
                  const active = options.compression === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.description}
                      onClick={() => onChange({ compression: preset.id })}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky/45",
                        active ? "bg-orange/20 text-orange-ink" : "bg-fog/[0.045] text-mute hover:bg-fog/[0.08] hover:text-mist/85",
                      )}
                    >
                      {active ? <Check className="size-3" strokeWidth={3} /> : null}
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="audio"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="space-y-5"
          >
            <div>
              <Label>Audio format</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {AUDIO_FORMATS.map((format) => (
                  <Chip key={format.id} active={options.audioFormat === format.id} onClick={() => onChange({ audioFormat: format.id })}>
                    {format.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div className={cn("transition-opacity", options.audioFormat !== "mp3" && "pointer-events-none opacity-35")}>
              <Label>Bitrate</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {AUDIO_QUALITIES.map((item) => (
                  <Chip key={item.id} active={options.audioQuality === item.id} onClick={() => onChange({ audioQuality: item.id })}>
                    {item.label}
                  </Chip>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
        <label className="flex cursor-pointer items-center gap-2.5">
          <ImageIcon className="size-3.5 text-mute/60" />
          <span className="text-[10.5px] text-mute">Cover art</span>
          <Switch checked={options.embedThumbnail} onCheckedChange={(embedThumbnail) => onChange({ embedThumbnail })} aria-label="Embed cover art" />
        </label>
        <label className="flex cursor-pointer items-center gap-2.5">
          <ShieldCheck className="size-3.5 text-mute/60" />
          <span className="text-[10.5px] text-mute">SponsorBlock</span>
          <Switch checked={options.sponsorBlock} onCheckedChange={(sponsorBlock) => onChange({ sponsorBlock })} aria-label="SponsorBlock" />
        </label>
        <div className={cn("flex items-center gap-2.5 transition-opacity", options.kind === "audio" && "pointer-events-none opacity-35")}>
          <Captions className="size-3.5 text-mute/60" />
          <span className="text-[10.5px] text-mute">Subtitles</span>
          <Segmented layoutId="subtitle-toggle" size="sm" value={options.subtitles} options={SUBTITLE_MODES} onChange={(subtitles) => onChange({ subtitles })} />
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mute/55">{children}</span>;
}
