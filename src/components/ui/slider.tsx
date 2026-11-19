import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../lib/utils";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  label?: string;
}

export function Slider({ value, min, max, step = 1, onChange, className, label }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-5 w-full touch-none select-none items-center", className)}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([next]) => onChange(next)}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-fog/10">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-r from-saffron via-orange to-pink" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        className="block size-4 rounded-full bg-saffron shadow-[0_2px_12px_rgba(0,0,0,0.55)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-saffron/50"
      />
    </SliderPrimitive.Root>
  );
}
