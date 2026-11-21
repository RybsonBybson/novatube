import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES } from "@/lib/i18n";
import { useLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";
import { Flag } from "./Flag";

/** Compact language dropdown with soft flag badges, mirroring the desktop app. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const active = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0];

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(240, rect.width);
    let left = rect.right - width;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPosition({ top: rect.bottom + 8, left, width });
  }, []);

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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("lang.label")}
        title={t("lang.label")}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-full bg-secondary pl-1.5 pr-3 text-[12px] font-medium text-muted-foreground outline-none ring-1 ring-inset ring-border transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <Flag code={active.flag} shape="circle" className="size-[22px]" />
        <span className="max-w-[100px] truncate">{active.native}</span>
        <ChevronDown className={cn("size-3.5 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open && position
        ? createPortal(
            <AnimatePresence>
              <motion.div
                ref={panelRef}
                role="listbox"
                aria-label={t("lang.label")}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                style={{ top: position.top, left: position.left, width: position.width }}
                className="fixed z-[120] overflow-hidden rounded-[18px] border border-border bg-popover/95 p-1.5 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
              >
                <div className="max-h-[320px] overflow-y-auto">
                  {LANGUAGES.map((item) => {
                    const selected = item.code === language;
                    return (
                      <button
                        key={item.code}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setLanguage(item.code);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left outline-none transition-colors",
                          selected ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <Flag code={item.flag} className="h-[19px] w-[28px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium leading-tight">{item.native}</span>
                          <span className="block truncate text-[9.5px] leading-tight opacity-50">{item.english}</span>
                        </span>
                        {selected ? <Check className="size-3.5 shrink-0 text-primary" strokeWidth={3} /> : null}
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
