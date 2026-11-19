import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewId } from "@shared/types";
import { Downloader } from "./components/Downloader";
import { ContextMenu, isEditableTarget, type ContextMenuState } from "./components/ContextMenu";
import { HistoryView } from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { useToast } from "./components/Toasts";
import { useAppInfo, useBinaries, useHistory, useSettings } from "./hooks/useBackend";
import { useDownloads } from "./hooks/useDownloads";
import { useTheme } from "./hooks/useTheme";
import { api } from "./lib/api";
import { TooltipProvider } from "./components/ui/tooltip";

const VIEWS: ViewId[] = ["downloader", "history", "settings"];

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

  const activeCount = downloads.items.filter(
    (item) => !["completed", "cancelled", "error"].includes(item.status),
  ).length;

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
      window.setTimeout(() => document.getElementById("nova-url-input")?.focus(), 90);
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
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950">
        <TitleBar />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            view={view}
            onChange={changeView}
            activeCount={activeCount}
            binaries={binaries}
            onOpenSettings={() => changeView("settings")}
          />

          <main ref={mainRef} className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="min-h-full"
              >
                {view === "downloader" ? (
                  <Downloader
                    downloads={downloads}
                    settings={settings}
                    binaries={binaries}
                    onOpenSettings={() => changeView("settings")}
                    onOpenHistory={() => changeView("history")}
                  />
                ) : null}

                {view === "history" ? (
                  <HistoryView
                    entries={history.entries}
                    loaded={history.loaded}
                    downloads={downloads}
                    onRemove={history.remove}
                    onClear={history.clear}
                  />
                ) : null}

                {view === "settings" ? (
                  <SettingsView
                    settings={settings}
                    settingsError={settingsError}
                    onUpdate={updateSettings}
                    binaries={binaries}
                    onUpdateYtDlp={updateYtDlp}
                    onRefreshBinaries={refreshBinaries}
                    appInfo={appInfo}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      </div>
    </TooltipProvider>
  );
}
