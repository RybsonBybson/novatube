import { motion } from "framer-motion";
import { Download, Loader2, Sparkles, type LucideProps } from "lucide-react";
import { cn } from "../../lib/utils";

export function Spinner({ className, ...props }: LucideProps) {
  return (
    <motion.span className={cn("inline-flex", className)} animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}>
      <Loader2 {...props} className="size-full" />
    </motion.span>
  );
}

export function AnimatedDownload({ className, ...props }: LucideProps) {
  return (
    <motion.span className={cn("inline-flex", className)} whileHover={{ y: [0, 2.5, 0] }} transition={{ duration: 0.45 }}>
      <Download {...props} className="size-full" />
    </motion.span>
  );
}

export function AnimatedSparkles({ className, ...props }: LucideProps) {
  return (
    <motion.span
      className={cn("inline-flex", className)}
      animate={{ rotate: [0, 8, -4, 0], scale: [1, 1.08, 1] }}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      whileHover={{ rotate: 22, scale: 1.18 }}
    >
      <Sparkles {...props} className="size-full" />
    </motion.span>
  );
}
