import { motion } from "framer-motion";
import { ArrowDownToLine, History, Settings2, type LucideIcon } from "lucide-react";
import type { BinariesStatus, ViewId } from "@shared/types";
import { cn } from "../lib/utils";
import { Spinner } from "./icons/Animated";
import { Tooltip } from "./ui/tooltip";

interface SidebarProps {
  view: ViewId;
  onChange: (view: ViewId) => void;
  activeCount: number;
  binaries: BinariesStatus | null;
  onOpenSettings: () => void;
}

const NAV: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "downloader", label: "Studio", icon: ArrowDownToLine },
  { id: "history", label: "Library", icon: History },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function Sidebar({ view, onChange, activeCount, binaries, onOpenSettings }: SidebarProps) {
  const ytDlp = binaries?.ytDlp;
  const ready = ytDlp?.state === "ready";
  const busy = ytDlp?.state === "downloading" || ytDlp?.state === "updating" || ytDlp?.state === "checking";

  return (
    <aside className="relative z-30 flex w-[76px] shrink-0 flex-col items-center bg-ink-900 pb-4 pt-5">
      <nav className="flex w-full flex-col items-center gap-1 px-2.5">
        {NAV.map((item) => {
          const active = view === item.id;
          const Icon = item.icon;
          return (
            <Tooltip key={item.id} label={item.label}>
              <button
                type="button"
                onClick={() => onChange(item.id)}
                className={cn(
                  "group relative flex w-full flex-col items-center gap-1.5 rounded-2xl py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lime/45",
                  active ? "text-mist" : "text-mute/70 hover:text-mist/80",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="sidebar-active"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-2xl bg-fog/[0.06] ring-1 ring-lime/20"
                  />
                ) : null}
                <span className="relative">
                  <Icon className="size-[19px]" strokeWidth={active ? 2 : 1.7} />
                  {item.id === "downloader" && activeCount > 0 ? (
                    <span className="nova-gradient absolute -right-2.5 -top-1.5 grid min-w-[15px] place-items-center rounded-full px-1 text-[8.5px] font-bold leading-[15px] text-on-accent">
                      {activeCount}
                    </span>
                  ) : null}
                </span>
                <span className="relative text-[9px] font-medium tracking-wide">{item.label}</span>
              </button>
            </Tooltip>
          );
        })}
      </nav>

      <Tooltip label={ready ? `yt-dlp ${ytDlp?.version ?? ""}` : ytDlp?.message ?? "Preparing engine"}>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-auto flex flex-col items-center gap-2 rounded-2xl px-3 py-3 outline-none transition-colors hover:bg-fog/[0.05] focus-visible:ring-2 focus-visible:ring-lime/45"
        >
          <span className="relative grid size-4 place-items-center">
            {busy ? (
              <Spinner className="size-3 text-aqua-ink" />
            ) : ready ? (
              <span className="size-1.5 rounded-full bg-lime shadow-[0_0_10px_rgba(201,246,63,0.9)]" />
            ) : (
              <span className="size-1.5 rounded-full bg-peach" />
            )}
          </span>
          <span className="text-[7.5px] font-medium uppercase tracking-[0.14em] text-mute/60">{ready ? "Ready" : busy ? "Setup" : "Offline"}</span>
        </button>
      </Tooltip>
    </aside>
  );
}
