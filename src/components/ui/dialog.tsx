import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-[140] bg-black/55 backdrop-blur-md data-[state=open]:animate-[nova-fade_0.16s_ease-out] data-[state=closed]:animate-[nova-fade-out_0.14s_ease-in]",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({ className, children, showClose = true, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[150] w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-card p-6 text-card-foreground shadow-[0_60px_160px_-50px_rgba(0,0,0,0.92)] outline-none data-[state=open]:animate-[nova-pop_0.18s_ease-out] data-[state=closed]:animate-[nova-pop-out_0.14s_ease-in]",
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-mute outline-none transition-colors hover:bg-fog/[0.07] hover:text-mist focus-visible:ring-2 focus-visible:ring-lime/45"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
