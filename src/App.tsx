import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewId } from "@shared/types";
import { Downloader } from "./components/Downloader";
import { ContextMenu, isEditableTarget, type ContextMenuState } from "./components/ContextMenu";
import { HistoryView } from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { TitleBar } from "./components/TitleBar";
import { useToast } from "./components/Toasts";
import { useAppInfo, useBinaries, useHistory, useSettings } from "./hooks/useBackend";
import { useDownloads } from "./hooks/useDownloads";
import { useTheme } from "./hooks/useTheme";
import { useUpdater } from "./hooks/useUpdater";
import { api } from "./lib/api";
import { truncateMiddle } from "./lib/utils";
import { TooltipProvider } from "./components/ui/tooltip";

const VIEWS: ViewId[] = ["downloader", "history", "settings"];
const BUSY_STATUSES = new Set(["queued", "fetching", "downloading", "processing", "compressing", "paused"]);

/**
 * All three views stay mounted and are only hidden with CSS. That keeps the
 * download UI state alive when navigating away, so switching to Settings can
 * never disturb a running queue.
 */
export default function App() {
  const [view, setView] = useState<ViewId>("downloader");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const toast = useToast();

  const downloads = useDownloads();
  const { settings, error: settingsError, update: updateSettings } = useSettings();
  const { status: binaries, updateYtDlp, refresh: refreshBinaries } = useBinaries();
  const history = useHistory();
  const appInfo = useAppInfo();
  useTheme(settings?.theme);
  const restoredView = useRef(false);

  const {
    available: updateAvailable,
    checking: updateChecking,
    installing: updateInstalling,
    progress: updateProgress,
    error: updateError,
    check: checkUpdates,
    install: installUpdate,
  } = useUpdater();

  const activeCount = downloads.items.reduce(
    (total, item) => total + (BUSY_STATUSES.has(item.status) ? 1 : 0),
    0,
  );

  const engineErrorRef = useRef(false);
  useEffect(() => {
    const state = binaries?.ytDlp.state;
    if (state === "error" && !engineErrorRef.current) {
      engineErrorRef.current = true;
      toast.push({
        type: "error",
        title: "Download engine needs attention",
        message: binaries?.ytDlp.message ?? "Open Settings and update yt-dlp to continue.",
      });
    }
    if (state === "ready") engineErrorRef.current = false;
  }, [binaries, toast]);

  /* Look for an app update once per launch. */
  const updateChecked = useRef(false);
  useEffect(() => {
    if (!settings || updateChecked.current) return;
    updateChecked.current = true;
    void checkUpdates();
  }, [settings, checkUpdates]);

  /* Install automatically when enabled — but never interrupt active downloads. */
  const autoInstallStarted = useRef(false);
  useEffect(() => {
    if (!settings?.autoUpdate || !updateAvailable || autoInstallStarted.current || updateInstalling) return;
    if (activeCount > 0) return;
    autoInstallStarted.current = true;
    void installUpdate();
  }, [settings?.autoUpdate, updateAvailable, updateInstalling, activeCount, installUpdate]);

  const changeView = useCallback(
    (next: ViewId) => {
      if (!VIEWS.includes(next)) return;
      setView(next);
      setContextMenu(null);
      void updateSettings({ lastView: next }).catch(() => undefined);
    },
    [updateSettings],
  );

  const focusSearch = useCallback(() => {
    if (view !== "downloader") {
      changeView("downloader");
      window.setTimeout(() => document.getElementById("nova-url-input")?.focus(), 40);
    } else {
      document.getElementById("nova-url-input")?.focus();
    }
  }, [view, changeView]);

  /* Keep the last used view for the next launch. */
  useEffect(() => {
    if (!settings || restoredView.current) return;
    restoredView.current = true;
    if (settings.rememberView && VIEWS.includes(settings.lastView)) setView(settings.lastView);
  }, [settings]);

  /* Hard keyboard lockdown mirrored in the main process, plus shortcuts. */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey || event.metaKey;
      const blocked =
        key === "f12" ||
        key === "f5" ||
        (ctrl && event.shiftKey && ["i", "j", "c"].includes(key)) ||
        (ctrl && ["r", "u"].includes(key)) ||
        (ctrl && event.altKey && ["i", "j"].includes(key));
      if (blocked) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (event.altKey && ["arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        return;
      }
      if (!event.altKey && ctrl && ["1", "2", "3"].includes(key)) {
        event.preventDefault();
        changeView(VIEWS[Number(key) - 1]);
        return;
      }
      if (!event.altKey && ctrl && key === "l") {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (!event.altKey && ctrl && key === "o") {
        event.preventDefault();
        const folder = settings?.downloadDir;
        if (folder) void api.app.openPath(folder).catch(() => undefined);
        return;
      }
      if (!ctrl && key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [changeView, focusSearch, settings?.downloadDir]);

  /* Native context menu is replaced by a custom one for text fields. */
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      event.preventDefault();
      if (isEditableTarget(event.target)) {
        setContextMenu({ x: event.clientX, y: event.clientY, target: event.target });
      } else {
        setContextMenu(null);
      }
    };
    window.addEventListener("contextmenu", handler, true);
    return () => window.removeEventListener("contextmenu", handler, true);
  }, []);

  /* Block accidental page navigation from drag & drop. */
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [view]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-transparent">
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <span className="aurora-blob one -left-44 -top-56 size-[640px]" />
          <span className="aurora-blob two -right-40 top-[-14rem] size-[560px]" />
          <span className="aurora-blob three -left-24 bottom-[-18rem] size-[520px]" />
          <span className="aurora-blob four right-[-10rem] bottom-[-14rem] size-[480px]" />
        </div>

        <TitleBar view={view} onChange={changeView} activeCount={activeCount} version={appInfo?.version} />

        <main ref={mainRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col px-8 lg:px-10">
            <div className="flex-1">
              <div className={view === "downloader" ? "min-h-full" : "hidden"} aria-hidden={view !== "downloader"}>
                <Downloader
                  active={view === "downloader"}
                  downloads={downloads}
                  settings={settings}
                  binaries={binaries}
                  onOpenSettings={() => changeView("settings")}
                  onOpenHistory={() => changeView("history")}
                />
              </div>

              <div className={view === "history" ? "min-h-full" : "hidden"} aria-hidden={view !== "history"}>
                <HistoryView
                  entries={history.entries}
                  loaded={history.loaded}
                  onAdd={downloads.add}
                  onRemove={history.remove}
                  onClear={history.clear}
                />
              </div>

              <div className={view === "settings" ? "min-h-full" : "hidden"} aria-hidden={view !== "settings"}>
                <SettingsView
                  settings={settings}
                  settingsError={settingsError}
                  onUpdate={updateSettings}
                  binaries={binaries}
                  onUpdateYtDlp={updateYtDlp}
                  onRefreshBinaries={refreshBinaries}
                  appInfo={appInfo}
                  updateAvailable={updateAvailable}
                  updateChecking={updateChecking}
                  updateInstalling={updateInstalling}
                  updateProgress={updateProgress}
                  updateError={updateError}
                  onCheckUpdates={checkUpdates}
                  onInstallUpdate={installUpdate}
                />
              </div>
            </div>

            <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-fog/[0.07] py-4 text-[10px] text-mute/50">
              <span className="truncate">
                Saves to {settings?.downloadDir ? truncateMiddle(settings.downloadDir, 62) : "your downloads folder"}
              </span>
              <span className="shrink-0">Private by design · everything stays on your device</span>
            </footer>
          </div>
        </main>

        <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      </div>
    </TooltipProvider>
  );
}