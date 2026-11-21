import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * A scannable settings row: a small icon tile, a short plain-language title,
 * one line explaining the effect, and the control itself on the right.
 */
export function OptionRow({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 border-b border-fog/[0.055] py-3 last:border-0",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon ? (
          <span className="mt-px grid size-[26px] shrink-0 place-items-center rounded-[9px] bg-fog/[0.05] text-mute/65 ring-1 ring-inset ring-fog/[0.05]">
            <Icon className="size-3.5" strokeWidth={1.8} />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold leading-tight text-mist/85">{title}</p>
          {description ? <p className="mt-1 text-[9.5px] leading-relaxed text-mute/45">{description}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** Card shell that groups related rows without a heavy panel look. */
export function OptionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[18px] border border-fog/[0.07] bg-fog/[0.012] px-4 py-1", className)}>{children}</div>
  );
}
