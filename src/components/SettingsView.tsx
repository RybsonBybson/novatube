import { motion } from "framer-motion";
import {
  ChevronDown,
  DownloadCloud,
  FolderDown,
  FolderOpen,
  Gauge,
  History,
  Languages,
  MonitorPlay,
  Music2,
  Palette,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AppInfo, AppSettings, BinariesStatus, DownloadOptions } from "@shared/types";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n/LanguageContext";
import type { UpdateInfo } from "../lib/updater";
import { cn, truncateMiddle } from "../lib/utils";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  COMPRESSION_OPTIONS,
  CONTAINERS,
  QUALITY_OPTIONS,
  compressionLabel,
  optionsFromSettings,
  optionsSummary,
  qualityShort,
  subtitleChoices,
} from "../lib/options";
import { LanguageMenu } from "./LanguageMenu";
import { useToast } from "./Toasts";
import { Button, Chip, IconButton } from "./ui/button";
import { OptionRow } from "./ui/option-row";
import { Segmented } from "./ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";
import { Spinner } from "./icons/Animated";

interface SettingsViewProps {
  settings: AppSettings | null;
  settingsError: string | null;
  onUpdate: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  binaries: BinariesStatus | null;
  onUpdateYtDlp: () => Promise<BinariesStatus>;
  onRefreshBinaries: () => Promise<BinariesStatus>;
  appInfo: AppInfo | null;
  updateAvailable: UpdateInfo | null;
  updateChecking: boolean;
  updateInstalling: boolean;
  updateProgress: number | null;
  updateError: string | null;
  onCheckUpdates: () => Promise<UpdateInfo | null>;
  onInstallUpdate: () => Promise<void>;
}

export function SettingsView({
  settings,
  settingsError,
  onUpdate,
  binaries,
  onUpdateYtDlp,
  onRefreshBinaries,
  appInfo,
  updateAvailable,
  updateChecking,
  updateInstalling,
  updateProgress,
  updateError,
  onCheckUpdates,
  onInstallUpdate,
}: SettingsViewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);
  // The slider tracks a local value while the user drags, so the thumb and the
  // readout stay buttery smooth even though saving to disk is an async round
  // trip. The value is persisted once, when the drag ends.
  const [concurrency, setConcurrency] = useState(settings?.concurrency ?? 3);

  useEffect(() => {
    if (settings) setConcurrency(settings.concurrency);
  }, [settings?.concurrency]);

  const save = async (patch: Partial<AppSettings>, successMessage?: string) => {
    try {
      await onUpdate(patch);
      if (successMessage) toast.push({ type: "success", title: t("common.saved"), message: successMessage });
    } catch (error) {
      toast.push({
        type: "error",
        title: t("settings.saveFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const pickFolder = async () => {
    try {
      const folder = await api.settings.pickFolder();
      if (folder) await save({ downloadDir: folder }, folder);
    } catch (error) {
      toast.push({
        type: "error",
        title: t("settings.folderFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const openFolder = async () => {
    try {
      await api.app.openPath(settings?.downloadDir ?? "");
    } catch (error) {
      toast.push({
        type: "error",
        title: t("settings.openFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const updateYtDlp = async () => {
    try {
      await onUpdateYtDlp();
      toast.push({ type: "success", title: t("settings.engineUpdated"), message: t("settings.engineUpdatedMessage") });
    } catch (error) {
      toast.push({
        type: "error",
        title: t("settings.updateFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const refresh = async () => {
    try {
      const next = await onRefreshBinaries();
      const ready = next.ytDlp.state === "ready";
      toast.push({
        type: ready ? "success" : "error",
        title: ready ? t("settings.allReady") : t("settings.engineAttention"),
        message: ready ? t("settings.allReadyMessage") : (next.ytDlp.message ?? t("settings.engineAttentionMessage")),
      });
    } catch (error) {
      toast.push({
        type: "error",
        title: t("settings.engineCheckFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const busy = binaries?.ytDlp.state === "downloading" || binaries?.ytDlp.state === "updating";
  const preset: DownloadOptions | null = settings ? optionsFromSettings(settings) : null;

  return (
    <div className="relative min-h-full pb-12 pt-10">
      <header>
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-mute/60">{t("settings.eyebrow")}</p>
        <h1 className="mt-3 font-display text-[40px] font-bold leading-[1.05] tracking-[-0.04em] text-mist">{t("settings.title")}</h1>
        <p className="mt-2 max-w-md text-[11px] leading-relaxed text-mute/50">{t("settings.subtitle")}</p>
      </header>

      {settingsError ? (
        <div className="mt-6 rounded-[14px] border border-danger/20 px-4 py-3 text-[10.5px] text-danger/80">{settingsError}</div>
      ) : null}

      {!settings ? (
        <div className="mt-12 flex items-center gap-2 text-[11px] text-mute/40">
          <Spinner className="size-4 text-sky-ink" />
          {t("settings.loading")}
        </div>
      ) : (
        <>
          <div className="mt-10 grid items-start gap-x-14 gap-y-8 lg:grid-cols-2">
            <Section icon={Zap} title={t("settings.quick")} hint={t("settings.quickHint")}>
              <OptionRow icon={MonitorPlay} title={t("settings.mode")}>
                <Segmented
                  layoutId="default-kind"
                  size="sm"
                  value={settings.defaultKind}
                  options={[
                    { id: "video", label: t("common.video") },
                    { id: "audio", label: t("common.audio") },
                  ]}
                  onChange={(defaultKind) => void save({ defaultKind })}
                />
              </OptionRow>

              {settings.defaultKind === "video" ? (
                <>
                  <OptionRow icon={MonitorPlay} title={t("options.qualityTitle")} description={t("options.qualityDesc")}>
                    <div className="flex flex-wrap justify-end gap-1">
                      {QUALITY_OPTIONS.map((option) => (
                        <Chip
                          key={option.id}
                          active={settings.defaultQuality === option.id}
                          onClick={() => void save({ defaultQuality: option.id })}
                          title={option.id === "best" ? t("options.best") : option.label}
                        >
                          {qualityShort(option.id, t)}
                        </Chip>
                      ))}
                    </div>
                  </OptionRow>
                  <OptionRow icon={FolderDown} title={t("options.containerTitle")} description={t("options.containerDesc")}>
                    <Segmented
                      layoutId="default-container"
                      size="sm"
                      value={settings.defaultContainer}
                      options={CONTAINERS}
                      onChange={(defaultContainer) => void save({ defaultContainer })}
                    />
                  </OptionRow>
                </>
              ) : (
                <>
                  <OptionRow icon={Music2} title={t("options.audioFormatTitle")} description={t("options.audioFormatDesc")}>
                    <div className="flex flex-wrap justify-end gap-1">
                      {AUDIO_FORMATS.map((format) => (
                        <Chip
                          key={format.id}
                          active={settings.defaultAudioFormat === format.id}
                          onClick={() => void save({ defaultAudioFormat: format.id })}
                        >
                          {format.label}
                        </Chip>
                      ))}
                    </div>
                  </OptionRow>
                  <OptionRow icon={Gauge} title={t("settings.mp3bitrate")}>
                    <div
                      className={cn(
                        "flex flex-wrap justify-end gap-1",
                        settings.defaultAudioFormat !== "mp3" && "pointer-events-none opacity-35",
                      )}
                    >
                      {AUDIO_QUALITIES.map((quality) => (
                        <Chip
                          key={quality.id}
                          active={settings.defaultAudioQuality === quality.id}
                          onClick={() => void save({ defaultAudioQuality: quality.id })}
                        >
                          {quality.label}
                        </Chip>
                      ))}
                    </div>
                  </OptionRow>
                </>
              )}

              {preset ? (
                <p className="py-3 text-[10px] text-mute/40">{t("settings.currently", { summary: optionsSummary(preset, t) })}</p>
              ) : null}
            </Section>

            <Section icon={FolderDown} title={t("settings.downloads")} hint={t("settings.downloadsHint")}>
              <div className="border-b border-fog/[0.055] py-3">
                <p className="text-[11px] font-semibold text-mist/85">{t("settings.saveTo")}</p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-fog/[0.04] px-3 py-2">
                    <FolderDown className="size-3.5 shrink-0 text-mute/55" />
                    <span className="truncate text-[10px] text-mist/65" title={settings.downloadDir}>
                      {truncateMiddle(settings.downloadDir, 46)}
                    </span>
                  </div>
                  <Button size="sm" variant="soft" onClick={() => void pickFolder()}>
                    {t("settings.change")}
                  </Button>
                  <IconButton label={t("settings.openFolder")} tone="sky" onClick={() => void openFolder()}>
                    <FolderOpen className="size-3.5" />
                  </IconButton>
                </div>
              </div>

              <OptionRow icon={Gauge} title={t("settings.simultaneous")}>
                <span className="font-mono text-[13px] font-semibold tabular-nums text-sky-ink">{concurrency}</span>
                <div className="w-full max-w-[220px]">
                  <Slider
                    value={concurrency}
                    min={1}
                    max={5}
                    step={1}
                    label={t("settings.simultaneous")}
                    onChange={setConcurrency}
                    onCommit={(value) => void save({ concurrency: value })}
                  />
                  <div className="mt-1 flex justify-between px-0.5 font-mono text-[8.5px] tabular-nums text-mute/35">
                    {[1, 2, 3, 4, 5].map((tick) => (
                      <span key={tick} className={cn(tick === concurrency && "text-sky-ink/70")}>
                        {tick}
                      </span>
                    ))}
                  </div>
                </div>
              </OptionRow>
            </Section>

            <Section icon={Palette} title={t("settings.appearance")} hint={t("settings.appearanceHint")}>
              <OptionRow icon={Languages} title={t("settings.language")} description={t("settings.languageHint")}>
                <LanguageMenu variant="row" />
              </OptionRow>
              <OptionRow icon={Sparkles} title={t("settings.theme")}>
                <Segmented
                  layoutId="theme-mode"
                  size="sm"
                  value={settings.theme}
                  options={[
                    { id: "system", label: t("settings.themeSystem") },
                    { id: "dark", label: t("settings.themeDark") },
                    { id: "light", label: t("settings.themeLight") },
                  ]}
                  onChange={(theme) => void save({ theme })}
                />
              </OptionRow>
              <OptionRow icon={History} title={t("settings.reopen")}>
                <Switch
                  checked={settings.rememberView}
                  onCheckedChange={(rememberView) => void save({ rememberView })}
                  aria-label={t("settings.reopen")}
                />
              </OptionRow>
            </Section>

            <Section
              icon={RefreshCw}
              title={t("settings.updates")}
              hint={t("settings.updatesHint")}
              action={
                <span className={cn("text-[9.5px] font-medium", updateAvailable ? "text-sky-ink" : "text-mute/40")}>
                  {updateInstalling
                    ? t("settings.updating", { percent: updateProgress ?? 0 })
                    : updateAvailable
                      ? t("settings.available", { version: updateAvailable.version })
                      : t("settings.upToDate", { version: appInfo?.version ?? "1.0.0" })}
                </span>
              }
            >
              <div className="flex flex-wrap items-center gap-2 py-3">
                <Button size="sm" variant="soft" onClick={() => void onCheckUpdates()} loading={updateChecking} disabled={updateInstalling}>
                  <RefreshCw className="size-3" />
                  {t("settings.checkNow")}
                </Button>
                <Button size="sm" onClick={() => void onInstallUpdate()} loading={updateInstalling} disabled={!updateAvailable}>
                  <DownloadCloud className="size-3" />
                  {t("common.install")}
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-mist/70">{t("settings.automatic")}</span>
                  <Switch
                    checked={settings.autoUpdate}
                    onCheckedChange={(autoUpdate) => void save({ autoUpdate })}
                    aria-label={t("settings.automatic")}
                  />
                </div>
              </div>

              {updateInstalling && updateProgress !== null ? (
                <div className="mb-3 h-1 overflow-hidden rounded-full bg-fog/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-sky"
                    animate={{ width: `${updateProgress}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 24 }}
                  />
                </div>
              ) : null}
              {updateError ? <p className="pb-3 text-[10px] text-danger/80">{updateError}</p> : null}
            </Section>
          </div>

          <div className="mt-12 border-t border-fog/[0.07] pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="flex items-center gap-2 text-[10px] font-medium text-mute/55 outline-none transition-colors hover:text-mist/85"
              aria-expanded={showAdvanced}
            >
              <ChevronDown className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")} />
              {t("settings.advanced")}
            </button>

            {showAdvanced ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-7 grid items-start gap-x-14 gap-y-8 lg:grid-cols-2"
              >
                <Section icon={SlidersHorizontal} title={t("settings.extras")} hint={t("settings.extrasHint")}>
                  <OptionRow icon={Sparkles} title={t("options.compression")} description={t("options.compressionDesc")}>
                    <Select
                      value={settings.defaultCompression}
                      onValueChange={(value) => void save({ defaultCompression: value as AppSettings["defaultCompression"] })}
                    >
                      <SelectTrigger aria-label={t("options.compression")} className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPRESSION_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {compressionLabel(option.id, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </OptionRow>
                  <OptionRow icon={Sparkles} title={t("options.coverArt")} description={t("options.coverArtDesc")}>
                    <Switch
                      checked={settings.embedThumbnail}
                      onCheckedChange={(embedThumbnail) => void save({ embedThumbnail })}
                      aria-label={t("options.coverArt")}
                    />
                  </OptionRow>
                  <OptionRow icon={Sparkles} title={t("options.sponsorBlock")} description={t("options.sponsorBlockDesc")}>
                    <Switch
                      checked={settings.sponsorBlock}
                      onCheckedChange={(sponsorBlock) => void save({ sponsorBlock })}
                      aria-label={t("options.sponsorBlock")}
                    />
                  </OptionRow>
                  <OptionRow icon={Sparkles} title={t("options.subtitles")} description={t("options.subtitlesDesc")}>
                    <Segmented
                      layoutId="default-subs"
                      size="sm"
                      value={settings.subtitles}
                      options={subtitleChoices(t)}
                      onChange={(subtitles) => void save({ subtitles })}
                    />
                  </OptionRow>
                </Section>

                <Section
                  icon={DownloadCloud}
                  title={t("settings.engine")}
                  hint={t("settings.engineHint")}
                  action={
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
                        <RefreshCw className="size-3" />
                        {t("common.check")}
                      </Button>
                      <Button size="sm" variant="soft" onClick={() => void updateYtDlp()} loading={busy}>
                        <DownloadCloud className="size-3" />
                        {t("common.update")}
                      </Button>
                    </div>
                  }
                >
                  <BinaryRow
                    name={t("settings.downloader")}
                    state={binaries?.ytDlp.state ?? "checking"}
                    version={binaries?.ytDlp.version}
                    message={binaries?.ytDlp.message}
                  />
                  <BinaryRow
                    name={t("settings.converter")}
                    state={binaries?.ffmpeg.state ?? "checking"}
                    version={binaries?.ffmpeg.version}
                    message={binaries?.ffmpeg.message}
                  />
                  <OptionRow icon={RefreshCw} title={t("settings.keepTools")}>
                    <Switch
                      checked={settings.autoUpdateYtDlp}
                      onCheckedChange={(autoUpdateYtDlp) => void save({ autoUpdateYtDlp })}
                      aria-label={t("settings.keepTools")}
                    />
                  </OptionRow>
                  <p className="py-3 text-[9.5px] text-mute/35">
                    {t("settings.footer", { version: appInfo?.version ?? "1.0.0" })}
                  </p>
                </Section>
              </motion.div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-[24px] p-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[8px] bg-fog/[0.05] text-mute/65 ring-1 ring-inset ring-fog/[0.05]">
            <Icon className="size-3" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-mute/60">{title}</h2>
            {hint ? <p className="mt-1 text-[10px] text-mute/35">{hint}</p> : null}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function BinaryRow({
  name,
  state,
  version,
  message,
}: {
  name: string;
  state: BinariesStatus["ytDlp"]["state"];
  version?: string;
  message?: string;
}) {
  const { t } = useI18n();
  const ready = state === "ready";
  const busy = state === "downloading" || state === "updating" || state === "checking";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-fog/[0.055] py-3">
      <div className="flex items-center gap-2">
        {busy ? <Spinner className="size-3 text-sky-ink" /> : <span className={cn("size-1.5 rounded-full", ready ? "bg-sky" : "bg-warn")} />}
        <span className="font-mono text-[10.5px] text-mist/70">{name}</span>
      </div>
      <span className={cn("truncate text-[9.5px]", ready ? "text-mute/45" : "text-warn/75")}>
        {ready ? version || t("settings.allReady") : (message ?? (busy ? t("common.check") : state))}
      </span>
    </div>
  );
}
