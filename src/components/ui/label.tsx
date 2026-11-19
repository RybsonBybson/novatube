import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Label({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] text-mute/50", className)} {...props} />;
}
