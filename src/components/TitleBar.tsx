import { motion } from "framer-motion";
import { Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ViewId } from "@shared/types";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { AnimatedSparkles } from "./icons/Animated";

function RestoreGlyph() {
  return (
    <svg viewBox="0 0 10 10" className="size-[11px]" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="0.6" y="2.7" width="6.7" height="6.7" rx="1.1" />
      <path d="M2.8 2.7V1.8c0-.66.54-1.2 1.2-1.2h5.4c.66 0 1.2.54 1.2 1.2v5.4c0 .66-.54 1.2-1.2 1.2h-.9" />
    </svg>
  );
}

const NAV: { id: ViewId; label: string }[] = [
  { id: "downloader", label: "Studio" },
  { id: "history", label: "Library" },
  { id: "settings", label: "Settings" },
];

interface TitleBarProps {
  view: ViewId;
  onChange: (view: ViewId) => void;
  activeCount: number;
  version?: string;
}

export function TitleBar({ view, onChange, activeCount, version }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    return api.window.onMaximizeChange(setMaximized);
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="drag-region relative z-50 flex h-10 w-full shrink-0 items-center justify-between border-b border-fog/[0.07] bg-ink-950"
    >
      <div className="flex h-full items-center gap-2.5 pl-5">
        <motion.div
          whileHover={{ rotate: 8, scale: 1.06 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="grid size-[22px] place-items-center rounded-[7px] bg-sky text-on-sky"
        >
          <AnimatedSparkles className="size-[12px]" />
        </motion.div>
        <span className="font-display text-[12.5px] font-bold tracking-[-0.015em] text-mist/90">NovaTube</span>
      </div>

      <div
        data-tauri-drag-region
        className="drag-region h-full flex-1"
        onDoubleClick={() => void api.window.toggleMaximize()}
      />

      <nav className="no-drag flex h-full items-center gap-1 pr-1">
        {NAV.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                "relative inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[10.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky/45",
                active ? "text-mist" : "text-mute/55 hover:text-mist/85",
              )}
            >
              {item.label}
              {item.id === "downloader" && activeCount > 0 ? (
                <span className="grid min-w-[15px] place-items-center rounded-full bg-sky px-1 text-[8px] font-bold leading-[15px] text-on-sky">
                  {activeCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <span className="no-drag hidden px-3 font-mono text-[9.5px] text-mute/40 sm:block">v{version ?? "1.0.0"}</span>

      <span className="no-drag h-4 w-px bg-fog/[0.08]" />

      <div className="no-drag flex h-full items-center">
        <button type="button" aria-label="Minimize" title="Minimize" className="window-control" onClick={() => void api.window.minimize()}>
          <Minus className="size-[13px]" strokeWidth={1.6} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          className="window-control"
          onClick={() => void api.window.toggleMaximize()}
        >
          {maximized ? <RestoreGlyph /> : <span className="size-[10px] rounded-[1.5px] border border-current" />}
        </button>
        <button type="button" aria-label="Close" title="Close" className="window-control close" onClick={() => void api.window.close()}>
          <X className="size-[14px]" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
