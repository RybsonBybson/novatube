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

    const offUpdate = api.downloads.onUpdate((item) => {
      setItems((current) => {
        const index = current.findIndex((entry) => entry.id === item.id);
        if (index === -1) return [...current, item];
        const next = [...current];
        next[index] = item;
        return next;
      });
    });
    const offRemove = api.downloads.onRemove((id) => {
      setItems((current) => current.filter((item) => item.id !== id));
    });
    const offSnapshot = api.downloads.onSnapshot((list) => setItems(list));

    return () => {
      mounted = false;
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
    (inputs: AddDownloadInput[]) => guard(() => api.downloads.addMany(inputs)),
    [guard],
  );
  const pause = useCallback((id: string) => void guard(() => api.downloads.pause(id)), [guard]);
  const resume = useCallback((id: string) => void guard(() => api.downloads.resume(id)), [guard]);
  const cancel = useCallback((id: string) => void guard(() => api.downloads.cancel(id)), [guard]);
  const retry = useCallback((id: string) => void guard(() => api.downloads.retry(id)), [guard]);
  const remove = useCallback((id: string) => void guard(() => api.downloads.remove(id)), [guard]);
  const clearFinished = useCallback(() => void guard(() => api.downloads.clearFinished()), [guard]);
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
    remove,
    clearFinished,
    openFile,
    openFolder,
  };
}

export type DownloadsApi = ReturnType<typeof useDownloads>;
