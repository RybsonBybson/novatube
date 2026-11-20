import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AddDownloadInput,
  AppInfo,
  AppSettings,
  BinariesStatus,
  DownloadItem,
  HistoryEntry,
  MediaInfo,
  NovaApi,
  ToastEvent,
} from "@shared/types";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Unwrap Rust `Result` rejections into ordinary Error objects. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (reason) {
    if (typeof reason === "string" && reason.trim()) throw new Error(reason);
    if (reason && typeof reason === "object" && "message" in reason) {
      throw new Error(String((reason as { message: unknown }).message));
    }
    throw new Error("The background process did not respond.");
  }
}

/** Subscribe immediately; unlisten as soon as the async registration resolves. */
function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void listen<T>(event, (message) => callback(message.payload))
    .then((off) => {
      if (disposed) off();
      else unlisten = off;
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Resolved lazily so the UI still renders outside a Tauri webview. */
let cachedWindow: ReturnType<typeof getCurrentWindow> | null = null;
function appWindow() {
  if (!hasTauri) return null;
  if (!cachedWindow) cachedWindow = getCurrentWindow();
  return cachedWindow;
}

export const api: NovaApi = {
  platform: navigator.userAgent.includes("Win") ? "win32" : navigator.userAgent.includes("Mac") ? "darwin" : "linux",

  window: {
    minimize: () => appWindow()?.minimize() ?? Promise.resolve(),
    toggleMaximize: async () => {
      const win = appWindow();
      if (!win) return false;
      await win.toggleMaximize();
      return win.isMaximized();
    },
    close: () => appWindow()?.close() ?? Promise.resolve(),
    onMaximizeChange: (callback) => {
      const win = appWindow();
      if (!win) return () => undefined;
      let active = true;
      let unlisten: UnlistenFn | null = null;
      const sync = () => {
        void win
          .isMaximized()
          .then((maximized) => {
            if (active) callback(maximized);
          })
          .catch(() => undefined);
      };
      sync();
      void win
        .onResized(sync)
        .then((off) => {
          if (active) unlisten = off;
          else off();
        })
        .catch(() => undefined);
      return () => {
        active = false;
        unlisten?.();
      };
    },
  },

  metadata: {
    fetch: (url: string) => call<MediaInfo>("metadata_fetch", { url }),
  },

  downloads: {
    list: () => call<DownloadItem[]>("downloads_list"),
    add: (input: AddDownloadInput) => call<DownloadItem>("downloads_add", { input }),
    addMany: (inputs: AddDownloadInput[]) => call<DownloadItem[]>("downloads_add_many", { inputs }),
    pause: (id: string) => call<void>("downloads_pause", { id }),
    resume: (id: string) => call<void>("downloads_resume", { id }),
    cancel: (id: string) => call<void>("downloads_cancel", { id }),
    retry: (id: string) => call<void>("downloads_retry", { id }),
    remove: (id: string) => call<void>("downloads_remove", { id }),
    clearFinished: () => call<void>("downloads_clear_finished"),
    clearAll: () => call<void>("downloads_clear_all"),
    openFile: (id: string) => call<void>("downloads_open_file", { id }),
    openFolder: (id: string) => call<void>("downloads_open_folder", { id }),
    onUpdate: (callback) => subscribe<DownloadItem>("downloads:update", callback),
    onRemove: (callback) => subscribe<string>("downloads:removed", callback),
    onSnapshot: (callback) => subscribe<DownloadItem[]>("downloads:snapshot", callback),
  },

  history: {
    list: () => call<HistoryEntry[]>("history_list"),
    remove: (id: string) => call<HistoryEntry[]>("history_remove", { id }),
    clear: () => call<HistoryEntry[]>("history_clear"),
    onChange: (callback) => subscribe<HistoryEntry[]>("history:changed", callback),
  },

  settings: {
    get: () => call<AppSettings>("settings_get"),
    update: (patch: Partial<AppSettings>) => call<AppSettings>("settings_update", { patch }),
    pickFolder: () => call<string | null>("settings_pick_folder"),
  },

  binaries: {
    status: () => call<BinariesStatus>("binaries_status"),
    updateYtDlp: () => call<BinariesStatus>("binaries_update_ytdlp"),
    refresh: () => call<BinariesStatus>("binaries_refresh"),
    onStatus: (callback) => subscribe<BinariesStatus>("binaries:status", callback),
  },

  app: {
    info: () => call<AppInfo>("app_info"),
    openPath: (path: string) => call<void>("app_open_path", { path }),
    openExternal: (url: string) => call<void>("app_open_external", { url }),
  },

  clipboard: {
    readText: () => call<string>("clipboard_read"),
    writeText: (text: string) => call<void>("clipboard_write", { text }),
  },

  onToast: (callback) => subscribe<ToastEvent>("toast", callback),
};
