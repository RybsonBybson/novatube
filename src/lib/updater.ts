import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  notes?: string;
  date?: string;
}

/**
 * Ask the updater for a newer release. Returns `null` when the app is current
 * (or when running outside a packaged Tauri build, e.g. during development).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update) return null;
    return { version: update.version, notes: update.body ?? undefined, date: update.date ?? undefined };
  } catch {
    return null;
  }
}

/** Download the pending update, then restart the app in place. */
export async function installUpdate(onProgress?: (percent: number) => void): Promise<void> {
  const update = await check();
  if (!update) throw new Error("You are already running the latest version.");

  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      if (total > 0) onProgress?.(Math.min(99, Math.round((received / total) * 100)));
    } else if (event.event === "Finished") {
      onProgress?.(100);
    }
  });

  await relaunch();
}
