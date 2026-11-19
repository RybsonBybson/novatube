import { motion } from "framer-motion";
import { Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { AnimatedSparkles } from "./icons/Animated";

function RestoreGlyph() {
  return (
    <svg viewBox="0 0 10 10" className="size-[11px]" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="0.6" y="2.7" width="6.7" height="6.7" rx="1.1" />
      <path d="M2.8 2.7V1.8c0-.66.54-1.2 1.2-1.2h5.4c.66 0 1.2.54 1.2 1.2v5.4c0 .66-.54 1.2-1.2 1.2h-.9" />
    </svg>
  );
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    return api.window.onMaximizeChange(setMaximized);
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="drag-region relative z-50 flex h-9 w-full shrink-0 items-center justify-between bg-ink-950"
    >
      <div className="flex h-full items-center gap-2.5 pl-4">
        <motion.div
          whileHover={{ rotate: 8, scale: 1.06 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="nova-gradient grid size-[20px] place-items-center rounded-[7px]"
        >
          <AnimatedSparkles className="size-[12px] text-on-accent" />
        </motion.div>
        <span className="font-display text-[12.5px] font-bold tracking-[-0.015em] text-mist/90">NovaTube</span>
      </div>

      <div
        data-tauri-drag-region
        className="drag-region h-full flex-1"
        onDoubleClick={() => void api.window.toggleMaximize()}
      />

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
