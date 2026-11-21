import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES } from "../lib/i18n";
import { useI18n } from "../lib/i18n/LanguageContext";
import { cn } from "../lib/utils";
import { Flag } from "./Flag";

interface LanguageMenuProps {
  /** Compact pill for the title bar, or a full-width row for Settings. */
  variant?: "pill" | "row";
  align?: "start" | "end";
  className?: string;
}

export function LanguageMenu({ variant = "pill", align = "end", className }: LanguageMenuProps) {
  const { language, setLanguage, t, meta } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(248, rect.width);
    let left = align === "end" ? rect.right - width : rect.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPosition({ top: rect.bottom + 8, left, width });
  }, [align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  const choose = (code: typeof language) => {
    setLanguage(code);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("nav.language")}
        title={t("nav.language")}
        className={cn(
          "no-drag group inline-flex items-center gap-2 rounded-full bg-fog/[0.05] text-mute/75 outline-none ring-1 ring-inset ring-fog/[0.08] transition-colors hover:bg-fog/[0.09] hover:text-mist focus-visible:ring-2 focus-visible:ring-sky/45",
          variant === "pill" ? "h-7 pl-1 pr-2.5 text-[10.5px]" : "h-9 pl-1.5 pr-3 text-[11.5px]",
          className,
        )}
      >
        <Flag code={meta.flag} shape="circle" className={variant === "pill" ? "size-[18px]" : "size-[23px]"} />
        <span className="max-w-[92px] truncate font-medium">{meta.native}</span>
        <ChevronDown className={cn("size-3 text-mute/45 transition-transform", open && "rotate-180")} />
      </button>

      {open && position
        ? createPortal(
            <AnimatePresence>
              <motion.div
                ref={panelRef}
                role="listbox"
                aria-label={t("nav.language")}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                style={{ top: position.top, left: position.left, width: position.width }}
                className="fixed z-[120] overflow-hidden rounded-[18px] border border-fog/[0.1] bg-ink-900/95 p-1.5 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
              >
                <div className="max-h-[320px] overflow-y-auto">
                  {LANGUAGES.map((item) => {
                    const active = item.code === language;
                    return (
                      <button
                        key={item.code}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => choose(item.code)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left outline-none transition-colors",
                          active ? "bg-sky/12 text-mist" : "text-mute/70 hover:bg-fog/[0.06] hover:text-mist/90",
                        )}
                      >
                        <Flag code={item.flag} className="h-[19px] w-[28px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-medium leading-tight">{item.native}</span>
                          <span className="block truncate text-[9px] leading-tight text-mute/40">{item.english}</span>
                        </span>
                        {active ? <Check className="size-3.5 shrink-0 text-sky-ink" strokeWidth={3} /> : null}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
