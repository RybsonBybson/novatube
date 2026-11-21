import { AnimatePresence, motion } from "framer-motion";
import {
  AudioLines,
  Captions,
  Film,
  ImageIcon,
  Minimize2,
  MonitorPlay,
  Music2,
  Package,
  ShieldCheck,
} from "lucide-react";
import type { DownloadOptions, MediaInfo } from "@shared/types";
import { useI18n } from "../lib/i18n/LanguageContext";
import { cn } from "../lib/utils";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  COMPRESSION_OPTIONS,
  CONTAINERS,
  QUALITY_OPTIONS,
  audioHint,
  compressionDescription,
  compressionLabel,
  containerHint,
  hasHighFrameRate,
  isQualityAvailable,
  maxQualityLabel,
  qualityShort,
  subtitleChoices,
} from "../lib/options";
import { Chip } from "./ui/button";
import { OptionCard, OptionRow } from "./ui/option-row";
import { Segmented } from "./ui/segmented";
import { Switch } from "./ui/switch";

interface AdvancedOptionsProps {
  options: DownloadOptions;
  onChange: (patch: Partial<DownloadOptions>) => void;
  media?: MediaInfo | null;
  className?: string;
}

export function AdvancedOptions({ options, onChange, media, className }: AdvancedOptionsProps) {
  const { t } = useI18n();
  const heights = media?.heights ?? [];
  const fpsValues = (media?.formats ?? []).map((format) => format.fps ?? 0);

  return (
    <OptionCard className={cn(className)}>
      <OptionRow icon={Film} title={t("options.kindTitle")} description={t("options.kindDesc")}>
        <Segmented
          layoutId="kind-toggle"
          size="sm"
          value={options.kind}
          options={[
            { id: "video", label: t("common.video") },
            { id: "audio", label: t("common.audio") },
          ]}
          onChange={(kind) => onChange({ kind })}
        />
      </OptionRow>

      <AnimatePresence mode="wait" initial={false}>
        {options.kind === "video" ? (
          <motion.div
            key="video"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
          >
            <OptionRow icon={MonitorPlay} title={t("options.qualityTitle")} description={t("options.qualityDesc")}>
              <div className="flex flex-wrap justify-end gap-1.5">
                {QUALITY_OPTIONS.map((option) => {
                  const available = isQualityAvailable(option.id, heights);
                  const highFps = hasHighFrameRate(heights, fpsValues, option.id);
                  return (
                    <Chip
                      key={option.id}
                      active={options.quality === option.id}
                      disabled={!available}
                      onClick={() => onChange({ quality: option.id })}
                      title={
                        available
                          ? option.id === "best"
                            ? t("options.best")
                            : option.label
                          : t("options.notAvailable", { quality: maxQualityLabel(heights) })
                      }
                    >
                      {qualityShort(option.id, t)}
                      {highFps ? (
                        <span className={cn("text-[8.5px]", options.quality === option.id ? "text-on-sky/60" : "text-mute/50")}>
                          60
                        </span>
                      ) : null}
                    </Chip>
                  );
                })}
              </div>
            </OptionRow>

            <OptionRow icon={Package} title={t("options.containerTitle")} description={t("options.containerDesc")}>
              <Segmented
                layoutId="container-toggle"
                size="sm"
                value={options.container}
                options={CONTAINERS.map((container) => ({
                  id: container.id,
                  label: container.label,
                  hint: containerHint(container.id, t),
                }))}
                onChange={(container) => onChange({ container })}
              />
            </OptionRow>

            <OptionRow icon={Minimize2} title={t("options.compressionTitle")} description={t("options.compressionDesc")}>
              <div className="flex flex-wrap justify-end gap-1.5">
                {COMPRESSION_OPTIONS.map((preset) => {
                  const active = options.compression === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={compressionDescription(preset.id, t)}
                      onClick={() => onChange({ compression: preset.id })}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky/45",
                        active
                          ? "bg-orange/20 text-orange-ink"
                          : "bg-fog/[0.045] text-mute hover:bg-fog/[0.08] hover:text-mist/85",
                      )}
                    >
                      {compressionLabel(preset.id, t)}
                    </button>
                  );
                })}
              </div>
            </OptionRow>
          </motion.div>
        ) : (
          <motion.div
            key="audio"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
          >
            <OptionRow icon={Music2} title={t("options.audioFormatTitle")} description={t("options.audioFormatDesc")}>
              <div className="flex flex-wrap justify-end gap-1.5">
                {AUDIO_FORMATS.map((format) => (
                  <Chip
                    key={format.id}
                    active={options.audioFormat === format.id}
                    title={audioHint(format.id, t)}
                    onClick={() => onChange({ audioFormat: format.id })}
                  >
                    {format.label}
                  </Chip>
                ))}
              </div>
            </OptionRow>

            <OptionRow icon={AudioLines} title={t("options.bitrateTitle")} description={t("options.bitrateDesc")}>
              <div
                className={cn(
                  "flex flex-wrap justify-end gap-1.5 transition-opacity",
                  options.audioFormat !== "mp3" && "pointer-events-none opacity-35",
                )}
              >
                {AUDIO_QUALITIES.map((item) => (
                  <Chip key={item.id} active={options.audioQuality === item.id} onClick={() => onChange({ audioQuality: item.id })}>
                    {item.label}
                  </Chip>
                ))}
              </div>
            </OptionRow>
          </motion.div>
        )}
      </AnimatePresence>

      <OptionRow icon={ImageIcon} title={t("options.coverArt")} description={t("options.coverArtDesc")}>
        <Switch
          checked={options.embedThumbnail}
          onCheckedChange={(embedThumbnail) => onChange({ embedThumbnail })}
          aria-label={t("options.coverArt")}
        />
      </OptionRow>

      <OptionRow icon={ShieldCheck} title={t("options.sponsorBlock")} description={t("options.sponsorBlockDesc")}>
        <Switch
          checked={options.sponsorBlock}
          onCheckedChange={(sponsorBlock) => onChange({ sponsorBlock })}
          aria-label={t("options.sponsorBlock")}
        />
      </OptionRow>

      <OptionRow
        icon={Captions}
        title={t("options.subtitles")}
        description={t("options.subtitlesDesc")}
        className={cn(options.kind === "audio" && "pointer-events-none opacity-40")}
      >
        <Segmented
          layoutId="subtitle-toggle"
          size="sm"
          value={options.subtitles}
          options={subtitleChoices(t)}
          onChange={(subtitles) => onChange({ subtitles })}
        />
      </OptionRow>
    </OptionCard>
  );
}
