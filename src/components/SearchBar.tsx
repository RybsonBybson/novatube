import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ClipboardPaste, Link2, ListVideo, Radio, Sparkles, X, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { detectSource, isSupportedUrl } from "../lib/url";
import { Spinner } from "./icons/Animated";
import { YoutubeIcon } from "./icons/YoutubeIcon";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPaste: () => void;
  loading: boolean;
  pasteLoading?: boolean;
  actionLabel: string;
  idleHint: ReactNode;
}

const SOURCE: Record<string, { label: string; icon: LucideIcon | typeof YoutubeIcon }> = {
  youtube: { label: "YouTube video", icon: YoutubeIcon },
  short: { label: "YouTube Short", icon: Sparkles },
  live: { label: "Live stream", icon: Radio },
  playlist: { label: "Playlist · batch select", icon: ListVideo },
  media: { label: "Media link", icon: Link2 },
};

export function SearchBar({ value, onChange, onSubmit, onPaste, loading, pasteLoading, actionLabel, idleHint }: SearchBarProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const source = value.trim() ? detectSource(value) : null;
  const supported = value.trim() ? isSupportedUrl(value) : false;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (supported && !loading) onSubmit();
      }}
    >
      <div
        className={cn(
          "flex min-h-[66px] items-center gap-1.5 rounded-[24px] bg-ink-850 px-2.5 transition-all duration-300",
          focused && "bg-ink-800 shadow-[0_30px_80px_-50px_rgba(240,188,0,0.65)] ring-1 ring-saffron/25",
        )}
      >
        <div className="ml-1.5 grid size-9 shrink-0 place-items-center">
          <Sparkles className={cn("size-[17px] transition-colors", focused ? "text-saffron-ink" : "text-mute/60")} />
        </div>

        <input
          id="nova-url-input"
          ref={inputRef}
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Paste a link — video, Shorts, live or playlist"
          className="h-11 min-w-0 flex-1 border-0 bg-transparent font-display text-[15px] font-medium tracking-[-0.01em] text-mist outline-none placeholder:text-mute/55"
        />

        <AnimatePresence>
          {value ? (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
              className="grid size-8 shrink-0 place-items-center rounded-full text-mute/60 outline-none transition-colors hover:bg-fog/[0.07] hover:text-mist"
              aria-label="Clear URL"
            >
              <X className="size-4" />
            </motion.button>
          ) : null}
        </AnimatePresence>

        <button
          type="button"
          onClick={onPaste}
          disabled={pasteLoading}
          title="Paste from clipboard"
          className="hidden size-10 shrink-0 place-items-center rounded-full text-mute outline-none transition-colors hover:bg-fog/[0.07] hover:text-mist sm:grid"
        >
          {pasteLoading ? <Spinner className="size-4 text-saffron-ink" /> : <ClipboardPaste className="size-[17px]" />}
        </button>

        <motion.button
          type="submit"
          disabled={!supported || loading}
          whileTap={supported && !loading ? { scale: 0.97 } : undefined}
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[12.5px] font-semibold tracking-[-0.01em] outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-saffron/45 sm:px-5",
            supported
              ? "nova-gradient text-on-accent shadow-[0_16px_44px_-20px_rgba(240,188,0,0.9)] hover:brightness-[1.06]"
              : "cursor-not-allowed bg-fog/[0.04] text-mute/40",
          )}
        >
          {loading ? <Spinner className="size-4" /> : <ArrowRight className="size-4" />}
          <span className="hidden sm:inline">{loading ? "Working…" : actionLabel}</span>
        </motion.button>
      </div>

      <div className="flex h-6 items-center gap-1.5 px-5 pt-2 text-[10px] text-mute/55">
        <AnimatePresence mode="wait" initial={false}>
          {source ? (
            <motion.span key={source} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1.5">
              {(() => {
                const Icon = SOURCE[source].icon;
                return <Icon className="size-3 text-saffron-ink/70" />;
              })()}
              {SOURCE[source].label}
            </motion.span>
          ) : (
            <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1.5">
              {idleHint}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
