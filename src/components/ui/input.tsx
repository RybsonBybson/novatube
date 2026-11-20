import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
}

/** Borderless field that lifts its tone on focus — no hard outline. */
export function Input({ className, icon, ...props }: InputProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl bg-fog/[0.05] px-3.5 transition-colors duration-200 focus-within:bg-fog/[0.08] focus-within:ring-1 focus-within:ring-sky/45",
        className,
      )}
    >
      {icon ? <span className="shrink-0 text-mute/60">{icon}</span> : null}
      <input
        className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[11.5px] text-mist placeholder:text-mute/50 focus:outline-none"
        {...props}
      />
    </div>
  );
}
