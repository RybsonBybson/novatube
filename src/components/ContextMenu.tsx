import { AnimatePresence, motion } from "framer-motion";
import { ClipboardCopy, ClipboardPaste, Scissors, TextSelect } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

export interface ContextMenuState {
  x: number;
  y: number;
  target: HTMLInputElement | HTMLTextAreaElement;
}

export function isEditableTarget(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "range", "button", "submit", "file", "color"].includes(target.type);
  }
  return target instanceof HTMLTextAreaElement || target.isContentEditable;
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  useEffect(() => {
    if (!state) return;
    setSelection({ start: state.target.selectionStart ?? 0, end: state.target.selectionEnd ?? 0 });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  const target = state.target;
  const hasSelection = selection.end > selection.start;
  const isPassword = target instanceof HTMLInputElement && target.type === "password";
  const currentValue = target.value ?? "";
  const selected = currentValue.slice(selection.start, selection.end);

  const focusTarget = () => {
    target.focus();
    target.setSelectionRange(selection.start, selection.end);
  };

  const copy = async () => {
    if (!selected) return;
    await api.clipboard.writeText(selected).catch(() => undefined);
    focusTarget();
    onClose();
  };

  const cut = async () => {
    if (!selected) return;
    await api.clipboard.writeText(selected).catch(() => undefined);
    const next = currentValue.slice(0, selection.start) + currentValue.slice(selection.end);
    const setter = Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set;
    setter?.call(target, next);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.focus();
    target.setSelectionRange(selection.start, selection.start);
    onClose();
  };

  const paste = async () => {
    try {
      const text = await api.clipboard.readText();
      if (!text) return;
      const next = currentValue.slice(0, selection.start) + text + currentValue.slice(selection.end);
      const setter = Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set;
      setter?.call(target, next);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.focus();
      const position = selection.start + text.length;
      target.setSelectionRange(position, position);
    } finally {
      onClose();
    }
  };

  const selectAll = () => {
    target.focus();
    target.select();
    onClose();
  };

  const x = Math.min(state.x, window.innerWidth - 190);
  const y = Math.min(state.y, window.innerHeight - 190);

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.96, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.12 }}
        className="surface-hi fixed z-[300] flex w-[178px] flex-col gap-0.5 overflow-hidden rounded-[18px] p-1.5 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.9)]"
        style={{ left: x, top: y }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <MenuItem icon={ClipboardCopy} label="Copy" hint="Ctrl+C" disabled={!hasSelection || isPassword} onClick={() => void copy()} />
        <MenuItem icon={Scissors} label="Cut" hint="Ctrl+X" disabled={!hasSelection || isPassword} onClick={() => void cut()} />
        <MenuItem icon={ClipboardPaste} label="Paste" hint="Ctrl+V" onClick={() => void paste()} />
        <MenuItem icon={TextSelect} label="Select all" hint="Ctrl+A" onClick={selectAll} />
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function MenuItem({
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: typeof ClipboardCopy;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[11px] transition-colors",
        disabled ? "cursor-not-allowed text-mute/30" : "text-mist/70 hover:bg-fog/[0.07] hover:text-mist",
      )}
    >
      <Icon className="size-3.5" />
      <span className="flex-1">{label}</span>
      <span className="text-[8.5px] text-mute/35">{hint}</span>
    </button>
  );
}
