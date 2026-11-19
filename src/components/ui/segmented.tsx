import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface SegmentedProps<T extends string> {
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  layoutId: string;
  className?: string;
  size?: "sm" | "md";
}

/** shadcn-style segmented control built on Radix Tabs with an animated pill. */
export function Segmented<T extends string>({ value, options, onChange, layoutId, className, size = "md" }: SegmentedProps<T>) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(next) => onChange(next as T)}>
      <TabsPrimitive.List className={cn("inline-flex items-center rounded-2xl bg-fog/[0.05] p-1", className)}>
        {options.map((option) => {
          const active = option.id === value;
          return (
            <TabsPrimitive.Trigger
              key={option.id}
              value={option.id}
              className={cn(
                "relative inline-flex items-center justify-center rounded-xl px-3.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lime/45",
                size === "sm" ? "h-7 text-[11px]" : "h-8 text-[11.5px]",
                active ? "text-on-accent" : "text-mute hover:text-mist",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={layoutId}
                  transition={{ type: "spring", stiffness: 450, damping: 34 }}
                  className="absolute inset-0 rounded-xl bg-lime shadow-[0_10px_28px_-14px_rgba(201,246,63,0.9)]"
                />
              ) : null}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                {option.label}
                {option.hint ? (
                  <span className={cn("text-[9.5px] font-normal", active ? "text-on-accent/55" : "text-mute/60")}>{option.hint}</span>
                ) : null}
              </span>
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
