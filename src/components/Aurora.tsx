import { motion } from "framer-motion";

const BLOBS = [
  { color: "#f0bc00", x: "-14%", size: 520, delay: 0 },
  { color: "#ff8b1f", x: "16%", size: 470, delay: 0.9 },
  { color: "#ff476f", x: "46%", size: 450, delay: 1.8 },
  { color: "#d175ff", x: "72%", size: 430, delay: 2.7 },
  { color: "#9ebdff", x: "96%", size: 470, delay: 3.6 },
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
          animate={{ opacity: [0.07, 0.15, 0.07], scale: [1, 1.08, 1] }}
          transition={{ duration: 9, delay: blob.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
