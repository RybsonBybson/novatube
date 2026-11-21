import type { ComponentType } from "react";
import ARFlag from "country-flag-icons/react/3x2/SA";
import CNFlag from "country-flag-icons/react/3x2/CN";
import DEFlag from "country-flag-icons/react/3x2/DE";
import ESFlag from "country-flag-icons/react/3x2/ES";
import FRFlag from "country-flag-icons/react/3x2/FR";
import GBFlag from "country-flag-icons/react/3x2/GB";
import INFlag from "country-flag-icons/react/3x2/IN";
import ITFlag from "country-flag-icons/react/3x2/IT";
import JPFlag from "country-flag-icons/react/3x2/JP";
import KRFlag from "country-flag-icons/react/3x2/KR";
import PLFlag from "country-flag-icons/react/3x2/PL";
import PTFlag from "country-flag-icons/react/3x2/PT";
import RUFlag from "country-flag-icons/react/3x2/RU";
import TRFlag from "country-flag-icons/react/3x2/TR";
import USFlag from "country-flag-icons/react/3x2/US";
import { cn } from "../lib/utils";

const FLAGS: Record<string, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  US: USFlag,
  GB: GBFlag,
  ES: ESFlag,
  PT: PTFlag,
  RU: RUFlag,
  CN: CNFlag,
  JP: JPFlag,
  PL: PLFlag,
  DE: DEFlag,
  FR: FRFlag,
  SA: ARFlag,
  IN: INFlag,
  KR: KRFlag,
  IT: ITFlag,
  TR: TRFlag,
};

interface FlagProps {
  /** ISO 3166-1 alpha-2 country code, e.g. "US" or "SA". */
  code: string;
  className?: string;
  /** Circle crops look best in tight pills; rectangles read better in lists. */
  shape?: "rounded" | "circle";
  title?: string;
}

const SIZE: Record<NonNullable<FlagProps["shape"]>, string> = {
  rounded: "rounded-[6px]",
  circle: "rounded-full",
};

/**
 * Soft, tactile flag badge used by the language switcher. A subtle ring and
 * inner shadow keep it sitting on the glass surfaces instead of floating.
 */
export function Flag({ code, className, shape = "rounded", title }: FlagProps) {
  const Icon = FLAGS[code] ?? USFlag;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-ink-800 ring-1 ring-inset ring-white/15 shadow-[0_1px_4px_rgba(0,0,0,0.45)]",
        SIZE[shape],
        className,
      )}
      title={title}
    >
      <span className={cn("block h-full w-full", shape === "circle" && "scale-[1.42]")}>
        <Icon className="block h-full w-full object-cover" aria-hidden />
      </span>
      {/* Soften saturation a touch so the flags match the muted Gemini palette. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-ink-950/10 mix-blend-multiply" />
    </span>
  );
}
