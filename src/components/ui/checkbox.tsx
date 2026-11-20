import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-[7px] bg-ink-750 text-transparent outline-none transition-all duration-200 hover:bg-ink-700 focus-visible:ring-2 focus-visible:ring-sky/45 data-[state=checked]:bg-sky data-[state=checked]:text-on-sky",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
