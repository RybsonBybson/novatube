import { motion } from "framer-motion";
import { ChevronDown, DownloadCloud, FolderDown, FolderOpen, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { AppInfo, AppSettings, BinariesStatus, DownloadOptions } from "@shared/types";
import { api } from "../lib/api";
import type { UpdateInfo } from "../lib/updater";
import { cn, truncateMiddle } from "../lib/utils";
import {
  AUDIO_FORMATS,
  AUDIO_QUALITIES,
  COMPRESSION_OPTIONS,
  CONTAINERS,
  QUALITY_OPTIONS,
  SUBTITLE_MODES,
  optionsFromSettings,
  optionsSummary,
} from "../lib/options";
import { useToast } from "./Toasts";
import { Button, Chip, IconButton } from "./ui/button";
import { Label } from "./ui/label";
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
  const toast = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const save = async (patch: Partial<AppSettings>, successMessage?: string) => {
    try {
      await onUpdate(patch);
      if (successMessage) toast.push({ type: "success", title: "Saved", message: successMessage });
    } catch (error) {
      toast.push({ type: "error", title: "Could not save setting", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const pickFolder = async () => {
    try {
      const folder = await api.settings.pickFolder();
      if (folder) await save({ downloadDir: folder }, folder);
    } catch (error) {
      toast.push({ type: "error", title: "Folder picker failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const openFolder = async () => {
    try {
      await api.app.openPath(settings?.downloadDir ?? "");
    } catch (error) {
      toast.push({ type: "error", title: "Could not open folder", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const updateYtDlp = async () => {
    try {
      await onUpdateYtDlp();
      toast.push({ type: "success", title: "Media engine updated", message: "You're running the latest version." });
    } catch (error) {
      toast.push({ type: "error", title: "Update failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const refresh = async () => {
    try {
      const next = await onRefreshBinaries();
      toast.push({
        type: next.ytDlp.state === "ready" ? "success" : "error",
        title: next.ytDlp.state === "ready" ? "Everything is ready" : "Media engine needs attention",
        message: next.ytDlp.state === "ready" ? "Downloads and conversions are good to go." : next.ytDlp.message ?? "Tap Update to install it.",
      });
    } catch (error) {
      toast.push({ type: "error", title: "Couldn't check the media engine", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const busy = binaries?.ytDlp.state === "downloading" || binaries?.ytDlp.state === "updating";
  const preset: DownloadOptions | null = settings ? optionsFromSettings(settings) : null;

  return (
    <div className="relative min-h-full pb-12 pt-10">
      <header>
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-mute/60">Preferences</p>
        <h1 className="mt-3 font-display text-[40px] font-bold leading-[1.05] tracking-[-0.04em] text-mist">Settings</h1>
        <p className="mt-2 max-w-md text-[11px] leading-relaxed text-mute/50">Quick downloads use these instantly — no extra choices.</p>
      </header>

      {settingsError ? <div className="mt-6 rounded-[14px] border border-danger/20 px-4 py-3 text-[10.5px] text-danger/80">{settingsError}</div> : null}

      {!settings ? (
        <div className="mt-12 flex items-center gap-2 text-[11px] text-mute/40">
          <Spinner className="size-4 text-sky-ink" />
          Loading settings
        </div>
      ) : (
        <>
          <div className="mt-10 grid items-start gap-x-16 gap-y-10 lg:grid-cols-2">
            <Section title="Quick download" hint="Applied the moment you paste a link">
              <Row label="Mode">
                <Segmented
                  layoutId="default-kind"
                  size="sm"
                  value={settings.defaultKind}
                  options={[
                    { id: "video", label: "Video" },
                    { id: "audio", label: "Audio" },
                  ]}
                  onChange={(defaultKind) => void save({ defaultKind })}
                />
              </Row>

              {settings.defaultKind === "video" ? (
                <>
                  <Row label="Resolution">
                    <div className="flex flex-wrap justify-end gap-1">
                      {QUALITY_OPTIONS.map((option) => (
                        <Chip key={option.id} active={settings.defaultQuality === option.id} onClick={() => void save({ defaultQuality: option.id })}>
                          {option.short}
                        </Chip>
                      ))}
                    </div>
                  </Row>
                  <Row label="Container">
                    <Segmented
                      layoutId="default-container"
                      size="sm"
                      value={settings.defaultContainer}
                      options={CONTAINERS}
                      onChange={(defaultContainer) => void save({ defaultContainer })}
                    />
                  </Row>
                </>
              ) : (
                <>
                  <Row label="Audio format">
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
                  </Row>
                  <Row label="MP3 bitrate">
                    <div className={cn("flex flex-wrap justify-end gap-1", settings.defaultAudioFormat !== "mp3" && "pointer-events-none opacity-35")}>
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
                  </Row>
                </>
              )}

              {preset ? <p className="pt-3 text-[10px] text-mute/40">Currently: {optionsSummary(preset)}</p> : null}
            </Section>

            <Section title="Downloads" hint="Save location and parallelism">
              <div className="border-b border-fog/[0.05] py-3">
                <Label>Save to</Label>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-fog/[0.04] px-3 py-2">
                    <FolderDown className="size-3.5 shrink-0 text-mute/55" />
                    <span className="truncate text-[10px] text-mist/65" title={settings.downloadDir}>
                      {truncateMiddle(settings.downloadDir, 46)}
                    </span>
                  </div>
                  <Button size="sm" variant="soft" onClick={() => void pickFolder()}>
                    Change
                  </Button>
                  <IconButton label="Open downloads folder" tone="sky" onClick={() => void openFolder()}>
                    <FolderOpen className="size-3.5" />
                  </IconButton>
                </div>
              </div>

              <div className="py-3">
                <div className="flex items-center justify-between">
                  <Label>Simultaneous downloads</Label>
                  <span className="font-mono text-[10.5px] tabular-nums text-sky-ink">{settings.concurrency}</span>
                </div>
                <div className="mt-3">
                  <Slider value={settings.concurrency} min={1} max={5} label="Simultaneous downloads" onChange={(value) => void save({ concurrency: value })} />
                </div>
              </div>
            </Section>

            <Section title="Appearance" hint="Theme and startup">
              <Row label="Theme">
                <Segmented
                  layoutId="theme-mode"
                  size="sm"
                  value={settings.theme}
                  options={[
                    { id: "system", label: "System" },
                    { id: "dark", label: "Dark" },
                    { id: "light", label: "Light" },
                  ]}
                  onChange={(theme) => void save({ theme })}
                />
              </Row>
              <Row label="Reopen last view">
                <Switch checked={settings.rememberView} onCheckedChange={(rememberView) => void save({ rememberView })} aria-label="Reopen last view" />
              </Row>
            </Section>

            <Section
              title="App updates"
              hint="Stay current automatically"
              action={
                <span className={cn("text-[9.5px] font-medium", updateAvailable ? "text-sky-ink" : "text-mute/40")}>
                  {updateInstalling
                    ? `Updating${updateProgress !== null ? ` · ${updateProgress}%` : ""}`
                    : updateAvailable
                      ? `v${updateAvailable.version} available`
                      : `v${appInfo?.version ?? "1.0.0"} · up to date`}
                </span>
              }
            >
              <div className="flex flex-wrap items-center gap-2 py-3">
                <Button size="sm" variant="soft" onClick={() => void onCheckUpdates()} loading={updateChecking} disabled={updateInstalling}>
                  <RefreshCw className="size-3" />
                  Check now
                </Button>
                <Button size="sm" onClick={() => void onInstallUpdate()} loading={updateInstalling} disabled={!updateAvailable}>
                  <DownloadCloud className="size-3" />
                  Install
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-mist/70">Automatic</span>
                  <Switch checked={settings.autoUpdate} onCheckedChange={(autoUpdate) => void save({ autoUpdate })} aria-label="Install updates automatically" />
                </div>
              </div>

              {updateInstalling && updateProgress !== null ? (
                <div className="mb-3 h-1 overflow-hidden rounded-full bg-fog/[0.06]">
                  <motion.div className="h-full rounded-full bg-sky" animate={{ width: `${updateProgress}%` }} transition={{ type: "spring", stiffness: 120, damping: 24 }} />
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
              Advanced options
            </button>

            {showAdvanced ? (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-7 grid items-start gap-x-16 gap-y-10 lg:grid-cols-2">
                <Section title="Extras" hint="Fine-tuning for every download">
                  <Row label="Compression">
                    <Select
                      value={settings.defaultCompression}
                      onValueChange={(value) => void save({ defaultCompression: value as AppSettings["defaultCompression"] })}
                    >
                      <SelectTrigger aria-label="Compression preset" className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPRESSION_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                  <Row label="Embed cover art">
                    <Switch checked={settings.embedThumbnail} onCheckedChange={(embedThumbnail) => void save({ embedThumbnail })} aria-label="Embed cover art" />
                  </Row>
                  <Row label="SponsorBlock">
                    <Switch checked={settings.sponsorBlock} onCheckedChange={(sponsorBlock) => void save({ sponsorBlock })} aria-label="SponsorBlock" />
                  </Row>
                  <Row label="Subtitles">
                    <Segmented layoutId="default-subs" size="sm" value={settings.subtitles} options={SUBTITLE_MODES} onChange={(subtitles) => void save({ subtitles })} />
                  </Row>
                </Section>

                <Section
                  title="Media engine"
                  hint="Powers downloading and conversion"
                  action={
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
                        <RefreshCw className="size-3" />
                        Check
                      </Button>
                      <Button size="sm" variant="soft" onClick={() => void updateYtDlp()} loading={busy}>
                        <DownloadCloud className="size-3" />
                        Update
                      </Button>
                    </div>
                  }
                >
                  <BinaryRow name="Downloader" state={binaries?.ytDlp.state ?? "checking"} version={binaries?.ytDlp.version} message={binaries?.ytDlp.message} />
                  <BinaryRow name="Converter" state={binaries?.ffmpeg.state ?? "checking"} version={binaries?.ffmpeg.version} message={binaries?.ffmpeg.message} />
                  <Row label="Keep tools current automatically">
                    <Switch checked={settings.autoUpdateYtDlp} onCheckedChange={(autoUpdateYtDlp) => void save({ autoUpdateYtDlp })} aria-label="Keep media tools current automatically" />
                  </Row>
                  <p className="pt-3 text-[9.5px] text-mute/35">
                    NovaTube {appInfo?.version ?? "1.0.0"} · No telemetry · Everything stays on your device
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
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-[24px] p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-mute/60">{title}</h2>
          {hint ? <p className="mt-1 text-[10px] text-mute/35">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fog/[0.05] py-3 last:border-0">
      <p className="text-[10.5px] font-medium text-mist/75">{label}</p>
      {children}
    </div>
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
  const ready = state === "ready";
  const busy = state === "downloading" || state === "updating" || state === "checking";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-fog/[0.05] py-3">
      <div className="flex items-center gap-2">
        {busy ? <Spinner className="size-3 text-sky-ink" /> : <span className={cn("size-1.5 rounded-full", ready ? "bg-sky" : "bg-warn")} />}
        <span className="font-mono text-[10.5px] text-mist/70">{name}</span>
      </div>
      <span className={cn("truncate text-[9.5px]", ready ? "text-mute/45" : "text-warn/75")}>
        {ready ? version || "ready" : message ?? (busy ? "checking" : state)}
      </span>
    </div>
  );
}
