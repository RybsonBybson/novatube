import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ToastEvent, ToastType } from "@shared/types";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

interface ToastInput {
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function nextId(): string {
  return `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

const TOAST_STYLE: Record<ToastType, { icon: typeof Info; tile: string; iconClass: string }> = {
  success: { icon: CheckCircle2, tile: "bg-saffron/10", iconClass: "text-saffron-ink" },
  error: { icon: AlertCircle, tile: "bg-danger/10", iconClass: "text-danger" },
  info: { icon: Info, tile: "bg-sky/10", iconClass: "text-sky-ink" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId();
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), toast.type === "error" ? 8000 : 5200),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    return api.onToast((toast) => {
      setToasts((current) => [...current.slice(-3), toast]);
      timers.current.set(
        toast.id,
        setTimeout(() => dismiss(toast.id), toast.type === "error" ? 9000 : 5200),
      );
    });
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex w-[330px] flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const config = TOAST_STYLE[toast.type];
            const Icon = config.icon;
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 22, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
                className="surface-hi pointer-events-auto relative overflow-hidden rounded-[20px] p-3.5 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.85)]"
              >
                <div className="flex items-start gap-2.5">
                  <div className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-[10px]", config.tile)}>
                    <Icon className={cn("size-4", config.iconClass)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-semibold text-mist/90">{toast.title}</p>
                    {toast.message ? <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-mute/70">{toast.message}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    aria-label="Dismiss notification"
                    className="grid size-5 shrink-0 place-items-center rounded-full text-mute/50 transition-colors hover:bg-fog/[0.07] hover:text-mist"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
