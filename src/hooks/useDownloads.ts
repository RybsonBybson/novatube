import { useCallback, useEffect, useRef, useState } from "react";
import type { AddDownloadInput, DownloadItem } from "@shared/types";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDownloads() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let mounted = true;
    api.downloads
      .list()
      .then((list) => {
        if (mounted) setItems(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoaded(true);
      });

    // Coalesce progress events into a single state update per window. A busy
    // queue emits many updates per second; rendering each one would re-run the
    // whole list reconciliation needlessly. One update per ~100ms keeps the UI
    // smooth while cutting renders (and GC churn) dramatically.
    const pending = new Map<string, DownloadItem>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      if (pending.size === 0) return;
      const batch = new Map(pending);
      pending.clear();
      setItems((current) => {
        let next = current;
        let copied = false;
        batch.forEach((item, id) => {
          const index = next.findIndex((entry) => entry.id === id);
          if (index === -1) {
            if (!copied) {
              next = [...next, item];
              copied = true;
            } else {
              next.push(item);
            }
          } else {
            if (!copied) {
              next = [...next];
              copied = true;
            }
            next[index] = item;
          }
        });
        return next;
      });
    };

    const schedule = () => {
      if (timer !== null) return;
      timer = setTimeout(flush, 100);
    };

    const offUpdate = api.downloads.onUpdate((item) => {
      pending.set(item.id, item);
      schedule();
    });
    const offRemove = api.downloads.onRemove((id) => {
      pending.delete(id);
      setItems((current) => current.filter((item) => item.id !== id));
    });
    const offSnapshot = api.downloads.onSnapshot((list) => {
      pending.clear();
      setItems(list);
    });

    return () => {
      mounted = false;
      if (timer !== null) clearTimeout(timer);
      offUpdate();
      offRemove();
      offSnapshot();
    };
  }, []);

  const guard = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (error) {
      toastRef.current.push({ type: "error", title: "Action failed", message: messageOf(error) });
      return undefined;
    }
  }, []);

  const add = useCallback(
    (input: AddDownloadInput) => guard(() => api.downloads.add(input)),
    [guard],
  );
  const addMany = useCallback(
    (inputs: AddDownloadInput[], prioritize?: boolean) => guard(() => api.downloads.addMany(inputs, prioritize)),
    [guard],
  );
  const pause = useCallback((id: string) => void guard(() => api.downloads.pause(id)), [guard]);
  const resume = useCallback((id: string) => void guard(() => api.downloads.resume(id)), [guard]);
  const cancel = useCallback((id: string) => void guard(() => api.downloads.cancel(id)), [guard]);
  const retry = useCallback((id: string) => void guard(() => api.downloads.retry(id)), [guard]);
  const moveToTop = useCallback((id: string) => void guard(() => api.downloads.moveToTop(id)), [guard]);
  const remove = useCallback((id: string) => void guard(() => api.downloads.remove(id)), [guard]);
  const clearFinished = useCallback(() => void guard(() => api.downloads.clearFinished()), [guard]);
  const clearAll = useCallback(() => void guard(() => api.downloads.clearAll()), [guard]);
  const openFile = useCallback((id: string) => void guard(() => api.downloads.openFile(id)), [guard]);
  const openFolder = useCallback((id: string) => void guard(() => api.downloads.openFolder(id)), [guard]);

  return {
    items,
    loaded,
    add,
    addMany,
    pause,
    resume,
    cancel,
    retry,
    moveToTop,
    remove,
    clearFinished,
    clearAll,
    openFile,
    openFolder,
  };
}

export type DownloadsApi = ReturnType<typeof useDownloads>;
