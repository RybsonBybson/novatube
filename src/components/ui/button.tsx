import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../icons/Animated";

const SPRING = { type: "spring" as const, stiffness: 520, damping: 30, mass: 0.6 };

export const buttonVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-[-0.01em] transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-sky/45 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:
          "bg-[linear-gradient(120deg,#4285f4_0%,#5b7ff2_52%,#9b72cb_100%)] text-white shadow-[0_18px_46px_-24px_rgba(66,133,244,0.95)] hover:brightness-110",
        secondary: "bg-fog/[0.07] text-mist/90 hover:bg-fog/[0.12] hover:text-mist",
        soft: "bg-fog/[0.05] text-mist/80 hover:bg-fog/[0.09] hover:text-mist",
        ghost: "text-mute hover:bg-fog/[0.06] hover:text-mist",
        outline: "bg-transparent text-mute hover:bg-fog/[0.06] hover:text-mist",
        danger: "bg-danger/15 text-danger hover:bg-danger/25",
      },
      size: {
        sm: "h-8 gap-1.5 px-3 text-[10.5px]",
        md: "h-10 gap-2 px-4 text-[11.5px]",
        lg: "h-12 gap-2 px-6 text-[12.5px]",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      | "onAnimationStart"
      | "onAnimationEnd"
      | "onAnimationIteration"
      | "onDrag"
      | "onDragStart"
      | "onDragEnd"
      | "onDragEnter"
      | "onDragExit"
      | "onDragLeave"
      | "onDragOver"
      | "onDrop"
    >,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), !asChild && "tactile", className);
  const inert = disabled || loading;

  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <motion.button
      whileHover={inert ? undefined : { scale: 1.02 }}
      whileTap={inert ? undefined : { scale: 0.94 }}
      transition={SPRING}
      className={classes}
      disabled={inert || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : children}
    </motion.button>
  );
}

type Tone = "default" | "accent" | "danger" | "sky";

interface IconButtonProps {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  tone?: Tone;
  className?: string;
  disabled?: boolean;
}

const TONES: Record<Tone, string> = {
  default: "text-mute hover:bg-fog/[0.07] hover:text-mist",
  accent: "text-mute hover:bg-sky/15 hover:text-sky-ink",
  sky: "text-mute hover:bg-sky/15 hover:text-sky-ink",
  danger: "text-mute hover:bg-danger/15 hover:text-danger",
};

export function IconButton({ children, label, onClick, tone = "default", className, disabled }: IconButtonProps) {
  return (
    <motion.button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      transition={SPRING}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky/45 disabled:pointer-events-none disabled:opacity-40",
        TONES[tone],
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

interface ChipProps {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}

export function Chip({ children, active = false, disabled = false, onClick, title, className }: ChipProps) {
  return (
    <motion.button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.035 }}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      transition={SPRING}
      className={cn(
        "tactile inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-sky/45",
        active ? "bg-sky text-on-sky shadow-[0_10px_26px_-14px_rgba(66,133,244,0.9)]" : "bg-fog/[0.045] text-mute hover:bg-fog/[0.085] hover:text-mist/85",
        disabled && "pointer-events-none opacity-25",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}
