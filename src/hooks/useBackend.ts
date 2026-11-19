import { useCallback, useEffect, useState } from "react";
import type { AppInfo, AppSettings, BinariesStatus, HistoryEntry } from "@shared/types";
import { api } from "../lib/api";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings
      .get()
      .then(setSettings)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const next = await api.settings.update(patch);
    setSettings(next);
    return next;
  }, []);

  return { settings, error, update, setSettings };
}

export function useBinaries() {
  const [status, setStatus] = useState<BinariesStatus | null>(null);

  useEffect(() => {
    api.binaries.status().then(setStatus).catch(() => undefined);
    return api.binaries.onStatus(setStatus);
  }, []);

  const updateYtDlp = useCallback(async () => {
    const next = await api.binaries.updateYtDlp();
    setStatus(next);
    return next;
  }, []);

  const refresh = useCallback(async () => {
    const next = await api.binaries.refresh();
    setStatus(next);
    return next;
  }, []);

  return { status, updateYtDlp, refresh };
}

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.history
      .list()
      .then((list) => {
        if (mounted) setEntries(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    const off = api.history.onChange(setEntries);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  const remove = useCallback(async (id: string) => {
    const next = await api.history.remove(id);
    setEntries(next);
    return next;
  }, []);

  const clear = useCallback(async () => {
    const next = await api.history.clear();
    setEntries(next);
    return next;
  }, []);

  return { entries, loaded, remove, clear };
}

export function useAppInfo() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.app.info().then(setInfo).catch(() => undefined);
  }, []);
  return info;
}
