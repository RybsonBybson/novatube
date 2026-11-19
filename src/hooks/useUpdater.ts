import { useCallback, useState } from "react";
import { checkForUpdate, installUpdate, type UpdateInfo } from "../lib/updater";

export function useUpdater() {
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (): Promise<UpdateInfo | null> => {
    setChecking(true);
    setError(null);
    try {
      const info = await checkForUpdate();
      setAvailable(info);
      return info;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const install = useCallback(async () => {
    setInstalling(true);
    setError(null);
    setProgress(0);
    try {
      await installUpdate(setProgress);
      // The app restarts on success, so we never reach the next line.
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setInstalling(false);
      setProgress(null);
    }
  }, []);

  return { available, checking, installing, progress, error, check, install };
}

export type Updater = ReturnType<typeof useUpdater>;
