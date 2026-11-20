import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-ink-750 outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-sky/45 disabled:pointer-events-none disabled:opacity-40 data-[state=checked]:bg-[linear-gradient(120deg,#4285f4,#9b72cb)] active:scale-[0.96]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[18px] translate-x-[3px] rounded-full bg-mist/70 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-white data-[state=checked]:shadow-[0_2px_10px_rgba(11,13,19,0.35)]" />
    </SwitchPrimitive.Root>
  );
}
