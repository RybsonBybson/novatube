import { motion } from "framer-motion";
import { Check, DownloadCloud, FolderDown, FolderOpen, RefreshCw } from "lucide-react";
import type { AppInfo, AppSettings, BinariesStatus, DownloadOptions } from "@shared/types";
import { api } from "../lib/api";
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
}

export function SettingsView({ settings, settingsError, onUpdate, binaries, onUpdateYtDlp, onRefreshBinaries, appInfo }: SettingsViewProps) {
  const toast = useToast();

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
      toast.push({ type: "success", title: "yt-dlp updated", message: "The engine is current." });
    } catch (error) {
      toast.push({ type: "error", title: "Update failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const refresh = async () => {
    try {
      const next = await onRefreshBinaries();
      toast.push({
        type: next.ytDlp.state === "ready" ? "success" : "error",
        title: next.ytDlp.state === "ready" ? "Engines ready" : "yt-dlp missing",
        message: next.ytDlp.state === "ready" ? `yt-dlp ${next.ytDlp.version}` : next.ytDlp.message ?? "Update yt-dlp to install it.",
      });
    } catch (error) {
      toast.push({ type: "error", title: "Engine check failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const busy = binaries?.ytDlp.state === "downloading" || binaries?.ytDlp.state === "updating";
  const preset: DownloadOptions | null = settings ? optionsFromSettings(settings) : null;

  return (
    <div className="relative min-h-full">
      <div className="relative mx-auto w-full max-w-[1020px] px-8 pb-24 pt-14 lg:px-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-aqua-ink/80">Preferences</p>
        <h1 className="mt-4 font-display text-[36px] font-bold leading-[1.05] tracking-[-0.04em] text-mist">Settings</h1>
        <p className="mt-3 text-[11.5px] text-mute/55">Quick mode downloads use these instantly — no extra choices.</p>

        {settingsError ? <div className="mt-6 rounded-2xl bg-danger/[0.08] px-4 py-3 text-[11px] text-danger/80">{settingsError}</div> : null}

        {!settings ? (
          <div className="mt-12 flex items-center justify-center gap-2 text-[11px] text-mute/40">
            <Spinner className="size-4 text-lime-ink" />
            Loading settings
          </div>
        ) : (
          <div className="mt-9 grid items-start gap-2.5 lg:grid-cols-2">
            <Panel delay={0} className="lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <SectionTitle title="Quick download preset" subtitle="Applied the moment you paste a link" accent />
                {preset ? (
                  <span className="rounded-full bg-lime/12 px-3 py-1 text-[10.5px] font-semibold text-lime-ink">{optionsSummary(preset)}</span>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <Label>Mode</Label>
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
              </div>

              {settings.defaultKind === "video" ? (
                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Resolution</Label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {QUALITY_OPTIONS.map((option) => (
                        <Chip key={option.id} active={settings.defaultQuality === option.id} onClick={() => void save({ defaultQuality: option.id })}>
                          {option.short}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <Field label="Container">
                    <Segmented
                      layoutId="default-container"
                      size="sm"
                      value={settings.defaultContainer}
                      options={CONTAINERS}
                      onChange={(defaultContainer) => void save({ defaultContainer })}
                    />
                  </Field>

                  <Field label="Compression">
                    <Select
                      value={settings.defaultCompression}
                      onValueChange={(value) => void save({ defaultCompression: value as AppSettings["defaultCompression"] })}
                    >
                      <SelectTrigger aria-label="Compression preset">
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
                  </Field>
                </div>
              ) : (
                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Audio format</Label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
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
                  </div>
                  <div className={cn("sm:col-span-2", settings.defaultAudioFormat !== "mp3" && "pointer-events-none opacity-35")}>
                    <Label>MP3 bitrate</Label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
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
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-fog/[0.06] pt-6">
                <SettingRow title="Embed cover art" hint="Add the thumbnail as art">
                  <Switch checked={settings.embedThumbnail} onCheckedChange={(embedThumbnail) => void save({ embedThumbnail })} aria-label="Embed cover art" />
                </SettingRow>
                <SettingRow title="SponsorBlock" hint="Cut sponsor segments">
                  <Switch checked={settings.sponsorBlock} onCheckedChange={(sponsorBlock) => void save({ sponsorBlock })} aria-label="SponsorBlock" />
                </SettingRow>
                <SettingRow title="Subtitles" hint="Download and embed">
                  <Segmented layoutId="default-subs" size="sm" value={settings.subtitles} options={SUBTITLE_MODES} onChange={(subtitles) => void save({ subtitles })} />
                </SettingRow>
              </div>
            </Panel>

            <Panel delay={0.04}>
              <SectionTitle title="Downloads" subtitle="Save location and parallelism" />

              <div className="mt-6">
                <Label>Save to</Label>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-fog/[0.05] px-3.5 py-2.5 transition-colors focus-within:bg-fog/[0.08] focus-within:ring-1 focus-within:ring-lime/35">
                    <FolderDown className="size-3.5 shrink-0 text-mute/60" />
                    <span className="truncate text-[10.5px] text-mist/70" title={settings.downloadDir}>
                      {truncateMiddle(settings.downloadDir, 44)}
                    </span>
                  </div>
                  <Button size="sm" variant="soft" onClick={() => void pickFolder()}>
                    Change
                  </Button>
                  <IconButton label="Open downloads folder" tone="accent" onClick={() => void openFolder()}>
                    <FolderOpen className="size-4" />
                  </IconButton>
                </div>
              </div>

              <div className="mt-7">
                <div className="flex items-center justify-between">
                  <Label>Simultaneous downloads</Label>
                  <span className="font-mono text-[11px] tabular-nums text-lime-ink">{settings.concurrency}</span>
                </div>
                <div className="mt-3">
                  <Slider value={settings.concurrency} min={1} max={5} label="Simultaneous downloads" onChange={(value) => void save({ concurrency: value })} />
                  <div className="mt-2 flex justify-between px-0.5 text-[9px] text-mute/35">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <span key={value} className={cn("tabular-nums", settings.concurrency === value && "text-mist/60")}>
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-7 flex items-center justify-between gap-3">
                <SettingLabel title="Auto-update yt-dlp" hint="Check for a new engine on launch" />
                <Switch checked={settings.autoUpdateYtDlp} onCheckedChange={(autoUpdateYtDlp) => void save({ autoUpdateYtDlp })} aria-label="Auto-update yt-dlp" />
              </div>
            </Panel>

            <Panel delay={0.06}>
              <SectionTitle title="Appearance" subtitle="Theme and startup" />

              <div className="mt-6 flex items-center justify-between gap-3">
                <Label>Theme</Label>
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
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <SettingLabel title="Reopen last view" hint="Start where you left off" />
                <Switch checked={settings.rememberView} onCheckedChange={(rememberView) => void save({ rememberView })} aria-label="Reopen last view" />
              </div>

              <p className="mt-6 text-[10px] leading-relaxed text-mute/40">Window size, position and maximized state are restored automatically.</p>

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[9.5px] text-mute/35">
                <span>Ctrl 1/2/3 · Views</span>
                <span>Ctrl L · Search</span>
                <span>Ctrl O · Folder</span>
              </div>
            </Panel>

            <Panel delay={0.08} className="lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <SectionTitle title="Engines" subtitle="yt-dlp fetches, ffmpeg merges" />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
                    <RefreshCw className="size-3.5" />
                    Re-check
                  </Button>
                  <Button size="sm" variant="soft" onClick={() => void updateYtDlp()} loading={busy}>
                    <DownloadCloud className="size-3.5" />
                    Update yt-dlp
                  </Button>
                </div>
              </div>

              <div className="mt-6 grid gap-1.5 sm:grid-cols-2">
                <BinaryCard name="yt-dlp" state={binaries?.ytDlp.state ?? "checking"} version={binaries?.ytDlp.version} path={binaries?.ytDlp.path} progress={binaries?.ytDlp.progress ?? 0} message={binaries?.ytDlp.message} />
                <BinaryCard name="ffmpeg" state={binaries?.ffmpeg.state ?? "checking"} version={binaries?.ffmpeg.version} path={binaries?.ffmpeg.path} progress={binaries?.ffmpeg.progress ?? 0} message={binaries?.ffmpeg.message} />
              </div>

              <p className="mt-6 flex items-center gap-2 text-[10px] text-mute/40">
                <Check className="size-3 text-aqua-ink/70" />
                NovaTube {appInfo?.version ?? "1.0.0"} · Tauri {appInfo?.tauri ?? "—"} · no telemetry
              </p>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className={cn("rounded-[26px] bg-ink-850 p-6", className)}>
      {children}
    </motion.section>
  );
}

function SectionTitle({ title, subtitle, accent = false }: { title: string; subtitle: string; accent?: boolean }) {
  return (
    <div>
      <h2 className={cn("font-display text-[13px] font-semibold tracking-[-0.01em]", accent ? "text-mist" : "text-mist/90")}>{title}</h2>
      <p className="mt-0.5 text-[10px] text-mute/45">{subtitle}</p>
    </div>
  );
}

function SettingLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <p className="text-[11.5px] font-medium text-mist/85">{title}</p>
      <p className="mt-0.5 text-[10px] text-mute/45">{hint}</p>
    </div>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <SettingLabel title={title} hint={hint} />
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function BinaryCard({
  name,
  state,
  version,
  path,
  progress,
  message,
}: {
  name: string;
  state: BinariesStatus["ytDlp"]["state"];
  version?: string;
  path?: string;
  progress: number;
  message?: string;
}) {
  const ready = state === "ready";
  const busy = state === "downloading" || state === "updating" || state === "checking";
  return (
    <div className="rounded-2xl bg-fog/[0.035] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {busy ? (
            <Spinner className="size-3.5 text-lime-ink" />
          ) : (
            <span className={cn("size-[6px] rounded-full", ready ? "bg-lime" : "bg-warn")} />
          )}
          <span className="font-mono text-[11px] font-medium text-mist/75">{name}</span>
        </div>
        <span className={cn("text-[9px] uppercase tracking-[0.12em]", ready ? "text-lime-ink/80" : "text-warn/80")}>
          {busy && state === "checking" ? "checking" : state}
        </span>
      </div>
      <p className="mt-2 truncate font-mono text-[9.5px] text-mute/45" title={version ?? path ?? ""}>
        {version ?? message ?? "Not installed"}
      </p>
      {busy && state !== "checking" ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-fog/[0.06]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-lime to-aqua"
            animate={{ width: `${progress}%` }}
            transition={{ type: "spring", stiffness: 100, damping: 22 }}
          />
        </div>
      ) : null}
    </div>
  );
}
