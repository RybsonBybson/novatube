import { useEffect } from "react";
import type { ThemeMode } from "@shared/types";

function resolve(mode: ThemeMode, prefersLight: boolean): "dark" | "light" {
  if (mode === "light" || mode === "dark") return mode;
  return prefersLight ? "light" : "dark";
}

function apply(resolved: "dark" | "light"): void {
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  try {
    localStorage.setItem("novatube-theme", resolved);
  } catch {
    /* Storage is best-effort; the boot screen can stay neutral. */
  }
}

/**
 * Keeps the document theme in sync with the saved preference and, in
 * "system" mode, with OS appearance changes while the app is open.
 */
export function useTheme(mode: ThemeMode | undefined): void {
  useEffect(() => {
    if (!mode) return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => apply(resolve(mode, media.matches));
    sync();
    if (mode !== "system") return;
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [mode]);
}
