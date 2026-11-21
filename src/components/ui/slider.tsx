import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../lib/utils";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Fires continuously while dragging; keep the UI responsive here. */
  onChange: (value: number) => void;
  /** Fires once when the drag/click ends; persist here, not on every tick. */
  onCommit?: (value: number) => void;
  className?: string;
  label?: string;
}

export function Slider({ value, min, max, step = 1, onChange, onCommit, className, label }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn(
        // `touch-none` stops the page from scrolling mid-drag; the generous hit
        // area makes the small thumb easy to grab.
        "relative flex h-6 w-full cursor-pointer touch-none select-none items-center",
        className,
      )}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([next]) => onChange(next)}
      onValueCommit={([next]) => onCommit?.(next)}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-fog/10">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-[linear-gradient(90deg,#4285f4,#9b72cb)]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        className="block size-4 rounded-full bg-white ring-2 ring-sky shadow-[0_2px_14px_rgba(66,133,244,0.65)] outline-none transition-transform duration-150 hover:scale-110 active:scale-125 focus-visible:ring-4 focus-visible:ring-sky/50"
      />
    </SliderPrimitive.Root>
  );
}
