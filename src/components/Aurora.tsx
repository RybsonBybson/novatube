import { motion } from "framer-motion";

const BLOBS = [
  { color: "#c9f63f", x: "-12%", size: 520, delay: 0 },
  { color: "#45e6c8", x: "42%", size: 460, delay: 1.4 },
  { color: "#ff8a6b", x: "86%", size: 420, delay: 2.6 },
];

export function Aurora({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden" style={{ height: compact ? 200 : 340 }}>
      {BLOBS.map((blob) => (
        <motion.div
          key={blob.color}
          className="absolute top-[-260px] rounded-full blur-[150px]"
          style={{
            left: blob.x,
            width: blob.size,
            height: blob.size,
            background: `radial-gradient(closest-side, ${blob.color}, transparent 72%)`,
          }}
          animate={{ opacity: [0.08, 0.16, 0.08], scale: [1, 1.08, 1] }}
          transition={{ duration: 9, delay: blob.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
